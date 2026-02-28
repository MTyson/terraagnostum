import { signInAnonymously, onAuthStateChanged, isSignInWithEmailLink, signInWithEmailLink, sendSignInLinkToEmail, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, setDoc, getDoc, onSnapshot, updateDoc, arrayUnion, arrayRemove, serverTimestamp, collection, addDoc, getDocs } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// IMPORT DECOMPOSED DATA & SERVICES
import { apartmentMap as initialMap } from './mapData.js';
import { callGemini } from './apiService.js';
import { triggerVisualUpdate, togglePinView, projectVisual } from './visualSystem.js';
import { handleGMIntent } from './gmEngine.js';
import { wizardState, handleWizardInput, startWizard } from './wizardSystem.js';
import * as UI from './ui.js';
import { app, auth, db, storage, isSyncEnabled, appId } from './firebaseConfig.js';

// PUSH TEST

// Initialize with seed data
let apartmentMap = { ...initialMap };
let activeTerminal = false;

// Player State
let localPlayer = { 
    hp: 20, 
    currentRoom: "bedroom", 
    stratum: "mundane",
    posture: "standing",
    inventory: [],
    closetDoorClosed: false,
    isArchitect: false
};

let localCharacters = []; 
let activeAvatar = null;  
let user = null;
let hasInitialized = false;
let mapUnsubscribe = null;
let currentMapPath = null;

const ARCHIVE_NODES = ['lore1', 'lore2', 'kitchen', 'spare_room', 'bedroom', 'closet', 'character_room', 'hallway_archive'];
const isArchiveRoom = (roomId) => ARCHIVE_NODES.includes(roomId);

function getUserTier() {
    if (!activeAvatar) return "VOID";
    if (localPlayer.isArchitect || (user && user.email === 'matthewcarltyson@gmail.com')) return "ARCHITECT";
    if (user && user.isAnonymous) return "GUEST";
    return "RESONANT";
}

// --- HELPER WRAPPERS ---
function shiftStratum(targetStratum) {
    const isTransitioningToFaen = targetStratum === 'faen' && localPlayer.stratum !== 'faen';
    UI.applyStratumTheme(targetStratum, isTransitioningToFaen);
    localPlayer.stratum = targetStratum;
    UI.renderMapHUD(apartmentMap, localPlayer.currentRoom, localPlayer.stratum);
}

function refreshCommandPrompt() {
    const roomShort = apartmentMap[localPlayer.currentRoom]?.shortName || localPlayer.currentRoom.toUpperCase();
    const wizardPlaceholder = wizardState.active ? (wizardState.type === 'login' ? '[ AWAITING EMAIL... ]' : '[ AWAITING INPUT... ]') : null;
    UI.updateCommandPrompt(getUserTier(), roomShort, typeof activeTerminal !== 'undefined' ? activeTerminal : false, wizardPlaceholder, activeAvatar);
}

function refreshStatusUI() {
    const roomShort = apartmentMap[localPlayer.currentRoom]?.shortName || localPlayer.currentRoom.toUpperCase();
    UI.updateStatusUI(localPlayer.posture, roomShort);
}

function refreshAllUI() {
    if (!activeAvatar) {
        document.body.classList.add('void-mode');
    } else {
        document.body.classList.remove('void-mode');
    }
    refreshCommandPrompt();
    refreshStatusUI();
    UI.updateAvatarUI(activeAvatar);
    UI.updateInventoryUI(localPlayer.inventory);
    UI.updateRoomItemsUI(apartmentMap[localPlayer.currentRoom]?.items);
    UI.updateRoomEntitiesUI(apartmentMap[localPlayer.currentRoom]?.npcs);
    UI.renderMapHUD(apartmentMap, localPlayer.currentRoom, localPlayer.stratum);
}

// --- AUTHENTICATION & SYNC ---
if (isSyncEnabled) {
    if (isSignInWithEmailLink(auth, window.location.href)) {
        let email = window.localStorage.getItem('emailForSignIn');
        if (!email) email = window.prompt('Please provide your email for confirmation');
        
        signInWithEmailLink(auth, email, window.location.href)
            .then(() => {
                window.localStorage.removeItem('emailForSignIn');
                UI.addLog(`[SYSTEM]: Identity confirmed. Welcome to the Technate, Architect.`, "var(--crayola-blue)");
            })
            .catch((error) => UI.addLog(`[SYSTEM ERROR]: ${error.message}`, "var(--term-red)"));
    }

    onAuthStateChanged(auth, async (u) => {
        // Wait for Firebase to check state. If genuinely no user, THEN assign guest.
        if (!u) {
            if (!isSignInWithEmailLink(auth, window.location.href)) {
                signInAnonymously(auth);
            }
            return;
        }

        user = u;
        if (user && !hasInitialized) {
            hasInitialized = true;
            const userType = user.isAnonymous ? "GUEST" : "ARCHITECT";
            refreshCommandPrompt(); 
            UI.addLog(`${userType} LINKED: ${user.uid.substring(0,8)}`, "var(--crayola-blue)");
            
            setupWorldListener();
            updateMapListener();
            await loadPlayerState(); 
            await loadUserCharacters();
            
            shiftStratum(localPlayer.stratum);
            
            const currentRoom = apartmentMap[localPlayer.currentRoom] || apartmentMap["lore1"];
            UI.printRoomDescription(currentRoom, localPlayer.stratum === 'faen', apartmentMap, activeAvatar);
            refreshAllUI();
            
            triggerVisualUpdate(null, localPlayer, apartmentMap, user);
        }
    });
}

function setupWorldListener() {
    if (!db) return;
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', 'archive_apartment');
    onSnapshot(roomRef, (snap) => {
        if (!snap.exists()) setDoc(roomRef, { created: serverTimestamp(), manifestations: [] });
    });
}

function mergeAndRefreshMap(fetchedNodes = {}) {
    apartmentMap = { ...initialMap, ...fetchedNodes };
    
    if (!apartmentMap[localPlayer.currentRoom]) {
        console.warn("[SYSTEM]: Reality sync interrupted. Re-anchoring to Bedroom.");
        localPlayer.currentRoom = "bedroom";
    }
    
    refreshAllUI();
}

function updateMapListener() {
    if (!db) return;

    const isPrivate = isArchiveRoom(localPlayer.currentRoom);
    
    // Determine path based on room
    const newPath = isPrivate && user
        ? `artifacts/${appId}/users/${user.uid}/instance/apartment_nodes`
        : `artifacts/${appId}/public/data/maps/apartment_graph_live`;

    if (currentMapPath === newPath) return; // No change needed
    if (mapUnsubscribe) mapUnsubscribe(); // Unsubscribe previous

    currentMapPath = newPath;
    const mapRef = doc(db, newPath.split('/').slice(0, -1).join('/'), newPath.split('/').pop());
    
    mapUnsubscribe = onSnapshot(mapRef, (snap) => {
        if (!snap.exists()) {
            setDoc(mapRef, { nodes: apartmentMap, lastUpdated: serverTimestamp() });
        } else {
            const data = snap.data();
            if (data.nodes) {
                mergeAndRefreshMap(data.nodes);
            }
        }
    });
}

async function loadPlayerState() {
    if (!db || !user) return;
    try {
        const stateRef = doc(db, 'artifacts', appId, 'users', user.uid, 'state', 'player');
        const snap = await getDoc(stateRef);
        if (snap.exists()) {
            const data = snap.data();
            localPlayer = { 
                ...localPlayer, 
                ...data,
                inventory: data.inventory || [],
                stratum: data.stratum || "mundane"
            };
            if (localPlayer.currentRoom === 'main_room') localPlayer.currentRoom = 'lore1';
            refreshCommandPrompt(); 
        }
    } catch (e) {
        console.error("Failed to load player state:", e);
    }
}

async function savePlayerState() {
    if (!db || !user) return;
    try {
        const stateRef = doc(db, 'artifacts', appId, 'users', user.uid, 'state', 'player');
        await setDoc(stateRef, localPlayer);
    } catch (e) {
        console.error("Failed to save player state:", e);
    }
}

async function loadUserCharacters() {
    if (!db || !user) return;
    try {
        const charCol = collection(db, 'artifacts', appId, 'users', user.uid, 'characters');
        const snap = await getDocs(charCol);
        localCharacters = [];
        activeAvatar = null;
        snap.forEach(doc => {
            const charData = { id: doc.id, ...doc.data() };
            localCharacters.push(charData);
            if (!charData.deceased && !charData.deployed) activeAvatar = charData; 
        });
        if (localCharacters.length > 0) {
            UI.addLog(`[SYSTEM]: Retrieved ${localCharacters.length} saved avatar(s) from your private archive.`, "var(--term-green)");
        }
        if (!activeAvatar && localCharacters.length > 0) {
            activeAvatar = localCharacters[0];
        }
        UI.updateAvatarUI(activeAvatar);
        refreshCommandPrompt();
    } catch (error) {
        console.error("Failed to load characters:", error);
    }
}

const pinBtnEl = document.getElementById('pin-view-btn');
if (pinBtnEl) {
    pinBtnEl.addEventListener('click', () => togglePinView(localPlayer, apartmentMap, user));
}

// --- NARRATIVE MOVEMENT ENGINE ---
async function executeMovement(targetDir) {
    const currentRoom = apartmentMap[localPlayer.currentRoom];
    if (!currentRoom) { console.warn('Movement: Current room not found'); return; }
    if (localPlayer.stratum === 'faen') {
        const nextId = 'faen_' + Date.now();
        apartmentMap[nextId] = {
            name: "Procedural Faen Pocket", shortName: "FAEN",
            description: "A surreal, ever-shifting landscape of translucent light and geometric fractals. Directions have no meaning here.",
            visualPrompt: "Abstract ethereal plane, glowing cyan and pink geometric structures, floating light particles.",
            exits: {}, pinnedView: null, items: [], marginalia: [], npcs: []
        };
        localPlayer.currentRoom = nextId;
        savePlayerState(); 
        refreshAllUI();
        
        UI.addLog(`[SYSTEM]: You traverse the ethereal currents to a new pocket of Faen.`, "var(--term-green)");
        UI.printRoomDescription(apartmentMap[nextId], true, apartmentMap, activeAvatar);
        triggerVisualUpdate(null, localPlayer, apartmentMap, user);
        return;
    }
    
    if (currentRoom.exits && currentRoom.exits[targetDir]) {
        const exitData = currentRoom.exits[targetDir];

        if (localPlayer.currentRoom === 'closet' && localPlayer.closetDoorClosed) {
            if (targetDir === 'out') {
                localPlayer.closetDoorClosed = false;
                UI.addLog("[NARRATOR]: You push the heavy reinforced door open and step out.", "#888");
            } else {
                UI.addLog("[SYSTEM]: The door is closed. You cannot move.", "var(--term-amber)");
                return;
            }
        }
        
        // CHECK FOR LOCKS
        if (typeof exitData === 'object' && exitData.locked) {
            UI.addLog(`[BLOCKED]: ${exitData.lockMsg || 'The path is barred.'}`, "var(--term-amber)");
            return; // Abort movement
        }

        const nextRoomKey = typeof exitData === 'string' ? exitData : exitData.target;
        
        const tier = getUserTier();
        if ((tier === "VOID" || tier === "GUEST") && !isArchiveRoom(nextRoomKey)) {
            UI.addLog(`[TANDY]: You cannot leave the Archive yet. Your vessel will evaporate. Go to the Tandem Terminal in the Lore Room and type 'login'.`, "#b084e8");
            return;
        }

        const nextRoom = apartmentMap[nextRoomKey];
        if (!nextRoom) { UI.addLog('[ERROR]: Reality sector missing.'); return; }

        localPlayer.currentRoom = nextRoomKey;
        
        savePlayerState(); 
        refreshAllUI();
        
        UI.addLog(`[SYSTEM]: You move ${targetDir.toUpperCase()}.`, "var(--term-green)");
        UI.printRoomDescription(nextRoom, false, apartmentMap, activeAvatar);
        updateMapListener(); // Check if we need to switch map instances
        
        triggerVisualUpdate(null, localPlayer, apartmentMap, user);
        
        if (isSyncEnabled && user) {
            const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', 'archive_apartment');
            updateDoc(roomRef, { manifestations: arrayUnion({ author: user.uid, text: `[${localPlayer.currentRoom}] User arrived from the ${targetDir}.`, timestamp: Date.now() }) });
        }
    } else {
        refreshStatusUI();
        UI.addLog(`[SYSTEM]: You cannot go that way.`, "var(--term-amber)");
        triggerVisualUpdate(null, localPlayer, apartmentMap, user);
    }
}

// --- COMMAND PARSER ---
let isProcessing = false;
const input = document.getElementById('cmd-input');

if (input) {
    input.addEventListener('keydown', async (e) => {
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && input.value === '') {
            e.preventDefault();
            if (wizardState.active || isProcessing) return;
            let dir = '';
            if (e.key === 'ArrowUp') dir = 'north';
            if (e.key === 'ArrowDown') dir = 'south';
            if (e.key === 'ArrowLeft') dir = 'west';
            if (e.key === 'ArrowRight') dir = 'east';
            UI.addLog(dir, "#ffffff");
            executeMovement(dir);
            return;
        }

        if (e.key === 'Enter') {
            e.preventDefault();
            const val = input.value.trim();
            input.value = '';
            
            if (!val && !wizardState.active) return;
            if (isProcessing) return;
            if (val) UI.addLog(val, "#ffffff");
            if (wizardState.active) { 
                async function handleWizardInput(val) {
                    let currentVal = val.trim();
                
                    // HANDLE LOGIN WIZARD
                    if (wizardState.type === 'login') {
                        const email = currentVal;
                        if (!email.includes('@')) {
                            UI.addLog("[SYSTEM]: Invalid signature format. Login aborted.", "var(--term-red)");
                            wizardState = { active: false, type: null, step: 0, pendingData: {} };
                            refreshAllUI();
                            return;
                        }
                        
                        UI.addLog(`[SYSTEM]: Transmitting anchoring frequency to ${email}...`, "var(--term-amber)");
                        const actionCodeSettings = { url: window.location.href, handleCodeInApp: true };
                        
                        try {
                            const { sendSignInLinkToEmail } = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js");
                            await sendSignInLinkToEmail(auth, email, actionCodeSettings);
                            window.localStorage.setItem('emailForSignIn', email);
                            UI.addLog("[TANDY]: Pulse sent. Check your inbox to fuse your signature.", "#b084e8");
                        } catch (error) {
                            UI.addLog(`[SYSTEM ERROR]: ${error.message}`, "var(--term-red)");
                        }
                            
                        wizardState = { active: false, type: null, step: 0, pendingData: {} };
                        refreshAllUI();
                        return;
                    }
                
                    // HANDLE AVATAR CREATION WIZARD
                    if (wizardState.type === 'avatar') {
                        if (wizardState.step === 1) {
                            // STEP 1: NAME
                            if (!currentVal) {
                                UI.addLog("[SYSTEM]: Querying Archive for a forgotten designation...", "var(--term-amber)");
                                try {
                                    const aiResponse = await callGemini("Generate a single, cool cyberpunk character name. Only return the name.");
                                    currentVal = aiResponse.trim();
                                } catch (e) { currentVal = "Unknown Entity"; }
                                UI.addLog(`[ARCHIVE]: Suggesting name: ${currentVal}`, "#b084e8");
                            }
                            wizardState.pendingData.name = currentVal;
                            UI.addLog(`[WIZARD]: Identity confirmed: '${currentVal}'. Enter Archetype or press ENTER for suggestion:`, "var(--term-amber)");
                            wizardState.step++;
                        } 
                        else if (wizardState.step === 2) {
                            // STEP 2: ARCHETYPE
                            if (!currentVal) {
                                UI.addLog("[SYSTEM]: Querying Archive for functional archetype...", "var(--term-amber)");
                                try {
                                    const aiResponse = await callGemini(`Suggest a unique cyberpunk archetype for ${wizardState.pendingData.name}. (e.g. Neon-Ghost). Return 1-2 words only.`);
                                    currentVal = aiResponse.replace(/["']/g, '').trim();
                                } catch (e) { currentVal = "Wanderer"; }
                                UI.addLog(`[ARCHIVE]: Suggesting archetype: ${currentVal}`, "#b084e8");
                            }
                            wizardState.pendingData.archetype = currentVal;
                            UI.addLog(`[WIZARD]: Archetype logged. Press ENTER for an AI visual imprint or describe your look:`, "var(--term-amber)");
                            wizardState.step++;
                        } 
                        else if (wizardState.step === 3) {
                            // STEP 3: VISUALS & FINALIZATION
                            if (!currentVal) {
                                UI.addLog("[SYSTEM]: Extrapolating visual imprint from Archive data...", "var(--term-amber)");
                                try {
                                    currentVal = await callGemini(`Write a 1-sentence cinematic visual description of ${wizardState.pendingData.name}, a ${wizardState.pendingData.archetype} in a cyberpunk world.`);
                                } catch (e) { currentVal = "A shadowed cyberpunk figure."; }
                                UI.addLog(`[ARCHIVE]: Visual imprint generated.`, "#b084e8");
                            }
                            
                            wizardState.pendingData.visual_prompt = currentVal;
                            UI.addLog(`[SYSTEM]: Collapsing quantum state... Rendering vessel...`, "var(--gm-purple)");
                            
                            let generatedImage = null;
                            try {
                                // Ensure projectVisual is correctly imported from apiService.js
                                generatedImage = await projectVisual(wizardState.pendingData.visual_prompt);
                            } catch (e) { console.error("Img Gen Error:", e); }
                            
                            const finalData = {
                                name: wizardState.pendingData.name,
                                archetype: wizardState.pendingData.archetype,
                                visual_prompt: wizardState.pendingData.visual_prompt,
                                image: generatedImage,
                                stats: { WILL: 20, CONS: 20, PHYS: 20 },
                                deceased: false, deployed: false, timestamp: Date.now()
                            };
                
                            const { addDoc, collection } = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js");
                            const docRef = await addDoc(collection(db, 'artifacts', appId, 'users', auth.currentUser.uid, 'characters'), finalData);
                            
                            // Set as active
                            activeAvatar = { id: docRef.id, ...finalData };
                            localCharacters.push(activeAvatar);
                            
                            if (typeof UI.materializeEffect === 'function') UI.materializeEffect(); 
                            UI.addLog(`[SYSTEM]: VESSEL COLLAPSE COMPLETE. YOU ARE REAL.`, "var(--term-green)");
                            wizardState = { active: false, type: null, step: 0, pendingData: {} };
                            refreshAllUI();
                        }
                        return;
                    }
                }
                handleWizardInput(val);
                return; 
            }
        
        const cmd = val.toLowerCase();

        if (cmd === 'logout') {
            UI.addLog("[SYSTEM]: Severing connection to the Technate...", "var(--term-amber)");
            import("https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js").then(({ signOut }) => {
                signOut(auth).then(() => window.location.reload());
            });
            return;
        }
    
        if (cmd === 'architect') {
            localPlayer.isArchitect = !localPlayer.isArchitect;
            UI.addLog(`[SYSTEM]: Architect flag: ${localPlayer.isArchitect ? 'ENABLED' : 'DISABLED'}`, "var(--term-amber)");
            refreshAllUI();
            return;
        }

        if (cmd.startsWith('"') || cmd.startsWith("'") || cmd.startsWith("say ")) {
            const speech = val.replace(/^say\s+/i, '').replace(/^["']|["']$/g, '');
            UI.addLog(`[YOU SAY]: "${speech}"`, "#ffffff");
            // Later we will route this to NPC AI. For now, just echo.
            return;
        }

        if (cmd.match(/^(use|access|hack)\s+(terminal|tandem|console)/)) {
            if (localPlayer.currentRoom === 'lore1') {
                activeTerminal = true;
                UI.addLog("[SYSTEM]: TANDEM INTERFACE ACTIVE. TYPE 'login' TO BIND SIGNATURE OR 'exit' TO DISCONNECT.", "var(--term-green)");
                refreshAllUI();
                return;
            }
        }

        if (activeTerminal) {
            if (cmd === 'exit' || cmd === 'leave' || cmd === 'disconnect') {
                activeTerminal = false;
                UI.addLog("[SYSTEM]: TANDEM INTERFACE DISCONNECTED.", "var(--term-amber)");
                refreshAllUI();
                return;
            }
            if (cmd === 'login') {
                if (getUserTier() === "ENTITY" || getUserTier() === "ARCHITECT") {
                    UI.addLog("[SYSTEM]: You are already bound to the Technate.", "var(--term-amber)");
                    return;
                }
                wizardState.active = true;
                wizardState.type = 'login';
                wizardState.step = 1;
                wizardState.pendingData = {};
                if (localPlayer.currentRoom === 'lore1') {
                    activeTerminal = true;
                    UI.addLog("[TANDY]: To anchor this vessel permanently, the Technate requires a frequency signature. An email address will do.", "#b084e8");
                } else {
                    UI.addLog("[SYSTEM]: INITIATING REMOTE LOGIN. Enter your email address:", "var(--term-green)");
                }
                refreshAllUI();
                return;
            }

            // Catch all other commands while in terminal
            UI.addLog("[TANDEM]: Unknown command. Type 'login' or 'exit'.", "var(--term-amber)");
            return;
        }

        if (cmd === 'login') {
            if (getUserTier() === "ENTITY" || getUserTier() === "ARCHITECT") {
                UI.addLog("[SYSTEM]: You are already bound to the Technate.", "var(--term-amber)");
                return;
            }
            wizardState = { active: true, type: 'login', step: 1, pendingData: {} };
            if (localPlayer.currentRoom === 'lore1') {
                activeTerminal = true;
                UI.addLog("[TANDY]: To anchor this vessel permanently, the Technate requires a frequency signature. An email address will do.", "#b084e8");
            } else {
                UI.addLog("[SYSTEM]: INITIATING REMOTE LOGIN. Enter your email address:", "var(--term-green)");
            }
            refreshAllUI();
            return;
        }

        if (cmd === 'list avatars' || cmd === 'avatars') {
            if (localCharacters.length === 0) {
                UI.addLog("[SYSTEM]: No persistent vessels found.", "var(--term-amber)");
                return;
            }
            UI.addLog("[SYSTEM]: --- AVAILABLE VESSELS ---", "var(--term-green)");
            localCharacters.forEach((char, index) => {
                const isAct = activeAvatar && activeAvatar.id === char.id ? "(ACTIVE)" : "";
                UI.addLog(`[${index + 1}] ${char.name} - ${char.archetype} ${isAct}`, "var(--term-green)");
            });
            UI.addLog("[SYSTEM]: Type 'swap avatar [number]' to change vessels.", "#888");
            return;
        }
        if (cmd.startsWith('swap avatar ')) {
            const num = parseInt(cmd.replace('swap avatar ', '').trim());
            if (isNaN(num) || num < 1 || num > localCharacters.length) {
                UI.addLog("[SYSTEM]: Invalid vessel designation.", "var(--term-red)");
                return;
            }
            activeAvatar = localCharacters[num - 1];
            UI.addLog(`[SYSTEM]: Consciousness transferred to ${activeAvatar.name}.`, "var(--term-green)");
            refreshAllUI();
            return;
        }

        if (localPlayer.currentRoom === 'closet') {
            if (cmd === 'investigate') {
                UI.addLog("[NARRATOR]: A heavy, metallic crate hums in the center of the room. It is hardwired into the floor and radiates a low-frequency pulse.", "#888");
                if (!localPlayer.closetDoorClosed) {
                    UI.addLog("[TANDY]: The energy is bleeding out into the hallway. You'll need to 'close the door' to isolate the quantum field.", "#b084e8");
                } else {
                    UI.addLog("[TANDY]: The field is isolated. You can 'turn on the machine' now.", "#b084e8");
                }
                return;
            }
            if (cmd === 'close door' || cmd === 'shut door') {
                localPlayer.closetDoorClosed = true;
                UI.addLog("[NARRATOR]: You pull the heavy door shut. The hum of the metal crate amplifies, vibrating in your teeth.", "#888");
                return;
            }
            if (cmd === 'open door') {
                localPlayer.closetDoorClosed = false;
                UI.addLog("[NARRATOR]: You open the door, letting the stale air of the hallway back in.", "#888");
                return;
            }
            if (cmd.match(/^(use|tune|activate|turn on)\s+(resonator|generator|machine|box)/)) {
                if (!localPlayer.closetDoorClosed) {
                    UI.addLog("[SYSTEM]: The machine whirs to life, but its energy bleeds out the open door. The Schrödinger state cannot be achieved.", "var(--term-amber)");
                    return;
                }
                UI.addLog("[SYSTEM]: RESONANCE ACHIEVED. QUANTUM STATE COLLAPSING...", "var(--term-green)");

                localPlayer.stratum = 'weave';
                if (typeof UI.applyStratumTheme === 'function') UI.applyStratumTheme('weave');

                const currentRoom = apartmentMap[localPlayer.currentRoom];
                UI.addLog("[NARRATOR]: The walls of the closet dissolve into raw, static data. You are pulled into the Ethereal Plane.", "#888");
                UI.printRoomDescription(currentRoom, true, apartmentMap, activeAvatar);
                refreshAllUI();
                return;
            }
        }

        // --- AUTH & IDENTITY COMMANDS ---
        if (cmd === 'whoami') {
            const tier = getUserTier();
            const cohesion = !activeAvatar ? 'Fading Ripple' : 'Materialized Signature';
            const uid = user ? user.uid.substring(0,8) : 'UNKNOWN';
            UI.addLog(`[SYSTEM]: Identity: ${tier} | UID: ${uid}`, "var(--term-green)");
            UI.addLog(`[SYSTEM]: Cohesion State: ${cohesion}`, "var(--term-green)");
            return;
        }

        const authMatch = cmd.match(/^(?:register|log in|login)\s+(.+@.+\..+)$/i);
        if (authMatch) {
            const email = authMatch[1].trim();
            UI.addLog(`[SYSTEM]: Initiating secure handshake for ${email}...`, "var(--term-amber)");
            const actionCodeSettings = {
                url: window.location.href.split('?')[0], // Clean URL to return to
                handleCodeInApp: true,
            };
            try {
                await sendSignInLinkToEmail(auth, email, actionCodeSettings);
                window.localStorage.setItem('emailForSignIn', email);
                UI.addLog(`[SYSTEM]: Authentication link dispatched. Check the inbox for ${email} to complete the uplink.`, "var(--term-green)");
            } catch (err) {
                UI.addLog(`[SYSTEM ERROR]: Registration failed. ${err.message}`, "var(--term-red)");
            }
            return;
        } else if (cmd === 'register' || cmd === 'log in' || cmd === 'login') {
            UI.addLog(`[SYSTEM]: Invalid format. Use 'register [your@email.com]' or 'log in [your@email.com]'.`, "var(--term-red)");
            return;
        }

        // CORE SYSTEM COMMANDS
        if (cmd === 'create avatar' || cmd === 'forge form' || cmd === 'make avatar') {
                if (localPlayer.currentRoom !== 'character_room' && localPlayer.currentRoom !== 'spare_room') {
                    UI.addLog(`[SYSTEM]: You must be in the Archive (Character Room) to forge a form.`, "var(--term-amber)");
                    return;
                }
                startWizard('avatar');
                UI.setWizardPrompt("WIZARD@FORGE:~$");
                UI.addLog(`[WIZARD]: Vessel Forging Protocol Initiated. Enter your identity (Name):`, "var(--term-amber)");
                return;
            }

            if (!activeAvatar && !cmd.startsWith('help') && !cmd.startsWith('create avatar') && !cmd.startsWith('assume')) {
                if (localPlayer.currentRoom !== 'character_room' && localPlayer.currentRoom !== 'spare_room') {
                    UI.addLog(`[SYSTEM]: You are an itinerant void. Go to the Archive to forge your form.`, "var(--term-amber)");
                }
            }

            if (!activeAvatar && ['take', 'get', 'pick up', 'use'].some(verb => cmd.startsWith(verb))) {
                UI.addLog("[SYSTEM]: Your phantom fingers pass through reality. You lack the Meaning to influence the Mundane.", "var(--term-amber)");
                return;
            }

            const dirMatch = cmd.match(/^(?:go\s+(?:to\s+(?:the\s+)?)?|move\s+|walk\s+|head\s+)?(north|south|east|west|n|s|e|w)$/);
            if (dirMatch) {
                const parsedDir = dirMatch[1];
                const expandMap = { 'n': 'north', 's': 'south', 'e': 'east', 'w': 'west' };
                executeMovement(expandMap[parsedDir] || parsedDir); return;
            }

            if (cmd === 'leave vessel' || cmd === 'deploy npc' || cmd === 'leave avatar') {
                if (!activeAvatar) { UI.addLog("[SYSTEM]: You have no vessel to leave.", "var(--term-red)"); return; }
                startWizard('deploy_npc');
                UI.setWizardPrompt("WIZARD@DEPLOY:~$");
                UI.addLog(`[WIZARD]: Vessel Deployment Protocol. WARNING: You will forfeit control of this avatar.`, "var(--term-red)");
                UI.addLog(`[WIZARD]: Describe its autonomous personality:`, "var(--term-amber)");
                return;
            }

            if (cmd === 'create npc' || cmd === 'spawn npc') {
                if (!activeAvatar) { UI.addLog("[SYSTEM]: Voids cannot spawn life.", "var(--term-red)"); return; }
                startWizard('create_npc');
                UI.setWizardPrompt("WIZARD@NPC:~$");
                UI.addLog(`[WIZARD]: NPC Spawning Protocol. Enter NPC Name:`, "var(--term-amber)");
                return;
            }

            if (cmd.startsWith('lock ')) {
                if (!activeAvatar) { UI.addLog("[SYSTEM]: Voids cannot manipulate locks.", "var(--term-red)"); return; }
                const parts = cmd.split(' ');
                const dirRaw = parts[1];
                const expandMap = { 'n': 'north', 's': 'south', 'e': 'east', 'w': 'west' };
                const finalDir = expandMap[dirRaw] || dirRaw;
                
                if (!finalDir || !apartmentMap[localPlayer.currentRoom].exits || !apartmentMap[localPlayer.currentRoom].exits[finalDir]) {
                    UI.addLog(`[SYSTEM]: Valid exit not found in that direction.`, "var(--term-amber)");
                    return;
                }
                
                startWizard('lock_exit', { direction: finalDir });
                UI.setWizardPrompt("WIZARD@LOCK:~$");
                UI.addLog(`[WIZARD]: Lock Protocol Initiated for ${finalDir.toUpperCase()}.`, "var(--term-amber)");
                UI.addLog(`Enter the blocking message (e.g., 'Max steps in front of you. "Hold it!"'):`, "var(--term-amber)");
                return;
            }

            const assumeMatch = cmd.match(/^(?:assume|possess)\s+(.+)$/i);
            if (assumeMatch) {
                if (activeAvatar) {
                    UI.addLog(`[SYSTEM]: You must LEAVE VESSEL before assuming a new form.`, "var(--term-amber)");
                    return;
                }

                const targetName = assumeMatch[1].toLowerCase();
                const room = apartmentMap[localPlayer.currentRoom];
                const npcs = room.npcs || [];

                const npcIndex = npcs.findIndex(n => n.name.toLowerCase().includes(targetName));

                if (npcIndex > -1) {
                    const npc = npcs[npcIndex];

                    // 1. Remove from room
                    npcs.splice(npcIndex, 1);
                    if (isSyncEnabled) {
                        const mapRef = doc(db, 'artifacts', appId, 'public', 'data', 'maps', 'apartment_graph_live');
                        updateDoc(mapRef, { [`nodes.${localPlayer.currentRoom}.npcs`]: arrayRemove(npc) });
                    }

                    // 2. Set as active avatar
                    const newCharData = {
                        name: npc.name,
                        archetype: npc.archetype || "Unknown",
                        visual_prompt: npc.visual_prompt || npc.visualPrompt || "A borrowed form.",
                        image: npc.image || null,
                        stats: npc.stats || { WILL: 20, CONS: 20, PHYS: 20 },
                        deceased: false,
                        deployed: false,
                        timestamp: Date.now()
                    };

                    UI.addLog(`[SYSTEM]: You have assumed control of [${npc.name}].`, "var(--term-green)");

                    if (user && !user.isAnonymous) {
                        try {
                            const charCol = collection(db, 'artifacts', appId, 'users', user.uid, 'characters');
                            addDoc(charCol, newCharData).then(docRef => {
                                newCharData.id = docRef.id;
                                activeAvatar = newCharData;
                                localCharacters.push(newCharData);
                                UI.updateAvatarUI(activeAvatar);
                                refreshCommandPrompt();
                            });
                        } catch (e) {
                            console.error("Failed to save assumed avatar to DB", e);
                        }
                    } else {
                        activeAvatar = newCharData;
                        localCharacters.push(newCharData);
                        UI.updateAvatarUI(activeAvatar);
                        refreshCommandPrompt();
                    }

                    UI.updateRoomEntitiesUI(room.npcs);
                } else {
                    UI.addLog(`[SYSTEM]: No unoccupied vessel matching '${assumeMatch[1]}' found here.`, "var(--term-amber)");
                }
                return;
            }

            if (cmd === 'create' || cmd === 'create item') {
                if (!activeAvatar) { UI.addLog("[SYSTEM]: Only materialized beings can create.", "var(--term-red)"); return; }
                startWizard('item');
                UI.setWizardPrompt("WIZARD@MATERIA:~$");
                UI.addLog(`[WIZARD]: Materialization Protocol Started. Enter name:`, "var(--term-amber)");
                return;
            } else if (cmd === 'edit room' || cmd === 'rewrite room' || cmd === 'render room') {
                if (!activeAvatar) { UI.addLog("[SYSTEM]: Voids cannot render.", "var(--term-red)"); return; }
                const currentRoomData = apartmentMap[localPlayer.currentRoom];
                startWizard('room', { ...currentRoomData });
                UI.setWizardPrompt("WIZARD@SECTOR:~$");
                UI.addLog(`[WIZARD]: Sector Overwrite Protocol Started.`);
                UI.addLog(`Current NAME: "${currentRoomData.name}"`, "var(--crayola-blue)");
                UI.addLog(`Enter new NAME (or press Enter to keep current):`, "var(--term-amber)");
                return;
            } else if (cmd.startsWith('build ')) {
                if (!activeAvatar) { UI.addLog("[SYSTEM]: Voids cannot expand space.", "var(--term-red)"); return; }
                const parts = cmd.split(' ');
                const isAuto = parts.includes('--auto') || parts.includes('auto');
                
                // Allow "build auto north" or "build north auto" or abbreviations like "build n auto"
                const dirRaw = parts.find(p => ['north', 'south', 'east', 'west', 'n', 's', 'e', 'w'].includes(p));
                const expandMap = { 'n': 'north', 's': 'south', 'e': 'east', 'w': 'west' };
                let finalDir = expandMap[dirRaw] || dirRaw;
                
                if (!finalDir) { 
                    if (isAuto && parts.length === 2) {
                        finalDir = 'here'; // User just typed 'build auto'
                    } else {
                        UI.addLog(`Use 'build north/south/east/west [auto]', or 'build auto' to re-weave current room.`, "var(--term-amber)"); 
                        return; 
                    }
                }
                
                if (isAuto) {
                    startWizard('auto_expand', { direction: finalDir });
                    UI.setWizardPrompt("WIZARD@AUTO-WEAVE:~$");
                    if (finalDir === 'here') {
                        UI.addLog(`[WIZARD]: Auto-Weave Protocol Initiated. Provide a 1-line seed phrase to re-weave the current room:`, "var(--term-amber)");
                    } else {
                        UI.addLog(`[WIZARD]: Auto-Weave Protocol Initiated. Provide a 1-line seed phrase for the new room:`, "var(--term-amber)");
                    }
                    return;
                }

                startWizard('expand', { direction: finalDir });
                UI.setWizardPrompt("WIZARD@EXPAND:~$");
                UI.addLog(`[WIZARD]: Expansion Protocol Started. Enter NAME for new room:`, "var(--term-amber)");
                return;
            } else if (cmd === 'generate room' || cmd === 'render sector') {
                if (!activeAvatar) { UI.addLog("[SYSTEM]: Only materialized beings can command the loom of reality.", "var(--term-red)"); return; }
                const currentRoom = apartmentMap[localPlayer.currentRoom];
                isProcessing = true;
                UI.addLog(`<span id="thinking-indicator" class="italic" style="color: var(--gm-purple)">COLLAPSING PROBABILITY FIELDS...</span>`);
                try {
                    const sysPrompt = `You are the Architect of Terra Agnostum. 
                    Generate a thematic room definition based on the current stratum: ${localPlayer.stratum.toUpperCase()}.
                    The current context is: ${currentRoom.name} - ${currentRoom.description}.
                    Respond STRICTLY in JSON:
                    {
                      "name": "Evocative Name",
                      "description": "Atmospheric narrative description",
                      "visual_prompt": "Detailed prompt for image generation"
                    }`;
                    const res = await callGemini("Generate a full room definition.", sysPrompt);
                    if (res && res.name && res.description) {
                        apartmentMap[localPlayer.currentRoom].name = res.name;
                        apartmentMap[localPlayer.currentRoom].shortName = res.name.substring(0, 7).toUpperCase();
                        apartmentMap[localPlayer.currentRoom].description = res.description;
                        apartmentMap[localPlayer.currentRoom].visualPrompt = res.visual_prompt;
                        apartmentMap[localPlayer.currentRoom].pinnedView = null; // Clear old pin
                        
                        if (isSyncEnabled) {
                            const mapRef = doc(db, 'artifacts', appId, 'public', 'data', 'maps', 'apartment_graph_live');
                            await updateDoc(mapRef, {
                                [`nodes.${localPlayer.currentRoom}.name`]: res.name,
                                [`nodes.${localPlayer.currentRoom}.shortName`]: apartmentMap[localPlayer.currentRoom].shortName,
                                [`nodes.${localPlayer.currentRoom}.description`]: res.description,
                                [`nodes.${localPlayer.currentRoom}.visualPrompt`]: res.visual_prompt,
                                [`nodes.${localPlayer.currentRoom}.pinnedView`]: null
                            });
                        }
                        UI.addLog(`[SYSTEM]: Sector successfully rendered.`, "var(--term-green)");
                        UI.printRoomDescription(apartmentMap[localPlayer.currentRoom], localPlayer.stratum === 'faen', apartmentMap, activeAvatar);
                        triggerVisualUpdate(res.visual_prompt, localPlayer, apartmentMap, user);
                        refreshStatusUI();
                        UI.renderMapHUD(apartmentMap, localPlayer.currentRoom, localPlayer.stratum);
                    }
                } catch (err) {
                    UI.addLog("[SYSTEM ERROR]: Reality collapse failed.", "var(--term-red)");
                } finally {
                    document.getElementById('thinking-indicator')?.remove();
                    isProcessing = false;
                }
                return;
            } else if (cmd === 'pin' || cmd === 'pin view') {
                if (!apartmentMap[localPlayer.currentRoom].pinnedView) togglePinView(localPlayer, apartmentMap, user);
                else UI.addLog("[SYSTEM]: View is already pinned. Use 'unpin' to clear.", "var(--term-amber)");
                return;
            } else if (cmd === 'unpin' || cmd === 'unpin view') {
                if (apartmentMap[localPlayer.currentRoom].pinnedView) togglePinView(localPlayer, apartmentMap, user);
                else UI.addLog("[SYSTEM]: View is not pinned.", "var(--term-amber)");
                return;
            } else if (cmd === 'look' || cmd === 'l') {
                UI.printRoomDescription(apartmentMap[localPlayer.currentRoom], localPlayer.stratum === 'faen', apartmentMap, activeAvatar); 
                triggerVisualUpdate(null, localPlayer, apartmentMap, user); return;
            } else if (cmd === 'stat' || cmd === 'stats') {
                if (!activeAvatar) return;
                UI.addLog(`IDENTITY: ${activeAvatar.name} | CLASS: ${activeAvatar.archetype}`, "var(--term-green)");
                UI.addLog(`WILL: ${activeAvatar.stats.WILL} | CONS: ${activeAvatar.stats.CONS} | PHYS: ${activeAvatar.stats.PHYS}`, "var(--term-amber)");
                return;
            } else if (cmd === 'map') {
                UI.addLog(`[SYSTEM]: Topology map live on HUD.`, "var(--term-green)"); return;
            } else if (cmd.startsWith('take ') || cmd.startsWith('get ') || cmd.startsWith('pick up ')) {
                const itemName = cmd.replace(/^(take|get|pick up)\s+/, '').toLowerCase();
                const room = apartmentMap[localPlayer.currentRoom];
                const itemIdx = (room.items || []).findIndex(i => i.name.toLowerCase().includes(itemName));
                if (itemIdx > -1) {
                    const item = room.items.splice(itemIdx, 1)[0];
                    localPlayer.inventory.push(item);
                    if (isSyncEnabled) updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'maps', 'apartment_graph_live'), { [`nodes.${localPlayer.currentRoom}.items`]: arrayRemove(item) });
                    savePlayerState(); 
                    UI.updateInventoryUI(localPlayer.inventory); 
                    UI.updateRoomItemsUI(room.items);
                    UI.addLog(`Picked up [${item.name}].`, "var(--term-green)");
                }
                return;
            } else if (cmd === 'inv' || cmd === 'inventory') {
            if (localPlayer.inventory.length === 0) UI.addLog("Inventory empty.", "var(--term-amber)");
            else localPlayer.inventory.forEach(item => UI.addLog(`- ${item.name} [${item.type}]`, "var(--term-green)"));
            return;
        } else if (cmd === 'help') {
            UI.addLog("HELP // Commands: LOOK, N/S/E/W, WHOAMI, LOGIN [EMAIL], CREATE AVATAR, LEAVE VESSEL, ASSUME [NPC], CREATE NPC, LOCK [DIR], CREATE ITEM, EDIT ROOM, BUILD [DIR] [--AUTO], GENERATE ROOM, PIN, UNPIN, INV, MAP, STAT, INVESTIGATE.", "var(--term-amber)");
            return;
        }

        // --- THE UNIVERSAL GM INTENT ENGINE ---
            isProcessing = true;
            
            try {
                await handleGMIntent(
                    val,
                    { apartmentMap, localPlayer, user, activeAvatar, isSyncEnabled, db, appId },
                    { 
                        shiftStratum, 
                        savePlayerState, 
                        refreshStatusUI, 
                        renderMapHUD: UI.renderMapHUD,
                        setActiveAvatar: (v) => { activeAvatar = v; }
                    }
                );
            } finally { 
                isProcessing = false; 
            }
        }
    });
}

setInterval(() => { 
    const timeEl = document.getElementById('time-display');
    if(timeEl) timeEl.innerText = `T+${new Date().toLocaleTimeString([], {hour12:false})}`; 
}, 1000);