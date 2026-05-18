import { rows } from './data.js';
import { initUI, updateGames, setCurrentUser, onToggleLookingForPlayers, setWishlist, onToggleWishlist } from './ui.js';
import { auth, googleProvider } from './firebase-config.js';
import { signInWithPopup, onAuthStateChanged, signOut } from "firebase/auth";
import { ensureUserProfile, getUserGames, updateUserVisibility, toggleLookingForPlayers, toggleWishlist, getUserWishlist, canManageCatalog, createBulkImportJob, createSingleGameJob, subscribeJobStatus } from './db.js';
import { getPublicLibrary } from './public-db.js';
import { importExcel } from './importer.js';

// Initialize UI
// Try to load public library first, fall back to static data if needed (or just show empty)
(async () => {
    try {
        const publicGames = await getPublicLibrary();
        if (publicGames && publicGames.length > 0) {
            initUI(publicGames);
        } else {
            console.log("No public games found, showing static sample.");
            initUI(rows);
        }
    } catch (e) {
        console.error("Error loading public library:", e);
        initUI(rows);
    }
})();

// Register UI callbacks
onToggleLookingForPlayers(async (gameId, status) => {
    if (auth.currentUser) {
        try {
            await toggleLookingForPlayers(auth.currentUser.uid, gameId, status);
        } catch (error) {
            alert("Error al actualizar estado: " + error.message);
        }
    }
});

onToggleWishlist(async (game, status) => {
    if (auth.currentUser) {
        try {
            await toggleWishlist(auth.currentUser.uid, game, status);
        } catch (error) {
            alert("Error al actualizar wishlist: " + error.message);
        }
    }
});

// DOM Elements
const loginBtn = document.getElementById('loginBtn');
const userDisplay = document.getElementById('userDisplay');
const mainNav = document.getElementById('mainNav');
const addGameBtn = document.getElementById('addGameBtn');
const addGameDialog = document.getElementById('addGameDialog');
const addGameForm = document.getElementById('addGameForm');
const cancelAddGame = document.getElementById('cancelAddGame');
const excelInput = document.getElementById('excelInput');
let isCatalogAdmin = false;

// Auth Logic
if (loginBtn) {
    loginBtn.addEventListener('click', async () => {
        try {
            await signInWithPopup(auth, googleProvider);
        } catch (error) {
            console.error("Login failed", error);
            if (error?.code === "auth/unauthorized-domain") {
                const host = window.location.hostname;
                alert(
                    `No se puede iniciar sesión desde este dominio (${host}). ` +
                    "Un administrador debe agregarlo en Firebase Console > Authentication > Settings > Authorized domains."
                );
            } else {
                alert("Error al iniciar sesión: " + error.message);
            }
        }
    });
}

onAuthStateChanged(auth, async (user) => {
    if (user) {
        setCurrentUser(user.uid);

        // Load Wishlist
        const wishlistGames = await getUserWishlist(user.uid);
        setWishlist(wishlistGames.map(g => g.id));

        if (loginBtn) loginBtn.style.display = 'none';
        if (userDisplay) {
            userDisplay.style.display = 'block';

            // Fetch user profile to get isPublic status
            const userProfile = await ensureUserProfile(user);
            const isPublic = userProfile ? userProfile.isPublic : false;
            isCatalogAdmin = userProfile?.role === "admin";

            userDisplay.innerHTML = `
                <span>Hola, ${user.displayName}</span>
                <label style="margin-left: 10px; font-size: 0.8em; cursor: pointer;">
                    <input type="checkbox" id="publicToggle" ${isPublic ? 'checked' : ''}>
                    Pública
                </label>
            `;

            const logoutBtn = document.createElement('button');
            logoutBtn.id = 'logoutBtn';
            logoutBtn.textContent = '(Salir)';
            logoutBtn.style.background = 'none';
            logoutBtn.style.border = 'none';
            logoutBtn.style.color = 'white';
            logoutBtn.style.cursor = 'pointer';
            logoutBtn.style.marginLeft = '5px';
            logoutBtn.style.fontSize = '12px';
            logoutBtn.addEventListener('click', () => signOut(auth));
            userDisplay.appendChild(logoutBtn);

            // Add listener for toggle
            const toggle = document.getElementById('publicToggle');
            if (toggle) {
                toggle.addEventListener('change', async (e) => {
                    try {
                        await updateUserVisibility(user.uid, e.target.checked);
                    } catch (err) {
                        console.error(err);
                        e.target.checked = !e.target.checked; // Revert on error
                        alert("Error al actualizar visibilidad");
                    }
                });
            }
        }
        if (mainNav) mainNav.style.display = 'block';
        console.log("User logged in:", user.uid);

        // Load public library by default on login
        const publicGames = await getPublicLibrary();
        updateGames(publicGames);
    } else {
        setCurrentUser(null);
        isCatalogAdmin = false;
        if (loginBtn) loginBtn.style.display = 'block';
        if (userDisplay) {
            userDisplay.style.display = 'none';
            userDisplay.textContent = '';
        }
        if (mainNav) mainNav.style.display = 'none';
        console.log("User logged out");
    }
});

// Navigation Logic
document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
        if (e.target.id === 'addGameBtn') {
            addGameDialog.showModal();
            return;
        }

        // Update active state
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');

        const view = e.target.dataset.view;
        if (view === 'home') {
            updateGames(rows); // Show static catalog for now (or public games later)
        } else if (view === 'my-library') {
            if (auth.currentUser) {
                const myGames = await getUserGames(auth.currentUser.uid);
                updateGames(myGames);
            }
        } else if (view === 'wishlist') {
            if (auth.currentUser) {
                const wishlistGames = await getUserWishlist(auth.currentUser.uid);
                updateGames(wishlistGames);
            }
        }
    });
});

// Add Game Logic
if (cancelAddGame) {
    cancelAddGame.addEventListener('click', () => {
        addGameDialog.close();
        addGameForm.reset();
        if (excelInput) excelInput.value = '';
    });
}

if (excelInput) {
    excelInput.addEventListener('change', async (e) => {
        if (!auth.currentUser) return;
        const file = e.target.files[0];
        if (!file) return;

        try {
            const isAdmin = isCatalogAdmin || await canManageCatalog(auth.currentUser.uid);
            if (!isAdmin) {
                alert('No tienes permisos para importar catálogo. Esta acción es solo para ADMIN.');
                return;
            }

            const { count, games } = await importExcel(file);
            const jobId = await createBulkImportJob(auth.currentUser.uid, file.name, games);
            alert(`Importación enviada (${count} juegos). Job: ${jobId}`);
            addGameDialog.close();
            if (excelInput) excelInput.value = '';
        } catch (error) {
            alert('Error al importar Excel: ' + error.message);
            console.error(error);
        }
    });
}

if (addGameForm) {
    addGameForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!auth.currentUser) return;

        const formData = new FormData(addGameForm);
        const gameData = {
            juego: formData.get('juego'),
            jug_min: Number(formData.get('jug_min')),
            jug_max: Number(formData.get('jug_max')),
            minutos: Number(formData.get('minutos')),
            complejidad: formData.get('complejidad'),
            categorias_str: formData.get('categorias'),
            mecanicas_str: formData.get('mecanicas'),
            // Derived fields for compatibility with existing UI
            jugadores: `${formData.get('jug_min')}-${formData.get('jug_max')}`,
            minutos_label: formData.get('minutos'),
            longitud: getDurationLabel(Number(formData.get('minutos'))),
            categorias: formData.get('categorias').split(',').map(s => s.trim()),
            mecanicas: formData.get('mecanicas').split(',').map(s => s.trim()).filter(Boolean),
            ubicacion: String(formData.get('ubicacion') || '').trim(),
            score: 0 // Default score
        };

        try {
            const isAdmin = isCatalogAdmin || await canManageCatalog(auth.currentUser.uid);
            if (!isAdmin) {
                alert('No tienes permisos para enriquecer catálogo. Esta acción es solo para ADMIN.');
                return;
            }

            const jobId = await createSingleGameJob(auth.currentUser.uid, gameData.juego);
            const stopWatching = subscribeJobStatus(jobId, (job) => {
                if (job.status === 'done') {
                    alert(`Juego "${gameData.juego}" procesado correctamente.`);
                    stopWatching();
                }
                if (job.status === 'error') {
                    alert(`Error procesando "${gameData.juego}". Revisa importJobs/${jobId}`);
                    stopWatching();
                }
            });

            addGameDialog.close();
            addGameForm.reset();
            alert(`Juego enviado a procesamiento. Job: ${jobId}`);
        } catch (error) {
            alert('Error al añadir juego: ' + error.message);
        }
    });
}

function getDurationLabel(minutes) {
    if (minutes <= 30) return 'Corto';
    if (minutes <= 60) return 'Moderado';
    if (minutes <= 120) return 'Medio-Largo';
    return 'Largo';
}
