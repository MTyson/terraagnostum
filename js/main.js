import { signInAnonymously, onAuthStateChanged, isSignInWithEmailLink, signInWithEmailLink, sendSignInLinkToEmail } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, setDoc, getDoc, onSnapshot, updateDoc, arrayUnion, arrayRemove, serverTimestamp, collection, addDoc, getDocs } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { ref, uploadString, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

// IMPORT DECOMPOSED DATA & SERVICES
import { apartmentMap as initialMap } from './mapData.js';
import { callGemini, projectVisual, compressImage } from './apiService.js';
import * as UI from './ui.js';
import { app, auth, db, storage, isSyncEnabled, appId } from './firebaseConfig.js';

// Initialize with seed data
let apartmentMap = { ...initialMap };

// Player State
let localPlayer = { 
    hp: 20, 
    currentRoom: "spare_room", 
    stratum: "mundane",
    posture: "standing",
    inventory: []
};

let localCharacters = []; 
let activeAvatar = null;  
let user = null;
let hasInitialized = false;
let currentBase64 = null;

// Expanded Creation Wizard State
let wizardState = {
    active: false,
    type: null, 
    step: 0,
    pendingData: {},
    existingData: {}
};

// --- HELPER WRAPPERS ---
function shiftStratum(targetStratum) {
    const isTransitioningToFaen = targetStratum === 'faen' && localPlayer.stratum !== 'faen';
    UI.applyStratumTheme(targetStratum, isTransitioningToFaen);
    localPlayer.stratum = targetStratum;
    UI.renderMapHUD(apartmentMap, localPlayer.currentRoom, localPlayer.stratum);
}

function refreshCommandPrompt() {
    const roomShort = apartmentMap[localPlayer.currentRoom]?.shortName || localPlayer.currentRoom.toUpperCase();
    UI.updateCommandPrompt(user, activeAvatar, roomShort);
}

function refreshStatusUI() {
    const roomShort = apartmentMap[localPlayer.currentRoom]?.shortName || localPlayer.currentRoom.toUpperCase();
    UI.updateStatusUI(localPlayer.posture, roomShort);
}

function refreshAllUI() {
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
        user = u;
        if (user && !hasInitialized) {
            hasInitialized = true;
            const userType = user.isAnonymous ? "GUEST" : "ARCHITECT";
            refreshCommandPrompt(); 
            UI.addLog(`${userType} LINKED: ${user.uid.substring(0,8)}`, "var(--crayola-blue)");
            
            setupWorldListener();
            setupMapListener();
            await loadPlayerState(); 
            await loadUserCharacters();
            
            shiftStratum(localPlayer.stratum);
            
            const currentRoom = apartmentMap[localPlayer.currentRoom] || apartmentMap["lore1"];
            UI.printRoomDescription(currentRoom, localPlayer.stratum === 'faen', apartmentMap);
            refreshAllUI();
            
            triggerVisualUpdate();
        }
    });

    if (!auth.currentUser && !isSignInWithEmailLink(auth, window.location.href)) {
        signInAnonymously(auth);
    }
}

function setupWorldListener() {
    if (!db) return;
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', 'archive_apartment');
    onSnapshot(roomRef, (snap) => {
        if (!snap.exists()) setDoc(roomRef, { created: serverTimestamp(), manifestations: [] });
    });
}

function setupMapListener() {
    if (!db) return;
    const mapRef = doc(db, 'artifacts', appId, 'public', 'data', 'maps', 'apartment_graph_live');
    onSnapshot(mapRef, (snap) => {
        if (!snap.exists()) {
            setDoc(mapRef, { nodes: apartmentMap, lastUpdated: serverTimestamp() });
        } else {
            const data = snap.data();
            if (data.nodes) {
                apartmentMap = data.nodes;
                UI.updateRoomItemsUI(apartmentMap[localPlayer.currentRoom]?.items);
                UI.updateRoomEntitiesUI(apartmentMap[localPlayer.currentRoom]?.npcs);
                UI.renderMapHUD(apartmentMap, localPlayer.currentRoom, localPlayer.stratum);
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
        UI.updateAvatarUI(activeAvatar);
        refreshCommandPrompt();
    } catch (error) {
        console.error("Failed to load characters:", error);
    }
}

// --- VISUAL & PINNING SYSTEM ---
export async function triggerVisualUpdate(overridePrompt = null) {
    const roomId = localPlayer.currentRoom;
    const room = apartmentMap[roomId] || {};
    
    currentBase64 = null;
    
    const pinnedUrl = (!overridePrompt && room.pinnedView) ? room.pinnedView : null;
    const basePrompt = overridePrompt || room.visualPrompt || room.visual_prompt || "A glitching void.";
    
    if (user) {
        if (pinnedUrl) {
            UI.togglePinButton(true, "UNPIN VIEW", "normal");
        } else {
            UI.togglePinButton(true, "GENERATING...", "uploading");
        }
    } else {
        UI.togglePinButton(false);
    }
    
    currentBase64 = await projectVisual(basePrompt, localPlayer.stratum, UI.addLog, pinnedUrl);
    
    if (user) {
        if (pinnedUrl) {
            UI.togglePinButton(true, "UNPIN VIEW", "normal");
        } else if (currentBase64) {
            UI.togglePinButton(true, "PIN VIEW", "normal");
        } else {
            UI.togglePinButton(false);
        }
    }
}

export async function togglePinView() {
    if (!user) { 
        UI.addLog("[SYSTEM]: Identity verification required for reality anchoring.", "var(--term-red)");
        return;
    }
    
    const roomId = localPlayer.currentRoom;
    const room = apartmentMap[roomId] || {};

    if (room.pinnedView) {
        UI.togglePinButton(true, "UNPINNING...", "uploading");
        try {
            const mapRef = doc(db, 'artifacts', appId, 'public', 'data', 'maps', 'apartment_graph_live');
            await updateDoc(mapRef, { [`nodes.${roomId}.pinnedView`]: null });
            apartmentMap[roomId].pinnedView = null;
            
            UI.addLog(`[SYSTEM]: Consensus reality anchor lifted. Space is fluid again.`, "var(--term-amber)");
            triggerVisualUpdate(); 
        } catch (e) {
            console.error("Unpinning error:", e);
            UI.togglePinButton(true, "ERROR", "normal");
            UI.addLog(`[SYSTEM ERROR]: Failed to lift anchor.`, "var(--term-red)");
        }
    } else {
        if (!currentBase64) {
            UI.addLog("[SYSTEM]: No projection active to anchor.", "var(--term-amber)");
            return;
        }
        
        UI.togglePinButton(true, "UPLOADING...", "uploading");
        try {
            const dataUrl = `data:image/png;base64,${currentBase64}`;
            const fileRef = ref(storage, `maps/${appId}/${roomId}_pinned_${Date.now()}.png`);
            await uploadString(fileRef, dataUrl, 'data_url');
            const downloadUrl = await getDownloadURL(fileRef);
            
            const mapRef = doc(db, 'artifacts', appId, 'public', 'data', 'maps', 'apartment_graph_live');
            await updateDoc(mapRef, { [`nodes.${roomId}.pinnedView`]: downloadUrl });
            apartmentMap[roomId].pinnedView = downloadUrl;
            
            UI.togglePinButton(true, "PINNED!", "pinned");
            UI.addLog(`[SYSTEM]: Consensus reality locked. The visual projection of ${apartmentMap[roomId].name || 'this sector'} is now canonical.`, "var(--gm-purple)");
            
            setTimeout(() => { UI.togglePinButton(true, "UNPIN VIEW", "normal"); }, 2000);
        } catch (e) {
            console.error("Pinning error:", e);
            UI.togglePinButton(true, "ERROR", "normal");
            UI.addLog(`[SYSTEM ERROR]: Failed to anchor memory to the cloud.`, "var(--term-red)");
        }
    }
}

const pinBtnEl = document.getElementById('pin-view-btn');
if (pinBtnEl) {
    pinBtnEl.addEventListener('click', togglePinView);
}

// --- NARRATIVE MOVEMENT ENGINE ---
async function executeMovement(targetDir) {
    const currentRoom = apartmentMap[localPlayer.currentRoom];
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
        UI.printRoomDescription(apartmentMap[nextId], true, apartmentMap);
        triggerVisualUpdate();
        return;
    }
    
    if (currentRoom.exits && currentRoom.exits[targetDir]) {
        const exitData = currentRoom.exits[targetDir];
        
        // CHECK FOR LOCKS
        if (typeof exitData === 'object' && exitData.locked) {
            UI.addLog(`[BLOCKED]: ${exitData.lockMsg || 'The path is barred.'}`, "var(--term-amber)");
            return; // Abort movement
        }

        const nextRoomKey = typeof exitData === 'string' ? exitData : exitData.target;
        localPlayer.currentRoom = nextRoomKey;
        const nextRoom = apartmentMap[nextRoomKey];
        
        savePlayerState(); 
        refreshAllUI();
        
        UI.addLog(`[SYSTEM]: You move ${targetDir.toUpperCase()}.`, "var(--term-green)");
        UI.printRoomDescription(nextRoom, false, apartmentMap);
        
        triggerVisualUpdate();
        
        if (isSyncEnabled && user) {
            const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', 'archive_apartment');
            updateDoc(roomRef, { manifestations: arrayUnion({ author: user.uid, text: `[${localPlayer.currentRoom}] User arrived from the ${targetDir}.`, timestamp: Date.now() }) });
        }
    } else {
        refreshStatusUI();
        UI.addLog(`[SYSTEM]: You cannot go that way.`, "var(--term-amber)");
        triggerVisualUpdate();
    }
}

// --- CREATION WIZARD ENGINE ---
function handleWizardInput(val) {
    if (wizardState.type === 'item') {
        if (wizardState.step === 1) {
            if (!val) { UI.addLog(`[WIZARD]: Name cannot be empty.`, "var(--term-red)"); return; }
            wizardState.pendingData.name = val;
            UI.addLog(`[WIZARD]: Name set to '${val}'. What type of item is this? (e.g., Book, Key, Weapon)`, "var(--term-amber)");
            wizardState.step++;
        } else if (wizardState.step === 2) {
            wizardState.pendingData.type = val || 'Artifact';
            UI.addLog(`[WIZARD]: Type set to '${wizardState.pendingData.type}'. Finally, provide a short physical description.`, "var(--term-amber)");
            wizardState.step++;
        } else if (wizardState.step === 3) {
            wizardState.pendingData.description = val || 'An unknown manifestation.';
            wizardState.pendingData.id = Date.now().toString(); 
            const room = apartmentMap[localPlayer.currentRoom];
            
            if (!room.items) room.items = [];
            room.items.push(wizardState.pendingData);
            
            if (isSyncEnabled) {
                const mapRef = doc(db, 'artifacts', appId, 'public', 'data', 'maps', 'apartment_graph_live');
                updateDoc(mapRef, { [`nodes.${localPlayer.currentRoom}.items`]: arrayUnion(wizardState.pendingData) });
            }
            
            UI.updateRoomItemsUI(room.items);
            UI.addLog(`[SYSTEM]: Successfully materialized [${wizardState.pendingData.name}] into ${room.name}.`, "var(--term-green)");
            refreshCommandPrompt();
            wizardState = { active: false, type: null, step: 0, pendingData: {}, existingData: {} };
        }
    } 
    else if (wizardState.type === 'room') {
        if (wizardState.step === 1) {
            wizardState.pendingData.name = val || wizardState.existingData.name;
            UI.addLog(`[WIZARD]: Room Name set to '${wizardState.pendingData.name}'.`);
            UI.addLog(`Current NARRATIVE: "${wizardState.existingData.description}"`, "var(--crayola-blue)");
            UI.addLog(`Enter new NARRATIVE (or press Enter to keep current):`, "var(--term-amber)");
            wizardState.step++;
        } else if (wizardState.step === 2) {
            wizardState.pendingData.description = val || wizardState.existingData.description;
            UI.addLog(`[WIZARD]: Description saved.`);
            UI.addLog(`Current VISUAL PROMPT: "${wizardState.existingData.visualPrompt || wizardState.existingData.visual_prompt}"`, "var(--crayola-blue)");
            UI.addLog(`Enter new VISUAL PROMPT (or press Enter to keep current):`, "var(--term-amber)");
            wizardState.step++;
        } else if (wizardState.step === 3) {
            wizardState.pendingData.visualPrompt = val || wizardState.existingData.visualPrompt || wizardState.existingData.visual_prompt;
            const rKey = localPlayer.currentRoom;
            
            apartmentMap[rKey].name = wizardState.pendingData.name;
            apartmentMap[rKey].shortName = wizardState.pendingData.name.substring(0, 7).toUpperCase();
            apartmentMap[rKey].description = wizardState.pendingData.description;
            apartmentMap[rKey].visualPrompt = wizardState.pendingData.visualPrompt;
            apartmentMap[rKey].pinnedView = null; // Clear old pin on edit
            
            if (isSyncEnabled) {
                const mapRef = doc(db, 'artifacts', appId, 'public', 'data', 'maps', 'apartment_graph_live');
                updateDoc(mapRef, {
                    [`nodes.${rKey}.name`]: wizardState.pendingData.name,
                    [`nodes.${rKey}.shortName`]: apartmentMap[rKey].shortName,
                    [`nodes.${rKey}.description`]: wizardState.pendingData.description,
                    [`nodes.${rKey}.visualPrompt`]: wizardState.pendingData.visualPrompt,
                    [`nodes.${rKey}.pinnedView`]: null // Clear old pin in DB
                });
            }
            
            UI.addLog(`[SYSTEM]: Sector successfully re-rendered. Old pins discarded.`, "var(--term-green)");
            UI.printRoomDescription(apartmentMap[rKey], localPlayer.stratum === 'faen', apartmentMap);
            triggerVisualUpdate(apartmentMap[rKey].visualPrompt); // Force regeneration with new prompt
            
            refreshStatusUI();
            UI.renderMapHUD(apartmentMap, rKey, localPlayer.stratum);
            refreshCommandPrompt();
            wizardState = { active: false, type: null, step: 0, pendingData: {}, existingData: {} };
        }
    } 
    else if (wizardState.type === 'expand') {
        if (wizardState.step === 1) {
            wizardState.pendingData.name = val || "New Area";
            UI.addLog(`[WIZARD]: Room Name set. Enter the narrative description:`, "var(--term-amber)");
            wizardState.step++;
        } else if (wizardState.step === 2) {
            wizardState.pendingData.description = val || 'An indistinct area.';
            UI.addLog(`[WIZARD]: Description saved. Enter a visual prompt for the image generator:`, "var(--term-amber)");
            wizardState.step++;
        } else if (wizardState.step === 3) {
            wizardState.pendingData.visualPrompt = val || 'A glitchy, undefined space.';
            const newRoomId = 'node_' + Date.now();
            const currentRoomKey = localPlayer.currentRoom;
            const dir = wizardState.pendingData.direction; 
            const reverseDir = { 'north':'south', 'south':'north', 'east':'west', 'west':'east' }[dir];
            
            const newNode = {
                name: wizardState.pendingData.name,
                shortName: wizardState.pendingData.name.substring(0, 7).toUpperCase(),
                description: wizardState.pendingData.description,
                visualPrompt: wizardState.pendingData.visualPrompt,
                exits: { [reverseDir]: currentRoomKey },
                pinnedView: null, items: [], marginalia: [], npcs: []
            };
            
            apartmentMap[newRoomId] = newNode;
            if (!apartmentMap[currentRoomKey].exits) apartmentMap[currentRoomKey].exits = {};
            apartmentMap[currentRoomKey].exits[dir] = newRoomId;
            
            if (isSyncEnabled) {
                const mapRef = doc(db, 'artifacts', appId, 'public', 'data', 'maps', 'apartment_graph_live');
                updateDoc(mapRef, {
                    [`nodes.${currentRoomKey}.exits.${dir}`]: newRoomId,
                    [`nodes.${newRoomId}`]: newNode
                });
            }
            
            UI.addLog(`[SYSTEM]: Sector materialization complete. Path to the ${dir.toUpperCase()} is now open.`, "var(--term-green)");
            refreshCommandPrompt();
            UI.renderMapHUD(apartmentMap, localPlayer.currentRoom, localPlayer.stratum);
            wizardState = { active: false, type: null, step: 0, pendingData: {}, existingData: {} };
        }
    }
    else if (wizardState.type === 'auto_expand') {
        if (wizardState.step === 1) {
            const seedPhrase = val || "An undefined anomaly.";
            const dir = wizardState.pendingData.direction;
            const currentRoomKey = localPlayer.currentRoom;
            const currentRoom = apartmentMap[currentRoomKey];
            
            isProcessing = true;
            wizardState = { active: false, type: null, step: 0, pendingData: {}, existingData: {} };
            refreshCommandPrompt();
            
            if (dir === 'here') {
                UI.addLog(`<span id="thinking-indicator" class="italic" style="color: var(--gm-purple)">RE-WEAVING LOCAL REALITY BASED ON SEED: "${seedPhrase}"...</span>`);
            } else {
                UI.addLog(`<span id="thinking-indicator" class="italic" style="color: var(--gm-purple)">WEAVING ADJACENT REALITY BASED ON SEED: "${seedPhrase}"...</span>`);
            }
            
            (async () => {
                try {
                    const sysPrompt = dir === 'here' ? 
                        `You are the Architect of Terra Agnostum. 
                        Redesign the current room based on the user's seed idea.
                        Current Stratum: ${localPlayer.stratum.toUpperCase()}.
                        Old Room Context: ${currentRoom.name} - ${currentRoom.description}.
                        User's Seed Idea for Room: "${seedPhrase}".
                        Expand on this seed idea to create a rich, atmospheric room.
                        Respond STRICTLY in JSON:
                        {
                          "name": "Evocative Name",
                          "description": "Atmospheric narrative description",
                          "visual_prompt": "Detailed prompt for image generation"
                        }` :
                        `You are the Architect of Terra Agnostum. 
                        Generate a thematic new room located to the ${dir.toUpperCase()} of the current room.
                        Current Stratum: ${localPlayer.stratum.toUpperCase()}.
                        Current Room Context: ${currentRoom.name} - ${currentRoom.description}.
                        User's Seed Idea for New Room: "${seedPhrase}".
                        Expand on this seed idea to create a rich, atmospheric room.
                        Respond STRICTLY in JSON:
                        {
                          "name": "Evocative Name",
                          "description": "Atmospheric narrative description",
                          "visual_prompt": "Detailed prompt for image generation"
                        }`;

                    const res = await callGemini("Generate an adjacent room from seed.", sysPrompt);
                    
                    if (res && res.name && res.description) {
                        if (dir === 'here') {
                            apartmentMap[currentRoomKey].name = res.name;
                            apartmentMap[currentRoomKey].shortName = res.name.substring(0, 7).toUpperCase();
                            apartmentMap[currentRoomKey].description = res.description;
                            apartmentMap[currentRoomKey].visualPrompt = res.visual_prompt || res.visualPrompt;
                            apartmentMap[currentRoomKey].pinnedView = null; // Clear old pin
                            
                            if (isSyncEnabled) {
                                const mapRef = doc(db, 'artifacts', appId, 'public', 'data', 'maps', 'apartment_graph_live');
                                await updateDoc(mapRef, {
                                    [`nodes.${currentRoomKey}.name`]: res.name,
                                    [`nodes.${currentRoomKey}.shortName`]: apartmentMap[currentRoomKey].shortName,
                                    [`nodes.${currentRoomKey}.description`]: res.description,
                                    [`nodes.${currentRoomKey}.visualPrompt`]: res.visual_prompt || res.visualPrompt,
                                    [`nodes.${currentRoomKey}.pinnedView`]: null
                                });
                            }
                            
                            UI.addLog(`[SYSTEM]: Sector successfully re-woven based on seed.`, "var(--term-green)");
                            UI.printRoomDescription(apartmentMap[currentRoomKey], localPlayer.stratum === 'faen', apartmentMap);
                            triggerVisualUpdate(apartmentMap[currentRoomKey].visualPrompt);
                            refreshStatusUI();
                            UI.renderMapHUD(apartmentMap, localPlayer.currentRoom, localPlayer.stratum);
                        } else {
                            const newRoomId = 'node_' + Date.now();
                            const reverseDir = { 'north':'south', 'south':'north', 'east':'west', 'west':'east' }[dir];
                            
                            const newNode = {
                                name: res.name,
                                shortName: res.name.substring(0, 7).toUpperCase(),
                                description: res.description,
                                visualPrompt: res.visual_prompt || res.visualPrompt,
                                exits: { [reverseDir]: currentRoomKey },
                                pinnedView: null, items: [], marginalia: [], npcs: []
                            };
                            
                            apartmentMap[newRoomId] = newNode;
                            if (!apartmentMap[currentRoomKey].exits) apartmentMap[currentRoomKey].exits = {};
                            apartmentMap[currentRoomKey].exits[dir] = newRoomId;
                            
                            if (isSyncEnabled) {
                                const mapRef = doc(db, 'artifacts', appId, 'public', 'data', 'maps', 'apartment_graph_live');
                                await updateDoc(mapRef, {
                                    [`nodes.${currentRoomKey}.exits.${dir}`]: newRoomId,
                                    [`nodes.${newRoomId}`]: newNode
                                });
                            }
                            
                            UI.addLog(`[SYSTEM]: Auto-sector materialization complete. Path to the ${dir.toUpperCase()} is now open to [${res.name}].`, "var(--term-green)");
                            UI.renderMapHUD(apartmentMap, localPlayer.currentRoom, localPlayer.stratum);
                        }
                    }
                } catch (err) {
                    UI.addLog("[SYSTEM ERROR]: Reality weave failed.", "var(--term-red)");
                } finally {
                    document.getElementById('thinking-indicator')?.remove();
                    isProcessing = false;
                }
            })();
        }
    }
    else if (wizardState.type === 'avatar') {
        if (wizardState.step === 1) {
            if (!val) { UI.addLog(`[WIZARD]: Name cannot be empty.`, "var(--term-red)"); return; }
            wizardState.pendingData.name = val;
            UI.addLog(`[WIZARD]: Identity confirmed as '${val}'. Enter your Archetype/Class (e.g., Cyber-Merc, Harmonic Bard, Faen Weaver):`, "var(--term-amber)");
            wizardState.step++;
        } else if (wizardState.step === 2) {
            wizardState.pendingData.archetype = val || 'Wanderer';
            UI.addLog(`[WIZARD]: Archetype logged. Describe your vessel's physical appearance in detail:`, "var(--term-amber)");
            wizardState.step++;
        } else if (wizardState.step === 3) {
            wizardState.pendingData.visual_prompt = val || 'A shadowed, undefined figure.';
            const charData = {
                name: wizardState.pendingData.name,
                archetype: wizardState.pendingData.archetype,
                visual_prompt: wizardState.pendingData.visual_prompt,
                stats: { WILL: 20, CONS: 20, PHYS: 20 },
                deceased: false, deployed: false
            };
            
            UI.addLog(`[SYSTEM]: Extracting genetic imprint for your primary vessel [${charData.name}]...`, "var(--gm-purple)");
            wizardState = { active: false, type: null, step: 0, pendingData: {}, existingData: {} };
            refreshCommandPrompt();

            (async () => {
                let cardImageSrc = "";
                let compressedImageSrc = "";
                try {
                    const combinedPrompt = `Highly detailed character portrait, ${localPlayer.stratum} aesthetic, Magic the Gathering card art style: ${charData.visual_prompt}`;
                    const imgRes = await fetch("/api/image", {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ instances: [{ prompt: combinedPrompt }] })
                    });
                    const imgData = await imgRes.json();
                    if (imgData.predictions?.[0]) {
                        cardImageSrc = `data:image/png;base64,${imgData.predictions[0].bytesBase64Encoded}`;
                        compressedImageSrc = await compressImage(cardImageSrc);
                    }
                } catch (e) {
                    console.error("Card Image Error", e);
                }
                
                const fullCharData = { ...charData, image: compressedImageSrc || cardImageSrc, timestamp: Date.now() };
                
                if (user) {
                    try {
                        const charCol = collection(db, 'artifacts', appId, 'users', user.uid, 'characters');
                        const docRef = await addDoc(charCol, fullCharData);
                        fullCharData.id = docRef.id; 
                        UI.addLog(`[SYSTEM]: Avatar Card [${charData.name}] permanently registered to your profile.`, "var(--term-green)");
                    } catch (e) {
                        UI.addLog(`[SYSTEM ERROR]: Could not save Avatar to the archive.`, "var(--term-red)");
                    }
                }
                
                UI.renderCharacterCard(fullCharData, compressedImageSrc || cardImageSrc);
                localCharacters.push(fullCharData);
                activeAvatar = fullCharData; 
                UI.updateAvatarUI(activeAvatar); 
                refreshCommandPrompt();
            })();
        }
    }
    else if (wizardState.type === 'deploy_npc') {
        if (wizardState.step === 1) {
            const personality = val || "Stands silently, observing the void.";
            const roomKey = localPlayer.currentRoom;
            const room = apartmentMap[roomKey];
            if (!room.npcs) room.npcs = [];
            
            const newNPC = {
                id: 'npc_' + Date.now(),
                name: activeAvatar.name,
                archetype: activeAvatar.archetype,
                visual_prompt: activeAvatar.visual_prompt,
                image: activeAvatar.image, 
                personality: personality,
                owner: user ? user.uid : 'guest'
            };
            
            room.npcs.push(newNPC);
            
            if (isSyncEnabled) {
                const mapRef = doc(db, 'artifacts', appId, 'public', 'data', 'maps', 'apartment_graph_live');
                updateDoc(mapRef, { [`nodes.${roomKey}.npcs`]: arrayUnion(newNPC) });
            }
            
            if (activeAvatar && user) {
                try {
                    const charRef = doc(db, 'artifacts', appId, 'users', user.uid, 'characters', activeAvatar.id);
                    updateDoc(charRef, { deployed: true }); 
                } catch (e) { console.error("Could not write deployment state.", e); }
            }
            
            UI.addLog(`[SYSTEM]: Vessel [${newNPC.name}] detached and left on autonomous local loop.`, "var(--term-green)");
            UI.addLog(`[SYSTEM]: You are once again an itinerant void. Find a mirror to forge a new form.`, "var(--term-amber)");
            
            activeAvatar = null;
            UI.updateAvatarUI(null);
            refreshCommandPrompt();
            UI.updateRoomEntitiesUI(room.npcs);
            wizardState = { active: false, type: null, step: 0, pendingData: {}, existingData: {} };
        }
    }
    else if (wizardState.type === 'create_npc') {
        if (wizardState.step === 1) {
            if (!val) { UI.addLog(`[WIZARD]: Name cannot be empty.`, "var(--term-red)"); return; }
            wizardState.pendingData.name = val;
            UI.addLog(`[WIZARD]: Name set to '${val}'. Enter Archetype/Role (e.g., Cafe Owner, Bouncer):`, "var(--term-amber)");
            wizardState.step++;
        } else if (wizardState.step === 2) {
            wizardState.pendingData.archetype = val || 'Entity';
            UI.addLog(`[WIZARD]: Archetype set. Describe their physical appearance:`, "var(--term-amber)");
            wizardState.step++;
        } else if (wizardState.step === 3) {
            wizardState.pendingData.visual_prompt = val || 'A shadowed figure.';
            UI.addLog(`[WIZARD]: Appearance saved. Describe their autonomous personality/goals (e.g., "Protects the north door, suspicious of strangers"):`, "var(--term-amber)");
            wizardState.step++;
        } else if (wizardState.step === 4) {
            wizardState.pendingData.personality = val || 'Stands silently.';
            const roomKey = localPlayer.currentRoom;
            const room = apartmentMap[roomKey];
            if (!room.npcs) room.npcs = [];
            
            const newNPC = {
                id: 'npc_' + Date.now(),
                name: wizardState.pendingData.name,
                archetype: wizardState.pendingData.archetype,
                visual_prompt: wizardState.pendingData.visual_prompt,
                image: null, 
                personality: wizardState.pendingData.personality,
                owner: user ? user.uid : 'system'
            };
            
            room.npcs.push(newNPC);
            
            if (isSyncEnabled) {
                const mapRef = doc(db, 'artifacts', appId, 'public', 'data', 'maps', 'apartment_graph_live');
                updateDoc(mapRef, { [`nodes.${roomKey}.npcs`]: arrayUnion(newNPC) });
            }
            
            UI.addLog(`[SYSTEM]: Entity [${newNPC.name}] instantiated into the sector. Generating portrait...`, "var(--term-green)");
            refreshCommandPrompt();
            UI.updateRoomEntitiesUI(room.npcs);
            wizardState = { active: false, type: null, step: 0, pendingData: {}, existingData: {} };

            // Generate portrait in background
            (async () => {
                try {
                    const combinedPrompt = `Highly detailed character portrait, ${localPlayer.stratum} aesthetic, Magic the Gathering card art style: ${newNPC.visual_prompt}`;
                    const imgRes = await fetch("/api/image", {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ instances: [{ prompt: combinedPrompt }] })
                    });
                    const imgData = await imgRes.json();
                    if (imgData.predictions?.[0]) {
                        const cardImageSrc = `data:image/png;base64,${imgData.predictions[0].bytesBase64Encoded}`;
                        const compressedImageSrc = await compressImage(cardImageSrc);
                        
                        const updatedRoom = apartmentMap[localPlayer.currentRoom];
                        const npcIdx = updatedRoom.npcs.findIndex(n => n.id === newNPC.id);
                        if (npcIdx > -1) {
                            updatedRoom.npcs[npcIdx].image = compressedImageSrc;
                            UI.updateRoomEntitiesUI(updatedRoom.npcs);
                            if (isSyncEnabled) {
                                const mapRef = doc(db, 'artifacts', appId, 'public', 'data', 'maps', 'apartment_graph_live');
                                updateDoc(mapRef, { [`nodes.${localPlayer.currentRoom}.npcs`]: updatedRoom.npcs });
                            }
                        }
                    }
                } catch (e) { console.error("NPC Image Gen Error", e); }
            })();
        }
    }
    else if (wizardState.type === 'lock_exit') {
        if (wizardState.step === 1) {
            wizardState.pendingData.lockMsg = val || 'The way is barred.';
            const dir = wizardState.pendingData.direction;
            const roomKey = localPlayer.currentRoom;
            const room = apartmentMap[roomKey];
            
            let existingTarget = room.exits[dir];
            let targetId = typeof existingTarget === 'string' ? existingTarget : existingTarget.target;
            
            room.exits[dir] = {
                target: targetId,
                locked: true,
                lockMsg: wizardState.pendingData.lockMsg
            };
            
            if (isSyncEnabled) {
                const mapRef = doc(db, 'artifacts', appId, 'public', 'data', 'maps', 'apartment_graph_live');
                updateDoc(mapRef, { [`nodes.${roomKey}.exits.${dir}`]: room.exits[dir] });
            }
            
            UI.addLog(`[SYSTEM]: Sector ${dir.toUpperCase()} is now LOCKED.`, "var(--term-amber)");
            refreshCommandPrompt();
            wizardState = { active: false, type: null, step: 0, pendingData: {}, existingData: {} };
        }
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
            if (wizardState.active) { handleWizardInput(val); return; }
        
        const cmd = val.toLowerCase();

        // --- AUTH & IDENTITY COMMANDS ---
        if (cmd === 'whoami') {
            if (!user) {
                UI.addLog("[SYSTEM]: No active connection.", "var(--term-red)");
            } else if (user.isAnonymous) {
                UI.addLog(`[SYSTEM]: Connected as GUEST (Anonymous). ID: ${user.uid}`, "var(--term-amber)");
                UI.addLog(`Use 'register [email]' or 'log in [email]' to secure your identity.`, "var(--crayola-blue)");
            } else {
                UI.addLog(`[SYSTEM]: Connected as ARCHITECT. Email: ${user.email} | ID: ${user.uid}`, "var(--term-green)");
            }
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
                if (localPlayer.currentRoom !== 'spare_room') {
                    UI.addLog(`[SYSTEM]: You must be in the Archive (Spare Room) to forge a form.`, "var(--term-amber)");
                    return;
                }
                wizardState = { active: true, type: 'avatar', step: 1, pendingData: {}, existingData: {} };
                UI.setWizardPrompt("WIZARD@FORGE:~$");
                UI.addLog(`[WIZARD]: Vessel Forging Protocol Initiated. Enter your identity (Name):`, "var(--term-amber)");
                return;
            }

            if (!activeAvatar && !cmd.startsWith('help') && !cmd.startsWith('create avatar') && !cmd.startsWith('assume')) {
                if (localPlayer.currentRoom !== 'spare_room') {
                    UI.addLog(`[SYSTEM]: You are an itinerant void. Go to the Archive to forge your form.`, "var(--term-amber)");
                }
            }

            const dirMatch = cmd.match(/^(?:go\s+(?:to\s+(?:the\s+)?)?|move\s+|walk\s+|head\s+)?(north|south|east|west|n|s|e|w)$/);
            if (dirMatch) {
                const parsedDir = dirMatch[1];
                const expandMap = { 'n': 'north', 's': 'south', 'e': 'east', 'w': 'west' };
                executeMovement(expandMap[parsedDir] || parsedDir); return;
            }

            if (cmd === 'leave vessel' || cmd === 'deploy npc' || cmd === 'leave avatar') {
                if (!activeAvatar) { UI.addLog("[SYSTEM]: You have no vessel to leave.", "var(--term-red)"); return; }
                wizardState = { active: true, type: 'deploy_npc', step: 1, pendingData: {}, existingData: {} };
                UI.setWizardPrompt("WIZARD@DEPLOY:~$");
                UI.addLog(`[WIZARD]: Vessel Deployment Protocol. WARNING: You will forfeit control of this avatar.`, "var(--term-red)");
                UI.addLog(`[WIZARD]: Describe its autonomous personality:`, "var(--term-amber)");
                return;
            }

            if (cmd === 'create npc' || cmd === 'spawn npc') {
                if (!activeAvatar) { UI.addLog("[SYSTEM]: Voids cannot spawn life.", "var(--term-red)"); return; }
                wizardState = { active: true, type: 'create_npc', step: 1, pendingData: {}, existingData: {} };
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
                
                wizardState = { active: true, type: 'lock_exit', step: 1, pendingData: { direction: finalDir }, existingData: {} };
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
                wizardState = { active: true, type: 'item', step: 1, pendingData: {}, existingData: {} };
                UI.setWizardPrompt("WIZARD@MATERIA:~$");
                UI.addLog(`[WIZARD]: Materialization Protocol Started. Enter name:`, "var(--term-amber)");
                return;
            } else if (cmd === 'edit room' || cmd === 'rewrite room' || cmd === 'render room') {
                if (!activeAvatar) { UI.addLog("[SYSTEM]: Voids cannot render.", "var(--term-red)"); return; }
                const currentRoomData = apartmentMap[localPlayer.currentRoom];
                wizardState = { active: true, type: 'room', step: 1, pendingData: {}, existingData: { ...currentRoomData } };
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
                    wizardState = { active: true, type: 'auto_expand', step: 1, pendingData: { direction: finalDir }, existingData: {} };
                    UI.setWizardPrompt("WIZARD@AUTO-WEAVE:~$");
                    if (finalDir === 'here') {
                        UI.addLog(`[WIZARD]: Auto-Weave Protocol Initiated. Provide a 1-line seed phrase to re-weave the current room:`, "var(--term-amber)");
                    } else {
                        UI.addLog(`[WIZARD]: Auto-Weave Protocol Initiated. Provide a 1-line seed phrase for the new room:`, "var(--term-amber)");
                    }
                    return;
                }

                wizardState = { active: true, type: 'expand', step: 1, pendingData: { direction: finalDir }, existingData: {} };
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
                        UI.printRoomDescription(apartmentMap[localPlayer.currentRoom], localPlayer.stratum === 'faen', apartmentMap);
                        triggerVisualUpdate(res.visual_prompt);
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
                if (!apartmentMap[localPlayer.currentRoom].pinnedView) togglePinView();
                else UI.addLog("[SYSTEM]: View is already pinned. Use 'unpin' to clear.", "var(--term-amber)");
                return;
            } else if (cmd === 'unpin' || cmd === 'unpin view') {
                if (apartmentMap[localPlayer.currentRoom].pinnedView) togglePinView();
                else UI.addLog("[SYSTEM]: View is not pinned.", "var(--term-amber)");
                return;
            } else if (cmd === 'look' || cmd === 'l') {
                UI.printRoomDescription(apartmentMap[localPlayer.currentRoom], localPlayer.stratum === 'faen', apartmentMap); 
                triggerVisualUpdate(); return;
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
            UI.addLog("HELP // Commands: LOOK, N/S/E/W, WHOAMI, LOGIN [EMAIL], CREATE AVATAR, LEAVE VESSEL, ASSUME [NPC], CREATE NPC, LOCK [DIR], CREATE ITEM, EDIT ROOM, BUILD [DIR] [--AUTO], GENERATE ROOM, PIN, UNPIN, INV, MAP, STAT.", "var(--term-amber)");
            return;
        }

        // --- THE UNIVERSAL GM INTENT ENGINE ---
            isProcessing = true;
            UI.addLog(`<span id="thinking-indicator" class="italic" style="color: var(--gm-purple)">EVALUATING INTENT...</span>`);
            
            try {
                const currentRoomData = apartmentMap[localPlayer.currentRoom];
                const inventoryNames = localPlayer.inventory.map(i => i.name).join(', ');
                const npcText = (currentRoomData.npcs || []).map(n => `[NPC] ${n.name} - Personality: ${n.personality}`).join('\n') || "None";
                
                // Build string representing current exits and their lock status
                const exitStrs = [];
                const adjacentNpcs = []; // Track NPCs in adjacent rooms for GM Context
                for (let [dir, data] of Object.entries(currentRoomData.exits || {})) {
                    const targetId = typeof data === 'object' ? data.target : data;
                    if (typeof data === 'object' && data.locked) {
                        exitStrs.push(`${dir.toUpperCase()} (LOCKED: ${data.lockMsg})`);
                    } else {
                        exitStrs.push(dir.toUpperCase());
                    }
                    
                    // Peek into the adjacent room for visible entities
                    const targetRoom = apartmentMap[targetId];
                    if (targetRoom && targetRoom.npcs && targetRoom.npcs.length > 0) {
                        targetRoom.npcs.forEach(n => {
                            adjacentNpcs.push(`[NPC to the ${dir.toUpperCase()}] ${n.name} - Personality: ${n.personality}`);
                        });
                    }
                }
                const exitText = exitStrs.length > 0 ? exitStrs.join(', ') : "None";
                const adjacentNpcText = adjacentNpcs.length > 0 ? adjacentNpcs.join('\n') : "None";
                
                const sysPrompt = `You are Tandy, the GM of Terra Agnostum. 
                Context: ${currentRoomData.name} (${localPlayer.stratum.toUpperCase()}). ${currentRoomData.description}.
                Entities Present: ${npcText}. Inventory: ${inventoryNames}.
                Adjacent Entities (Visible through doorways/counters): ${adjacentNpcText}.
                Exits: ${exitText}.
                IMPORTANT: A 'faen_jump' can ONLY happen if the user is in 'Schrödinger's Closet' (CLOSET) or explicitly uses specific 'Aethal' code.
                IMPORTANT: If a user attempts to interact with an Adjacent Entity across a counter or doorway, you may roleplay their response based on their personality.
                IMPORTANT: If a user attempts to go through a LOCKED exit, and they successfully persuade, bribe, or trick the guarding Adjacent Entity, you may set world_edit type to 'unlock_exit' and provide the direction.
                Respond STRICTLY in JSON:
                {
                  "speaker": "NARRATOR or NPC Name",
                  "narrative": "outcome",
                  "color": "hex",
                  "trigger_visual": "prompt or null",
                  "faen_jump": boolean,
                  "trigger_stratum_shift": null or 'mundane', 'faen', 'technate',
                  "trigger_teleport": null or { "new_room_id": "id", "name": "Name", "description": "Desc", "visual_prompt": "Prompt" },
                  "world_edit": null or {"type": "add_marginalia", "text": "text"} or {"type": "unlock_exit", "direction": "north"},
                  "trigger_respawn": false
                }`;
                
                const res = await callGemini(`User: ${val}`, sysPrompt);
                let stateChanged = false;
                
                if (res.faen_jump && localPlayer.stratum !== 'faen') {
                    if (localPlayer.currentRoom === 'closet' || cmd.includes('aethal')) {
                        shiftStratum('faen');
                        localPlayer.currentRoom = 'faen_entry';
                        apartmentMap['faen_entry'] = {
                            name: "Faen Nexus", shortName: "NEXUS",
                            description: "The entry point to the ethereal plane. Space is fluid and glowing.",
                            visualPrompt: "Glowing ethereal nexus portal.",
                            exits: {}, pinnedView: null, items: [], marginalia: [], npcs: []
                        };
                        stateChanged = true;
                        UI.addLog(`[SYSTEM]: Conventional geometry discarded. Welcome to Faen.`, "var(--faen-pink)");
                    } else {
                        UI.addLog("[SYSTEM]: Dimensional shift failed. Anchors too strong in this node.", "var(--term-red)");
                    }
                } else if (res.trigger_stratum_shift) {
                    const target = res.trigger_stratum_shift.toLowerCase();
                    if (localPlayer.stratum !== target) { 
                        shiftStratum(target); 
                        stateChanged = true; 
                    }
                }
                
                if (res.trigger_respawn) {
                    if (activeAvatar && user) updateDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'characters', activeAvatar.id), { deceased: true });
                    activeAvatar = null; localPlayer.currentRoom = "spare_room"; localPlayer.stratum = "mundane";
                    stateChanged = true; 
                    UI.addLog(`Vessel destroyed. Connection severed.`, "var(--term-red)"); 
                    shiftStratum('mundane');
                }
                
                if (res.trigger_teleport && !res.trigger_respawn) {
                    const t = res.trigger_teleport;
                    if (!apartmentMap[t.new_room_id]) {
                        apartmentMap[t.new_room_id] = { ...t, shortName: t.name.substring(0, 7).toUpperCase(), exits: {}, pinnedView: null, items: [], marginalia: [], npcs: [] };
                        if (isSyncEnabled) updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'maps', 'apartment_graph_live'), { [`nodes.${t.new_room_id}`]: apartmentMap[t.new_room_id] });
                    }
                    localPlayer.currentRoom = t.new_room_id; 
                    stateChanged = true; 
                    UI.addLog(`Reality warp successful.`, "var(--gm-purple)");
                }
                
                if (stateChanged) { 
                    refreshStatusUI(); 
                    savePlayerState(); 
                    UI.renderMapHUD(apartmentMap, localPlayer.currentRoom, localPlayer.stratum); 
                }
                
                const speakerPrefix = (res.speaker === 'SYSTEM' || res.speaker === 'NARRATOR') ? `[${res.speaker}]` : `${res.speaker.toUpperCase()}`;
                UI.addLog(`${speakerPrefix}: ${res.narrative}`, res.color);
                
                if (res.world_edit) {
                    const room = apartmentMap[localPlayer.currentRoom];
                    if (res.world_edit.type === 'add_marginalia') {
                        if (!room.marginalia) room.marginalia = [];
                        room.marginalia.push(res.world_edit.text);
                        if (isSyncEnabled) updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'maps', 'apartment_graph_live'), { [`nodes.${localPlayer.currentRoom}.marginalia`]: arrayUnion(res.world_edit.text) });
                    } else if (res.world_edit.type === 'unlock_exit') {
                        const unlockDir = res.world_edit.direction.toLowerCase();
                        if (room.exits[unlockDir] && typeof room.exits[unlockDir] === 'object') {
                            room.exits[unlockDir].locked = false;
                            if (isSyncEnabled) updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'maps', 'apartment_graph_live'), { [`nodes.${localPlayer.currentRoom}.exits.${unlockDir}.locked`]: false });
                            UI.addLog(`[SYSTEM]: The path ${unlockDir.toUpperCase()} has been opened.`, "var(--term-green)");
                        }
                    }
                }
                
                if (res.trigger_visual && !res.trigger_respawn && !res.trigger_teleport) {
                    triggerVisualUpdate(res.trigger_visual); // GM Override passed here!
                } else if (res.trigger_stratum_shift || res.trigger_teleport || res.faen_jump) {
                    triggerVisualUpdate(); // No override passed
                }
            } catch (err) { 
                UI.addLog("SYSTEM EVALUATION FAILED!", "var(--term-red)"); 
            } finally { 
                document.getElementById('thinking-indicator')?.remove(); 
                isProcessing = false; 
            }
        }
    });
}

setInterval(() => { 
    const timeEl = document.getElementById('time-display');
    if(timeEl) timeEl.innerText = `T+${new Date().toLocaleTimeString([], {hour12:false})}`; 
}, 1000);