import { initUI, updateGames, setLoading } from './ui.js';
import { auth, googleProvider } from './firebase-config.js';
import { signInWithPopup, onAuthStateChanged, signOut } from "firebase/auth";
import { ensureUserProfile, getCatalogGames, canManageCatalog, createBulkImportJob, createSingleGameJob, subscribeJobStatus } from './db.js';
import { importExcel } from './importer.js';

let currentCatalog = [];
let catalogPromise = null;
let lazyRowsPromise = null;

async function loadLazyRows() {
    if (!lazyRowsPromise) {
        lazyRowsPromise = import('./data.js');
    }
    const module = await lazyRowsPromise;
    return module.rows || [];
}

async function resolveCatalogWithLazyFallback() {
    if (currentCatalog && currentCatalog.length > 0) {
        return currentCatalog;
    }

    if (!catalogPromise) {
        catalogPromise = (async () => {
            try {
                const catalogGames = await getCatalogGames();
                if (catalogGames && catalogGames.length > 0) {
                    currentCatalog = catalogGames;
                    return currentCatalog;
                }
                console.log('No catalog games found, loading lazy fallback.');
            } catch (e) {
                console.error('Error loading catalog:', e);
            }

            currentCatalog = await loadLazyRows();
            return currentCatalog;
        })();

        try {
            await catalogPromise;
        } finally {
            catalogPromise = null;
        }
    }

    return catalogPromise || currentCatalog;
}

async function showHomeCatalog() {
    if (currentCatalog && currentCatalog.length > 0) {
        updateGames(currentCatalog);
        return;
    }

    const fallbackCatalog = await resolveCatalogWithLazyFallback();
    updateGames(fallbackCatalog);
}

// Initialize UI
(async () => {
    initUI([], { loading: true });
    const initialCatalog = await resolveCatalogWithLazyFallback();
    updateGames(initialCatalog);
})();

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
        const userProfile = await ensureUserProfile(user);

        if (loginBtn) loginBtn.style.display = 'none';
        if (userDisplay) {
            userDisplay.style.display = 'block';

            isCatalogAdmin = userProfile?.role === "admin";

            userDisplay.innerHTML = `
                <span>Hola, ${user.displayName}</span>
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

        }
        if (mainNav) mainNav.style.display = 'block';
        console.log("User logged in:", user.uid);
    } else {
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
            setLoading(true);
            await showHomeCatalog();
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
