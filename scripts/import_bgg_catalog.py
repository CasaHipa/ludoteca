#!/usr/bin/env python3
"""
Build the ludoteca catalog from an Excel/CSV file using BoardGameGeek XML API2.

Expected input columns:
- Required: a game name column named like "juego", "nombre", "titulo", "title" or "name".
- Optional: a free-text location column named like "ubicacion", "ubicación" or "location".

Example:
    python3 scripts/import_bgg_catalog.py juegos.xlsx --output src/data.js

The script writes the same shape consumed by the web app's src/data.js fallback.
BoardGameGeek can throttle bursts, so this script intentionally sleeps between
requests and retries temporary 202/429/5xx responses.
"""

from __future__ import annotations

import argparse
import csv
import html
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path
from typing import Any


BGG_BASE_URL = "https://boardgamegeek.com/xmlapi2"
DEFAULT_SLEEP_SECONDS = 2.5
DEFAULT_BATCH_PAUSE_SECONDS = 20.0
DEFAULT_BATCH_SIZE = 25
MAX_RETRIES = 6

NAME_HEADERS = ("juego", "nombre", "titulo", "título", "title", "name")
LOCATION_HEADERS = ("ubicacion", "ubicación", "location", "ubic")


def normalize_header(value: Any) -> str:
    return str(value or "").strip().lower()


def normalize_match_text(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().lower())


def read_sheet_strings(xlsx_path: Path) -> list[str]:
    with zipfile.ZipFile(xlsx_path) as archive:
        if "xl/sharedStrings.xml" not in archive.namelist():
            return []

        root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
        namespace = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
        strings: list[str] = []
        for item in root.findall("x:si", namespace):
            parts = [node.text or "" for node in item.findall(".//x:t", namespace)]
            strings.append("".join(parts))
        return strings


def column_index(cell_ref: str) -> int:
    letters = "".join(ch for ch in cell_ref if ch.isalpha()).upper()
    index = 0
    for char in letters:
        index = index * 26 + (ord(char) - ord("A") + 1)
    return index - 1


def read_xlsx(path: Path) -> list[list[str]]:
    shared_strings = read_sheet_strings(path)
    with zipfile.ZipFile(path) as archive:
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        namespace = {
            "x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
            "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        }
        first_sheet = workbook.find("x:sheets/x:sheet", namespace)
        if first_sheet is None:
            return []

        rel_id = first_sheet.attrib[f"{{{namespace['r']}}}id"]
        rels = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        rel_namespace = {"r": "http://schemas.openxmlformats.org/package/2006/relationships"}
        target = None
        for rel in rels.findall("r:Relationship", rel_namespace):
            if rel.attrib.get("Id") == rel_id:
                target = rel.attrib["Target"]
                break
        if not target:
            return []

        sheet_path = "xl/" + target.lstrip("/")
        sheet = ET.fromstring(archive.read(sheet_path))
        rows: list[list[str]] = []
        sheet_namespace = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}

        for row in sheet.findall(".//x:sheetData/x:row", sheet_namespace):
            values: list[str] = []
            for cell in row.findall("x:c", sheet_namespace):
                ref = cell.attrib.get("r", "")
                idx = column_index(ref)
                while len(values) <= idx:
                    values.append("")

                cell_type = cell.attrib.get("t")
                value_node = cell.find("x:v", sheet_namespace)
                inline_text_node = cell.find("x:is/x:t", sheet_namespace)

                if cell_type == "s" and value_node is not None:
                    shared_idx = int(value_node.text or "0")
                    values[idx] = shared_strings[shared_idx] if shared_idx < len(shared_strings) else ""
                elif cell_type == "inlineStr" and inline_text_node is not None:
                    values[idx] = inline_text_node.text or ""
                elif value_node is not None:
                    values[idx] = value_node.text or ""
                else:
                    values[idx] = ""
            rows.append(values)
        return rows


def read_csv(path: Path) -> list[list[str]]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        return [row for row in csv.reader(handle)]


def read_input_rows(path: Path) -> list[list[str]]:
    suffix = path.suffix.lower()
    if suffix == ".xlsx":
        return read_xlsx(path)
    if suffix == ".csv":
        return read_csv(path)
    raise ValueError("Formato no soportado. Usá .xlsx o .csv.")


def find_column(headers: list[str], candidates: tuple[str, ...]) -> int:
    for idx, header in enumerate(headers):
        normalized = normalize_header(header)
        if any(candidate in normalized for candidate in candidates):
            return idx
    return -1


def load_input_games(path: Path) -> list[dict[str, str]]:
    rows = read_input_rows(path)
    if not rows:
        return []

    headers = [normalize_header(value) for value in rows[0]]
    name_idx = find_column(headers, NAME_HEADERS)
    location_idx = find_column(headers, LOCATION_HEADERS)
    if name_idx < 0:
        raise ValueError("No encontré una columna de nombre de juego.")

    games: list[dict[str, str]] = []
    seen: set[str] = set()
    for row in rows[1:]:
        name = str(row[name_idx]).strip() if name_idx < len(row) else ""
        if not name:
            continue
        normalized = normalize_match_text(name)
        if normalized in seen:
            continue
        seen.add(normalized)
        location = str(row[location_idx]).strip() if 0 <= location_idx < len(row) else ""
        games.append({"name": name, "location": location})
    return games


def bgg_get(path: str, params: dict[str, str], sleep_seconds: float) -> ET.Element:
    url = f"{BGG_BASE_URL}/{path}?{urllib.parse.urlencode(params)}"
    last_error: Exception | None = None

    for attempt in range(1, MAX_RETRIES + 1):
        if attempt > 1 or sleep_seconds > 0:
            time.sleep(sleep_seconds if attempt == 1 else min(60, sleep_seconds * attempt * 2))

        try:
            request = urllib.request.Request(url, headers={"User-Agent": "ludoteca-catalog-import/1.0"})
            with urllib.request.urlopen(request, timeout=45) as response:
                return ET.fromstring(response.read())
        except urllib.error.HTTPError as exc:
            last_error = exc
            if exc.code not in (202, 429, 500, 502, 503, 504):
                raise
            print(f"BGG {exc.code}; reintento {attempt}/{MAX_RETRIES}: {url}", file=sys.stderr)
        except (urllib.error.URLError, TimeoutError, ET.ParseError) as exc:
            last_error = exc
            print(f"Error temporal; reintento {attempt}/{MAX_RETRIES}: {exc}", file=sys.stderr)

    raise RuntimeError(f"No pude obtener respuesta de BGG: {url}") from last_error


def xml_value(node: ET.Element | None, default: str = "") -> str:
    if node is None:
        return default
    return html.unescape(node.attrib.get("value", default))


def int_value(node: ET.Element | None, default: int | None = None) -> int | None:
    value = xml_value(node)
    if value in ("", "0"):
        return default
    try:
        return int(float(value))
    except ValueError:
        return default


def float_value(node: ET.Element | None, default: float | None = None) -> float | None:
    value = xml_value(node)
    try:
        parsed = float(value)
    except ValueError:
        return default
    return parsed if parsed > 0 else default


def complexity_label(weight: float | None) -> str:
    if weight is None:
        return ""
    if weight < 1.8:
        return "Liviano"
    if weight < 2.4:
        return "Medio-Liviano"
    if weight < 3.4:
        return "Medio"
    if weight < 4.2:
        return "Medio-Pesado"
    return "Pesado"


def duration_label(minutes: int | None) -> str:
    if minutes is None:
        return ""
    if minutes <= 30:
        return "Corto"
    if minutes <= 60:
        return "Moderado"
    if minutes <= 120:
        return "Medio-Largo"
    return "Largo"


def parse_player_poll(item: ET.Element) -> tuple[str, str]:
    poll = item.find("poll[@name='suggested_numplayers']")
    if poll is None:
        return "", ""

    recommended: list[int] = []
    best: list[int] = []
    for results in poll.findall("results"):
        numplayers = results.attrib.get("numplayers", "")
        if not numplayers.isdigit():
            continue

        votes = {result.attrib.get("value"): int(result.attrib.get("numvotes", "0")) for result in results.findall("result")}
        best_votes = votes.get("Best", 0)
        recommended_votes = votes.get("Recommended", 0)
        not_recommended_votes = votes.get("Not Recommended", 0)
        players = int(numplayers)

        if best_votes > 0 and best_votes >= recommended_votes and best_votes >= not_recommended_votes:
            best.append(players)
        if best_votes + recommended_votes > not_recommended_votes:
            recommended.append(players)

    return compact_number_ranges(recommended), compact_number_ranges(best)


def parse_age_poll(item: ET.Element) -> int | None:
    poll = item.find("poll[@name='suggested_playerage']")
    if poll is None:
        return None

    votes_by_age: list[tuple[int, int]] = []
    for result in poll.findall("results/result"):
        value = result.attrib.get("value", "")
        if not value.isdigit():
            continue
        votes = int(result.attrib.get("numvotes", "0"))
        if votes > 0:
            votes_by_age.append((int(value), votes))

    if not votes_by_age:
        return None
    return max(votes_by_age, key=lambda item: item[1])[0]


def compact_number_ranges(values: list[int]) -> str:
    unique = sorted(set(values))
    if not unique:
        return ""

    ranges: list[str] = []
    start = previous = unique[0]
    for value in unique[1:]:
        if value == previous + 1:
            previous = value
            continue
        ranges.append(str(start) if start == previous else f"{start}-{previous}")
        start = previous = value
    ranges.append(str(start) if start == previous else f"{start}-{previous}")
    return ", ".join(ranges)


def find_bgg_id(name: str, sleep_seconds: float) -> str | None:
    root = bgg_get("search", {"query": name, "type": "boardgame"}, sleep_seconds)
    items = root.findall("item")
    if not items:
        return None

    wanted = normalize_match_text(name)
    for item in items:
        item_name = item.find("name")
        if item_name is not None and normalize_match_text(item_name.attrib.get("value", "")) == wanted:
            return item.attrib.get("id")

    for item in items:
        item_name = item.find("name")
        if item_name is not None and normalize_match_text(item_name.attrib.get("value", "")).startswith(wanted):
            return item.attrib.get("id")

    return items[0].attrib.get("id")


def fetch_bgg_game(bgg_id: str, original_name: str, location: str, sleep_seconds: float) -> dict[str, Any]:
    root = bgg_get("thing", {"id": bgg_id, "stats": "1"}, sleep_seconds)
    item = root.find("item")
    if item is None:
        raise ValueError(f"BGG no devolvió datos para id {bgg_id}")

    primary_name = item.find("name[@type='primary']")
    name = xml_value(primary_name, original_name)
    min_players = int_value(item.find("minplayers"))
    max_players = int_value(item.find("maxplayers"))
    min_age = int_value(item.find("minage"))
    min_time = int_value(item.find("minplaytime"))
    max_time = int_value(item.find("maxplaytime"))
    playing_time = int_value(item.find("playingtime"))
    if playing_time is None and min_time is not None and max_time is not None:
        playing_time = round((min_time + max_time) / 2)

    categories: list[str] = []
    mechanics: list[str] = []
    for link in item.findall("link"):
        link_type = link.attrib.get("type")
        value = html.unescape(link.attrib.get("value", "")).strip()
        if not value:
            continue
        if link_type == "boardgamecategory":
            categories.append(value)
        elif link_type == "boardgamemechanic":
            mechanics.append(value)

    statistics = item.find("statistics/ratings")
    score = float_value(statistics.find("average") if statistics is not None else None)
    weight = float_value(statistics.find("averageweight") if statistics is not None else None)
    community_players, best_players = parse_player_poll(item)
    community_age = parse_age_poll(item)

    if min_players is not None and max_players is not None:
        players = f"{min_players}-{max_players}"
    else:
        players = ""

    if min_time is not None and max_time is not None and min_time != max_time:
        minutes_label = f"{min_time}-{max_time}"
    elif playing_time is not None:
        minutes_label = str(playing_time)
    else:
        minutes_label = ""

    return {
        "bgg_id": bgg_id,
        "juego": name,
        "nombre_excel": original_name,
        "jug_min": min_players,
        "jug_max": max_players,
        "jugadores": players,
        "jugadores_comunidad": community_players,
        "mejor_jugadores": best_players,
        "suggested_numplayers": community_players,
        "minutos_min": min_time,
        "minutos_max": max_time,
        "minutos": playing_time,
        "minutos_label": minutes_label,
        "longitud": duration_label(playing_time),
        "edad_minima": min_age,
        "edad_comunidad": community_age,
        "categorias": categories,
        "categorias_str": ", ".join(categories),
        "mecanicas": mechanics,
        "mecanicas_str": ", ".join(mechanics),
        "score": round(score, 1) if score is not None else None,
        "complejidad_num": round(weight, 1) if weight is not None else None,
        "complejidad": complexity_label(weight),
        "ubicacion": location,
    }


def write_data_js(path: Path, rows: list[dict[str, Any]]) -> None:
    payload = json.dumps(rows, ensure_ascii=False, separators=(",", ":"))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"export const rows = {payload};\n", encoding="utf-8")


def write_json(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Importar catálogo desde Excel/CSV y enriquecerlo con BGG.")
    parser.add_argument("input", type=Path, help="Archivo .xlsx o .csv con columna de nombre de juego.")
    parser.add_argument("--output", type=Path, default=Path("src/data.js"), help="Salida JS compatible con la app.")
    parser.add_argument("--json-output", type=Path, help="Opcional: guardar también un JSON del catálogo.")
    parser.add_argument("--sleep", type=float, default=DEFAULT_SLEEP_SECONDS, help="Segundos entre llamadas a BGG.")
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE, help="Cantidad de juegos antes de una pausa larga.")
    parser.add_argument("--batch-pause", type=float, default=DEFAULT_BATCH_PAUSE_SECONDS, help="Pausa larga entre lotes.")
    parser.add_argument("--limit", type=int, help="Procesar sólo los primeros N juegos, útil para pruebas.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    input_path = args.input
    if not input_path.exists():
        print(f"No existe el archivo: {input_path}", file=sys.stderr)
        return 1

    input_games = load_input_games(input_path)
    if args.limit:
        input_games = input_games[: args.limit]
    if not input_games:
        print("No encontré juegos para procesar.", file=sys.stderr)
        return 1

    rows: list[dict[str, Any]] = []
    failures: list[str] = []

    for idx, game in enumerate(input_games, start=1):
        name = game["name"]
        print(f"[{idx}/{len(input_games)}] Buscando: {name}")
        try:
            bgg_id = find_bgg_id(name, args.sleep)
            if not bgg_id:
                raise ValueError("sin resultados en BGG")
            rows.append(fetch_bgg_game(bgg_id, name, game["location"], args.sleep))
        except Exception as exc:
            failures.append(f"{name}: {exc}")
            print(f"  ERROR: {name}: {exc}", file=sys.stderr)

        if args.batch_size > 0 and idx % args.batch_size == 0 and idx < len(input_games):
            print(f"Pausa de {args.batch_pause:.1f}s para evitar throttling de BGG...")
            time.sleep(args.batch_pause)

    rows.sort(key=lambda item: (-(item.get("score") or 0), item.get("juego") or ""))
    write_data_js(args.output, rows)
    if args.json_output:
        write_json(args.json_output, rows)

    print(f"Catálogo escrito en {args.output} ({len(rows)} juegos).")
    if failures:
        print("\nJuegos no importados:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
