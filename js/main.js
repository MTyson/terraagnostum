import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, isSignInWithEmailLink, signInWithEmailLink } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, onSnapshot, updateDoc, arrayUnion, arrayRemove, serverTimestamp, collection, addDoc, getDocs } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getStorage, ref, uploadString, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

// IMPORT DECOMPOSED DATA & SERVICES
import { apartmentMap as initialMap } from './mapData.js';
import { callGemini, projectVisual, compressImage } from './apiService.js';
import * as UI from './ui.js';

const firebaseConfig = {
    apiKey: "AIzaSyDtWZdtC-IeKDVyFqcwuqa_tn0hoH91dtc",
    authDomain: "terra-agnostum.firebaseapp.com",
    projectId: "terra-agnostum",
    storageBucket: "terra-agnostum.firebasestorage.app",
    messagingSenderId: "809154092201",
    appId: "1:809154092201:web:95aaddd47c6ce021cf1db8"
};

const appId = 'terra-agnostum-shared';

let app, auth, db, storage;
let isSyncEnabled = false;

try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    storage = getStorage(app);
    isSyncEnabled = true;
    document.getElementById('sync-status').innerText = "SYNC: READY";
    document.getElementById('sync-status').style.color = "var(--term-amber)";
} catch (e) {
    document.getElementById('sync-status').innerText = "SYNC: OFFLINE";
}

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
            UI.printRoomDescription(apartmentMap[localPlayer.currentRoom], localPlayer.stratum === 'faen');
            refreshAllUI();
            
            triggerVisualUpdate(apartmentMap[localPlayer.currentRoom]?.visualPrompt || apartmentMap["lore1"].visualPrompt);
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
    
    UI.togglePinButton(false);
    currentBase64 = null;
    
    const pinnedUrl = (!overridePrompt && room.pinnedView) ? room.pinnedView : null;
    const basePrompt = overridePrompt || room.visualPrompt || "A glitching void.";
    
    currentBase64 = await projectVisual(basePrompt, localPlayer.stratum, UI.addLog, pinnedUrl);
    
    if (currentBase64 && user && !user.isAnonymous) {
        UI.togglePinButton(true, "PIN VIEW");
    }
}

export async function pinCurrentView() {
    if (!currentBase64 || !user || user.isAnonymous) return;
    const roomId = localPlayer.currentRoom;
    
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
        UI.addLog(`[SYSTEM]: Consensus reality locked. The visual projection of ${apartmentMap[roomId].name} is now canonical.`, "var(--gm-purple)");
        
        setTimeout(() => { UI.togglePinButton(false); }, 2000);
    } catch (e) {
        console.error("Pinning error:", e);
        UI.togglePinButton(true, "ERROR", "normal");
        UI.addLog(`[SYSTEM ERROR]: Failed to anchor memory to the cloud.`, "var(--term-red)");
    }
}

document.getElementById('pin-view-btn').addEventListener('click', pinCurrentView);

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
        UI.printRoomDescription(apartmentMap[nextId], true);
        triggerVisualUpdate();
        return;
    }
    
    if (currentRoom.exits && currentRoom.exits[targetDir]) {
        const nextRoomKey = currentRoom.exits[targetDir];
        localPlayer.currentRoom = nextRoomKey;
        const nextRoom = apartmentMap[nextRoomKey];
        
        savePlayerState(); 
        refreshAllUI();
        
        UI.addLog(`[SYSTEM]: You move ${targetDir.toUpperCase()}.`, "var(--term-green)");
        UI.printRoomDescription(nextRoom, false);
        triggerVisualUpdate(nextRoom.visualPrompt);
        
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
            UI.addLog(`Current VISUAL PROMPT: "${wizardState.existingData.visualPrompt}"`, "var(--crayola-blue)");
            UI.addLog(`Enter new VISUAL PROMPT (or press Enter to keep current):`, "var(--term-amber)");
            wizardState.step++;
        } else if (wizardState.step === 3) {
            wizardState.pendingData.visualPrompt = val || wizardState.existingData.visualPrompt;
            const rKey = localPlayer.currentRoom;
            
            apartmentMap[rKey].name = wizardState.pendingData.name;
            apartmentMap[rKey].shortName = wizardState.pendingData.name.substring(0, 7).toUpperCase();
            apartmentMap[rKey].description = wizardState.pendingData.description;
            apartmentMap[rKey].visualPrompt = wizardState.pendingData.visualPrompt;
            
            if (isSyncEnabled) {
                const mapRef = doc(db, 'artifacts', appId, 'public', 'data', 'maps', 'apartment_graph_live');
                updateDoc(mapRef, {
                    [`nodes.${rKey}.name`]: wizardState.pendingData.name,
                    [`nodes.${rKey}.shortName`]: apartmentMap[rKey].shortName,
                    [`nodes.${rKey}.description`]: wizardState.pendingData.description,
                    [`nodes.${rKey}.visualPrompt`]: wizardState.pendingData.visualPrompt
                });
            }
            
            UI.addLog(`[SYSTEM]: Sector successfully re-rendered.`, "var(--term-green)");
            UI.printRoomDescription(apartmentMap[rKey], localPlayer.stratum === 'faen');
            triggerVisualUpdate(apartmentMap[rKey].visualPrompt);
            
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
}

// --- COMMAND PARSER ---
let isProcessing = false;
const input = document.getElementById('cmd-input');

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

        if (!activeAvatar && !cmd.startsWith('help') && !cmd.startsWith('create avatar')) {
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
            UI.addLog(`[WIZARD]: Sector Overwrite Protocol Started. Enter new NAME:`);
            return;
        } else if (cmd.startsWith('build ')) {
            if (!activeAvatar) { UI.addLog("[SYSTEM]: Voids cannot expand space.", "var(--term-red)"); return; }
            const dir = cmd.split(' ')[1];
            if (!['north', 'south', 'east', 'west'].includes(dir)) { UI.addLog(`Use 'build north/south/east/west'.`, "var(--term-amber)"); return; }
            wizardState = { active: true, type: 'expand', step: 1, pendingData: { direction: dir }, existingData: {} };
            UI.setWizardPrompt("WIZARD@EXPAND:~$");
            UI.addLog(`[WIZARD]: Expansion Protocol Started. Enter NAME for new room:`, "var(--term-amber)");
            return;
        } else if (cmd === 'look' || cmd === 'l') {
            UI.printRoomDescription(apartmentMap[localPlayer.currentRoom], localPlayer.stratum === 'faen'); 
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
            UI.addLog("HELP // Commands: LOOK, N/S/E/W, CREATE AVATAR, LEAVE VESSEL, CREATE ITEM, EDIT ROOM, BUILD [DIR], INV, MAP, STAT.", "var(--term-amber)");
            return;
        }

        // --- THE UNIVERSAL GM INTENT ENGINE ---
        isProcessing = true;
        UI.addLog(`<span id="thinking-indicator" class="italic" style="color: var(--gm-purple)">EVALUATING INTENT...</span>`);
        
        try {
            const currentRoomData = apartmentMap[localPlayer.currentRoom];
            const inventoryNames = localPlayer.inventory.map(i => i.name).join(', ');
            const npcText = (currentRoomData.npcs || []).map(n => `[NPC] ${n.name} - Personality: ${n.personality}`).join('\n') || "None";
            
            const sysPrompt = `You are Tandy, the GM of Terra Agnostum. 
            Context: ${currentRoomData.name} (${localPlayer.stratum.toUpperCase()}). ${currentRoomData.description}.
            Entities: ${npcText}. Inventory: ${inventoryNames}.
            IMPORTANT: A 'faen_jump' can ONLY happen if the user is in 'Schrödinger's Closet' (CLOSET) or explicitly uses specific 'Aethal' code.
            IMPORTANT: Only use 'trigger_teleport' for magical/forced warping, NEVER for standard movement.
            Respond STRICTLY in JSON:
            {
              "speaker": "NARRATOR or NPC Name",
              "narrative": "outcome",
              "color": "hex",
              "trigger_visual": "prompt or null",
              "faen_jump": boolean,
              "trigger_stratum_shift": null or 'mundane', 'faen', 'technate',
              "trigger_teleport": null or { "new_room_id": "id", "name": "Name", "description": "Desc", "visual_prompt": "Prompt" },
              "world_edit": null or {"type": "add_marginalia", "text": "text"},
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
            
            if (res.world_edit && res.world_edit.type === 'add_marginalia') {
                const room = apartmentMap[localPlayer.currentRoom];
                if (!room.marginalia) room.marginalia = [];
                room.marginalia.push(res.world_edit.text);
                if (isSyncEnabled) updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'maps', 'apartment_graph_live'), { [`nodes.${localPlayer.currentRoom}.marginalia`]: arrayUnion(res.world_edit.text) });
            }
            
            if (res.trigger_visual && !res.trigger_respawn && !res.trigger_teleport) {
                triggerVisualUpdate(res.trigger_visual);
            } else if (res.trigger_stratum_shift || res.trigger_teleport || res.faen_jump) {
                triggerVisualUpdate();
            }
        } catch (err) { 
            UI.addLog("SYSTEM EVALUATION FAILED!", "var(--term-red)"); 
        } finally { 
            document.getElementById('thinking-indicator')?.remove(); 
            isProcessing = false; 
        }
    }
});

setInterval(() => { 
    const timeEl = document.getElementById('time-display');
    if(timeEl) timeEl.innerText = `T+${new Date().toLocaleTimeString([], {hour12:false})}`; 
}, 1000);