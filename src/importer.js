import readXlsxFile from 'read-excel-file';

const splitList = (value) => String(value || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

export async function importExcel(file) {
    try {
        const rows = await readXlsxFile(file);
        if (!rows?.length) return { count: 0, games: [] };

        const headers = rows[0].map(h => String(h || '').toLowerCase().trim());
        const gameIdx = headers.findIndex(h => h.includes('juego') || h.includes('name') || h.includes('titulo'));
        const ubicacionIdx = headers.findIndex(h => h.includes('ubicaci'));
        const categoriasIdx = headers.findIndex(h => h.includes('categor'));
        const mecanicasIdx = headers.findIndex(h => h.includes('mecani') || h.includes('mechanic'));
        const suggestedPlayersIdx = headers.findIndex(h => h.includes('suggested_numplayers') || h.includes('jugadores sugeridos'));

        if (gameIdx === -1) throw new Error("No se encontró la columna 'Juego' o 'Nombre' en el Excel.");

        let count = 0;
        const parsedGames = [];
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i] || [];
            const name = row[gameIdx];
            if (!name) continue;

            const categorias = categoriasIdx >= 0 ? splitList(row[categoriasIdx]) : [];
            const mecanicas = mecanicasIdx >= 0 ? splitList(row[mecanicasIdx]) : [];
            const suggested = suggestedPlayersIdx >= 0 ? String(row[suggestedPlayersIdx] || '').trim() : '';

            parsedGames.push({
                juego: String(name).trim(),
                jug_min: 1,
                jug_max: 4,
                minutos: 60,
                complejidad: 'Medio',
                categorias,
                categorias_str: categorias.join(', '),
                mecanicas,
                mecanicas_str: mecanicas.join(', '),
                suggested_numplayers: suggested,
                ubicacion: ubicacionIdx >= 0 ? String(row[ubicacionIdx] || '').trim() : '',
                createdAt: new Date()
            });
            count++;
        }
        return { count, games: parsedGames };
    } catch (e) {
        console.error('Error importing Excel:', e);
        throw e;
    }
}
