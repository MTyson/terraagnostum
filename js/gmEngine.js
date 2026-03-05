import { callGemini, generatePortrait, compressImage } from './apiService.js';
import { buildSystemPrompt } from './contextEngine.js';
import { triggerVisualUpdate } from './visualSystem.js';
import * as UI from './ui.js';
import * as stateManager from './stateManager.js';
import * as syncEngine from './syncEngine.js';

export async function handleGMIntent(
    val,
    state,
    actions,
    isSilent = false
) {
    const { localPlayer, user, activeAvatar } = state;
    const { shiftStratum, savePlayerState, setActiveAvatar, syncAvatarStats } = actions;

    if (!isSilent) {
        UI.addLog(`<span id="thinking-indicator" class="italic" style="color: var(--gm-purple)">EVALUATING INTENT...</span>`);
    }
    
    try {
        const activeMap = stateManager.getActiveMap();
        // CRITICAL FIX: Add a fallback object so .npcs never throws an undefined error
        const currentRoomData = activeMap[localPlayer.currentRoom] || { name: "Shifting Sector", description: "Reality is manifesting...", exits: {}, npcs: [], items: [], marginalia: [] };
        
        const inventoryNames = localPlayer.inventory.map(i => i.name).join(', ');
        const npcText = (currentRoomData.npcs || []).map(n => {
            let statsStr = "";
            if (n.stats) statsStr = ` (WILL: ${n.stats.WILL}, CONS: ${n.stats.CONS}, PHYS: ${n.stats.PHYS})`;
            return `[NPC] ${n.name}${statsStr} - Personality: ${n.personality}`;
        }).join('\n') || "None";
        
        // 1. BUILD MODULAR CONTEXT
        const systemPrompt = buildSystemPrompt(localPlayer, currentRoomData, inventoryNames, npcText);

        // 2. USER INTENT
        const userPrompt = `PLAYER ACTION: "${val}"\n\nEvaluate this intent against the system rules and current room state. Respond ONLY in the requested JSON format.`;

        // 3. API CALL
        const res = await callGemini(userPrompt, systemPrompt);
        let stateChanged = false;

        // Handle Combat State from AI
        if (res.combat_active !== undefined) {
            if (res.combat_active && !localPlayer.combat.active) {
                stateManager.updatePlayer({ 
                    combat: { active: true, opponent: res.speaker || "Shadow" } 
                });
                if (!isSilent) UI.addLog(`[SYSTEM]: COMBAT INITIALIZED. BATTLE OF WILLS ENGAGED.`, "var(--term-red)");
                stateChanged = true;
            } else if (!res.combat_active && localPlayer.combat.active) {
                stateManager.updatePlayer({ 
                    combat: { active: false, opponent: null } 
                });
                if (!isSilent) UI.addLog(`[SYSTEM]: Combat resolved.`, "var(--term-green)");
                stateChanged = true;
            }
        }

        // Handle Damage to Player
        if (res.damage_to_player && activeAvatar) {
            const newWill = Math.max(0, (activeAvatar.stats.WILL || 20) - res.damage_to_player);
            const updatedAvatar = { ...activeAvatar, stats: { ...activeAvatar.stats, WILL: newWill } };
            stateManager.setActiveAvatar(updatedAvatar);
            if (!isSilent) UI.addLog(`[COMBAT]: You took ${res.damage_to_player} WILL damage!`, "var(--term-red)");
            if (syncAvatarStats) syncAvatarStats();

            if (newWill <= 0) {
                if (!isSilent) UI.addLog(`[SYSTEM]: Your Will has withered. Your vessel collapses...`, "var(--term-red)");
                // Defeat Sequence: Teleport to bedroom, restore WILL
                const restoredAvatar = { ...updatedAvatar, stats: { ...updatedAvatar.stats, WILL: 20 } };
                stateManager.setActiveAvatar(restoredAvatar);
                if (syncAvatarStats) syncAvatarStats();
                stateManager.updatePlayer({ 
                    currentRoom: "bedroom", 
                    stratum: "mundane",
                    combat: { active: false, opponent: null }
                });
                shiftStratum('mundane');
                stateChanged = true;
                if (!isSilent) UI.addLog(`[NARRATOR]: You gasp as you wake up in your bedroom, the astral nightmare fading into a cold sweat.`, "#888");
            }
        }

        // Handle Damage to NPC (Battle of Wills)
        if (res.damage_to_npc && stateManager.getState().localPlayer.combat.active) {
            const currentState = stateManager.getState();
            const activeMap = stateManager.getActiveMap();
            const room = activeMap[currentState.localPlayer.currentRoom] || { npcs: [] };
            const opponentName = currentState.localPlayer.combat.opponent.toLowerCase();
            // Fuzzy match for NPC name
            const npc = room.npcs?.find(n => 
                n.name.toLowerCase() === opponentName || 
                n.name.toLowerCase().includes(opponentName) ||
                opponentName.includes(n.name.toLowerCase())
            );
            
            if (npc) {
                if (!npc.stats) npc.stats = { WILL: 2, CONS: 20, PHYS: 20 };
                const newNpcWill = Math.max(0, (npc.stats.WILL || 5) - res.damage_to_npc);
                npc.stats.WILL = newNpcWill;
                if (!isSilent) UI.addLog(`[COMBAT]: ${npc.name} took ${res.damage_to_npc} WILL damage! (Remaining WILL: ${newNpcWill})`, "var(--term-amber)");
                
                if (newNpcWill <= 0) {
                    if (!isSilent) UI.addLog(`[SYSTEM]: ${npc.name} has been dissipated. Victory!`, "var(--term-green)");
                    
                    // Remove NPC from room
                    const newNpcs = room.npcs.filter(n => n.name !== npc.name);
                    stateManager.updateMapNode(currentState.localPlayer.currentRoom, { npcs: newNpcs });
                    syncEngine.updateMapNode(currentState.localPlayer.currentRoom, { npcs: newNpcs });

                    // Reset Combat State
                    stateManager.updatePlayer({ combat: { active: false, opponent: null } });
                    stateChanged = true;

                    // Auto-grant Resonant Key and Shift Stratum if Shadow is defeated
                    if (npc.name.startsWith("Shadow")) {
                        const key = { name: "Resonant Key", type: "Key Item", description: "A vibrating, semi-translucent key that resonates with the apartment's front door." };
                        const currentLocalPlayer = stateManager.getState().localPlayer;
                        if (!currentLocalPlayer.inventory.some(i => i.name === key.name)) {
                            stateManager.updatePlayer({ inventory: [...currentLocalPlayer.inventory, key] });
                            if (!isSilent) UI.addLog(`[REWARD]: You have obtained [${key.name}].`, "var(--term-green)");
                        }
                        
                        if (currentLocalPlayer.stratum !== 'mundane') {
                            stateManager.updatePlayer({ currentRoom: 'bedroom', stratum: 'mundane' });
                            shiftStratum('mundane');
                            if (!isSilent) UI.addLog(`[SYSTEM]: Harmonic resonance achieved. Shifting back to mundane stratum...`, "var(--term-green)");
                            
                            stateChanged = true;
                        }
                    }
                }
            }
        }
        
        const currentLocalPlayer = stateManager.getState().localPlayer;
        if (res.astral_jump && currentLocalPlayer.stratum !== 'astral') {
            if (currentLocalPlayer.currentRoom === 'closet' || val.toLowerCase().includes('aethal')) {
                shiftStratum('astral');
                const entryId = 'astral_entry';
                const entryNode = {
                    name: "Astral Nexus", shortName: "NEXUS",
                    description: "The entry point to the astral plane. Space is fluid and glowing.",
                    visualPrompt: "Glowing astral nexus portal.",
                    exits: {}, pinnedView: null, items: [], marginalia: [], npcs: []
                };
                stateManager.setLocalAreaCache({ [entryId]: entryNode });
                stateManager.updatePlayer({ currentRoom: entryId });
                stateChanged = true;
                if (!isSilent) UI.addLog(`[SYSTEM]: Conventional geometry discarded. Welcome to the Astral Plane.`, "var(--faen-pink)");
            } else {
                if (!isSilent) UI.addLog("[SYSTEM]: Dimensional shift failed. Anchors too strong in this node.", "var(--term-red)");
            }
        } else if (res.trigger_stratum_shift) {
            const target = res.trigger_stratum_shift.toLowerCase();
            if (currentLocalPlayer.stratum !== target) { 
                shiftStratum(target); 
                stateChanged = true;
            }
        }
        
        if (res.give_item) {
            const updatedLocalPlayer = stateManager.getState().localPlayer;
            stateManager.updatePlayer({ inventory: [...updatedLocalPlayer.inventory, res.give_item] });
            if (!isSilent) UI.addLog(`[REWARD]: You have obtained [${res.give_item.name}].`, "var(--term-green)");
            stateChanged = true;
        }

        if (res.trigger_respawn) {
            const currentAvatar = stateManager.getState().activeAvatar;
            if (currentAvatar && user) syncEngine.markCharacterDeceased(currentAvatar.id);
            setActiveAvatar(null);
            stateManager.updatePlayer({ currentRoom: "bedroom", stratum: "mundane" });
            stateChanged = true;
            if (!isSilent) UI.addLog(`Vessel destroyed. Connection severed.`, "var(--term-red)"); 
            shiftStratum('mundane');
        }
        
        if (res.trigger_teleport && !res.trigger_respawn) {
            let t = res.trigger_teleport;
            const activeMap = stateManager.getActiveMap();
            
            // Fuzzy Match Protection: Check if the AI invented a new ID for an existing room name
            const existingEntry = Object.entries(activeMap).find(([id, r]) => 
                id.toLowerCase() === t.new_room_id.toLowerCase() || 
                r.name.toLowerCase() === t.name.toLowerCase()
            );

            if (existingEntry) {
                t.new_room_id = existingEntry[0];
            }

            if (!activeMap[t.new_room_id]) {
                // It's a truly new room, link it back to the current room so they aren't trapped
                const returnDir = "back"; 
                const newRoom = { 
                    ...t, 
                    shortName: t.name.substring(0, 7).toUpperCase(), 
                    exits: { [returnDir]: stateManager.getState().localPlayer.currentRoom }, 
                    pinnedView: null, 
                    items: [], 
                    marginalia: [], 
                    npcs: [] 
                };
                
                stateManager.updateMapNode(t.new_room_id, newRoom);
                syncEngine.updateMapNode(t.new_room_id, newRoom);
            }
            stateManager.updatePlayer({ currentRoom: t.new_room_id }); 
            stateChanged = true;
            if (!isSilent) UI.addLog(`Reality warp successful.`, "var(--gm-purple)");
        }
        
        if (stateChanged) { 
            if (typeof actions.savePlayerState === 'function') actions.savePlayerState(); 
        }
        
        if (!isSilent) {
            const speakerPrefix = (res.speaker === 'SYSTEM' || res.speaker === 'NARRATOR') ? `[${res.speaker}]` : `${res.speaker.toUpperCase()}`;
            UI.addLog(`${speakerPrefix}: ${res.narrative}`, res.color);
        }
        
        if (res.world_edit) {
            const currentState = stateManager.getState();
            const activeMap = stateManager.getActiveMap();
            const room = activeMap[currentState.localPlayer.currentRoom] || { npcs: [], items: [], marginalia: [], exits: {} };
            
            if (res.world_edit.type === 'add_marginalia') {
                const marginalia = [...(room.marginalia || []), res.world_edit.text];
                stateManager.updateMapNode(currentState.localPlayer.currentRoom, { marginalia });
                syncEngine.addArrayElementToNode(currentState.localPlayer.currentRoom, 'marginalia', res.world_edit.text);
            } else if (res.world_edit.type === 'unlock_exit') {
                const unlockDir = res.world_edit.direction.toLowerCase();
                if (room.exits[unlockDir] && typeof room.exits[unlockDir] === 'object') {
                    const exits = { ...room.exits };
                    exits[unlockDir] = { ...exits[unlockDir], locked: false };
                    stateManager.updateMapNode(currentState.localPlayer.currentRoom, { exits });
                    syncEngine.updateMapNode(currentState.localPlayer.currentRoom, { [`exits.${unlockDir}.locked`]: false });
                    if (!isSilent) UI.addLog(`[SYSTEM]: The path ${unlockDir.toUpperCase()} has been opened.`, "var(--term-green)");
                }
            } else if (res.world_edit.type === 'spawn_item') {
                const items = [...(room.items || []), res.world_edit.item];
                stateManager.updateMapNode(currentState.localPlayer.currentRoom, { items });
                syncEngine.addArrayElementToNode(currentState.localPlayer.currentRoom, 'items', res.world_edit.item);
                if (!isSilent) UI.addLog(`[SYSTEM]: ${res.world_edit.item.name} has manifested in the room.`, "var(--term-green)");
            } else if (res.world_edit.type === 'spawn_npc') {
                const npcData = res.world_edit.npc;
                
                // Generate portrait for NPC if visual_prompt provided and no image
                if (npcData.visual_prompt && !npcData.image) {
                    if (!isSilent) UI.addLog(`[SYSTEM]: Manifesting visual imprint for ${npcData.name}...`, "var(--term-amber)");
                    try {
                        const b64 = await generatePortrait(npcData.visual_prompt, currentState.localPlayer.stratum);
                        if (b64) {
                            const dataUrl = `data:image/png;base64,${b64}`;
                            npcData.image = await compressImage(dataUrl, 400, 0.7);
                            if (!isSilent) UI.addLog(`[SYSTEM]: Visual imprint successful for ${npcData.name}.`, "var(--term-green)");
                        } else {
                            if (!isSilent) UI.addLog(`[SYSTEM]: Visual manifestation failed for ${npcData.name}.`, "var(--term-red)");
                        }
                    } catch (e) {
                        console.error("NPC Portrait generation error:", e);
                        if (!isSilent) UI.addLog(`[SYSTEM ERROR]: Portrait generation failed.`, "var(--term-red)");
                    }
                }

                const npcs = [...(room.npcs || [])];
                // Prevent duplicate NPCs if the GM keeps sending spawn_npc for the same entity
                const existingIdx = npcs.findIndex(n => n.name === npcData.name);
                if (existingIdx > -1) {
                    // Update existing NPC data but preserve image if new data doesn't have one
                    const oldNpc = npcs[existingIdx];
                    if (!npcData.image && oldNpc.image) npcData.image = oldNpc.image;
                    npcs[existingIdx] = npcData;
                } else {
                    npcs.push(npcData);
                }
                stateManager.updateMapNode(currentState.localPlayer.currentRoom, { npcs });
                syncEngine.updateMapNode(currentState.localPlayer.currentRoom, { npcs });
                if (!isSilent) UI.addLog(`[SYSTEM]: A new presence detected: ${npcData.name}.`, "var(--term-amber)");
            }
        }
        
        const isLooking = val.toLowerCase().includes('look') || val.toLowerCase().includes('examine') || val.toLowerCase().includes('search');
        
        // AUTO-REPAIR MISSING NPC PORTRAITS ON LOOK
        if (isLooking && currentRoomData.npcs) {
            for (let npc of currentRoomData.npcs) {
                if (npc.visual_prompt && !npc.image) {
                    if (!isSilent) UI.addLog(`[REPAIR]: Re-weaving visual imprint for ${npc.name}...`, "var(--term-amber)");
                    const b64 = await generatePortrait(npc.visual_prompt, stateManager.getState().localPlayer.stratum);
                    if (b64) {
                        npc.image = await compressImage(`data:image/png;base64,${b64}`, 400, 0.7);
                        stateManager.updateMapNode(stateManager.getState().localPlayer.currentRoom, { npcs: currentRoomData.npcs });
                        syncEngine.updateMapNode(stateManager.getState().localPlayer.currentRoom, { npcs: currentRoomData.npcs });
                    }
                }
            }
        }
        
        return res.suggested_actions || [];
    } catch (err) { 
        console.error(err);
        if (!isSilent) UI.addLog("SYSTEM EVALUATION FAILED!", "var(--term-red)"); 
        return [];
    } finally { 
        if (!isSilent) document.getElementById('thinking-indicator')?.remove(); 
    }
}
