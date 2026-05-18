import { db } from './firebase-config.js';
import { doc, getDoc, setDoc, collection, addDoc, getDocs, query, where, serverTimestamp, onSnapshot } from "firebase/firestore";

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

export async function getCatalogGames() {
    const catalogRef = collection(db, "catalog");
    const querySnapshot = await getDocs(catalogRef);
    const games = [];
    querySnapshot.forEach((doc) => {
        games.push({ id: doc.id, ...doc.data() });
    });
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
        payload: { fileName, games, targetCollection: "catalog" },
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
        payload: { gameName: String(gameName).trim(), normalizedName: normalized, targetCollection: "catalog" },
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
