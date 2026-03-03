// js/syncEngine.js
import { 
    doc, setDoc, getDoc, onSnapshot, updateDoc, arrayUnion, arrayRemove, 
    serverTimestamp, collection, addDoc, getDocs 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, appId, isSyncEnabled } from './firebaseConfig.js';
import * as stateManager from './stateManager.js';

let mapUnsubscribe = null;
let currentMapPath = null;
const CHAR_COLLECTION = 'v3_characters';

/**
 * Initializes the background synchronization for the current user session.
 */
export async function initializeSession(user) {
    if (!db || !user || !isSyncEnabled) return;

    // 1. Setup World Manifestation Listener
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', 'archive_apartment');
    onSnapshot(roomRef, (snap) => {
        if (!snap.exists()) setDoc(roomRef, { created: serverTimestamp(), manifestations: [] });
    });

    // 2. Load Player State
    await loadPlayerState(user);

    // 3. Load Astral Map
    await loadAstralMap(user);

    // 4. Load User Characters
    await loadUserCharacters(user);

    // 5. Initial Map Listener
    updateMapListener(user);
    
    // 6. Subscribe to room changes to update the map listener
    stateManager.subscribe((state) => {
        if (state.user) {
            updateMapListener(state.user);
        }
    });
}

async function loadPlayerState(user) {
    try {
        const stateRef = doc(db, 'artifacts', appId, 'users', user.uid, 'state', 'player');
        const snap = await getDoc(stateRef);
        if (snap.exists()) {
            const data = snap.data();
            let newRoom = data.currentRoom;
            if (newRoom === 'main_room') newRoom = 'lore1';
            
            stateManager.updatePlayer({ 
                ...data, 
                currentRoom: newRoom,
                inventory: data.inventory || [], 
                stratum: data.stratum || "mundane" 
            });
        }
    } catch (e) { console.error("SyncEngine: Failed to load player state:", e); }
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

export function updateMapListener(user) {
    if (!db || !user) return;
    const { localPlayer } = stateManager.getState();
    const isPrivate = stateManager.isArchiveRoom(localPlayer.currentRoom);
    const newPath = isPrivate 
        ? `artifacts/${appId}/users/${user.uid}/instance/apartment_nodes`
        : `artifacts/${appId}/public/data/maps/apartment_graph_live`;

    if (currentMapPath === newPath) return; 
    if (mapUnsubscribe) mapUnsubscribe(); 

    currentMapPath = newPath;
    const pathParts = newPath.split('/');
    const mapRef = doc(db, pathParts.slice(0, -1).join('/'), pathParts.pop());
    
    mapUnsubscribe = onSnapshot(mapRef, (snap) => {
        if (!snap.exists()) {
            const { apartmentMap } = stateManager.getState();
            setDoc(mapRef, { nodes: apartmentMap, lastUpdated: serverTimestamp() });
        } else {
            const data = snap.data();
            if (data.nodes) {
                stateManager.setApartmentMap(data.nodes);
            }
        }
    });
}

export async function savePlayerState() {
    const { user, localPlayer, activeAvatar, astralMap } = stateManager.getState();
    if (!db || !user || !isSyncEnabled) return;
    try {
        const stateRef = doc(db, 'artifacts', appId, 'users', user.uid, 'state', 'player');
        const stateToSave = { 
            ...localPlayer, 
            activeAvatarId: activeAvatar ? activeAvatar.id : null 
        };
        await setDoc(stateRef, stateToSave);
        
        if (Object.keys(astralMap).length > 0) {
            const astralRef = doc(db, 'artifacts', appId, 'users', user.uid, 'instance', 'astral_nodes');
            await setDoc(astralRef, { nodes: astralMap, lastUpdated: serverTimestamp() });
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
    
    const isPrivate = stateManager.isArchiveRoom(roomId);
    const mapPath = isPrivate 
        ? `artifacts/${appId}/users/${user.uid}/instance/apartment_nodes`
        : `artifacts/${appId}/public/data/maps/apartment_graph_live`;
    
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
    
    const isPrivate = stateManager.isArchiveRoom(roomId);
    const mapPath = isPrivate 
        ? `artifacts/${appId}/users/${user.uid}/instance/apartment_nodes`
        : `artifacts/${appId}/public/data/maps/apartment_graph_live`;
        
    try {
        const mapRef = doc(db, mapPath);
        await updateDoc(mapRef, { [`nodes.${roomId}.${arrayPath}`]: arrayRemove(element) });
    } catch (e) { console.error("SyncEngine: Failed to remove element from node:", e); }
}

export async function addArrayElementToNode(roomId, arrayPath, element) {
    const { user } = stateManager.getState();
    if (!db || !user || !isSyncEnabled) return;
    
    const isPrivate = stateManager.isArchiveRoom(roomId);
    const mapPath = isPrivate 
        ? `artifacts/${appId}/users/${user.uid}/instance/apartment_nodes`
        : `artifacts/${appId}/public/data/maps/apartment_graph_live`;
        
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
