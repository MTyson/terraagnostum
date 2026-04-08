// js/stateManager.js

// --- INITIAL STATE ---
let state = {
    localPlayer: { 
        hp: 20, credits: 0, currentRoom: "void", stratum: "mundane",
        inventory: [], quests: [], closetDoorClosed: false, isArchitect: false,
        explorerMode: false,
        combat: { active: false, opponent: null, timerStartedAt: null }, activeAvatarId: null,
        stats: {
            AMN: 20,
            PHYS: { total: 6, Strength: 3, Agility: 3 },
            WILL: { total: 7, Conviction: 4, Anchor: 3 },
            AWR: { total: 7, Perception: 4, Insight: 3 },
            bias: { PHYS: 'A', WILL: 'A', AWR: 'A' }
        },
        accountAmn: 0
    },
    localAreaCache: {}, // THE ONLY CACHE
    strata: {}, // Dynamic strata from Firestore
    localCharacters: [], activeAvatar: null, user: null,
    otherPlayers: {}, // Global presence map: { uid: { roomId, avatarName, ... } }
    activeTerminal: false, isProcessing: false, suggestions: [], showShareChip: false,
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
    return state.localAreaCache; // Always return the flat cache
}

export function updatePlayer(updates) {
    state.localPlayer = { ...state.localPlayer, ...updates };
    notify();
}

export function setLocalAreaCache(nodes) {
    // Merge instead of replace to protect local-only rooms (like the Astral Nexus during initialization)
    state.localAreaCache = { ...state.localAreaCache, ...(nodes || {}) };
    notify();
}

export function setStrata(strata) {
    state.strata = strata || {};
    notify();
}

export function updateMapNode(arg1, arg2, arg3) {
    // Detect if caller used legacy (mapType, nodeId, updates) or new (nodeId, updates)
    const nodeId = arg3 ? arg2 : arg1;
    const updates = arg3 ? arg3 : arg2;

    if (!nodeId) return;

    // By removing the strict `if` check, we allow brand new rooms to be injected instantly
    // before the Firebase onSnapshot listener even fires.
    state.localAreaCache[nodeId] = { ...(state.localAreaCache[nodeId] || {}), ...updates };
    notify();
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

export function setOtherPlayers(players) {
    state.otherPlayers = players || {};
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

export function setShowShareChip(val) {
    state.showShareChip = val;
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

/**
 * Automatically distributes root stat points into sub-stats based on 50/50 split and bias.
 * @param {'PHYS' | 'WILL' | 'AWR'} pool 
 * @param {number} newValue 
 */
export function updateSubStats(pool, newValue) {
    const bias = state.localPlayer.stats.bias[pool];
    const base = Math.floor(newValue / 2);
    const extra = newValue % 2;
    
    state.localPlayer.stats[pool].total = newValue;

    if (pool === 'PHYS') {
        state.localPlayer.stats.PHYS.Strength = base + (bias === 'A' ? extra : 0);
        state.localPlayer.stats.PHYS.Agility = base + (bias === 'B' ? extra : 0);
    } else if (pool === 'WILL') {
        state.localPlayer.stats.WILL.Conviction = base + (bias === 'A' ? extra : 0);
        state.localPlayer.stats.WILL.Anchor = base + (bias === 'B' ? extra : 0);
    } else if (pool === 'AWR') {
        state.localPlayer.stats.AWR.Perception = base + (bias === 'A' ? extra : 0);
        state.localPlayer.stats.AWR.Insight = base + (bias === 'B' ? extra : 0);
    }
    notify();
}

/**
 * Returns the "Render Weight" category based on AMN.
 * @param {number} amn 
 * @returns {'STABLE' | 'HEAVY' | 'UNSTABLE'}
 */
export function getRenderWeight(amn) {
    if (amn > 25) return "UNSTABLE";
    if (amn > 20) return "HEAVY";
    return "STABLE";
}
