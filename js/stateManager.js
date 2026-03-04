// js/stateManager.js
import { apartmentMap as initialMap, ARCHIVE_NODES, isArchiveRoom } from './mapData.js';

// --- INITIAL STATE ---
let state = {
    localPlayer: { 
        hp: 20, 
        currentRoom: "bedroom", 
        stratum: "mundane",
        inventory: [],
        closetDoorClosed: false,
        isArchitect: false,
        combat: { active: false, opponent: null },
        activeAvatarId: null
    },
    apartmentMap: { ...initialMap },
    mundaneMap: {}, // Add this!
    astralMap: {},
    localCharacters: [], 
    activeAvatar: null,  
    user: null,
    activeTerminal: false,
    isProcessing: false,
    suggestions: [],
    wizardState: { active: false, type: null, step: 0, pendingData: {} }
};

// --- PUB/SUB MECHANISM ---
const listeners = new Set();

/**
 * Subscribe to state changes.
 * @param {Function} listener - Function to call on state change.
 * @returns {Function} Unsubscribe function.
 */
export function subscribe(listener) {
    listeners.add(listener);
    // Immediately call with current state for initialization
    listener(state);
    return () => listeners.delete(listener);
}

function notify() {
    listeners.forEach(listener => listener(state));
}

// --- GETTERS ---
export function getState() {
    return state;
}

export function getUserTier() {
    const { activeAvatar, localPlayer, user } = state;
    if (!activeAvatar) return "VOID";
    if (localPlayer.isArchitect || (user && user.email === 'matthewcarltyson@gmail.com')) return "ARCHITECT";
    if (user && user.isAnonymous) return "GUEST";
    return "RESONANT";
}

export function getActiveMap() {
    const { currentRoom, stratum } = state.localPlayer;
    if (currentRoom?.startsWith('astral_') || stratum === 'astral') {
        return state.astralMap;
    }
    // Check archive first
    if (isArchiveRoom(currentRoom)) {
        return state.apartmentMap;
    }
    // Fallback chain for mundane rooms: 
    // 1. Mundane Map (Synced Public World)
    // 2. Apartment Map (Static Base Rooms / Private Instance)
    if (state.mundaneMap && state.mundaneMap[currentRoom]) {
        return state.mundaneMap;
    }
    if (state.apartmentMap[currentRoom]) {
        return state.apartmentMap;
    }
    return state.mundaneMap;
}

// --- SETTERS & VALIDATION ---

/**
 * Validates the player's current location and falls back to bedroom if invalid.
 * This is the central "Trust Boundary" for player movement.
 */
function validateLocation() {
    const activeMap = getActiveMap();
    const currentRoom = state.localPlayer.currentRoom;

    // Leniency during transitions: if map is loading or we are transitioning via "outside"
    if (Object.keys(activeMap).length === 0 || currentRoom === "outside") {
        return false;
    }

    // 1. Check if the current room exists in the active map
    if (!activeMap[currentRoom]) {
        console.warn(`[GLITCH]: Room '${currentRoom}' not found in active map. Intercepting and redirecting to bedroom.`);
        state.localPlayer.currentRoom = "bedroom";
        return true;
    }
    
    return false;
}

export function updatePlayer(updates) {
    state.localPlayer = { ...state.localPlayer, ...updates };
    const changed = validateLocation();
    notify();
    return changed;
}

export function setApartmentMap(nodes) {
    state.apartmentMap = { ...initialMap, ...nodes };
    validateLocation();
    notify();
}

export function setMundaneMap(nodes) {
    state.mundaneMap = nodes || {};
    notify();
}

export function setAstralMap(nodes) {
    state.astralMap = nodes || {};
    validateLocation();
    notify();
}

export function updateMapNode(mapType, nodeId, updates) {
    const map = mapType === 'astral' ? state.astralMap : state.apartmentMap;
    if (map[nodeId]) {
        map[nodeId] = { ...map[nodeId], ...updates };
        notify();
    }
}

export function setActiveAvatar(avatar) {
    state.activeAvatar = avatar;
    state.localPlayer.activeAvatarId = avatar ? avatar.id : null;
    notify();
}

export function setLocalCharacters(chars) {
    state.localCharacters = chars;
    notify();
}

export function setUser(user) {
    state.user = user;
    notify();
}

export function setTerminal(active) {
    state.activeTerminal = active;
    notify();
}

export function setProcessing(processing) {
    state.isProcessing = processing;
    notify();
}

export function setSuggestions(suggestions) {
    state.suggestions = suggestions;
    notify();
}

export function updateWizardState(updates) {
    state.wizardState = { ...state.wizardState, ...updates };
    notify();
}

export function resetWizard() {
    state.wizardState = { active: false, type: null, step: 0, pendingData: {} };
    notify();
}

export function startWizard(type, initialData = {}) {
    state.wizardState = { active: true, type, step: 1, pendingData: initialData };
    notify();
}

export function setState(path, value) {
    const parts = path.split('.');
    let current = state;
    for (let i = 0; i < parts.length - 1; i++) {
        current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;
    notify();
}
