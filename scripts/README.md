# Importar catálogo desde BoardGameGeek

El script `import_bgg_catalog.py` genera el catálogo local que consume la app (`src/data.js`) a partir de un Excel o CSV.

Por defecto es incremental: lee el catálogo actual de `src/data.js`, reutiliza los juegos que ya existen y consulta BoardGameGeek sólo para juegos nuevos del Excel/CSV. Si el archivo trae una ubicación nueva para un juego existente, actualiza ese campo.

Si `tqdm` está instalado, muestra una barra de progreso con contadores de juegos reutilizados, consultados en BGG y fallas. Si no está instalado, el script funciona igual con logs simples.

## Formato del archivo

Debe tener una primera fila con encabezados.

Columnas soportadas:

- `juego`, `nombre`, `titulo`, `title` o `name`: requerida.
- `ubicacion`, `ubicación` o `location`: opcional, campo libre para la ubicación física.

También se acepta un archivo "solo nombres", sin encabezado, con los juegos en la primera columna.

Ejemplo:

```csv
juego,ubicacion
Ark Nova,primer estante arriba
Brass Birmingham,segundo estante
```

## Uso

Si usás el Excel por defecto `scripts/Ludoteca Casa Hipa - Solo nombres.xlsx`, podés correr:

```bash
cd scripts
python import_bgg_catalog.py
```

Eso escribe `../src/data.js` y `../import-fallas.txt`.

```bash
python3 scripts/import_bgg_catalog.py juegos.xlsx --output src/data.js
```

También podés dejar el archivo dentro de `scripts/` y pasar esa ruta:

```bash
python3 scripts/import_bgg_catalog.py scripts/juegos.xlsx --output src/data.js
```

Para reconstruir el catálogo desde cero, sin reutilizar datos existentes:

```bash
python3 scripts/import_bgg_catalog.py scripts/juegos.xlsx --output src/data.js --replace
```

Para forzar que BGG se consulte incluso para juegos ya existentes:

```bash
python3 scripts/import_bgg_catalog.py scripts/juegos.xlsx --output src/data.js --refresh-existing
```

Para probar con pocos juegos:

```bash
python3 scripts/import_bgg_catalog.py juegos.xlsx --limit 5 --output src/data.js
```

Para guardar también un JSON que luego puede subirse a Firestore `catalog`:

```bash
python3 scripts/import_bgg_catalog.py juegos.xlsx --output src/data.js --json-output catalog.json
```

Para guardar un reporte de los juegos que no se pudieron importar:

```bash
python3 scripts/import_bgg_catalog.py scripts/juegos.xlsx --output src/data.js --failures-output import-fallas.txt
```

## Pausas contra throttling

BoardGameGeek limita llamadas seguidas. Por defecto el script:

- espera `2.5s` entre requests;
- cada `25` juegos hace una pausa de `20s`;
- reintenta errores temporales `202`, `429` y `5xx`;
- si BGG devuelve `Retry-After`, espera ese tiempo antes de reintentar.

Se puede ajustar:

```bash
python3 scripts/import_bgg_catalog.py juegos.xlsx --sleep 4 --batch-size 20 --batch-pause 45 --max-retries 8
```

Después de generar `src/data.js`, correr:

```bash
npm run build
```

La web usa Firestore `catalog` primero; si esa colección está vacía, usa `src/data.js` como fallback estático.
