
export const filters = { players: "", complexityMin: "", complexityMax: "", duration: "", mechanics: "", search: "" };
let currentGames = []; // Store the current list of games
let hasLoadedDataset = false;
let isLoadingData = false;
let currentUserId = null;
let currentUserWishlist = new Set(); // Set of game IDs
let toggleLookingForPlayersCallback = null;
let toggleWishlistCallback = null;

// DOM Elements
const groups = document.querySelectorAll('[data-filter]');
const searchInput = document.querySelector('#search');
const counter = document.querySelector('#matchCount');
const results = document.querySelector('#results');
const resetBtn = document.querySelector('#resetFilters');
const complexityOrder = ["Liviano", "Medio-Liviano", "Medio", "Medio-Pesado", "Pesado"];

export function initUI(games) {
    currentGames = games;
    hasLoadedDataset = true;
    isLoadingData = false;

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


    const mechanicsGroup = document.querySelector('[data-filter="mechanics"]');
    if (mechanicsGroup) {
        const all = new Set();
        games.forEach(g => (Array.isArray(g.mecanicas) ? g.mecanicas : []).forEach(m => all.add(m)));
        Array.from(all).sort().forEach(m => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'chip';
            btn.dataset.value = String(m);
            btn.textContent = String(m);
            mechanicsGroup.appendChild(btn);
        });
    }

    setupEventListeners();
    applyFilters();
    updateAutocomplete(games);
}

export function updateGames(newGames) {
    currentGames = newGames;
    hasLoadedDataset = true;
    isLoadingData = false;
    applyFilters();
    updateAutocomplete(newGames);
}

export function setLoadingData(loading) {
    isLoadingData = Boolean(loading);
    if (isLoadingData) {
        renderLoading();
        updateCounter(0);
        return;
    }
    applyFilters();
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
            applyFilters();
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
    const haystack = [row.juego, row.categorias_str || '', row.mecanicas_str || '']
        .join(' ').toLowerCase();
    return haystack.includes(filters.search);
}

function applyFilters() {
    const filtered = currentGames.filter(row =>
        matchesPlayers(row) &&
        matchesComplexity(row) &&
        matchesDuration(row) &&
        matchesMechanics(row) &&
        matchesSearch(row)
    ).sort((a, b) => {
        const scoreA = a.score ?? 0;
        const scoreB = b.score ?? 0;
        if (scoreA === scoreB) {
            return (a.juego || '').localeCompare(b.juego || '');
        }
        return scoreB - scoreA;
    });
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
        const hasActiveFilters = Object.values(filters).some(Boolean);
        if (!isLoadingData && (hasActiveFilters || hasLoadedDataset)) {
            empty.textContent = hasActiveFilters
                ? 'No hay juegos que cumplan esos filtros. Ajusta alguna condición.'
                : 'No hay juegos publicados todavía.';
            results.appendChild(empty);
        }
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
        const categories = row.categorias_str || (Array.isArray(row.categorias) ? row.categorias.join(', ') : 'Sin categorías');
        const mechanics = row.mecanicas_str || (Array.isArray(row.mecanicas) ? row.mecanicas.join(', ') : 'Sin mecánicas');
        const location = row.ubicacion || 'Ubicación no especificada';
        const gameId = row.id || row.juego;
        const isLookingForPlayers = row.lookingForPlayers || false;
        const inWishlist = currentUserWishlist.has(gameId);
        const lookingForPlayersClass = isLookingForPlayers ? 'active' : '';
        const wishlistClass = inWishlist ? 'active' : '';

        card.innerHTML = `
            <h3>${row.juego || 'Juego sin nombre'}</h3>
            <div class="meta">
                <span class="chip">${players}</span>
                <span class="chip">${duration}</span>
                <span class="chip">${complexity}</span>
                <span class="chip">⭐ ${score}</span>
            </div>
            <p><strong>Categorías:</strong> ${categories}</p>
            <p><strong>Mecánicas:</strong> ${mechanics}</p>
            <p><strong>Ubicación:</strong> ${location}</p>
            ${currentUserId ? `
            <div class="actions">
                <button class="action-btn ${lookingForPlayersClass}" data-action="toggle-looking" data-game-id="${gameId}">
                    ${isLookingForPlayers ? '✅ Buscando jugadores' : '🎲 Buscar jugadores'}
                </button>
                <button class="action-btn ${wishlistClass}" data-action="toggle-wishlist" data-game-id="${gameId}">
                    ${inWishlist ? '❤️ En wishlist' : '🤍 Añadir wishlist'}
                </button>
            </div>
            ` : ''}
        `;

        // Add event listeners for action buttons
        if (currentUserId) {
            const lookingBtn = card.querySelector('[data-action="toggle-looking"]');
            const wishlistBtn = card.querySelector('[data-action="toggle-wishlist"]');

            if (lookingBtn && toggleLookingForPlayersCallback) {
                lookingBtn.addEventListener('click', async () => {
                    const newStatus = !isLookingForPlayers;
                    try {
                        await toggleLookingForPlayersCallback(gameId, newStatus);
                        row.lookingForPlayers = newStatus;
                        applyFilters(); // Re-render
                    } catch (error) {
                        console.error('Error toggling looking for players:', error);
                    }
                });
            }

            if (wishlistBtn && toggleWishlistCallback) {
                wishlistBtn.addEventListener('click', async () => {
                    const newStatus = !inWishlist;
                    try {
                        await toggleWishlistCallback(row, newStatus);
                        if (newStatus) {
                            currentUserWishlist.add(gameId);
                        } else {
                            currentUserWishlist.delete(gameId);
                        }
                        applyFilters(); // Re-render
                    } catch (error) {
                        console.error('Error toggling wishlist:', error);
                    }
                });
            }
        }
        results.appendChild(card);
    });
}

function renderLoading() {
    if (!results) return;
    results.innerHTML = `
        <div class="empty loading-state">
            <div class="spinner" aria-hidden="true">⏳</div>
            <p>Buscando juegos...</p>
        </div>
    `;
}
