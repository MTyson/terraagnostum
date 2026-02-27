import { doc, updateDoc, arrayUnion, addDoc, collection } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { callGemini, compressImage, generatePortrait } from './apiService.js';
import { triggerVisualUpdate } from './visualSystem.js';
import * as UI from './ui.js';
import { db, appId, isSyncEnabled } from './firebaseConfig.js';

export const wizardState = {
    active: false,
    type: null,
    step: 0,
    pendingData: {},
    existingData: {}
};

export function resetWizard() {
    wizardState.active = false;
    wizardState.type = null;
    wizardState.step = 0;
    wizardState.pendingData = {};
    wizardState.existingData = {};
}

export function startWizard(type, existingData = {}) {
    wizardState.active = true;
    wizardState.type = type;
    wizardState.step = 1;
    wizardState.pendingData = {};
    wizardState.existingData = existingData;
}

export function handleWizardInput(val, state, actions) {
    const { apartmentMap, localPlayer, user, activeAvatar } = state;
    const { 
        refreshCommandPrompt, 
        refreshStatusUI, 
        setActiveAvatar, 
        addLocalCharacter,
        setIsProcessing 
    } = actions;

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
            resetWizard();
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
            triggerVisualUpdate(apartmentMap[rKey].visualPrompt, localPlayer, apartmentMap, user); // Force regeneration with new prompt
            
            refreshStatusUI();
            UI.renderMapHUD(apartmentMap, rKey, localPlayer.stratum);
            refreshCommandPrompt();
            resetWizard();
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
            resetWizard();
        }
    }
    else if (wizardState.type === 'auto_expand') {
        if (wizardState.step === 1) {
            const seedPhrase = val || "An undefined anomaly.";
            const dir = wizardState.pendingData.direction;
            const currentRoomKey = localPlayer.currentRoom;
            const currentRoom = apartmentMap[currentRoomKey];
            
            setIsProcessing(true);
            resetWizard();
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
                            triggerVisualUpdate(apartmentMap[currentRoomKey].visualPrompt, localPlayer, apartmentMap, user);
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
                    setIsProcessing(false);
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
            resetWizard();
            refreshCommandPrompt();

            (async () => {
                let cardImageSrc = "";
                let compressedImageSrc = "";
                try {
                    const b64 = await generatePortrait(charData.visual_prompt, localPlayer.stratum);
                    if (b64) {
                        cardImageSrc = `data:image/png;base64,${b64}`;
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
                addLocalCharacter(fullCharData);
                setActiveAvatar(fullCharData); 
                UI.updateAvatarUI(fullCharData); 
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
            
            setActiveAvatar(null);
            UI.updateAvatarUI(null);
            refreshCommandPrompt();
            UI.updateRoomEntitiesUI(room.npcs);
            resetWizard();
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
            resetWizard();

            // Generate portrait in background
            (async () => {
                try {
                    const b64 = await generatePortrait(newNPC.visual_prompt, localPlayer.stratum);
                    if (b64) {
                        const cardImageSrc = `data:image/png;base64,${b64}`;
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
            resetWizard();
        }
    }
}