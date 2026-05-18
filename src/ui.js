
export const filters = { players: "", complexityMin: "", complexityMax: "", duration: "", mechanics: "", search: "", genreSearch: "", mechanicsSearch: "" };
let currentGames = []; // Store the current list of games
let currentUserId = null;
let currentUserWishlist = new Set(); // Set of game IDs
let toggleLookingForPlayersCallback = null;
let toggleWishlistCallback = null;

// DOM Elements
const groups = document.querySelectorAll('[data-filter]');
const searchInput = document.querySelector('#search');
const genreSearchInput = document.querySelector('#genreSearch');
const mechanicsSearchInput = document.querySelector('#mechanicsSearch');
const counter = document.querySelector('#matchCount');
const results = document.querySelector('#results');
const resetBtn = document.querySelector('#resetFilters');
const complexityOrder = ["Liviano", "Medio-Liviano", "Medio", "Medio-Pesado", "Pesado"];

export function initUI(games) {
    currentGames = games;

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
    applyFilters();
    updateAutocomplete(newGames);
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

    const debounce = (fn, wait = 200) => {
        let timeoutId;
        return (...args) => {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => fn(...args), wait);
        };
    };

    if (searchInput) {
        searchInput.addEventListener('input', debounce(() => {
            filters.search = searchInput.value.trim().toLowerCase();
            applyFilters();
        }));
    }

    if (genreSearchInput) {
        genreSearchInput.addEventListener('input', debounce(() => {
            filters.genreSearch = genreSearchInput.value.trim().toLowerCase();
            applyFilters();
        }));
    }

    if (mechanicsSearchInput) {
        mechanicsSearchInput.addEventListener('input', debounce(() => {
            filters.mechanicsSearch = mechanicsSearchInput.value.trim().toLowerCase();
            applyFilters();
        }));
    }

    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            filters.players = filters.complexityMin = filters.complexityMax = filters.duration = filters.mechanics = filters.search = filters.genreSearch = filters.mechanicsSearch = '';
            if (searchInput) searchInput.value = '';
            if (genreSearchInput) genreSearchInput.value = '';
            if (mechanicsSearchInput) mechanicsSearchInput.value = '';
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


function matchesGenreSearch(row) {
    if (!filters.genreSearch) return true;
    return String(row.categorias_str || '').toLowerCase().includes(filters.genreSearch);
}

function matchesMechanicsSearch(row) {
    if (!filters.mechanicsSearch) return true;
    return String(row.mecanicas_str || '').toLowerCase().includes(filters.mechanicsSearch);
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
        matchesGenreSearch(row) &&
        matchesMechanicsSearch(row) &&
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
