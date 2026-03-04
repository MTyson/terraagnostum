// js/intentRouter.js
import { sendSignInLinkToEmail, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { auth, db, appId, isSyncEnabled } from './firebaseConfig.js';
import * as stateManager from './stateManager.js';
import * as syncEngine from './syncEngine.js';
import * as UI from './ui.js';
import { handleGMIntent } from './gmEngine.js';
import { startWizard } from './wizardSystem.js';
import { triggerVisualUpdate, togglePinView } from './visualSystem.js';
import { callGemini } from './apiService.js';
import { isArchiveRoom } from './mapData.js';

// --- HELPER WRAPPERS (Local to Router) ---

function getActiveMap() {
    return stateManager.getActiveMap();
}

function getUserTier() {
    return stateManager.getUserTier();
}

function shiftStratum(targetStratum) {
    const { localPlayer } = stateManager.getState();
    const isTransitioningToFaen = targetStratum === 'faen' && localPlayer.stratum !== 'faen';
    UI.applyStratumTheme(targetStratum, isTransitioningToFaen);
    stateManager.updatePlayer({ stratum: targetStratum });
}

// --- NARRATIVE MOVEMENT ENGINE ---
export async function executeMovement(targetDir) {
    const state = stateManager.getState();
    const { localPlayer, astralMap, apartmentMap, user, activeAvatar } = state;

    if (localPlayer.combat.active) {
        UI.addLog(`[SYSTEM]: You cannot disengage while in combat with ${localPlayer.combat.opponent}!`, "var(--term-red)");
        return;
    }
    const activeMap = getActiveMap();
    const currentRoom = activeMap[localPlayer.currentRoom];
    
    if (!currentRoom && !isArchiveRoom(localPlayer.currentRoom)) {
        UI.addLog('[SYSTEM]: Dimensional synchronization in progress. Please wait for the sector to stabilize.', 'var(--term-amber)');
        return;
    }
    
    if (localPlayer.stratum === 'astral') {
        const currentMap = (localPlayer.currentRoom.startsWith('astral_')) ? astralMap : apartmentMap;
        const currentRoomData = currentMap[localPlayer.currentRoom];
        
        if (currentRoomData.exits && currentRoomData.exits[targetDir]) {
            const nextId = typeof currentRoomData.exits[targetDir] === 'string' ? currentRoomData.exits[targetDir] : currentRoomData.exits[targetDir].target;
            
            stateManager.updatePlayer({ currentRoom: nextId });
            syncEngine.savePlayerState();
            const updatedActiveMap = getActiveMap();
            const nextRoom = updatedActiveMap[nextId];
            UI.addLog(`[SYSTEM]: You traverse the astral currents to ${nextRoom.name}.`, "var(--term-green)");
            UI.printRoomDescription(nextRoom, true, updatedActiveMap, activeAvatar);
            triggerVisualUpdate(null, stateManager.getState().localPlayer, updatedActiveMap, user);
            return;
        }

        // No exit exists yet, start the generation sequence
        startWizard('astral_voyage', { direction: targetDir, fromId: localPlayer.currentRoom });
        UI.setWizardPrompt("ASTRAL@VOYAGE:~$");
        UI.addLog(`[SYSTEM]: You move ${targetDir.toUpperCase()} into the kaleidoscopic void.`, "var(--term-green)");
        UI.addLog(`[WIZARD]: As the colors shift and reality warps, what do you see manifesting before you? (Describe the next sector)`, "var(--term-amber)");
        return;
    }
    
    if (currentRoom.exits && currentRoom.exits[targetDir]) {
        const exitData = currentRoom.exits[targetDir];

        if (typeof exitData === 'object' && exitData.locked) {
            UI.addLog(`[BLOCKED]: ${exitData.lockMsg || 'The path is barred.'}`, "var(--term-amber)");
            return; 
        }

        const nextRoomKey = typeof exitData === 'string' ? exitData : exitData.target;
        
        // --- QUEST LOCK: FRONT DOOR ---
        if (localPlayer.currentRoom === 'hallway' && targetDir === 'south' && nextRoomKey === 'outside') {
            const currentRoomData = activeMap[localPlayer.currentRoom];
            
            // Check if it's already unlocked (allowing for string or object exit types)
            const isLocked = typeof currentRoomData.exits.south === 'object' && currentRoomData.exits.south.locked;
            
            if (!isLocked) {
                // Already open, proceed normally
            } else {
                const keyIdx = localPlayer.inventory.findIndex(i => i.name === "Resonant Key");
                if (keyIdx === -1) {
                    UI.addLog("[BLOCKED]: The front door is locked with a quantum seal. It requires a 'Resonant Key' to open.", "var(--term-amber)");
                    UI.addLog("[TANDY]: You'll need to go to the closet and tune the generator to the Astral Plane to synthesize a key.", "#b084e8");
                    return;
                } else {
                    UI.addLog("[SUCCESS]: You press the Resonant Key against the seal. It vibrates, then dissolves into light as the door unlatches.", "var(--term-green)");
                    
                    // 1. Update Firestore so the door stays open for this user
                    syncEngine.updateMapNode('hallway', { 
                        exits: { ...currentRoomData.exits, south: { target: 'outside', locked: false } } 
                    });

                    // 2. Remove the key and save player state
                    const newInv = [...localPlayer.inventory];
                    newInv.splice(keyIdx, 1);
                    stateManager.updatePlayer({ inventory: newInv });
                    syncEngine.savePlayerState();
                }
            }
        }

        const tier = getUserTier();
        if ((tier === "VOID" || tier === "GUEST") && !isArchiveRoom(nextRoomKey)) {
            UI.addLog(`[TANDY]: You cannot leave the Archive yet. Your vessel will evaporate. Go to the Tandem Terminal in the Lore Room and type 'login'.`, "#b084e8");
            return;
        }

        stateManager.updatePlayer({ currentRoom: nextRoomKey });
        syncEngine.savePlayerState(); 
        
        // Give the syncEngine a moment to swap listeners and populate the new map
        setTimeout(() => {
            const updatedActiveMap = getActiveMap();
            const nextRoom = updatedActiveMap[nextRoomKey];
            UI.addLog(`[SYSTEM]: You move ${targetDir.toUpperCase()}.`, "var(--term-green)");
            UI.printRoomDescription(nextRoom, stateManager.getState().localPlayer.stratum === 'astral', updatedActiveMap, activeAvatar);
            syncEngine.logManifestation(stateManager.getState().localPlayer.currentRoom, `User arrived from the ${targetDir}.`);
            triggerVisualUpdate(null, stateManager.getState().localPlayer, updatedActiveMap, user);
        }, 100);
    } else {
        UI.addLog(`[SYSTEM]: You cannot go that way.`, "var(--term-amber)");
        triggerVisualUpdate(null, localPlayer, getActiveMap(), user);
    }
}

// --- COMMAND PARSER ---
export async function handleCommand(val) {
    const state = stateManager.getState();
    const { localPlayer, activeAvatar, user, activeTerminal, localCharacters, apartmentMap } = state;
    const cmd = val.toLowerCase();

    // INTERCEPT AI SUGGESTION REQUEST
    if (cmd === '💡 suggest' || cmd === 'suggest') {
        UI.renderContextualCommands(['Thinking...']);
        try {
            const activeMap = getActiveMap();
            const suggestions = await handleGMIntent(
                "Provide context-sensitive suggestions.",
                { activeMap, localPlayer, user, activeAvatar, isSyncEnabled: true, appId: 'ignored' },
                { 
                    shiftStratum, 
                    savePlayerState: syncEngine.savePlayerState, 
                    refreshStatusUI: () => {}, 
                    renderMapHUD: UI.renderMapHUD,
                    setActiveAvatar: stateManager.setActiveAvatar,
                    syncAvatarStats: () => syncEngine.syncAvatarStats(stateManager.getState().activeAvatar?.id, stateManager.getState().activeAvatar?.stats),
                    updateMapListener: () => syncEngine.updateMapListener(stateManager.getState().user)
                },
                true // IS SILENT
            );
            stateManager.setSuggestions(suggestions);
        } catch (e) {
            console.error("AI Suggestion failed:", e);
            stateManager.setSuggestions([]);
        }
        return;
    }

    if (cmd === 'logout') {
        UI.addLog("[SYSTEM]: Severing connection to the Technate...", "var(--term-amber)");
        signOut(auth).then(() => window.location.href = window.location.pathname);
        return;
    }

    if (cmd === 'architect') {
        // Toggle local state
        stateManager.updatePlayer({ isArchitect: !localPlayer.isArchitect });
        
        // PERSIST the change to Firestore immediately
        syncEngine.savePlayerState(); 
        
        UI.addLog(`[SYSTEM]: Architect flag: ${stateManager.getState().localPlayer.isArchitect ? 'ENABLED' : 'DISABLED'}`, "var(--term-amber)");
        return;
    }

    if (cmd === 'become architect' || cmd === 'upgrade') {
        if (!user || user.isAnonymous) {
            UI.addLog("[SYSTEM]: You must 'login' with a verified frequency (email) before acquiring an Architect license.", "var(--term-red)");
            return;
        }
        if (localPlayer.isArchitect) {
            UI.addLog("[SYSTEM]: You are already bound as an ARCHITECT.", "var(--term-amber)");
            return;
        }
        // PROD STRIPE:
        //const paymentLink = `https://buy.stripe.com/dRmfZh0Cq0Jm5v31wpg3600?client_reference_id=${user.uid}`;
        // TEST STRIPE:
        //const paymentLink = `https://buy.stripe.com/test_7sY4gA5DC6U09JL7dd6kg00?client_reference_id=${user.uid}`;
        // A simple way to swap links based on where the game is running
    const isLocal = window.location.hostname === 'localhost';
    const liveLink = "https://buy.stripe.com/dRmfZh0Cq0Jm5v31wpg3600";
    const testLink = "https://buy.stripe.com/test_7sY4gA5DC6U09JL7dd6kg00";

    const paymentLink = `${isLocal ? testLink : liveLink}?client_reference_id=${user.uid}`;
        
        
        window.open(paymentLink, '_blank');
        UI.addLog(`[SYSTEM]: Architect uplink opened in a new tab. Awaiting transaction...`, "var(--term-green)");
        UI.addLog(`[SYSTEM]: Do not close this terminal. Your status will update automatically upon verification.`, "#888");
        return;
    }

    if (cmd.startsWith('"') || cmd.startsWith("'") || cmd.startsWith("say ")) {
        const speech = val.replace(/^say\s+/i, '').replace(/^["']|["']$/g, '');
        UI.addLog(`[YOU SAY]: "${speech}"`, "#ffffff");
        return;
    }

    if (cmd.match(/^(use|access|hack)\s+(terminal|tandem|console)/)) {
        if (localPlayer.currentRoom === 'lore1') {
            stateManager.setTerminal(true);
            UI.addLog("[SYSTEM]: TANDEM INTERFACE ACTIVE. TYPE 'login' TO BIND SIGNATURE OR 'exit' TO DISCONNECT.", "var(--term-green)");
            return;
        }
    }

    if (activeTerminal) {
        if (cmd === 'exit' || cmd === 'leave' || cmd === 'disconnect') {
            stateManager.setTerminal(false);
            UI.addLog("[SYSTEM]: TANDEM INTERFACE DISCONNECTED.", "var(--term-amber)");
            return;
        }
        if (cmd === 'login') {
            if (getUserTier() === "ENTITY" || getUserTier() === "ARCHITECT") {
                UI.addLog("[SYSTEM]: You are already bound to the Technate.", "var(--term-amber)");
                return;
            }
            startWizard('login');
            if (localPlayer.currentRoom === 'lore1') {
                stateManager.setTerminal(true);
                UI.addLog("[TANDY]: To anchor this vessel permanently, the Technate requires a frequency signature. An email address will do.", "#b084e8");
            } else {
                UI.addLog("[SYSTEM]: INITIATING REMOTE LOGIN. Enter your email address:", "var(--term-green)");
            }
            return;
        }
        UI.addLog("[TANDEM]: Unknown command. Type 'login' or 'exit'.", "var(--term-amber)");
        return;
    }

    if (cmd === 'login') {
        if (getUserTier() === "ENTITY" || getUserTier() === "ARCHITECT") {
            UI.addLog("[SYSTEM]: You are already bound to the Technate.", "var(--term-amber)");
            return;
        }
        startWizard('login');
        if (localPlayer.currentRoom === 'lore1') {
            stateManager.setTerminal(true);
            UI.addLog("[TANDY]: To anchor this vessel permanently, the Technate requires a frequency signature. An email address will do.", "#b084e8");
        } else {
            UI.addLog("[SYSTEM]: INITIATING REMOTE LOGIN. Enter your email address:", "var(--term-green)");
        }
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
        stateManager.setActiveAvatar(localCharacters[num - 1]);
        UI.addLog(`[SYSTEM]: Consciousness transferred to ${stateManager.getState().activeAvatar.name}.`, "var(--term-green)");
        return;
    }

    if (localPlayer.currentRoom === 'closet') {
        if (cmd === 'investigate') {
            UI.addLog("[NARRATOR]: An exotic Hacked Schumann Generator sits in the center of the room. Its quantum field is destabilized.", "#888");
            if (!localPlayer.closetDoorClosed) {
                UI.addLog("[TANDY]: The energy is bleeding out into the hallway. You'll need to 'close the door' to isolate the quantum field.", "#b084e8");
            } else {
                UI.addLog("[TANDY]: The field is isolated. You can 'use the generator' now.", "#b084e8");
            }
            return;
        }

        if (cmd === 'close door' || cmd === 'shut door') {
            stateManager.updatePlayer({ closetDoorClosed: true });
            UI.addLog("[NARRATOR]: You pull the heavy door shut. The hum of the metal crate amplifies, vibrating in your teeth.", "#888");
            syncEngine.savePlayerState();
            return;
        }

        if (cmd === 'open door') {
            stateManager.updatePlayer({ closetDoorClosed: false });
            UI.addLog("[NARRATOR]: You open the door, letting the stale air of the hallway back in.", "#888");
            syncEngine.savePlayerState();
            return;
        }

        if (cmd.match(/^(use|tune|activate|turn on|engage|start)\s+(resonator|generator|machine|box|device)/) || cmd === 'use generator') {
            if (!activeAvatar) {
                UI.addLog("[SYSTEM]: Your phantom hands pass right through the controls. You lack the physical cohesion to engage the machine.", "var(--term-red)");
                return;
            }
            if (!localPlayer.closetDoorClosed) {
                UI.addLog("[SYSTEM]: The machine whirs to life, but its energy bleeds out the open door. The Schrödinger state cannot be achieved.", "var(--term-amber)");
                return;
            }

            UI.addLog("[SYSTEM]: RESONANCE ACHIEVED. QUANTUM STATE COLLAPSING...", "var(--term-green)");
            shiftStratum('astral');
            
            // Initialize Astral Map
            const entryId = 'astral_entry';
            const newAstralMap = {
                [entryId]: {
                    name: "Astral Nexus", shortName: "NEXUS",
                    description: "A mind-bending cosmic nexus where reality dissolves into abstract patterns. The space is a swirl of neon static and half-formed memories.",
                    visualPrompt: "Strange non-euclidean geometries, swirling lightforms of neon purple and gold, a mind-bending cosmic nexus.",
                    exits: {}, pinnedView: null, items: [], marginalia: [], npcs: []
                }
            };
            stateManager.setAstralMap(newAstralMap);
            stateManager.updatePlayer({ currentRoom: entryId });
            const activeMap = getActiveMap();

            UI.addLog("[NARRATOR]: The walls of the closet dissolve into raw, static data. You are pulled into the Astral Plane.", "#888");
            UI.addLog("[TANDY]: You're in. The Astral Plane is a reflection of your intent. To escape the apartment, you must find a way to synthesize a Resonant Key here.", "#b084e8");
            
            UI.printRoomDescription(activeMap[entryId], true, activeMap, activeAvatar);
            await triggerVisualUpdate(activeMap[entryId].visualPrompt, stateManager.getState().localPlayer, activeMap, user);

            // Let the AI take initiative
            await handleGMIntent("Describe the strange astral nexus and present an initial challenge to gain the Resonant Key.", 
                { activeMap: newAstralMap, localPlayer: stateManager.getState().localPlayer, user, activeAvatar, isSyncEnabled: true, appId: 'ignored' },
                { shiftStratum, savePlayerState: syncEngine.savePlayerState, refreshStatusUI: () => {}, renderMapHUD: UI.renderMapHUD, setActiveAvatar: stateManager.setActiveAvatar, syncAvatarStats: () => syncEngine.syncAvatarStats(stateManager.getState().activeAvatar?.id, stateManager.getState().activeAvatar?.stats) }
            );
            return;
        }
    }

    // --- AUTH & IDENTITY COMMANDS ---
    if (cmd === 'whoami') {
        const tier = getUserTier();
        const cohesion = !activeAvatar ? 'Fading Ripple' : 'Materialized Signature';
        const uid = user ? user.uid.substring(0,8) : 'UNKNOWN';
        const emailLine = (user && user.email) ? ` | Frequency: ${user.email}` : '';
        UI.addLog(`[SYSTEM]: Identity: ${tier}${emailLine} | UID: ${uid}`, "var(--term-green)");
        UI.addLog(`[SYSTEM]: Cohesion State: ${cohesion}`, "var(--term-green)");
        return;
    }

    const authMatch = cmd.match(/^(?:register|log in|login)\s+(.+@.+\..+)$/i);
    if (authMatch) {
        const email = authMatch[1].trim();
        UI.addLog(`[SYSTEM]: Initiating secure handshake for ${email}...`, "var(--term-amber)");
        const actionCodeSettings = { url: window.location.href.split('?')[0], handleCodeInApp: true };
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
        
        const activeMap = getActiveMap();
        if (!finalDir || !activeMap[localPlayer.currentRoom].exits || !activeMap[localPlayer.currentRoom].exits[finalDir]) {
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
        const room = getActiveMap()[localPlayer.currentRoom];
        const npcs = room.npcs || [];

        const npcIndex = npcs.findIndex(n => n.name.toLowerCase().includes(targetName));

        if (npcIndex > -1) {
            const npc = npcs[npcIndex];

            npcs.splice(npcIndex, 1);
            syncEngine.removeArrayElementFromNode(localPlayer.currentRoom, 'npcs', npc);

            const newCharData = {
                name: npc.name,
                archetype: npc.archetype || "Unknown",
                visual_prompt: npc.visual_prompt || npc.visualPrompt || "A borrowed form.",
                image: npc.image || null,
                stats: npc.stats || { WILL: 20, CONS: 20, PHYS: 20 },
                deceased: false, deployed: false, timestamp: Date.now()
            };

            UI.addLog(`[SYSTEM]: You have assumed control of [${npc.name}].`, "var(--term-green)");

            if (user && !user.isAnonymous) {
                syncEngine.createCharacter(newCharData).then(id => {
                    newCharData.id = id;
                    stateManager.setActiveAvatar(newCharData);
                    const { localCharacters } = stateManager.getState();
                    stateManager.setLocalCharacters([...localCharacters, newCharData]);
                });
            } else {
                stateManager.setActiveAvatar(newCharData);
                const { localCharacters } = stateManager.getState();
                stateManager.setLocalCharacters([...localCharacters, newCharData]);
            }
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
        
        const dirRaw = parts.find(p => ['north', 'south', 'east', 'west', 'n', 's', 'e', 'w'].includes(p));
        const expandMap = { 'n': 'north', 's': 'south', 'e': 'east', 'w': 'west' };
        let finalDir = expandMap[dirRaw] || dirRaw;
        
        if (!finalDir) { 
            if (isAuto && parts.length === 2) {
                finalDir = 'here'; 
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
        const activeMap = getActiveMap();
        const currentRoomData = activeMap[localPlayer.currentRoom];
        stateManager.setProcessing(true);
        UI.addLog(`<span id="thinking-indicator" class="italic" style="color: var(--gm-purple)">COLLAPSING PROBABILITY FIELDS...</span>`);
        try {
            const sysPrompt = `You are the Architect of Terra Agnostum. Generate a thematic room definition based on the current stratum: ${localPlayer.stratum.toUpperCase()}. The current context is: ${currentRoomData.name} - ${currentRoomData.description}. Respond STRICTLY in JSON: {"name": "Evocative Name", "description": "Atmospheric narrative description", "visual_prompt": "Detailed prompt for image generation"}`;
            const res = await callGemini("Generate a full room definition.", sysPrompt);
            if (res && res.name && res.description) {
                const updates = {
                    name: res.name,
                    shortName: res.name.substring(0, 7).toUpperCase(),
                    description: res.description,
                    visualPrompt: res.visual_prompt,
                    pinnedView: null
                };
                stateManager.updateMapNode(localPlayer.currentRoom.startsWith('astral_') ? 'astral' : 'apartment', localPlayer.currentRoom, updates);
                syncEngine.updateMapNode(localPlayer.currentRoom, updates);
                
                UI.addLog(`[SYSTEM]: Sector successfully rendered.`, "var(--term-green)");
                UI.printRoomDescription(stateManager.getState().apartmentMap[localPlayer.currentRoom], localPlayer.stratum === 'astral', activeMap, activeAvatar);
                triggerVisualUpdate(res.visual_prompt, stateManager.getState().localPlayer, activeMap, user);
            }
        } catch (err) {
            UI.addLog("[SYSTEM ERROR]: Reality collapse failed.", "var(--term-red)");
        } finally {
            document.getElementById('thinking-indicator')?.remove();
            stateManager.setProcessing(false);
        }
        return;
    } else if (cmd === 'pin' || cmd === 'pin view') {
        const activeMap = getActiveMap();
        if (!activeMap[localPlayer.currentRoom].pinnedView) togglePinView(localPlayer, activeMap, user);
        else UI.addLog("[SYSTEM]: View is already pinned. Use 'unpin' to clear.", "var(--term-amber)");
        return;
    } else if (cmd === 'unpin' || cmd === 'unpin view') {
        const activeMap = getActiveMap();
        if (activeMap[localPlayer.currentRoom].pinnedView) togglePinView(localPlayer, activeMap, user);
        else UI.addLog("[SYSTEM]: View is not pinned.", "var(--term-amber)");
        return;
    } else if (cmd === 'look' || cmd === 'l') {
        const activeMap = getActiveMap();
        UI.printRoomDescription(activeMap[localPlayer.currentRoom], localPlayer.stratum === 'astral', activeMap, activeAvatar); 
        triggerVisualUpdate(null, localPlayer, activeMap, user); return;
    } else if (cmd === 'stat' || cmd === 'stats') {
        if (!activeAvatar) return;
        UI.addLog(`IDENTITY: ${activeAvatar.name} | CLASS: ${activeAvatar.archetype}`, "var(--term-green)");
        UI.addLog(`WILL: ${activeAvatar.stats.WILL} | CONS: ${activeAvatar.stats.CONS} | PHYS: ${activeAvatar.stats.PHYS}`, "var(--term-amber)");
        return;
    } else if (cmd === 'map') {
        UI.addLog(`[SYSTEM]: Topology map live on HUD.`, "var(--term-green)"); return;
    } else if (cmd.startsWith('take ') || cmd.startsWith('get ') || cmd.startsWith('pick up ')) {
        const itemName = cmd.replace(/^(take|get|pick up)\s+/, '').toLowerCase();
        const activeMap = getActiveMap();
        const room = activeMap[localPlayer.currentRoom];
        const itemIdx = (room.items || []).findIndex(i => i.name.toLowerCase().includes(itemName));
        if (itemIdx > -1) {
            const items = [...room.items];
            const item = items.splice(itemIdx, 1)[0];
            const inventory = [...localPlayer.inventory, item];
            stateManager.updateMapNode(localPlayer.currentRoom.startsWith('astral_') ? 'astral' : 'apartment', localPlayer.currentRoom, { items });
            stateManager.updatePlayer({ inventory });
            syncEngine.removeArrayElementFromNode(localPlayer.currentRoom, 'items', item);
            syncEngine.savePlayerState(); 
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
    stateManager.setProcessing(true);
    try {
        const suggestions = await handleGMIntent(
            val,
            { 
                get activeMap() { return getActiveMap(); }, 
                localPlayer, user, activeAvatar, isSyncEnabled: true, appId: 'ignored' 
            },
            { 
                shiftStratum, 
                savePlayerState: syncEngine.savePlayerState, 
                refreshStatusUI: () => {}, 
                renderMapHUD: UI.renderMapHUD,
                setActiveAvatar: stateManager.setActiveAvatar,
                syncAvatarStats: () => syncEngine.syncAvatarStats(stateManager.getState().activeAvatar?.id, stateManager.getState().activeAvatar?.stats),
                updateMapListener: () => syncEngine.updateMapListener(stateManager.getState().user)
            }
        );
        stateManager.setSuggestions(suggestions);
    } finally { 
        stateManager.setProcessing(false); 
    }
}
