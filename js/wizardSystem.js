import { callGemini, generatePortrait } from './apiService.js'; 
import * as UI from './ui.js';
import * as stateManager from './stateManager.js';
import * as syncEngine from './syncEngine.js';
import { triggerVisualUpdate } from './visualSystem.js';
import { handleGMIntent } from './gmEngine.js';

// State is now managed by stateManager.js
export function startWizard(type, initialData = {}) {
    stateManager.startWizard(type, initialData);
}

export function resetWizard() {
    stateManager.resetWizard();
}

// Built-in Compression Utility to prevent 1MB Firestore limits
async function compressImage(base64Str, maxWidth = 512, quality = 0.7) {
    return new Promise((resolve) => {
        if (!base64Str || !base64Str.startsWith('data:image')) return resolve(base64Str);
        const img = new Image();
        img.src = base64Str;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;
            if (width > maxWidth) {
                height = Math.round((height * maxWidth) / width);
                width = maxWidth;
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = () => resolve(base64Str);
    });
}

// The Core Handler (Now Context-Aware!)
export async function handleWizardInput(val, context = {}, callbacks = {}) {
    const wizardState = stateManager.getState().wizardState;
    let currentVal = val.trim();
    
    // Unpack the context
    const { activeMap, localPlayer, user, activeAvatar } = context;
    const { 
        updateMapListener, 
        setActiveAvatar, 
        addLocalCharacter, 
        shiftStratum, 
        savePlayerState, 
        handleGMIntent 
    } = callbacks;

    const endWizard = () => {
        resetWizard();
    };

    // 1. LOGIN WIZARD
    if (currentVal.toLowerCase() === 'exit wizard' || currentVal.toLowerCase() === 'cancel') {
        UI.addLog("[WIZARD]: Protocol terminated by user.", "var(--term-amber)");
        endWizard();
        return;
    }

    if (wizardState.type === 'login') {
        const email = currentVal;
        UI.addLog(`[SYSTEM]: Transmitting anchoring frequency to ${email}...`, "var(--term-amber)");
        const { auth } = await import('./firebaseConfig.js');
        const { sendSignInLinkToEmail } = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js");

        const actionCodeSettings = { url: window.location.href.split('?')[0], handleCodeInApp: true };
        try {
            await sendSignInLinkToEmail(auth, email, actionCodeSettings);
            window.localStorage.setItem('emailForSignIn', email);
            UI.addLog("[TANDY]: Pulse sent. Check your inbox to fuse your signature.", "#b084e8");
        } catch(e) { UI.addLog(`[ERROR]: ${e.message}`, "var(--term-red)"); }
        endWizard();
        return;
    }

    // 2. AVATAR WIZARD (With AI Assists & Compression)
    if (wizardState.type === 'avatar') {
        if (wizardState.step === 1) {
            if (!currentVal) {
                UI.addLog("[SYSTEM]: Querying Archive for designation...", "var(--term-amber)");
                const aiRes = await callGemini("Generate 1 cool cyberpunk name. Name only.");
                currentVal = aiRes.trim();
            }
            stateManager.updateWizardState({ pendingData: { ...wizardState.pendingData, name: currentVal }, step: 2 });
            UI.addLog(`[WIZARD]: Name confirmed: '${currentVal}'. Enter Archetype or press ENTER:`, "var(--term-amber)");
        } 
        else if (wizardState.step === 2) {
            if (!currentVal) {
                UI.addLog("[SYSTEM]: Querying Archive for archetype...", "var(--term-amber)");
                const aiRes = await callGemini(`Suggest a 1-word cyberpunk archetype for ${wizardState.pendingData.name}.`);
                currentVal = aiRes.replace(/["']/g, '').trim();
            }
            stateManager.updateWizardState({ pendingData: { ...wizardState.pendingData, archetype: currentVal }, step: 3 });
            UI.addLog(`[WIZARD]: Archetype logged. Press ENTER for an AI visual imprint:`, "var(--term-amber)");
        } 
        else if (wizardState.step === 3) {
            if (!currentVal) {
                UI.addLog("[SYSTEM]: Extrapolating visual imprint...", "var(--term-amber)");
                currentVal = await callGemini(`1-sentence visual description of ${wizardState.pendingData.name}, a ${wizardState.pendingData.archetype} in a cyberpunk world.`);
            }
            
            UI.addLog(`[SYSTEM]: Collapsing quantum state... Materializing vessel...`, "var(--gm-purple)");
            
            let finalImage = null;
            try {
                UI.addLog(`[SYSTEM]: Rendering vessel matrix...`, "var(--term-amber)");
                const b64 = await generatePortrait(currentVal, localPlayer.stratum);
                
                if (b64) {
                    UI.addLog(`[SYSTEM]: Optimizing visual signature for stability...`, "var(--term-amber)");
                    const dataUrl = `data:image/png;base64,${b64}`;
                    finalImage = await compressImage(dataUrl, 512, 0.7);
                }
            } catch(e) { 
                UI.addLog("[SYSTEM ERROR]: Render failed.", "var(--term-red)"); 
                console.error("Avatar render error:", e);
            }

            const finalData = {
                name: wizardState.pendingData.name,
                archetype: wizardState.pendingData.archetype,
                visual_prompt: currentVal,
                image: finalImage,
                stats: { WILL: 20, CONS: 20, PHYS: 20 },
                deceased: false, deployed: false, timestamp: Date.now()
            };

            const characterId = await syncEngine.createCharacter(finalData);
            if (characterId) {
                finalData.id = characterId;
                stateManager.setActiveAvatar(finalData);
                const { localCharacters } = stateManager.getState();
                stateManager.setLocalCharacters([...localCharacters, finalData]);
                UI.materializeEffect(); 
                UI.addLog(`[SYSTEM]: VESSEL COLLAPSE COMPLETE. YOU ARE REAL.`, "var(--term-green)");
                UI.addLog(`[TANDY]: You have a shape now. Good. But your signature is fragile... a stiff breeze could scatter you. Go to the Lore Archive and use the Tandem Terminal to 'login'. Anchor yourself.`, "#b084e8");
                
                if (!user || user.isAnonymous) {
                    localStorage.setItem('awaitingNewUserHint', 'true');
                }
                endWizard();
            } else {
                UI.addLog("[SYSTEM ERROR]: Failed to persist vessel.", "var(--term-red)");
                endWizard();
            }
        }
        return;
    }

    // === 3. RESTORED ARCHITECT COMMANDS ===
    if (wizardState.type === 'item') {
        if (!currentVal) return;
        const room = activeMap[localPlayer.currentRoom];
        const newItem = { name: currentVal, type: "Constructed Object" };
        const items = [...(room.items || []), newItem];
        stateManager.updateMapNode(localPlayer.currentRoom, { items });
        syncEngine.addArrayElementToNode(localPlayer.currentRoom, 'items', newItem);
        UI.addLog(`[SYSTEM]: Materialized [${currentVal}].`, "var(--term-green)");
        endWizard();
        return;
    }

    if (wizardState.type === 'room') {
        if (currentVal) {
            const updates = {
                name: currentVal,
                shortName: currentVal.substring(0, 7).toUpperCase()
            };
            stateManager.updateMapNode(localPlayer.currentRoom, updates);
            syncEngine.updateMapNode(localPlayer.currentRoom, updates);
            UI.addLog(`[SYSTEM]: Sector identity overwritten.`, "var(--term-green)");
        }
        endWizard();
        return;
    }

    if (wizardState.type === 'lock_exit') {
        if (!currentVal) return;
        const dir = wizardState.pendingData.direction;
        const room = activeMap[localPlayer.currentRoom];
        const target = typeof room.exits[dir] === 'string' ? room.exits[dir] : room.exits[dir].target;
        const exitUpdate = { target: target, locked: true, lockMsg: currentVal };
        const exits = { ...room.exits, [dir]: exitUpdate };
        stateManager.updateMapNode(localPlayer.currentRoom, { exits });
        syncEngine.updateMapNode(localPlayer.currentRoom, { [`exits.${dir}`]: exitUpdate });
        UI.addLog(`[SYSTEM]: Exit ${dir.toUpperCase()} locked.`, "var(--term-amber)");
        endWizard();
        return;
    }

    if (wizardState.type === 'expand') {
        if (!currentVal) return;
        const dir = wizardState.pendingData.direction;
        const newRoomId = 'room_' + crypto.randomUUID().split('-')[0];
        const getOpposite = (d) => ({'north':'south','south':'north','east':'west','west':'east'})[d] || 'out';
        
        const newRoom = {
            name: currentVal,
            shortName: currentVal.substring(0, 7).toUpperCase(),
            description: "A newly woven pocket of reality. It is waiting for definition.",
            visualPrompt: "An empty, newly constructed cyberpunk room, wireframe elements solidifying into reality.",
            exits: { [getOpposite(dir)]: localPlayer.currentRoom },
            items: [], npcs: []
        };
        
        stateManager.updateMapNode(newRoomId, newRoom);
        syncEngine.updateMapNode(newRoomId, newRoom);

        const currentExits = { ...activeMap[localPlayer.currentRoom].exits, [dir]: newRoomId };
        stateManager.updateMapNode(localPlayer.currentRoom, { exits: currentExits });
        syncEngine.updateMapNode(localPlayer.currentRoom, { [`exits.${dir}`]: newRoomId });

        UI.addLog(`[SYSTEM]: Reality expanded ${dir.toUpperCase()}.`, "var(--term-green)");
        endWizard();
        return;
    }

    if (wizardState.type === 'auto_expand') {
         if (!currentVal) return;
         const dir = wizardState.pendingData.direction;
         UI.addLog(`[SYSTEM]: Handing seed phrase to the AI Architect...`, "var(--gm-purple)");
         try {
             const prompt = `Generate a room definition based on this seed: "${currentVal}". Stratum: ${localPlayer.stratum}. Respond strictly in JSON: {"name":"...","description":"...","visual_prompt":"..."}`;
             const res = await callGemini("Generate room", prompt);
             if (res && res.name) {
                 const newRoomId = 'room_' + crypto.randomUUID().split('-')[0];
                 const getOpposite = (d) => ({'north':'south','south':'north','east':'west','west':'east'})[d] || 'out';
                 
                 const newRoom = {
                     name: res.name,
                     shortName: res.name.substring(0, 7).toUpperCase(),
                     description: res.description,
                     visualPrompt: res.visual_prompt,
                     exits: { [getOpposite(dir)]: localPlayer.currentRoom },
                     items: [], npcs: []
                 };
                 
                 stateManager.updateMapNode(newRoomId, newRoom);
                 syncEngine.updateMapNode(newRoomId, newRoom);

                 if (dir !== 'here') {
                    const currentExits = { ...activeMap[localPlayer.currentRoom].exits, [dir]: newRoomId };
                    stateManager.updateMapNode(localPlayer.currentRoom, { exits: currentExits });
                    syncEngine.updateMapNode(localPlayer.currentRoom, { [`exits.${dir}`]: newRoomId });
                 }
                 UI.addLog(`[SYSTEM]: Sector generated.`, "var(--term-green)");
             }
         } catch(e) { UI.addLog("[SYSTEM ERROR]: Weave failed.", "var(--term-red)"); }
         endWizard();
         return;
    }

    if (wizardState.type === 'deploy_npc') {
        if (!currentVal) return;
        const room = activeMap[localPlayer.currentRoom];
        
        const newNpc = {
            name: activeAvatar.name,
            archetype: activeAvatar.archetype,
            visualPrompt: activeAvatar.visual_prompt,
            image: activeAvatar.image,
            behavior: currentVal
        };
        const npcs = [...(room.npcs || []), newNpc];
        stateManager.updateMapNode(localPlayer.currentRoom, { npcs });
        syncEngine.addArrayElementToNode(localPlayer.currentRoom, 'npcs', newNpc);

        UI.addLog(`[SYSTEM]: Vessel detached and autonomous protocol initialized.`, "var(--term-amber)");
        stateManager.setActiveAvatar(null);
        endWizard();
        return;
    }

    if (wizardState.type === 'create_npc') {
        if (wizardState.step === 1) {
            if (!currentVal) return;
            stateManager.updateWizardState({ pendingData: { ...wizardState.pendingData, name: currentVal }, step: 2 });
            UI.addLog(`[WIZARD]: Name logged. Enter Archetype (e.g., 'Vendor', 'Guard'):`, "var(--term-amber)");
        } else if (wizardState.step === 2) {
            if (!currentVal) return;
            stateManager.updateWizardState({ pendingData: { ...wizardState.pendingData, archetype: currentVal }, step: 3 });
            UI.addLog(`[WIZARD]: Archetype logged. Enter Visual Description:`, "var(--term-amber)");
        } else if (wizardState.step === 3) {
            if (!currentVal) return;
            UI.addLog(`[SYSTEM]: Compiling NPC...`, "var(--term-amber)");
            
            let npcImg = null;
            try {
                const b64 = await generatePortrait(currentVal, localPlayer.stratum);
                if (b64) {
                    const dataUrl = `data:image/png;base64,${b64}`;
                    npcImg = await compressImage(dataUrl, 400, 0.7);
                }
            } catch(e) {
                console.error("NPC render error:", e);
            }
            
            const newNpc = {
                name: wizardState.pendingData.name,
                archetype: wizardState.pendingData.archetype,
                visualPrompt: currentVal,
                image: npcImg,
                behavior: "Standing idle."
            };
            
            const room = activeMap[localPlayer.currentRoom];
            const npcs = [...(room.npcs || []), newNpc];
            stateManager.updateMapNode(localPlayer.currentRoom, { npcs });
            syncEngine.addArrayElementToNode(localPlayer.currentRoom, 'npcs', newNpc);
            
            UI.addLog(`[SYSTEM]: Entity [${newNpc.name}] spawned successfully.`, "var(--term-green)");
            endWizard();
        }
        return;
    }

    // === 4. TUTORIAL CYOA WIZARD ===
    if (wizardState.type === 'tutorial_cyoa') {
        if (wizardState.step === 1) {
            if (!currentVal) return;
            UI.addLog(`[SYSTEM]: Processing your action in the Astral Plane...`, "var(--gm-purple)");
            const prompt = `The player is in the Astral Plane (Astral stratum) in a cyberpunk world. They are facing a fragmented memory-entity. They decided to: "${currentVal}". Describe the atmospheric outcome in 2-3 sentences, and present ONE final obstacle or choice before they can stabilize their connection. Respond in plain text.`;
            try {
                const response = await callGemini("Process CYOA turn 1", prompt);
                UI.addLog(`[NARRATOR]: ${response}`, "#888");
                UI.addLog(`[WIZARD]: How do you proceed?`, "var(--term-amber)");
                stateManager.updateWizardState({ step: 2 });
            } catch (e) {
                UI.addLog(`[SYSTEM ERROR]: The connection destabilized. Try your action again.`, "var(--term-red)");
            }
        } else if (wizardState.step === 2) {
            if (!currentVal) return;
            UI.addLog(`[SYSTEM]: Resolving final quantum state...`, "var(--gm-purple)");
            const prompt = `The player is completing a cyberpunk astral plane tutorial. Their final action is: "${currentVal}". Determine if they succeed. Respond STRICTLY in JSON: { "narrative": "A 2-sentence atmospheric conclusion.", "success": true or false }`;
            try {
                const responseStr = await callGemini("Process CYOA turn 2", prompt);
                
                const cleanJson = responseStr.replace(/```json/g, '').replace(/```/g, '').trim();
                const response = JSON.parse(cleanJson);
                
                UI.addLog(`[NARRATOR]: ${response.narrative}`, "#888");
                
                if (response.success) {
                    UI.addLog(`[SYSTEM]: ANOMALY RESOLVED. REWARD DISTRIBUTED.`, "var(--term-green)");
                    const newItem = { 
                        name: "Resonant Key", 
                        type: "Key Item", 
                        description: "A fractal shard of crystallized Meaning. It hums with the frequency of the front door." 
                    };
                    stateManager.updatePlayer({ inventory: [...localPlayer.inventory, newItem] });
                    UI.addLog(`[TANDY]: You did it. You synthesized a Resonant Key. Returning you to mundane reality now. Go to the front door in the hallway and use the key to exit.`, "#b084e8");
                } else {
                    UI.addLog(`[SYSTEM]: ANOMALY UNRESOLVED. YOU WERE EJECTED FROM THE ASTRAL PLANE.`, "var(--term-red)");
                    UI.addLog(`[TANDY]: That was close. The field collapsed. You'll need to tune the generator and try again when you're ready.`, "#b084e8");
                }
                
                const apartmentArea = `apartment_${user.uid}`;
                stateManager.updatePlayer({ 
                    currentArea: apartmentArea,
                    currentRoom: 'closet'
                });
                await syncEngine.updateAreaListener(apartmentArea);

                if (shiftStratum) shiftStratum('mundane');
                endWizard();
            } catch (e) {
                UI.addLog(`[SYSTEM ERROR]: The connection destabilized. Try your action again.`, "var(--term-red)");
            }
        }
        return;
    }

    // === 5. ASTRAL VOYAGE WIZARD (Procedural Map Generation) ===
    if (wizardState.type === 'astral_voyage') {
        if (!currentVal) return;
        const dir = wizardState.pendingData.direction;
        const fromId = wizardState.pendingData.fromId;

        UI.addLog(`[SYSTEM]: Committing your vision to the Astral Plane...`, "var(--gm-purple)");
        
        try {
            const prompt = `The player is navigating the Astral Plane. They move ${dir.toUpperCase()} and describe seeing: "${currentVal}". 
            Generate a thematic room definition based on this vision. 
            Respond STRICTLY in JSON: {"name": "Evocative Name", "description": "Atmospheric narrative description", "visual_prompt": "Detailed prompt for image generation"}`;
            
            const res = await callGemini("Generate Astral Room", prompt);
            if (res && res.name) {
                const newRoomId = 'astral_' + Date.now();
                const getOpposite = (d) => ({'north':'south','south':'north','east':'west','west':'east'})[d] || 'out';
                const backDir = getOpposite(dir);
                
                const targetAreaId = `astral_${stateManager.getState().user.uid}`;
                const newRoom = {
                    id: newRoomId,
                    name: res.name || "Unknown Sector",
                    shortName: (res.name || "ASTRAL").substring(0, 8).toUpperCase(),
                    description: res.description || "A shifting expanse of raw potential.",
                    visualPrompt: res.visual_prompt || "A surreal, dream-like landscape.",
                    exits: { [backDir]: fromId },
                    metadata: { stratum: 'astral', isEditable: true, ownerId: stateManager.getState().user.uid, area: targetAreaId }
                };

                // 1. Save new room to the target ASTRAL subcollection
                syncEngine.updateMapNode(newRoomId, newRoom, targetAreaId);
                
                // 2. Save the exit link in the CURRENT subcollection
                const currentExits = activeMap[fromId].exits || {};
                currentExits[dir] = newRoomId;
                stateManager.updateMapNode(fromId, { exits: currentExits });
                syncEngine.updateMapNode(fromId, { [`exits.${dir}`]: newRoomId }, stateManager.getState().localPlayer.currentArea);

                // 3. Transition the player to the new Astral Area
                stateManager.updatePlayer({ currentArea: targetAreaId, currentRoom: newRoomId });
                UI.addLog(`[SYSTEM]: Sector successfully manifested.`, "var(--term-green)");
                
                // 4. Force sync engine to shift to the Astral map before rendering
                await syncEngine.updateAreaListener(targetAreaId);
                const updatedActiveMap = stateManager.getActiveMap();
                UI.printRoomDescription(newRoom, true, updatedActiveMap, activeAvatar);
                
                triggerVisualUpdate(res.visual_prompt, stateManager.getState().localPlayer, updatedActiveMap, stateManager.getState().user);

                // Fire the Shadow Avatar Encounter
                handleGMIntent(
                    "The player has just manifested and entered this new astral sector. You MUST spawn a hostile NPC named 'Shadow Avatar' using the world_edit spawn_npc command. Set combat_active to true. Its stats MUST be: { \"WILL\": 20, \"CONS\": 20, \"PHYS\": 20 }. Describe its terrifying, glitchy appearance as it challenges the player to a Battle of Wills.", 
                    { 
                        activeMap: stateManager.getActiveMap(), 
                        localPlayer: stateManager.getState().localPlayer, 
                        user: stateManager.getState().user,
                        activeAvatar: stateManager.getState().activeAvatar
                    }, 
                    { 
                        updateMapListener: () => syncEngine.updateAreaListener(stateManager.getState().localPlayer.currentArea),
                        shiftStratum: shiftStratum,
                        savePlayerState: syncEngine.savePlayerState,
                        setActiveAvatar: stateManager.setActiveAvatar,
                        syncAvatarStats: syncEngine.syncAvatarStats
                    },
                    false // Ensure isSilent is false so the player sees the output
                );
            }
        } catch(e) { 
            UI.addLog("[SYSTEM ERROR]: Astral manifestation failed. Reality collapsed back to nexus.", "var(--term-red)");
            console.error(e);
        }
        endWizard();
        return;
    }

    // Fallback cancel
    UI.addLog("[WIZARD]: Protocol terminated.", "var(--term-amber)");
    endWizard();
}
