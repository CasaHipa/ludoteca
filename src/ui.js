
const multiFilterNames = ['players', 'complexity', 'duration', 'mechanics'];
export const filters = { players: [], complexity: [], duration: [], mechanics: [], search: "" };
let currentGames = []; // Store the current list of games
let sortedGames = [];
let searchDebounceTimer = null;
let isLoading = false;
let eventListenersReady = false;

// DOM Elements
const groups = document.querySelectorAll('[data-filter]');
const searchInput = document.querySelector('#search');
const counter = document.querySelector('#matchCount');
const results = document.querySelector('#results');
const resetBtn = document.querySelector('#resetFilters');
const TOP_FILTER_CHIPS_LIMIT = 10;

function buildTopFrequencyChips(games, groupSelector, fieldName) {
    const group = document.querySelector(`[data-filter="${groupSelector}"]`);
    if (!group) return;

    const freq = new Map();
    games.forEach(game => {
        const values = Array.isArray(game[fieldName]) ? game[fieldName] : [];
        values.forEach(value => {
            const normalized = String(value).trim();
            if (!normalized) return;
            freq.set(normalized, (freq.get(normalized) || 0) + 1);
        });
    });

    group.querySelectorAll('button[data-value]:not([data-value=""])').forEach(btn => btn.remove());

    const topValues = Array.from(freq.entries())
        .sort((a, b) => {
            if (b[1] !== a[1]) return b[1] - a[1];
            return a[0].localeCompare(b[0]);
        })
        .slice(0, TOP_FILTER_CHIPS_LIMIT)
        .map(([value]) => value);

    topValues.forEach(value => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'chip';
        btn.dataset.value = value;
        btn.textContent = value;
        group.appendChild(btn);
    });

    syncFilterGroupActive(groupSelector);

    // Los elementos fuera del top de chips siguen siendo descubribles vía búsqueda libre.
}

function getSelectedValues(name) {
    return Array.isArray(filters[name]) ? filters[name] : [];
}

function toggleFilterValue(name, value) {
    if (!multiFilterNames.includes(name)) return;
    if (value === '') {
        filters[name] = [];
        return;
    }

    const selected = getSelectedValues(name);
    filters[name] = selected.includes(value)
        ? selected.filter(item => item !== value)
        : [...selected, value];
}

function syncFilterGroupActive(name) {
    const group = document.querySelector(`[data-filter="${name}"]`);
    if (!group) return;
    const selected = getSelectedValues(name);

    group.querySelectorAll('button').forEach(btn => {
        const value = btn.dataset.value ?? '';
        btn.classList.toggle('is-active', value === '' ? selected.length === 0 : selected.includes(value));
    });
}

function syncAllFilterGroups() {
    multiFilterNames.forEach(syncFilterGroupActive);
}

export function initUI(games, options = {}) {
    isLoading = Boolean(options.loading);
    setGamesDataset(games);

    // Initialize Filter Buttons
    const playerGroup = document.querySelector('[data-filter="players"]');
    // Clear existing buttons if any (except the "Cualquiera" one if we want to keep it, but easier to rebuild)
    // Actually, the HTML structure might be static, let's assume the HTML structure for filters exists.
    // The original code dynamically added player buttons.

    if (playerGroup && playerGroup.children.length <= 1) { // Only "Cualquiera" exists
        const playerOptions = [1, 2, 3, 4, 5, 6, 7, 8];
        playerOptions.forEach(num => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'chip';
            btn.dataset.value = String(num);
            btn.textContent = num;
            playerGroup.appendChild(btn);
        });
    }


    buildTopFrequencyChips(games, 'mechanics', 'mecanicas');
    buildTopFrequencyChips(games, 'categories', 'categorias');
    buildTopFrequencyChips(games, 'genres', 'generos');
    syncAllFilterGroups();

    if (!eventListenersReady) {
        setupEventListeners();
        eventListenersReady = true;
    }
    applyFilters();
}

export function updateGames(newGames) {
    isLoading = false;
    setGamesDataset(newGames);
    buildTopFrequencyChips(currentGames, 'mechanics', 'mecanicas');
    buildTopFrequencyChips(currentGames, 'categories', 'categorias');
    buildTopFrequencyChips(currentGames, 'genres', 'generos');
    syncAllFilterGroups();
    applyFilters();
}

export function setLoading(loading = true) {
    isLoading = loading;
    applyFilters();
}

function normalizeSearchText(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

function tokenizeSearchText(value) {
    return normalizeSearchText(value)
        .split(/[^a-z0-9]+/i)
        .filter(Boolean);
}

function setGamesDataset(games) {
    currentGames = (games || []).map(game => ({
        ...game,
        search_tokens: tokenizeSearchText([
            game.juego || '',
            game.categorias_str || '',
            game.mecanicas_str || ''
        ].join(' '))
    }));

    sortedGames = currentGames.slice().sort((a, b) => {
        const scoreA = a.score ?? 0;
        const scoreB = b.score ?? 0;
        if (scoreA === scoreB) {
            return (a.juego || '').localeCompare(b.juego || '');
        }
        return scoreB - scoreA;
    });

    updateAutocomplete(currentGames);
}

function updateAutocomplete(games) {
    const suggestions = new Set();
    games.forEach(game => {
        if (game.juego) suggestions.add(game.juego);
        if (game.categorias) {
            game.categorias.forEach(c => suggestions.add(c));
        }
        if (game.mecanicas) {
            game.mecanicas.forEach(m => suggestions.add(m));
        }
    });

    const datalist = document.getElementById('search-suggestions');
    if (datalist) {
        datalist.innerHTML = '';
        Array.from(suggestions).sort().forEach(value => {
            const option = document.createElement('option');
            option.value = value;
            datalist.appendChild(option);
        });
    }
}

function setupEventListeners() {
    groups.forEach(group => {
        group.addEventListener('click', ev => {
            const btn = ev.target.closest('button');
            if (!btn) return;
            const value = btn.dataset.value ?? '';
            const name = group.dataset.filter;

            toggleFilterValue(name, value);
            syncFilterGroupActive(name);
            applyFilters();
        });
    });

    if (searchInput) {
        searchInput.addEventListener('input', () => {
            filters.search = searchInput.value.trim().toLowerCase();
            if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(() => {
                applyFilters();
            }, 200);
        });
    }

    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            multiFilterNames.forEach(name => {
                filters[name] = [];
            });
            filters.search = '';
            if (searchInput) searchInput.value = '';
            syncAllFilterGroups();
            applyFilters();
        });
    }
}

function matchesPlayers(row) {
    const selectedPlayers = getSelectedValues('players');
    if (selectedPlayers.length === 0) return true;
    const min = row.jug_min;
    const max = row.jug_max;
    return selectedPlayers.some(value => {
        const desired = parseInt(value, 10);
        if (Number.isNaN(desired)) return false;
        if (min !== null && max !== null) {
            return desired >= min && desired <= max;
        }
        if (min !== null) return desired >= min;
        if (max !== null) return desired <= max;
        return true;
    });
}

function matchesComplexity(row) {
    const selectedComplexities = getSelectedValues('complexity');
    if (selectedComplexities.length === 0) return true;
    if (!row.complejidad) return false;
    return selectedComplexities.includes(row.complejidad);
}

function matchesMechanics(row) {
    const selectedMechanics = getSelectedValues('mechanics');
    if (selectedMechanics.length === 0) return true;
    const list = Array.isArray(row.mecanicas) ? row.mecanicas : [];
    return list.some(m => selectedMechanics.includes(String(m)));
}

function matchesDuration(row) {
    const selectedDurations = getSelectedValues('duration');
    if (selectedDurations.length === 0) return true;
    return selectedDurations.includes(row.longitud);
}

function matchesSearch(row) {
    if (!filters.search) return true;
    const queryTokens = tokenizeSearchText(filters.search);
    if (queryTokens.length === 0) return true;
    const searchTokens = Array.isArray(row.search_tokens) ? row.search_tokens : [];
    return queryTokens.every(queryToken =>
        searchTokens.some(searchToken => searchToken.startsWith(queryToken))
    );
}

function applyFilters() {
    if (isLoading) {
        updateCounter(0);
        render([], { loading: true });
        return;
    }

    const filtered = sortedGames.filter(row =>
        matchesPlayers(row) &&
        matchesComplexity(row) &&
        matchesDuration(row) &&
        matchesMechanics(row) &&
        matchesSearch(row)
    );
    updateCounter(filtered.length);
    render(filtered.slice(0, 30));
}

function updateCounter(total) {
    if (!counter) return;
    if (isLoading) {
        counter.textContent = 'Cargando juegos...';
        return;
    }
    if (total === 0) {
        counter.textContent = 'Sin coincidencias';
    } else if (total === 1) {
        counter.textContent = '1 juego encontrado';
    } else {
        counter.textContent = `${total} juegos encontrados`;
    }
}

function render(rows, options = {}) {
    if (!results) return;
    results.innerHTML = '';
    if (options.loading) {
        const loading = document.createElement('div');
        loading.className = 'empty';
        loading.textContent = 'Cargando juegos...';
        results.appendChild(loading);
        return;
    }
    if (rows.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'No hay juegos que cumplan esos filtros. Ajusta alguna condición.';
        results.appendChild(empty);
        return;
    }
    rows.forEach((row) => {
        const card = document.createElement('article');
        card.className = 'card';
        const score = row.score !== null && row.score !== undefined ? Number(row.score).toFixed(1) : '–';
        const durationLabel = row.minutos_label || row.longitud;
        const duration = durationLabel ? (String(durationLabel).toLowerCase().includes('min') ? durationLabel : `${durationLabel} min`) : 'Duración variable';
        const players = row.jugadores || 'Jugadores variables';
        const complexity = row.complejidad || 'Sin dato';
        const categories = Array.isArray(row.categorias) ? row.categorias.slice(0, 3) : [];
        const mechanics = Array.isArray(row.mecanicas) ? row.mecanicas.slice(0, 2) : [];

        card.innerHTML = `
      <div>
        <h2>${row.juego || 'Juego sin nombre'}</h2>
        <p class="subtitle">${row.categorias_str || 'Sin categorías'}</p>
      </div>
      <div class="meta">
        <span><strong>${players}</strong> jugadores</span>
        <span>${duration}</span>
        <span>Complejidad: <strong>${complexity}</strong></span>
        <span class="score">Puntaje ${score}</span>
        ${row.suggested_numplayers ? `<span>Sugerido: <strong>${row.suggested_numplayers}</strong></span>` : ''}
        ${row.ubicacion ? `<span style="opacity:.75">Ubicación: ${row.ubicacion}</span>` : ''}
      </div>
      <div class="tags">
        ${categories.map(cat => `<span>${cat}</span>`).join('')}
        ${mechanics.map(mech => `<span>${mech}</span>`).join('')}
      </div>
    `;

        results.appendChild(card);
    });
}
