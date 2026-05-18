import { db } from './firebase-config.js';
import { doc, getDoc, setDoc, collection, addDoc, getDocs, query, where, deleteDoc, serverTimestamp, onSnapshot } from "firebase/firestore";

/**
 * Ensures a user profile exists in the database.
 * @param {Object} user - The Firebase Auth user object.
 */
export async function ensureUserProfile(user) {
    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
        // Create new user profile
        const newProfile = {
            displayName: user.displayName,
            email: user.email,
            photoURL: user.photoURL,
            createdAt: new Date(),
            isPublic: false, // Default to private
            role: "user"
        };
        try {
            await setDoc(userRef, newProfile);
            console.log("User profile created for:", user.uid);
            return newProfile;
        } catch (e) {
            console.error("Error creating user profile:", e);
            return null;
        }
    } else {
        console.log("User profile already exists for:", user.uid);
        return userSnap.data();
    }
}

export async function updateUserVisibility(userId, isPublic) {
    const userRef = doc(db, "users", userId);
    try {
        await setDoc(userRef, { isPublic: isPublic }, { merge: true });
        console.log("User visibility updated to:", isPublic);
    } catch (e) {
        console.error("Error updating user visibility:", e);
        throw e;
    }
}

/**
 * Fetch all games for a specific user.
 * @param {string} userId 
 */
export async function getUserGames(userId) {
    const gamesRef = collection(db, "users", userId, "games");
    const q = query(gamesRef);
    const querySnapshot = await getDocs(q);
    const games = [];
    querySnapshot.forEach((doc) => {
        games.push({ id: doc.id, ...doc.data() });
    });
    return games;
}

export async function addGameToLibrary(userId, gameData) {
    try {
        const userGamesRef = collection(db, "users", userId, "games");
        await addDoc(userGamesRef, gameData);
        console.log("Game added to library");
    } catch (e) {
        console.error("Error adding game:", e);
        throw e;
    }
}

export async function toggleLookingForPlayers(userId, gameId, status) {
    const gameRef = doc(db, "users", userId, "games", gameId);
    try {
        await setDoc(gameRef, { lookingForPlayers: status }, { merge: true });
        console.log(`Game ${gameId} lookingForPlayers set to ${status}`);
    } catch (e) {
        console.error("Error updating game status:", e);
        throw e;
    }
}

export async function toggleWishlist(userId, game, status) {
    // game object should contain at least id, juego, and originalOwnerId if possible
    const wishlistRef = doc(db, "users", userId, "wishlist", game.id);
    try {
        if (status) {
            await setDoc(wishlistRef, {
                ...game,
                addedAt: new Date()
            });
        } else {
            await deleteDoc(wishlistRef);
        }
        console.log(`Game ${game.id} wishlist status: ${status}`);
    } catch (e) {
        console.error("Error updating wishlist:", e);
        throw e;
    }
}

export async function getUserWishlist(userId) {
    const wishlistRef = collection(db, "users", userId, "wishlist");
    const snap = await getDocs(wishlistRef);
    const games = [];
    snap.forEach(doc => games.push(doc.data()));
    return games;
}


export async function getUserRole(userId) {
    const userRef = doc(db, "users", userId);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) return "user";
    return userSnap.data().role || "user";
}

export async function canManageCatalog(userId) {
    const role = await getUserRole(userId);
    return role === "admin";
}

export async function createBulkImportJob(userId, fileName, games) {
    const jobsRef = collection(db, "importJobs");
    const payload = {
        type: "bulk_excel",
        status: "queued",
        requestedBy: userId,
        payload: { fileName, games },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    };
    const jobRef = await addDoc(jobsRef, payload);
    return jobRef.id;
}

export async function createSingleGameJob(userId, gameName) {
    const jobsRef = collection(db, "importJobs");
    const normalized = String(gameName || "").trim().toLowerCase();
    if (!normalized) throw new Error("Nombre de juego inválido");

    const pendingQ = query(
        jobsRef,
        where("type", "==", "single_game"),
        where("requestedBy", "==", userId),
        where("payload.normalizedName", "==", normalized),
        where("status", "in", ["queued", "processing"])
    );
    const pendingSnap = await getDocs(pendingQ);
    if (!pendingSnap.empty) {
        return pendingSnap.docs[0].id;
    }

    const payload = {
        type: "single_game",
        status: "queued",
        requestedBy: userId,
        payload: { gameName: String(gameName).trim(), normalizedName: normalized },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    };
    const jobRef = await addDoc(jobsRef, payload);
    return jobRef.id;
}

export function subscribeJobStatus(jobId, callback) {
    const jobRef = doc(db, "importJobs", jobId);
    return onSnapshot(jobRef, (snap) => {
        if (!snap.exists()) return;
        callback({ id: snap.id, ...snap.data() });
    });
}
