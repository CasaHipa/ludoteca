
export const filters = { players: "", complexityMin: "", complexityMax: "", duration: "", mechanics: "", search: "" };
let currentGames = []; // Store the current list of games
let sortedGames = [];
let currentUserId = null;
let currentUserWishlist = new Set(); // Set of game IDs
let toggleLookingForPlayersCallback = null;
let toggleWishlistCallback = null;
let searchDebounceTimer = null;

// DOM Elements
const groups = document.querySelectorAll('[data-filter]');
const searchInput = document.querySelector('#search');
const counter = document.querySelector('#matchCount');
const results = document.querySelector('#results');
const resetBtn = document.querySelector('#resetFilters');
const complexityOrder = ["Liviano", "Medio-Liviano", "Medio", "Medio-Pesado", "Pesado"];
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

    // Los elementos fuera del top de chips siguen siendo descubribles vía búsqueda libre.
}

export function initUI(games) {
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

    setupEventListeners();
    setupCollapsibleFilters();
    applyFilters();
}

export function updateGames(newGames) {
    setGamesDataset(newGames);
    applyFilters();
}

function setGamesDataset(games) {
    currentGames = (games || []).map(game => ({
        ...game,
        search_blob_lower: [
            game.juego || '',
            game.categorias_str || '',
            game.mecanicas_str || ''
        ].join(' ').toLowerCase()
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

export function setCurrentUser(uid) {
    currentUserId = uid;
    applyFilters(); // Re-render to update UI state
}

export function setWishlist(wishlistIds) {
    currentUserWishlist = new Set(wishlistIds);
    applyFilters();
}

export function onToggleLookingForPlayers(callback) {
    toggleLookingForPlayersCallback = callback;
}

export function onToggleWishlist(callback) {
    toggleWishlistCallback = callback;
}

function setupEventListeners() {
    groups.forEach(group => {
        group.addEventListener('click', ev => {
            const btn = ev.target.closest('button');
            if (!btn) return;
            const value = btn.dataset.value ?? '';
            const name = group.dataset.filter;

            if (filters[name] === value && value !== '') {
                filters[name] = '';
                group.querySelectorAll('button').forEach(b => b.classList.toggle('is-active', b.dataset.value === ''));
            } else {
                filters[name] = value;
                group.querySelectorAll('button').forEach(b => b.classList.toggle('is-active', b === btn));
                if (value === '') {
                    group.querySelectorAll('button').forEach(b => {
                        if (b.dataset.value === '') b.classList.add('is-active');
                    });
                }
            }
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
            filters.players = filters.complexityMin = filters.complexityMax = filters.duration = filters.mechanics = filters.search = '';
            if (searchInput) searchInput.value = '';
            groups.forEach(group => {
                group.querySelectorAll('button').forEach(btn => {
                    const isDefault = btn.dataset.value === '';
                    btn.classList.toggle('is-active', isDefault);
                });
            });
            applyFilters();
        });
    }
}

function getStoredExpandedState(sectionKey) {
    try {
        const value = localStorage.getItem(`${FILTER_TOGGLE_STORAGE_PREFIX}.${sectionKey}.expanded`);
        return value === null ? null : value === 'true';
    } catch (_) {
        return null;
    }
}

function saveExpandedState(sectionKey, expanded) {
    try {
        localStorage.setItem(`${FILTER_TOGGLE_STORAGE_PREFIX}.${sectionKey}.expanded`, String(expanded));
    } catch (_) {
        // Silently ignore storage errors (private mode / disabled storage).
    }
}

function setCollapsedState(button, group, expanded) {
    group.classList.toggle('is-expanded', expanded);
    group.classList.toggle('is-collapsed', !expanded);
    button.setAttribute('aria-expanded', String(expanded));
    button.textContent = expanded ? 'Colapsar' : 'Expandir';
    button.setAttribute('aria-label', `${expanded ? 'Colapsar' : 'Expandir'} filtros de mecánica`);
}

function setupCollapsibleFilters() {
    collapsibleSections.forEach(section => {
        const button = document.querySelector(section.button);
        const group = document.querySelector(section.group);
        if (!button || !group) return;

        const saved = getStoredExpandedState(section.key);
        const expanded = saved ?? false;
        setCollapsedState(button, group, expanded);

        button.addEventListener('click', () => {
            const nextExpanded = button.getAttribute('aria-expanded') !== 'true';
            setCollapsedState(button, group, nextExpanded);
            saveExpandedState(section.key, nextExpanded);
        });
    });
}

function matchesPlayers(row) {
    if (!filters.players) return true;
    const desired = parseInt(filters.players, 10);
    const min = row.jug_min;
    const max = row.jug_max;
    if (min !== null && max !== null) {
        return desired >= min && desired <= max;
    }
    if (min !== null) return desired >= min;
    if (max !== null) return desired <= max;
    return true;
}

function matchesComplexity(row) {
    if (!row.complejidad) return !filters.complexityMin && !filters.complexityMax;
    const value = complexityOrder.indexOf(row.complejidad);
    if (value === -1) return false;
    const min = filters.complexityMin ? complexityOrder.indexOf(filters.complexityMin) : -1;
    const max = filters.complexityMax ? complexityOrder.indexOf(filters.complexityMax) : Infinity;
    if (min !== -1 && value < min) return false;
    if (max !== Infinity && value > max) return false;
    return true;
}

function matchesMechanics(row) {
    if (!filters.mechanics) return true;
    const list = Array.isArray(row.mecanicas) ? row.mecanicas : [];
    return list.some(m => String(m).toLowerCase() === filters.mechanics.toLowerCase());
}

function matchesDuration(row) {
    if (!filters.duration) return true;
    return row.longitud === filters.duration;
}

function matchesSearch(row) {
    if (!filters.search) return true;
    const haystack = row.search_blob_lower || '';
    return haystack.includes(filters.search);
}

function applyFilters() {
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
    if (total === 0) {
        counter.textContent = 'Sin coincidencias';
    } else if (total === 1) {
        counter.textContent = '1 juego encontrado';
    } else {
        counter.textContent = `${total} juegos encontrados`;
    }
}

function render(rows) {
    if (!results) return;
    results.innerHTML = '';
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

        let ownerHtml = '';
        if (row.ownerName) {
            ownerHtml = `<div style="font-size:12px; color:#f97316; margin-bottom:4px;">De: <strong>${row.ownerName}</strong></div>`;
        }

        // Looking for Players Logic
        let lfpHtml = '';
        const isOwner = currentUserId && (row.ownerId === currentUserId || (!row.ownerId && !row.id));

        if (currentUserId && row.ownerId === currentUserId) {
            const isLooking = row.lookingForPlayers || false;
            lfpHtml = `
                <div style="margin-top: 8px; border-top: 1px solid #eee; padding-top: 8px;">
                    <label style="font-size: 12px; cursor: pointer; display: flex; align-items: center; gap: 5px;">
                        <input type="checkbox" class="lfp-toggle" data-id="${row.id}" ${isLooking ? 'checked' : ''}>
                        Busco gente para jugar
                    </label>
                </div>
            `;
        } else if (row.lookingForPlayers) {
            lfpHtml = `
                <div style="margin-top: 8px; border-top: 1px solid #eee; padding-top: 8px;">
                    <span style="font-size: 12px; background: #dcfce7; color: #166534; padding: 2px 6px; border-radius: 4px;">
                        👋 Busca jugadores
                    </span>
                </div>
            `;
        }

        // Wishlist Logic
        let wishlistHtml = '';
        if (currentUserId && row.ownerId !== currentUserId && row.id) {
            const isWishlisted = currentUserWishlist.has(row.id);
            const heartColor = isWishlisted ? '#ef4444' : '#ccc';
            wishlistHtml = `
                <button class="wishlist-btn" data-id="${row.id}" style="background:none; border:none; cursor:pointer; position: absolute; top: 10px; right: 10px; font-size: 20px; color: ${heartColor};" title="${isWishlisted ? 'Quitar de mi lista' : 'Quiero jugar este juego'}">
                    ♥
                </button>
            `;
        }

        card.innerHTML = `
      ${wishlistHtml}
      <div>
        ${ownerHtml}
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
      ${lfpHtml}
    `;

        // Add event listener for toggle
        const toggle = card.querySelector('.lfp-toggle');
        if (toggle) {
            toggle.addEventListener('change', (e) => {
                if (toggleLookingForPlayersCallback) {
                    toggleLookingForPlayersCallback(row.id, e.target.checked);
                }
            });
        }

        // Add event listener for wishlist
        const wishlistBtn = card.querySelector('.wishlist-btn');
        if (wishlistBtn) {
            wishlistBtn.addEventListener('click', (e) => {
                const isWishlisted = currentUserWishlist.has(row.id);
                // Optimistic update
                if (isWishlisted) {
                    currentUserWishlist.delete(row.id);
                    e.target.style.color = '#ccc';
                } else {
                    currentUserWishlist.add(row.id);
                    e.target.style.color = '#ef4444';
                }

                if (toggleWishlistCallback) {
                    toggleWishlistCallback(row, !isWishlisted);
                }
            });
        }

        results.appendChild(card);
    });
}
