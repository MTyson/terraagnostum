// js/syncEngine.js
import { 
    doc, setDoc, getDoc, onSnapshot, updateDoc, arrayUnion, arrayRemove, 
    serverTimestamp, collection, addDoc, getDocs, writeBatch, query, where 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { ref, uploadString, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";
import { db, auth, appId, storage, isSyncEnabled } from './firebaseConfig.js';
import * as stateManager from './stateManager.js';
import { blueprintApartment, blueprintGlobal } from './mapData.js';
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

    // --- GLOBAL EXIT REPAIR MIGRATION ---
    // Finds and corrects any apartment exits that still point to old privatized
    // versions of what are now shared global rooms (e.g. instance_uid_outside -> outside)
    repairPrivatizedGlobalExits(user);

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
 * MIGRATION: Repairs any apartment exit that incorrectly points to an old privatized
 * version of a global room (e.g. `instance_uid_outside` instead of `outside`).
 * 
 * This corrects the fallout from a refactor that moved `outside` from blueprintApartment
 * to blueprintGlobal. Players seeded before this change have a broken hallway exit.
 * This function runs on every boot but is a no-op (fast) if nothing needs fixing.
 */
async function repairPrivatizedGlobalExits(user) {
    if (!db || !user || !isSyncEnabled) return;

    const globalRoomsRef = collection(db, 'artifacts', appId, 'rooms');
    const batch = writeBatch(db);
    let needsCommit = false;

    // Build a list of room IDs that are canonical global rooms (not to be instanced)
    const globalRoomIds = new Set(Object.keys(blueprintGlobal));

    // For each apartment blueprint room, check if any exit target is a defunct private global
    for (const [blueprintKey, data] of Object.entries(blueprintApartment)) {
        if (!data.exits) continue;
        const instancedRoomId = `instance_${user.uid}_${blueprintKey}`;
        const instancedRoomRef = doc(globalRoomsRef, instancedRoomId);
        const updatesNeeded = {};

        for (const [dir, blueprintExit] of Object.entries(data.exits)) {
            const blueprintTargetId = typeof blueprintExit === 'string' ? blueprintExit : blueprintExit.target;
            // Is this exit supposed to go to a global room?
            if (!globalRoomIds.has(blueprintTargetId)) continue;

            // The correct target is the global room ID (e.g. "outside")
            // If the player's Firestore room has something else (e.g. "instance_uid_outside"), fix it.
            const activeMap = stateManager.getActiveMap();
            const instancedRoom = activeMap[instancedRoomId];
            if (!instancedRoom || !instancedRoom.exits) continue;

            const storedExit = instancedRoom.exits[dir];
            const storedTargetId = typeof storedExit === 'string' ? storedExit : storedExit?.target;

            if (storedTargetId && storedTargetId !== blueprintTargetId) {
                console.log(`[SYNC]: Repairing broken exit on ${instancedRoomId}.${dir}: ${storedTargetId} → ${blueprintTargetId}`);
                // Rebuild correct exit object from blueprint
                const correctedExit = typeof blueprintExit === 'string' 
                    ? blueprintTargetId
                    : { ...blueprintExit, target: blueprintTargetId };
                updatesNeeded[`exits.${dir}`] = correctedExit;
            }
        }

        if (Object.keys(updatesNeeded).length > 0) {
            // Use updateDoc (supports dot paths) for surgical field updates
            try {
                await updateDoc(instancedRoomRef, updatesNeeded);
                // Also update local cache immediately
                for (const [key, val] of Object.entries(updatesNeeded)) {
                    const exitDir = key.replace('exits.', '');
                    stateManager.updateMapNode(instancedRoomId, { exits: { ...(stateManager.getActiveMap()[instancedRoomId]?.exits || {}), [exitDir]: val } });
                }
                console.log(`[SYNC]: Repaired exits on ${instancedRoomId} in Firestore.`);
            } catch(e) {
                console.warn(`[SYNC]: Could not repair exits on ${instancedRoomId}:`, e);
            }
        }
    }
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
            const needsRefresh = Object.values(strata).some(s => s.visualStyle && s.visualStyle.includes('typos on legal documents'));
            if (needsRefresh) {
                console.log("[SYNC]: Outdated strata detected. Re-seeding...");
                const batch = writeBatch(db);
                for (const [id, data] of Object.entries(DEFAULT_STRATA)) {
                    batch.set(doc(strataRef, id), data);
                }
                await batch.commit();
                return;
            }

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
            // ===== DIAGNOSTIC: Log snapshot summary =====
            const outsideDoc = snapshot.docs?.find(d => d.id === 'outside');
            console.log(`%c[SYNC DIAG] onSnapshot fired. ${snapshot.size} docs. "outside" in snapshot: ${!!outsideDoc}`, 'color: cyan; font-weight: bold');
            if (outsideDoc) {
                const od = outsideDoc.data();
                console.log(`[SYNC DIAG] outside.name="${od.name}" outside.exits=`, od.exits);
            } else {
                console.warn('[SYNC DIAG] "outside" is NOT in this snapshot - dynamic seeder will inject blueprint!');
            }
            // ============================================
            snapshot.forEach(doc => { 
                const roomData = doc.data(); 
                
                // --- BACKWARD COMPATIBLE BLUEPRINT MERGE ---
                // If this room originated from the apartment blueprint, ensure its exits
                // have the latest locks (reqAuth, itemReq) and correct global targets.
                const baseId = doc.id.replace(/^instance_[^_]+_/, '');
                if (blueprintApartment[baseId] && blueprintApartment[baseId].exits && roomData.exits) {
                    for (const [dir, exitData] of Object.entries(blueprintApartment[baseId].exits)) {
                        if (typeof exitData === 'object' && roomData.exits[dir]) {
                            // Upgrade string to object if necessary
                            if (typeof roomData.exits[dir] === 'string') {
                                roomData.exits[dir] = { target: roomData.exits[dir] };
                            }
                            // GLOBAL TARGET FIX: If the blueprint exit points to a global (non-apartment) room,
                            // force the stored exit to use the correct global target.
                            // This corrects old private exits like instance_uid_outside -> outside
                            if (exitData.target && !blueprintApartment[exitData.target]) {
                                roomData.exits[dir].target = exitData.target;
                            }
                            if (exitData.reqAuth !== undefined) roomData.exits[dir].reqAuth = exitData.reqAuth;
                            if (exitData.itemReq !== undefined) roomData.exits[dir].itemReq = exitData.itemReq;
                            if (exitData.lockMsg !== undefined) roomData.exits[dir].lockMsg = exitData.lockMsg;
                        }
                    }
                }
                
                rooms[doc.id] = roomData; 
            });
            
            // Dynamic Seeding for Missing Global Rooms
            // CRITICAL: Use getDoc to check Firestore directly before seeding.
            // We cannot rely on snapshot timing alone - if we write blueprint data
            // async (fire-and-forget), the write can arrive AFTER a player's edit
            // and silently overwrite fields like name/description/visualPrompt.
            for (const [roomId, roomData] of Object.entries(blueprintGlobal)) {
                if (!rooms[roomId]) {
                    // Double-check Firestore directly to confirm the room truly doesn't exist
                    const roomRef = doc(globalRoomsRef, roomId);
                    const existingSnap = await getDoc(roomRef);
                    if (!existingSnap.exists()) {
                        console.log(`[SYNC]: Global room [${roomId}] confirmed missing. Seeding...`);
                        await setDoc(roomRef, { ...roomData, id: roomId });
                        rooms[roomId] = { ...roomData, id: roomId };
                    } else {
                        // Doc exists in Firestore but wasn't in the snapshot yet (timing).
                        // Use the real Firestore data, not the blueprint.
                        console.log(`[SYNC]: Global room [${roomId}] found in Firestore (snapshot lag). Using live data.`);
                        rooms[roomId] = existingSnap.data();
                    }
                }
            }

            // Seeding logic: if global rooms collection is completely empty, seed with blueprintApartment and blueprintGlobal
            if (snapshot.empty) {
                console.log("[SYNC]: Global room collection empty. Seeding templates...");
                const batch = writeBatch(db);
                
                for (const [roomId, roomData] of Object.entries(blueprintApartment)) {
                    const roomRef = doc(globalRoomsRef, roomId);
                    // merge: true so future blueprint updates don't wipe custom room data
                    batch.set(roomRef, { 
                        ...roomData, 
                        id: roomId
                    }, { merge: true });
                }
                for (const [roomId, roomData] of Object.entries(blueprintGlobal)) {
                    const roomRef = doc(globalRoomsRef, roomId);
                    // merge: true protects all player-built exits on shared global rooms
                    batch.set(roomRef, { 
                        ...roomData, 
                        id: roomId
                    }, { merge: true });
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
    // Sanitize: JSON round-trip removes undefined values that Firebase rejects
    const safeElement = element !== null && typeof element === 'object'
        ? JSON.parse(JSON.stringify(element))
        : element;
    if (safeElement === undefined || safeElement === null) {
        console.warn(`[SYNC]: addArrayElementToNode skipped — element for '${arrayPath}' is null/undefined.`);
        return;
    }
    const roomRef = doc(db, 'artifacts', appId, 'rooms', roomId);
    try {
        await updateDoc(roomRef, { [arrayPath]: arrayUnion(safeElement) });
    } catch (e) { console.error("SyncEngine: Failed to add element to node:", e); }
}

export async function uploadNPCImage(npcId, dataUri) {
    if (!db || !storage || !isSyncEnabled || !dataUri || !dataUri.startsWith('data:')) return dataUri;
    try {
        const storagePath = `artifacts/${appId}/npcs/${npcId}.png`;
        const fileRef = ref(storage, storagePath);
        await uploadString(fileRef, dataUri, 'data_url');
        return await getDownloadURL(fileRef);
    } catch (e) {
        console.error("SyncEngine: NPC image upload failed:", e);
        return dataUri;
    }
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

export async function saveFeedback(feedbackData) {
    const { user, localPlayer, activeAvatar } = stateManager.getState();
    if (!db || !isSyncEnabled) return;
    try {
        const feedbackCol = collection(db, 'artifacts', appId, 'feedback');
        await addDoc(feedbackCol, {
            ...feedbackData,
            uid: user?.uid || 'anonymous',
            email: user?.email || null,
            roomId: localPlayer.currentRoom,
            stratum: localPlayer.stratum,
            avatarName: activeAvatar?.name || null,
            timestamp: serverTimestamp(),
            userAgent: navigator.userAgent
        });
        console.log("[SYNC]: Feedback recorded.");
    } catch (e) { console.error("SyncEngine: Failed to save feedback:", e); }
}

export async function logManifestation(roomId, text) {
    console.log(`[MANIFESTATION] ${roomId}: ${text}`);
}

/**
 * Loads a room by merging static blueprint data with dynamic Firestore state from the global collection.
 */
export async function loadRoom(roomId) {
    const { user } = stateManager.getState();
    
    // Blueprint data is ONLY used for player-instanced apartment rooms.
    // Global shared rooms (e.g. 'outside', 'room_xxx') must load purely from Firestore.
    const isInstancedRoom = roomId.startsWith(`instance_`);
    const baseId = isInstancedRoom ? roomId.replace(/^instance_[^_]+_/, '') : null;
    const blueprint = (isInstancedRoom && baseId && blueprintApartment[baseId]) ? blueprintApartment[baseId] : {};

    const roomRef = doc(db, 'artifacts', appId, 'rooms', roomId);
    
    try {
        const snap = await getDoc(roomRef);
        const firestoreData = snap.exists() ? snap.data() : {};

        const mergedItems = new Map();
        [...(blueprint.items || []), ...(firestoreData.items || [])].forEach(item => {
            const key = item.id || item.name;
            const existing = mergedItems.get(key) || {};
            mergedItems.set(key, { ...existing, ...item });
        });

        const mergedNpcs = new Map();
        [...(blueprint.npcs || []), ...(firestoreData.npcs || [])].forEach(npc => {
            const key = npc.id || (npc.name + (npc.inventory?.length || 0));
            const existing = mergedNpcs.get(key) || {};
            mergedNpcs.set(key, { ...existing, ...npc, inventory: npc.inventory || existing.inventory || [] });
        });

        return {
            ...blueprint,
            ...firestoreData,
            items: Array.from(mergedItems.values()),
            npcs: Array.from(mergedNpcs.values())

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

/**
 * Writes or updates the player's Anchor Portal record in the shared portals registry.
 * This registry is read by the AIGM (Weave feature, Phase 3) and by portal traversal logic.
 */
export async function savePortal(portalData) {
    const { user } = stateManager.getState();
    if (!db || !user || !isSyncEnabled) return;
    try {
        const portalRef = doc(db, 'artifacts', appId, 'portals', user.uid);
        await setDoc(portalRef, {
            ...portalData,
            ownerUid: user.uid,
            lastActive: serverTimestamp()
        }, { merge: true });
        console.log('[SYNC]: Portal registry updated.');
    } catch (e) { console.error('SyncEngine: Failed to save portal:', e); }
}

/**
 * Marks a portal as inactive in the registry (lock portal command).
 * The portal item is removed from the room separately via removeItemFromRoom.
 */
export async function setPortalActive(uid, active) {
    if (!db || !isSyncEnabled) return;
    try {
        const portalRef = doc(db, 'artifacts', appId, 'portals', uid);
        await setDoc(portalRef, { active, lastActive: serverTimestamp() }, { merge: true });
    } catch (e) { console.error('SyncEngine: Failed to set portal active state:', e); }
}

/**
 * Queries unread notifications for the current user, marks them read, and returns them.
 * Call at boot time after loadPlayerState. Returns [] if none found.
 */
export async function checkPendingNotifications() {
    const { user } = stateManager.getState();
    if (!db || !user || user.isAnonymous || !isSyncEnabled) return [];
    try {
        const notifCol = collection(db, 'artifacts', appId, 'notifications');
        const q = query(notifCol, where('targetUid', '==', user.uid));
        const snap = await getDocs(q);
        if (snap.empty) return [];

        const notifications = [];
        const batch = writeBatch(db);
        snap.forEach(docSnap => {
            const data = docSnap.data();
            if (!data.read) {
                notifications.push(data);
                batch.update(docSnap.ref, { read: true });
            }
        });
        if (notifications.length > 0) await batch.commit();
        return notifications;
    } catch (e) {
        console.warn('[SYNC]: Failed to check notifications:', e);
        return [];
    }
}

/**
 * Writes a persistent notification for another player.
 * Stored in Firestore and surfaced to the recipient on next login.
 */
export async function sendNotification(targetUid, notifData) {
    if (!db || !isSyncEnabled) return;
    try {
        const notifCol = collection(db, 'artifacts', appId, 'notifications');
        await addDoc(notifCol, {
            ...notifData,
            targetUid,
            timestamp: serverTimestamp(),
            read: false
        });
    } catch (e) { console.warn('[SYNC]: Failed to send notification:', e); }
}

