// js/syncEngine.js
import { 
    doc, setDoc, getDoc, onSnapshot, updateDoc, arrayUnion, arrayRemove, 
    serverTimestamp, collection, addDoc, getDocs, writeBatch, query, where 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { ref, uploadString, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";
import { db, auth, appId, storage, isSyncEnabled } from './firebaseConfig.js';
import * as stateManager from './stateManager.js';
import { blueprintApartment } from './mapData.js';
import { DEFAULT_STRATA } from './stratumData.js';

let mapUnsubscribe = null;
let strataUnsubscribe = null;
const CHAR_COLLECTION = 'characters';

/**
 * Orchestrates the boot sequence by peeking at state before applying it.
 */
export async function bootSyncEngine(mergeAndRefreshCallback) {
    const { user } = stateManager.getState();
    if (!db || !user || !isSyncEnabled) return;

    let startRoom = `instance_${user.uid}_bedroom`;
    try {
        const stateRef = doc(db, 'artifacts', appId, 'playerState', user.uid);
        const snap = await getDoc(stateRef);
        if (snap.exists()) {
            const data = snap.data();
            startRoom = data.currentRoom || startRoom;
        } else {
            // New user detection: Ensure private instance exists
            await seedPlayerInstance(user);
        }
    } catch(e) {
        console.warn("[SYNC]: Error fetching player state, ensuring instance exists.");
        await seedPlayerInstance(user);
    }

    // Set initial room before loading
    stateManager.updatePlayer({ currentRoom: startRoom });
    
    await updateGlobalMapListener();
    await updateStrataListener();
    await loadPlayerState(user);
    await loadUserCharacters(user);
    await startPresenceListener();

    // --- ZOMBIE RULE (Bedroom Respawn) ---
    // If not in combat and last active was long ago, reset to bedroom anchor
    const { localPlayer } = stateManager.getState();
    const IDLE_TIMEOUT = 30 * 60 * 1000; // 30 minutes
    const isRecentlyActive = localPlayer.lastActive && (Date.now() - localPlayer.lastActive.toMillis?.() || localPlayer.lastActive) < IDLE_TIMEOUT;
    
    const isInsideInstance = localPlayer.currentRoom.startsWith('instance_');

    if (!localPlayer.combat?.active && !isRecentlyActive && localPlayer.currentRoom !== `instance_${user.uid}_bedroom` && isInsideInstance) {
        console.log("[SYNC]: Idle detected. Reality recalibrating to primary anchor (Bedroom).");
        startRoom = `instance_${user.uid}_bedroom`;
        stateManager.updatePlayer({ currentRoom: startRoom });
        await savePlayerState();
    }

    // Ensure the starting room is properly merged
    const roomData = await loadRoom(startRoom);
    stateManager.updateMapNode(startRoom, roomData);
}

/**
 * Seeds a private instance of the apartment for a new user.
 */
async function seedPlayerInstance(user) {
    const globalRoomsRef = collection(db, 'artifacts', appId, 'rooms');
    const primaryAnchorRef = doc(globalRoomsRef, `instance_${user.uid}_bedroom`);
    
    // Quick check to avoid redundant seeding
    const snap = await getDoc(primaryAnchorRef);
    if (snap.exists()) return;

    console.log(`[SYNC]: Generating private apartment instance for ${user.uid.substring(0,8)}...`);
    const batch = writeBatch(db);

    for (const [blueprintKey, data] of Object.entries(blueprintApartment)) {
        const instancedId = `instance_${user.uid}_${blueprintKey}`;
        const roomRef = doc(globalRoomsRef, instancedId);
        
        // Remap exits to point to the user's private rooms
        const remappedExits = {};
        if (data.exits) {
            for (const [dir, target] of Object.entries(data.exits)) {
                const targetId = typeof target === 'string' ? target : target.target;
                
                if (blueprintApartment[targetId]) {
                    const instancedTarget = `instance_${user.uid}_${targetId}`;
                    if (typeof target === 'string') {
                        remappedExits[dir] = instancedTarget;
                    } else {
                        remappedExits[dir] = { ...target, target: instancedTarget };
                    }
                } else {
                    remappedExits[dir] = target; // Global exit (e.g. "outside")
                }
            }
        }

        batch.set(roomRef, {
            ...data,
            id: instancedId,
            exits: remappedExits,
            metadata: { 
                ...(data.metadata || {}), 
                isInstance: true, 
                owner: user.uid,
                authorizedUids: [user.uid] // Foundation for future "Share with Friend" feature
            }
        });
    }
    await batch.commit();
}

/**
 * Loads player state and maintains a real-time listener for updates.
 */
export async function loadPlayerState(user) {
    try {
        const stateRef = doc(db, 'artifacts', appId, 'playerState', user.uid);
        
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
        const charCol = collection(db, 'artifacts', appId, CHAR_COLLECTION);
        const q = query(charCol, where("ownerUid", "==", user.uid));
        const snap = await getDocs(q);
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
            const defaultAvatar = characters.find(c => !c.deceased && !c.deployed);
            if (defaultAvatar) {
                stateManager.setActiveAvatar(defaultAvatar);
            }
        }
    } catch (e) { console.error("SyncEngine: Failed to load characters:", e); }
}

/**
 * Attaches a real-time listener to the global strata collection.
 * Performs initial seeding if the collection is empty.
 * Caches results in localStorage for fast subsequent loads.
 */
export async function updateStrataListener() {
    const { user } = stateManager.getState();
    if (!db || !user) return;
    if (strataUnsubscribe) strataUnsubscribe();

    // 1. Initial Load from Cache (Fast Boot)
    try {
        const cached = localStorage.getItem(`strata_cache_${appId}`);
        if (cached) {
            const strata = JSON.parse(cached);
            stateManager.setStrata(strata);
            console.log("[SYNC]: Strata definitions loaded from local cache.");
        }
    } catch (e) {
        console.warn("[SYNC]: Failed to parse strata cache.", e);
    }

    const strataRef = collection(db, 'artifacts', appId, 'strata');
    
    return new Promise((resolve) => {
        strataUnsubscribe = onSnapshot(strataRef, async (snapshot) => {
            const strata = {};
            snapshot.forEach(doc => { strata[doc.id] = doc.data(); });
            
            // Seeding logic: if strata collection is empty, seed with DEFAULT_STRATA
            if (snapshot.empty) {
                console.log("[SYNC]: Strata collection empty. Seeding from DEFAULT_STRATA...");
                const batch = writeBatch(db);
                
                for (const [id, data] of Object.entries(DEFAULT_STRATA)) {
                    const docRef = doc(strataRef, id);
                    batch.set(docRef, data);
                }
                await batch.commit();
                return;
            }

            // 2. Update State & Local Cache
            stateManager.setStrata(strata);
            localStorage.setItem(`strata_cache_${appId}`, JSON.stringify(strata));
            
            resolve();
        });
    });
}

/**
 * Attaches a real-time listener to the global rooms collection.
 * Performs initial seeding if the collection is empty.
 */
export async function updateGlobalMapListener() {
    const { user } = stateManager.getState();
    if (!db || !user) return;
    if (mapUnsubscribe) mapUnsubscribe();

    const globalRoomsRef = collection(db, 'artifacts', appId, 'rooms');
    
    return new Promise((resolve) => {
        mapUnsubscribe = onSnapshot(globalRoomsRef, async (snapshot) => {
            const rooms = {};
            snapshot.forEach(doc => { rooms[doc.id] = doc.data(); });
            
            // Seeding logic: if global rooms collection is completely empty, seed with blueprintApartment
            if (snapshot.empty) {
                console.log("[SYNC]: Global room collection empty. Seeding from blueprintApartment...");
                const batch = writeBatch(db);
                
                for (const [roomId, roomData] of Object.entries(blueprintApartment)) {
                    const roomRef = doc(globalRoomsRef, roomId);
                    batch.set(roomRef, { 
                        ...roomData, 
                        id: roomId
                    });
                }
                await batch.commit();
                // onSnapshot will trigger again after commit
                return;
            }

            stateManager.setLocalAreaCache(rooms);
            resolve();
        });
    });
}

export async function savePlayerState() {
    const { user, localPlayer, activeAvatar } = stateManager.getState();
    if (!db || !user || !isSyncEnabled) return;
    try {
        const stateRef = doc(db, 'artifacts', appId, 'playerState', user.uid);
        const stateToSave = { 
            ...localPlayer, 
            activeAvatarId: activeAvatar?.id || null,
            lastActive: serverTimestamp()
        };
        await setDoc(stateRef, stateToSave, { merge: true });
        
        // Also update shared presence
        await updatePresence(user, localPlayer, activeAvatar);
    } catch (e) { console.error("SyncEngine: Failed to save player state:", e); }
}

async function updatePresence(user, localPlayer, activeAvatar) {
    if (!db || !user || !isSyncEnabled) return;
    try {
        const presenceRef = doc(db, 'artifacts', appId, 'presence', user.uid);
        await setDoc(presenceRef, {
            uid: user.uid,
            roomId: localPlayer.currentRoom,
            avatarName: activeAvatar?.name || "Disembodied Void",
            avatarImage: activeAvatar?.image || null,
            inCombat: localPlayer.combat?.active || false,
            lastActive: serverTimestamp()
        }, { merge: true });
    } catch (e) { console.warn("SyncEngine: Presence update failed:", e); }
}

let presenceUnsubscribe = null;
export async function startPresenceListener() {
    if (!db || !isSyncEnabled) return;
    if (presenceUnsubscribe) presenceUnsubscribe();

    const presenceCol = collection(db, 'artifacts', appId, 'presence');
    presenceUnsubscribe = onSnapshot(presenceCol, (snapshot) => {
        const players = {};
        const { user } = stateManager.getState();
        
        snapshot.forEach(doc => {
            // Don't include self in otherPlayers
            if (user && doc.id === user.uid) return;
            
            const data = doc.data();
            // Filter out stale presence (> 5 mins)
            const lastActive = data.lastActive?.toMillis?.() || 0;
            if (Date.now() - lastActive < 5 * 60 * 1000) {
                players[doc.id] = data;
            }
        });
        stateManager.setOtherPlayers(players);
    });
}

export async function syncAvatarStats(avatarId, stats) {
    const { user } = stateManager.getState();
    if (!db || !user || !isSyncEnabled || !avatarId) return;
    try {
        const charRef = doc(db, 'artifacts', appId, CHAR_COLLECTION, avatarId);
        await setDoc(charRef, stats, { merge: true });
    } catch (e) { console.error("SyncEngine: Failed to sync avatar stats:", e); }
}

/**
 * Updates a room node in the global rooms collection.
 */
export async function updateMapNode(roomId, updates) {
    const { user } = stateManager.getState();
    if (!db || !user || !isSyncEnabled) return;
    const roomRef = doc(db, 'artifacts', appId, 'rooms', roomId);
    try { 
        const hasDotPaths = Object.keys(updates).some(k => k.includes('.'));
        if (hasDotPaths) {
            await updateDoc(roomRef, updates);
        } else {
            await setDoc(roomRef, updates, { merge: true });
        }
    } catch (e) { 
        try {
            await setDoc(roomRef, updates, { merge: true });
        } catch (innerE) {
            console.error("SyncEngine: Failed to update map node:", innerE); 
        }
    }
}

export async function removeArrayElementFromNode(roomId, arrayPath, element) {
    const { user } = stateManager.getState();
    if (!db || !user || !isSyncEnabled) return;
    const roomRef = doc(db, 'artifacts', appId, 'rooms', roomId);
    try {
        await updateDoc(roomRef, { [arrayPath]: arrayRemove(element) });
    } catch (e) { console.error("SyncEngine: Failed to remove element from node:", e); }
}

export async function addArrayElementToNode(roomId, arrayPath, element) {
    const { user } = stateManager.getState();
    if (!db || !user || !isSyncEnabled) return;
    const roomRef = doc(db, 'artifacts', appId, 'rooms', roomId);
    try {
        await updateDoc(roomRef, { [arrayPath]: arrayUnion(element) });
    } catch (e) { console.error("SyncEngine: Failed to add element to node:", e); }
}

export async function createCharacter(charData) {
    const { user } = stateManager.getState();
    if (!db || !user || !isSyncEnabled) return null;
    
    try {
        if (charData.image && charData.image.startsWith('data:')) {
            try {
                const avatarId = `avatar_${Date.now()}`;
                const storagePath = `artifacts/${appId}/users/${user.uid}/avatars/${avatarId}.png`;
                const fileRef = ref(storage, storagePath);
                
                await uploadString(fileRef, charData.image, 'data_url');
                charData.image = await getDownloadURL(fileRef);
            } catch (storageErr) {
                console.error("SyncEngine: Failed to upload character image to storage:", storageErr);
            }
        }

        const charCol = collection(db, 'artifacts', appId, CHAR_COLLECTION);
        const finalCharData = {
            name: charData.name || "Unnamed Vessel",
            archetype: charData.archetype || "Unknown",
            description: charData.description || "No biometric history on file.",
            stratum: charData.stratum || "mundane",
            visual_prompt: charData.visual_prompt || charData.visualPrompt || "A mysterious figure.",
            stats: charData.stats || { AMN: 20, WILL: 10, AWR: 10, PHYS: 10 },
            image: charData.image || null,
            deceased: charData.deceased ?? false,
            deployed: charData.deployed ?? false,
            ownerUid: user.uid,
            timestamp: serverTimestamp()
        };

        // Filter out any undefined keys to prevent Firestore errors
        Object.keys(finalCharData).forEach(key => finalCharData[key] === undefined && delete finalCharData[key]);

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
        const charRef = doc(db, 'artifacts', appId, CHAR_COLLECTION, avatarId);
        await updateDoc(charRef, { deceased: true });
    } catch (e) { console.error("SyncEngine: Failed to mark character deceased:", e); }
}

export async function markCharacterDeployed(avatarId) {
    const { user } = stateManager.getState();
    if (!db || !user || !isSyncEnabled) return;
    
    try {
        const charRef = doc(db, 'artifacts', appId, CHAR_COLLECTION, avatarId);
        await updateDoc(charRef, { deployed: true });
    } catch (e) { console.error("SyncEngine: Failed to mark character deployed:", e); }
}

export async function saveLoreFragment(roomId, loreData) {
    const { user } = stateManager.getState();
    if (!db || !user || !isSyncEnabled) return;
    try {
        // Lore is now flattened at the root of the app namespace
        const loreCol = collection(db, 'artifacts', appId, 'lore');
        await addDoc(loreCol, {
            ...loreData,
            roomId: roomId, // Reference to the room it belongs to
            timestamp: serverTimestamp(),
            author: user.uid
        });
    } catch (e) { console.error("SyncEngine: Failed to save lore fragment:", e); }
}

export async function logManifestation(roomId, text) {
    console.log(`[MANIFESTATION] ${roomId}: ${text}`);
}

/**
 * Loads a room by merging static blueprint data with dynamic Firestore state from the global collection.
 */
export async function loadRoom(roomId) {
    const blueprint = blueprintApartment[roomId] || {};
    const { user } = stateManager.getState();

    const roomRef = doc(db, 'artifacts', appId, 'rooms', roomId);
    
    try {
        const snap = await getDoc(roomRef);
        const firestoreData = snap.exists() ? snap.data() : {};

        const rawItems = [
            ...(blueprint.items || []), 
            ...(firestoreData.items || [])
        ];
        const rawNpcs = [
            ...(blueprint.npcs || []),
            ...(firestoreData.npcs || [])
        ].map(npc => ({ ...npc, inventory: npc.inventory || [] }));

        return {
            ...blueprint,
            ...firestoreData,
            items: Array.from(new Map(rawItems.map(item => [item.id || item.name, item])).values()),
            npcs: Array.from(new Map(rawNpcs.map(npc => [npc.id || (npc.name + (npc.inventory?.length || 0)), npc])).values())
        };
    } catch (e) {
        console.error(`SyncEngine: Failed to load room ${roomId}:`, e);
        return blueprint;
    }
}

export async function updateNPCInRoom(roomId, npcId, updates) {
    if (!auth.currentUser) return;
    const room = await loadRoom(roomId);
    if (!room.npcs) return;

    const npcIndex = room.npcs.findIndex(n => n.id === npcId || n.name === npcId);
    if (npcIndex === -1) return;

    room.npcs[npcIndex] = { ...room.npcs[npcIndex], ...updates };

    await updateRoom(roomId, { npcs: room.npcs });
}

export async function spawnNPCInRoom(roomId, npcData) {
    if (!auth.currentUser) return;
    const finalNpc = { ...npcData, inventory: npcData.inventory || [] };
    const roomRef = doc(db, 'artifacts', appId, 'rooms', roomId);
    await setDoc(roomRef, { npcs: arrayUnion(finalNpc) }, { merge: true });
    console.log(`[SYSTEM]: ${finalNpc.name} persisted to global ${roomId} state.`);
}

export async function removeNPCFromRoom(roomId, npcData) {
    if (!auth.currentUser) return;
    const roomRef = doc(db, 'artifacts', appId, 'rooms', roomId);
    await updateDoc(roomRef, { npcs: arrayRemove(npcData) }).catch(()=>{});
}

export async function removeItemFromRoom(roomId, itemData) {
    if (!auth.currentUser) return;
    const roomRef = doc(db, 'artifacts', appId, 'rooms', roomId);
    await updateDoc(roomRef, { items: arrayRemove(itemData) }).catch(()=>{});
}

export async function updateRoom(roomId, updates) {
    if (!auth.currentUser) return;
    const roomRef = doc(db, 'artifacts', appId, 'rooms', roomId);
    await setDoc(roomRef, updates, { merge: true });
}
