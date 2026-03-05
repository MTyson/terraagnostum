// js/syncEngine.js
import { 
    doc, setDoc, getDoc, onSnapshot, updateDoc, arrayUnion, arrayRemove, 
    serverTimestamp, collection, addDoc, getDocs, writeBatch 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, appId, isSyncEnabled } from './firebaseConfig.js';
import * as stateManager from './stateManager.js';
import { blueprintApartment } from './mapData.js';

let mapUnsubscribe = null;
let currentMapPath = null;
const CHAR_COLLECTION = 'v3_characters';

/**
 * Orchestrates the boot sequence by peeking at state before applying it.
 */
export async function bootSyncEngine(mergeAndRefreshCallback) {
    const { user } = stateManager.getState();
    if (!db || !user || !isSyncEnabled) return;

    let startRoom = 'bedroom';
    let startArea = `apartment_${user.uid}`;
    try {
        const stateRef = doc(db, 'artifacts', appId, 'users', user.uid, 'state', 'player');
        const snap = await getDoc(stateRef);
        if (snap.exists()) {
            const data = snap.data();
            startRoom = data.currentRoom || startRoom;
            startArea = data.currentArea || startArea;
        }
    } catch(e) {}

    // Set initial area before loading
    stateManager.updatePlayer({ currentArea: startArea, currentRoom: startRoom });
    await updateAreaListener(startArea);
    await loadPlayerState(user);
    await loadUserCharacters(user);
}

/**
 * Loads player state and maintains a real-time listener for updates.
 */
export async function loadPlayerState(user) {
    try {
        const stateRef = doc(db, 'artifacts', appId, 'users', user.uid, 'state', 'player');
        
        onSnapshot(stateRef, (snap) => {
            if (snap.exists()) {
                const data = snap.data();
                stateManager.updatePlayer({ 
                    ...data, 
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

async function loadUserCharacters(user) {
    try {
        const charCol = collection(db, 'artifacts', appId, 'users', user.uid, CHAR_COLLECTION);
        const snap = await getDocs(charCol);
        const characters = [];
        snap.forEach(doc => {
            characters.push({ id: doc.id, ...doc.data() });
        });
        stateManager.setLocalCharacters(characters);
        
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

export async function updateAreaListener(areaId) {
    const { user } = stateManager.getState();
    if (!db || !user) return;

    if (mapUnsubscribe) mapUnsubscribe();
    currentMapPath = areaId;

    const areaRoomsRef = collection(db, 'artifacts', appId, 'public', 'data', 'areas', areaId, 'rooms');
    
    return new Promise((resolve) => {
        let resolved = false;
        mapUnsubscribe = onSnapshot(areaRoomsRef, async (snapshot) => {
            const areaNodes = {};
            snapshot.forEach(doc => { areaNodes[doc.id] = doc.data(); });
            
            // THE IMPOSITION: If area is empty, spawn the blueprint apartment!
            if (Object.keys(areaNodes).length === 0 && areaId === `apartment_${user.uid}`) {
                console.log("[SYNC]: Imposing full apartment architecture...");
                const batch = writeBatch(db);
                
                for (const [roomId, roomData] of Object.entries(blueprintApartment)) {
                    // If the room is 'outside', it actually belongs in the public area, so we skip imposing it into the private apartment.
                    if (roomId === 'outside') continue; 
                    
                    const roomRef = doc(areaRoomsRef, roomId);
                    batch.set(roomRef, { 
                        ...roomData, 
                        id: roomId,
                        metadata: { ...roomData.metadata, ownerId: user.uid, area: areaId }
                    });
                }
                await batch.commit();
                return; // The snapshot will automatically re-fire after the commit
            }

            // PUBLIC WORLD SEEDING
            if (Object.keys(areaNodes).length === 0 && areaId === 'public_void') {
                console.log("[SYNC]: Imposing public void anchor...");
                const roomRef = doc(areaRoomsRef, 'outside');
                await setDoc(roomRef, { 
                    ...blueprintApartment['outside'], 
                    id: 'outside',
                    metadata: { stratum: 'mundane', isEditable: false, ownerId: 'PUBLIC', area: 'public_void' }
                });
                return;
            }

            stateManager.setLocalAreaCache(areaNodes);
            if (!resolved) { resolved = true; resolve(); }
        });
    });
}

export async function savePlayerState() {
    const { user, localPlayer, activeAvatar } = stateManager.getState();
    if (!db || !user || !isSyncEnabled) return;
    try {
        const stateRef = doc(db, 'artifacts', appId, 'users', user.uid, 'state', 'player');
        const stateToSave = { 
            ...localPlayer, 
            activeAvatarId: activeAvatar ? activeAvatar.id : null 
        };
        await setDoc(stateRef, stateToSave, { merge: true });
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
    const { user, localPlayer } = stateManager.getState();
    if (!db || !user || !isSyncEnabled) return;
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'areas', localPlayer.currentArea, 'rooms', roomId);
    try { await updateDoc(roomRef, updates); } catch (e) { console.error(e); }
}

export async function removeArrayElementFromNode(roomId, arrayPath, element) {
    const { user, localPlayer } = stateManager.getState();
    if (!db || !user || !isSyncEnabled) return;
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'areas', localPlayer.currentArea, 'rooms', roomId);
    try {
        await updateDoc(roomRef, { [arrayPath]: arrayRemove(element) });
    } catch (e) { console.error("SyncEngine: Failed to remove element from node:", e); }
}

export async function addArrayElementToNode(roomId, arrayPath, element) {
    const { user, localPlayer } = stateManager.getState();
    if (!db || !user || !isSyncEnabled) return;
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'areas', localPlayer.currentArea, 'rooms', roomId);
    try {
        await updateDoc(roomRef, { [arrayPath]: arrayUnion(element) });
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

export async function logManifestation(roomId, text) {
    // This needs to be updated or removed for the new architecture.
    // For now, logging to a central doc is fine if it still exists, 
    // but the path 'artifacts/appId/public/data/rooms/archive_apartment' is deprecated.
    console.log(`[MANIFESTATION] ${roomId}: ${text}`);
}
