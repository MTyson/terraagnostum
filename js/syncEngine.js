// js/syncEngine.js
import { 
    doc, setDoc, getDoc, onSnapshot, updateDoc, arrayUnion, arrayRemove, 
    serverTimestamp, collection, addDoc, getDocs, writeBatch 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { ref, uploadString, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";
import { db, auth, appId, storage, isSyncEnabled } from './firebaseConfig.js';
import * as stateManager from './stateManager.js';
import { blueprintApartment, isArchiveRoom } from './mapData.js';

let mapUnsubscribe = null;
let currentMapPath = null;
const CHAR_COLLECTION = 'characters';

/**
 * Orchestrates the boot sequence by peeking at state before applying it.
 */
export async function bootSyncEngine(mergeAndRefreshCallback) {
    const { user } = stateManager.getState();
    if (!db || !user || !isSyncEnabled) return;

    let startRoom = 'bedroom';
    let startArea = `apartment_${user.uid}`;
    let needsCorrectionSave = false;
    try {
        const stateRef = doc(db, 'artifacts', appId, 'users', user.uid, 'state', 'player');
        const snap = await getDoc(stateRef);
        if (snap.exists()) {
            const data = snap.data();
            startRoom = data.currentRoom || startRoom;
            startArea = data.currentArea || startArea;

            // Area/Room consistency check
            // FIX: Exclude 'outside' so it doesn't force you out of the public_void area
            if (isArchiveRoom(startRoom) && startRoom !== 'outside') {
                if (!startArea || !startArea.startsWith('apartment_')) {
                    console.log("[SYNC]: Inconsistent room/area detected on boot. Forcing apartment area.");
                    startArea = `apartment_${user.uid}`;
                    needsCorrectionSave = true;
                }
            }
        }
    } catch(e) {}

    // Set initial area before loading
    stateManager.updatePlayer({ currentArea: startArea, currentRoom: startRoom });
    if (needsCorrectionSave) savePlayerState();
    await updateAreaListener(startArea);
    await loadPlayerState(user);
    await loadUserCharacters(user);

    // Ensure the starting room is properly merged if it's an archive room
    if (isArchiveRoom(startRoom)) {
        const roomData = await loadRoom(startRoom);
        stateManager.updateMapNode(null, startRoom, roomData);
    }
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
                const prevState = stateManager.getState();
                const areaChanged = data.currentArea && data.currentArea !== prevState.localPlayer.currentArea;
                
                stateManager.updatePlayer({ 
                    ...data, 
                    inventory: data.inventory || [], 
                    stratum: data.stratum || "mundane" 
                });
                
                if (areaChanged) {
                    console.log(`[SYNC]: Area transition detected in Firestore: ${data.currentArea}. Updating listener...`);
                    updateAreaListener(data.currentArea);
                }

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
            if (found) {
                stateManager.setActiveAvatar(found);
            }
        } else if (localPlayer.activeAvatarId === undefined) {
            // Only auto-pick if activeAvatarId is missing (undefined)
            // If it's explicitly null or empty string, stay in VOID state.
            const defaultAvatar = characters.find(c => !c.deceased && !c.deployed);
            if (defaultAvatar) {
                stateManager.setActiveAvatar(defaultAvatar);
            }
        }
    } catch (e) { console.error("SyncEngine: Failed to load characters:", e); }
}

export async function updateAreaListener(areaId) {
    const { user } = stateManager.getState();
    if (!db || !user) return;
    if (mapUnsubscribe) mapUnsubscribe();

    const areaRoomsRef = collection(db, 'artifacts', appId, 'public', 'data', 'areas', areaId, 'rooms');
    
    return new Promise((resolve) => {
        mapUnsubscribe = onSnapshot(areaRoomsRef, async (snapshot) => {
            const areaNodes = {};
            snapshot.forEach(doc => { areaNodes[doc.id] = doc.data(); });
            
            // Seeding logic for the apartment and public areas
            if (Object.keys(areaNodes).length === 0) {
                if (areaId === `apartment_${user.uid}`) {
                    console.log("[SYNC]: Imposing full apartment architecture...");
                    const batch = writeBatch(db);
                    
                    for (const [roomId, roomData] of Object.entries(blueprintApartment)) {
                        if (roomId === 'outside') continue; 
                        const roomRef = doc(areaRoomsRef, roomId);
                        batch.set(roomRef, { 
                            ...roomData, 
                            id: roomId,
                            metadata: { ...roomData.metadata, ownerId: user.uid, area: areaId }
                        });
                    }
                    batch.commit();
                    return;
                } else if (areaId === 'public_void') {
                    console.log("[SYNC]: Imposing public void architecture...");
                    const batch = writeBatch(db);
                    const roomData = blueprintApartment['outside'];
                    const roomRef = doc(areaRoomsRef, 'outside');
                    batch.set(roomRef, { 
                        ...roomData, 
                        id: 'outside',
                        metadata: { ...roomData.metadata, area: 'public_void' }
                    });
                    batch.commit();
                    return;
                }
            }

            // CRITICAL: For archive rooms, we must merge the blueprint and the GLOBAL state
            // to ensure NPCs/Items from loadRoom/spawnNPCInRoom are not overwritten by 
            // the area-specific listener.
            for (const roomId of Object.keys(areaNodes)) {
                if (isArchiveRoom(roomId)) {
                    areaNodes[roomId] = await loadRoom(roomId, areaId);
                }
            }

            stateManager.setLocalAreaCache(areaNodes);
            resolve();
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
            activeAvatarId: activeAvatar?.id || null 
        };
        await setDoc(stateRef, stateToSave, { merge: true });
    } catch (e) { console.error("SyncEngine: Failed to save player state:", e); }
}

export async function syncAvatarStats(avatarId, stats) {
    const { user } = stateManager.getState();
    if (!db || !user || !isSyncEnabled || !avatarId) return;
    try {
        const charRef = doc(db, 'artifacts', appId, 'users', user.uid, CHAR_COLLECTION, avatarId);
        // Ensure we merge stats to not overwrite other fields if passing partials
        await setDoc(charRef, stats, { merge: true });
    } catch (e) { console.error("SyncEngine: Failed to sync avatar stats:", e); }
}

export async function updateMapNode(roomId, updates, targetArea = null) {
    if (isArchiveRoom(roomId)) {
        return updateRoom(roomId, updates);
    }
    const { user, localPlayer } = stateManager.getState();
    if (!db || !user || !isSyncEnabled) return;
    const areaToUpdate = targetArea || localPlayer.currentArea;
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'areas', areaToUpdate, 'rooms', roomId);
    try { 
        // Use updateDoc for dot-notated paths to ensure nested updates work correctly in Firestore
        const hasDotPaths = Object.keys(updates).some(k => k.includes('.'));
        if (hasDotPaths) {
            await updateDoc(roomRef, updates);
        } else {
            await setDoc(roomRef, updates, { merge: true });
        }
    } catch (e) { 
        // Fallback to setDoc if updateDoc fails (e.g. document doesn't exist)
        try {
            await setDoc(roomRef, updates, { merge: true });
        } catch (innerE) {
            console.error("SyncEngine: Failed to update map node:", innerE); 
        }
    }
}

export async function removeArrayElementFromNode(roomId, arrayPath, element) {
    if (isArchiveRoom(roomId)) {
        if (arrayPath === 'npcs') return removeNPCFromRoom(roomId, element);
        if (arrayPath === 'items') return removeItemFromRoom(roomId, element);
    }
    const { user, localPlayer } = stateManager.getState();
    if (!db || !user || !isSyncEnabled) return;
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'areas', localPlayer.currentArea, 'rooms', roomId);
    try {
        await updateDoc(roomRef, { [arrayPath]: arrayRemove(element) });
    } catch (e) { console.error("SyncEngine: Failed to remove element from node:", e); }
}

export async function addArrayElementToNode(roomId, arrayPath, element) {
    if (isArchiveRoom(roomId)) {
        if (arrayPath === 'npcs') return spawnNPCInRoom(roomId, element);
        if (arrayPath === 'items') {
            const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomId);
            return updateDoc(roomRef, { items: arrayUnion(element) });
        }
    }
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
        // --- STORAGE FIX FOR LARGE IMAGES ---
        // Character portraits can exceed Firestore's 1MB limit. 
        // We persist them to Storage and save the URL instead.
        if (charData.image && charData.image.startsWith('data:')) {
            try {
                const avatarId = `avatar_${Date.now()}`;
                const storagePath = `artifacts/${appId}/users/${user.uid}/avatars/${avatarId}.png`;
                const fileRef = ref(storage, storagePath);
                
                await uploadString(fileRef, charData.image, 'data_url');
                charData.image = await getDownloadURL(fileRef);
            } catch (storageErr) {
                console.error("SyncEngine: Failed to upload character image to storage:", storageErr);
                // Continue anyway, but Firestore might fail if image is too large.
            }
        }

        const charCol = collection(db, 'artifacts', appId, 'users', user.uid, CHAR_COLLECTION);
        const finalCharData = {
            ...charData,
            deployed: charData.deployed ?? false
        };
        const docRef = await addDoc(charCol, finalCharData);
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

export async function markCharacterDeployed(avatarId) {
    const { user } = stateManager.getState();
    if (!db || !user || !isSyncEnabled) return;
    
    try {
        const charRef = doc(db, 'artifacts', appId, 'users', user.uid, CHAR_COLLECTION, avatarId);
        await updateDoc(charRef, { deployed: true });
    } catch (e) { console.error("SyncEngine: Failed to mark character deployed:", e); }
}

export async function saveLoreFragment(areaId, loreData) {
    const { user } = stateManager.getState();
    if (!db || !user || !isSyncEnabled) return;
    try {
        const loreCol = collection(db, 'artifacts', appId, 'public', 'data', 'areas', areaId, 'lore');
        await addDoc(loreCol, {
            ...loreData,
            timestamp: serverTimestamp(),
            author: user.uid
        });
    } catch (e) { console.error("SyncEngine: Failed to save lore fragment:", e); }
}

export async function logManifestation(roomId, text) {
    // This needs to be updated or removed for the new architecture.
    // For now, logging to a central doc is fine if it still exists, 
    // but the path 'artifacts/appId/public/data/rooms/archive_apartment' is deprecated.
    console.log(`[MANIFESTATION] ${roomId}: ${text}`);
}

/**
 * Loads a room by merging static blueprint data with dynamic Firestore state.
 * This ensures NPCs created via "LEAVE VESSEL" persist across map transitions.
 */
export async function loadRoom(roomId, areaId = null) {
    // 1. Get the base data from the static blueprint
    const blueprint = blueprintApartment[roomId] || {};

    const { user, localPlayer } = stateManager.getState();
    const targetArea = areaId || localPlayer.currentArea;

    // 2. Fetch the "Live" state from Firestore
    // We check BOTH the shared path and the area-specific path for maximum persistence
    const sharedRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomId);
    const areaRef = doc(db, 'artifacts', appId, 'public', 'data', 'areas', targetArea, 'rooms', roomId);
    
    const [sharedSnap, areaSnap] = await Promise.all([
        getDoc(sharedRef),
        getDoc(areaRef)
    ]);

    const sharedData = sharedSnap.exists() ? sharedSnap.data() : {};
    const areaData = areaSnap.exists() ? areaSnap.data() : {};

    // 3. CRITICAL MERGE: Combine static layout with dynamic entities from both locations
    // We prioritize Area Data -> Shared Data -> Blueprint
    const rawItems = [
        ...(blueprint.items || []), 
        ...(sharedData.items || []),
        ...(areaData.items || [])
    ];
    const rawNpcs = [
        ...(sharedData.npcs || []),
        ...(areaData.npcs || [])
    ].map(npc => ({ ...npc, inventory: npc.inventory || [] }));

    return {
        ...blueprint,
        ...sharedData,
        ...areaData,
        // Ensure we combine items and npcs from all sources and deduplicate
        items: Array.from(new Map(rawItems.map(item => [item.id || item.name, item])).values()),
        npcs: Array.from(new Map(rawNpcs.map(npc => [npc.id || (npc.name + (npc.inventory?.length || 0)), npc])).values())
    };
}

/**
 * Updates a specific NPC in a room.
 */
export async function updateNPCInRoom(roomId, npcId, updates) {
    if (!auth.currentUser) return;
    const { localPlayer } = stateManager.getState();
    const room = await loadRoom(roomId);
    if (!room.npcs) return;

    const npcIndex = room.npcs.findIndex(n => n.id === npcId || n.name === npcId);
    if (npcIndex === -1) return;

    room.npcs[npcIndex] = { ...room.npcs[npcIndex], ...updates };

    await updateRoom(roomId, { npcs: room.npcs });
}

/**
 * Persists a spawned NPC to Firestore so it survives map reloads.
 */
export async function spawnNPCInRoom(roomId, npcData) {
    if (!auth.currentUser) return;
    const { localPlayer } = stateManager.getState();

    // Ensure inventory exists
    const finalNpc = { ...npcData, inventory: npcData.inventory || [] };

    // We save to BOTH to ensure it's found regardless of loading method
    const sharedRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomId);
    const areaRef = doc(db, 'artifacts', appId, 'public', 'data', 'areas', localPlayer.currentArea, 'rooms', roomId);
    
    const p1 = setDoc(sharedRef, { npcs: arrayUnion(finalNpc) }, { merge: true });
    const p2 = setDoc(areaRef, { npcs: arrayUnion(finalNpc) }, { merge: true });

    await Promise.all([p1, p2]);
    console.log(`[SYSTEM]: ${finalNpc.name} persisted to ${roomId} state.`);
}

/**
 * Removes an NPC from a room in Firestore.
 */
export async function removeNPCFromRoom(roomId, npcData) {
    if (!auth.currentUser) return;
    const { localPlayer } = stateManager.getState();

    const sharedRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomId);
    const areaRef = doc(db, 'artifacts', appId, 'public', 'data', 'areas', localPlayer.currentArea, 'rooms', roomId);
    
    await Promise.all([
        updateDoc(sharedRef, { npcs: arrayRemove(npcData) }).catch(()=>{}),
        updateDoc(areaRef, { npcs: arrayRemove(npcData) }).catch(()=>{})
    ]);
}

/**
 * Removes an item from a room in Firestore.
 */
export async function removeItemFromRoom(roomId, itemData) {
    if (!auth.currentUser) return;
    const { localPlayer } = stateManager.getState();

    const sharedRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomId);
    const areaRef = doc(db, 'artifacts', appId, 'public', 'data', 'areas', localPlayer.currentArea, 'rooms', roomId);
    
    await Promise.all([
        updateDoc(sharedRef, { items: arrayRemove(itemData) }).catch(()=>{}),
        updateDoc(areaRef, { items: arrayRemove(itemData) }).catch(()=>{})
    ]);
}

/**
 * Updates a specific field in a room (e.g., name or description).
 */
export async function updateRoom(roomId, updates) {
    if (!auth.currentUser) return;
    const { localPlayer } = stateManager.getState();

    const sharedRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomId);
    const areaRef = doc(db, 'artifacts', appId, 'public', 'data', 'areas', localPlayer.currentArea, 'rooms', roomId);
    
    await Promise.all([
        setDoc(sharedRef, updates, { merge: true }),
        setDoc(areaRef, updates, { merge: true })
    ]);
}
