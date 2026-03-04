// js/syncEngine.js
import { 
    doc, setDoc, getDoc, onSnapshot, updateDoc, arrayUnion, arrayRemove, 
    serverTimestamp, collection, addDoc, getDocs 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, appId, isSyncEnabled } from './firebaseConfig.js';
import * as stateManager from './stateManager.js';
import { isArchiveRoom } from './mapData.js';

let mapUnsubscribe = null;
let currentMapPath = null;
const CHAR_COLLECTION = 'v3_characters';

/**
 * Sets up the world manifestation listener.
 */
export function setupWorldListener() {
    if (!db || !appId) return;
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', 'archive_apartment');
    onSnapshot(roomRef, (snap) => {
        if (!snap.exists()) setDoc(roomRef, { created: serverTimestamp(), manifestations: [] });
    });
}

/**
 * Orchestrates the boot sequence by peeking at state before applying it.
 */
export async function bootSyncEngine(mergeAndRefreshCallback) {
    const { user } = stateManager.getState();
    if (!db || !user || !isSyncEnabled) return;

    // 1. PEEK at Player State (Do not update stateManager yet!)
    let startRoom = 'bedroom'; // default
    let playerData = null;
    try {
        const stateRef = doc(db, 'artifacts', appId, 'users', user.uid, 'state', 'player');
        const snap = await getDoc(stateRef);
        if (snap.exists()) {
            playerData = snap.data();
            startRoom = playerData.currentRoom === 'main_room' ? 'lore1' : playerData.currentRoom;
        }
    } catch(e) { console.error("SyncEngine: Failed to peek player state:", e); }

    // 2. Load Maps based on the peeked startRoom
    await loadAstralMap(user);
    await updateMapListener(startRoom, mergeAndRefreshCallback);

    // 3. Start real-time player state listener
    await loadPlayerState(user);
    
    // 4. Load remaining user data
    await loadUserCharacters(user);

    // 5. Subscribe to future room changes to update the map listener
    stateManager.subscribe((state) => {
        if (state.user) {
            updateMapListener(state.localPlayer.currentRoom);
        }
    });
}

/**
 * Legacy initializer (now forwards to bootSyncEngine for compatibility if needed)
 */
export async function initializeSession(user) {
    setupWorldListener();
    return bootSyncEngine();
}

/**
 * Loads player state and maintains a real-time listener for updates (e.g. Stripe checkout).
 */
export async function loadPlayerState(user) {
    try {
        const stateRef = doc(db, 'artifacts', appId, 'users', user.uid, 'state', 'player');
        
        // Listen for real-time updates (like Stripe webhooks)
        onSnapshot(stateRef, (snap) => {
            if (snap.exists()) {
                const data = snap.data();
                let newRoom = data.currentRoom;
                if (newRoom === 'main_room') newRoom = 'lore1';
                
                // This keeps the browser state in sync with the database instantly
                stateManager.updatePlayer({ 
                    ...data, 
                    currentRoom: newRoom,
                    inventory: data.inventory || [], 
                    stratum: data.stratum || "mundane" 
                });
                
                if (data.isArchitect) {
                    console.log("[SYSTEM]: Architect status verified via uplink.");
                }
            }
        });
    } catch (e) { console.error("SyncEngine: Failed to sync player state:", e); }
}

async function loadAstralMap(user) {
    try {
        const astralRef = doc(db, 'artifacts', appId, 'users', user.uid, 'instance', 'astral_nodes');
        const snap = await getDoc(astralRef);
        if (snap.exists()) {
            stateManager.setAstralMap(snap.data().nodes || {});
        }
    } catch (e) { console.error("SyncEngine: Failed to load astral map:", e); }
}

async function loadUserCharacters(user) {
    try {
        const charCol = collection(db, 'artifacts', appId, 'users', user.uid, CHAR_COLLECTION);
        const snap = await getDocs(charCol);
        const characters = [];
        snap.forEach(doc => {
            characters.push({ id: doc.id, ...doc.data() });
        });
        stateManager.setLocalCharacters(characters);
        
        // Restore active avatar if saved
        const { localPlayer } = stateManager.getState();
        if (localPlayer.activeAvatarId) {
            const found = characters.find(c => c.id === localPlayer.activeAvatarId);
            if (found) stateManager.setActiveAvatar(found);
        } else if (characters.length > 0) {
            const defaultAvatar = characters.find(c => !c.deceased && !c.deployed) || characters[0];
            stateManager.setActiveAvatar(defaultAvatar);
        }
    } catch (e) { console.error("SyncEngine: Failed to load characters:", e); }
}

/**
 * Determines the correct Firestore path for a given room ID.
 * Seals the leak between private and public world data.
 */
function getMapPath(roomId, userId) {
    if (roomId.startsWith('astral_')) {
        return `artifacts/${appId}/users/${userId}/instance/astral_nodes`;
    } else if (isArchiveRoom(roomId)) {
        return `artifacts/${appId}/users/${userId}/instance/apartment_nodes`;
    } else {
        return `artifacts/${appId}/public/data/maps/apartment_graph_live`;
    }
}

export async function updateMapListener(startRoom, mergeAndRefreshCallback) {
    const { user } = stateManager.getState();
    if (!db || !user) return;

    // Resolve room: prioritize passed startRoom, fallback to state
    const roomToUse = startRoom || stateManager.getState().localPlayer.currentRoom;
    const newPath = getMapPath(roomToUse, user.uid);
    const isMundane = !roomToUse.startsWith('astral_') && !isArchiveRoom(roomToUse);

    if (currentMapPath === newPath) return Promise.resolve(); 
    if (mapUnsubscribe) mapUnsubscribe(); 

    currentMapPath = newPath;
    const pathParts = newPath.split('/');
    const mapRef = doc(db, pathParts.slice(0, -1).join('/'), pathParts.pop());
    
    return new Promise((resolve) => {
        let resolved = false;
        mapUnsubscribe = onSnapshot(mapRef, (snap) => {
            if (!snap.exists()) {
                // Map Initialization: If snapshot doesn't exist and it's an Archive room, initialize it
                if (isArchiveRoom(roomToUse)) {
                    const { apartmentMap } = stateManager.getState();
                    setDoc(mapRef, { nodes: apartmentMap, lastUpdated: serverTimestamp() });
                }
            } else {
                const data = snap.data();
                if (data.nodes) {
                    // Data Routing: Ensure data is routed to the correct state bucket based on path
                    if (mergeAndRefreshCallback) {
                        mergeAndRefreshCallback(data.nodes);
                    } else if (currentMapPath.includes('astral_nodes')) {
                        stateManager.setAstralMap(data.nodes);
                    } else if (currentMapPath.includes('apartment_nodes')) {
                        stateManager.setApartmentMap(data.nodes);
                    } else {
                        stateManager.setMundaneMap(data.nodes);
                    }
                }
            }
            if (!resolved) {
                resolved = true;
                resolve();
            }
        }, (err) => {
            console.error("SyncEngine: Map listener error:", err);
            if (!resolved) { resolved = true; resolve(); }
        });
    });
}

// 2. Modify savePlayerState to use { merge: true }
export async function savePlayerState() {
    const { user, localPlayer, activeAvatar, astralMap } = stateManager.getState();
    if (!db || !user || !isSyncEnabled) return;
    try {
        const stateRef = doc(db, 'artifacts', appId, 'users', user.uid, 'state', 'player');
        const stateToSave = { 
            ...localPlayer, 
            activeAvatarId: activeAvatar ? activeAvatar.id : null 
        };
        
        // CRITICAL: Use merge: true so local 'false' doesn't kill server 'true'
        await setDoc(stateRef, stateToSave, { merge: true });
        
        if (Object.keys(astralMap).length > 0) {
            const astralRef = doc(db, 'artifacts', appId, 'users', user.uid, 'instance', 'astral_nodes');
            await setDoc(astralRef, { nodes: astralMap, lastUpdated: serverTimestamp() }, { merge: true });
        }
    } catch (e) { console.error("SyncEngine: Failed to save player state:", e); }
}

export async function syncAvatarStats(avatarId, stats) {
    const { user } = stateManager.getState();
    if (!db || !user || !isSyncEnabled) return;
    try {
        const charRef = doc(db, 'artifacts', appId, 'users', user.uid, CHAR_COLLECTION, avatarId);
        await updateDoc(charRef, { stats });
    } catch (e) { console.error("SyncEngine: Failed to sync avatar stats:", e); }
}

export async function updateMapNode(roomId, updates) {
    const { user } = stateManager.getState();
    if (!db || !user || !isSyncEnabled) return;
    
    const mapPath = getMapPath(roomId, user.uid);
    const mapRef = doc(db, mapPath);
    const firestoreUpdates = {};
    for (let [key, val] of Object.entries(updates)) {
        firestoreUpdates[`nodes.${roomId}.${key}`] = val;
    }
    
    try {
        await updateDoc(mapRef, firestoreUpdates);
    } catch (e) { console.error("SyncEngine: Failed to update map node:", e); }
}

export async function logManifestation(roomId, text) {
    const { user } = stateManager.getState();
    if (!db || !user || !isSyncEnabled) return;
    
    try {
        const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', 'archive_apartment');
        await updateDoc(roomRef, { 
            manifestations: arrayUnion({ 
                author: user.uid, 
                text: `[${roomId}] ${text}`, 
                timestamp: Date.now() 
            }) 
        });
    } catch (e) { console.error("SyncEngine: Failed to log manifestation:", e); }
}

export async function removeArrayElementFromNode(roomId, arrayPath, element) {
    const { user } = stateManager.getState();
    if (!db || !user || !isSyncEnabled) return;
    
    const mapPath = getMapPath(roomId, user.uid);
        
    try {
        const mapRef = doc(db, mapPath);
        await updateDoc(mapRef, { [`nodes.${roomId}.${arrayPath}`]: arrayRemove(element) });
    } catch (e) { console.error("SyncEngine: Failed to remove element from node:", e); }
}

export async function addArrayElementToNode(roomId, arrayPath, element) {
    const { user } = stateManager.getState();
    if (!db || !user || !isSyncEnabled) return;
    
    const mapPath = getMapPath(roomId, user.uid);
        
    try {
        const mapRef = doc(db, mapPath);
        await updateDoc(mapRef, { [`nodes.${roomId}.${arrayPath}`]: arrayUnion(element) });
    } catch (e) { console.error("SyncEngine: Failed to add element to node:", e); }
}

export async function createCharacter(charData) {
    const { user } = stateManager.getState();
    if (!db || !user || !isSyncEnabled) return null;
    
    try {
        const charCol = collection(db, 'artifacts', appId, 'users', user.uid, CHAR_COLLECTION);
        const docRef = await addDoc(charCol, charData);
        return docRef.id;
    } catch (e) { 
        console.error("SyncEngine: Failed to create character:", e); 
        return null;
    }
}

export async function markCharacterDeceased(avatarId) {
    const { user } = stateManager.getState();
    if (!db || !user || !isSyncEnabled) return;
    
    try {
        const charRef = doc(db, 'artifacts', appId, 'users', user.uid, CHAR_COLLECTION, avatarId);
        await updateDoc(charRef, { deceased: true });
    } catch (e) { console.error("SyncEngine: Failed to mark character deceased:", e); }
}
