import { doc, updateDoc, arrayUnion } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { callGemini, generatePortrait, compressImage } from './apiService.js';
import { triggerVisualUpdate } from './visualSystem.js';
import * as UI from './ui.js';

export async function handleGMIntent(
    val,
    state,
    actions
) {
    const { apartmentMap, localPlayer, user, activeAvatar, isSyncEnabled, db, appId } = state;
    const { shiftStratum, savePlayerState, refreshStatusUI, renderMapHUD, setActiveAvatar } = actions;

    UI.addLog(`<span id="thinking-indicator" class="italic" style="color: var(--gm-purple)">EVALUATING INTENT...</span>`);
    
    try {
        const currentRoomData = apartmentMap[localPlayer.currentRoom];
        if (!currentRoomData) {
            console.error("Room not found in map:", localPlayer.currentRoom);
            UI.addLog(`[SYSTEM ERROR]: Location data corrupted for ${localPlayer.currentRoom}.`, "var(--term-red)");
            return;
        }
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
        Current Avatar: ${activeAvatar ? `${activeAvatar.name} (${activeAvatar.archetype})` : 'None'}.
        
        SPECIAL QUEST: If the user is in the ASTRAL stratum, they are on a quest to obtain a 'Resonant Key' to escape the apartment. 
        The Astral Plane takes shape based on the user's actions. Create bizarre challenges, non-euclidean puzzles, or social encounters with memory-fragments.
        
        ASTRAL ENCOUNTER: If the user is in the ASTRAL stratum and there is NO 'Shadow Avatar' (or a shadow reflection NPC) currently present in the 'Entities Present' list, you MUST immediately manifest one using "spawn_npc". 
        The Shadow Avatar is a dark, flickering reflection of the user's current avatar. It should challenge the player's identity or purpose. 
        Create a 'visual_prompt' for it that is a dark, glitchy, debased, sci-fi/fantasy bad guy version of the player character's description.
        Required Action if NPC missing: "world_edit": {"type": "spawn_npc", "npc": {"name": "Shadow ${activeAvatar ? activeAvatar.name : 'Self'}", "archetype": "Glitch Reflection", "personality": "Challenging and cryptic", "visual_prompt": "A dark, glitching shadow silhouette of the player character, digital corruption artifacts, eerie astral plane background, glowing eyes, highly detailed."}}
        
        Once the user has sufficiently overcome an obstacle or demonstrated creative intent, you can grant them the 'Resonant Key' using "give_item": {"name": "Resonant Key", "type": "Key Item", "description": "..."}.
        After they get the key, you should trigger a shift back to 'mundane'.  
        This is a New User Quest, a Choose Your Own Adventure in collaboration with you, the AI GM, designed to show off how much is possible in the game and get them used to the controls.  

        IMPORTANT: An 'astral_jump' can ONLY happen if the user is in 'Schrödinger's Closet' (CLOSET) or explicitly uses specific 'Aethal' code.
        IMPORTANT: If a user attempts to interact with an Adjacent Entity across a counter or doorway, you may roleplay their response based on their personality.
        IMPORTANT: If a user attempts to go through a LOCKED exit, and they successfully persuade, bribe, or trick the guarding Adjacent Entity, you may set world_edit type to 'unlock_exit' and provide the direction.
        Respond STRICTLY in JSON:
        {
          "speaker": "NARRATOR or NPC Name",
          "narrative": "outcome",
          "color": "hex",
          "trigger_visual": "prompt or null",
          "astral_jump": boolean,
          "trigger_stratum_shift": null or 'mundane', 'astral', 'faen', 'technate',
          "trigger_teleport": null or { "new_room_id": "id", "name": "Name", "description": "Desc", "visual_prompt": "Prompt" },
          "give_item": null or { "name": "Name", "type": "Type", "description": "Desc" },
          "world_edit": null or {"type": "add_marginalia", "text": "text"} or {"type": "unlock_exit", "direction": "north"} or {"type": "spawn_item", "item": {"name": "...", "type": "...", "description": "..."}} or {"type": "spawn_npc", "npc": {"name": "...", "archetype": "...", "personality": "...", "visual_prompt": "..."}},
          "trigger_respawn": false
        }`;
        
        const res = await callGemini(`User: ${val}`, sysPrompt);
        let stateChanged = false;
        
        if (res.astral_jump && localPlayer.stratum !== 'astral') {
            if (localPlayer.currentRoom === 'closet' || val.toLowerCase().includes('aethal')) {
                shiftStratum('astral');
                localPlayer.currentRoom = 'astral_entry';
                apartmentMap['astral_entry'] = {
                    name: "Astral Nexus", shortName: "NEXUS",
                    description: "The entry point to the astral plane. Space is fluid and glowing.",
                    visualPrompt: "Glowing astral nexus portal.",
                    exits: {}, pinnedView: null, items: [], marginalia: [], npcs: []
                };
                stateChanged = true;
                UI.addLog(`[SYSTEM]: Conventional geometry discarded. Welcome to the Astral Plane.`, "var(--faen-pink)");
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
        
        if (res.give_item) {
            localPlayer.inventory.push(res.give_item);
            UI.addLog(`[REWARD]: You have obtained [${res.give_item.name}].`, "var(--term-green)");
            UI.updateInventoryUI(localPlayer.inventory);
            stateChanged = true;
        }

        if (res.trigger_respawn) {
            if (activeAvatar && user) updateDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'characters', activeAvatar.id), { deceased: true });
            setActiveAvatar(null);
            localPlayer.currentRoom = "spare_room"; 
            localPlayer.stratum = "mundane";
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
            renderMapHUD(apartmentMap, localPlayer.currentRoom, localPlayer.stratum); 
        }
        
        const speakerPrefix = (res.speaker === 'SYSTEM' || res.speaker === 'NARRATOR') ? `[${res.speaker}]` : `${res.speaker.toUpperCase()}`;
        UI.addLog(`${speakerPrefix}: ${res.narrative}`, res.color);
        
        if (res.world_edit) {
            stateChanged = true;
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
            } else if (res.world_edit.type === 'spawn_item') {
                if (!room.items) room.items = [];
                room.items.push(res.world_edit.item);
                if (isSyncEnabled && !localPlayer.currentRoom.startsWith('astral_')) {
                    updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'maps', 'apartment_graph_live'), { [`nodes.${localPlayer.currentRoom}.items`]: arrayUnion(res.world_edit.item) });
                }
                UI.updateRoomItemsUI(room.items);
                UI.addLog(`[SYSTEM]: ${res.world_edit.item.name} has manifested in the room.`, "var(--term-green)");
            } else if (res.world_edit.type === 'spawn_npc') {
                const npcData = res.world_edit.npc;
                
                // Generate portrait for NPC if visual_prompt provided and no image
                if (npcData.visual_prompt && !npcData.image) {
                    UI.addLog(`[SYSTEM]: Manifesting visual imprint for ${npcData.name}...`, "var(--term-amber)");
                    try {
                        const b64 = await generatePortrait(npcData.visual_prompt, localPlayer.stratum);
                        if (b64) {
                            const dataUrl = `data:image/png;base64,${b64}`;
                            npcData.image = await compressImage(dataUrl, 400, 0.7);
                            UI.addLog(`[SYSTEM]: Visual imprint successful for ${npcData.name}.`, "var(--term-green)");
                        } else {
                            UI.addLog(`[SYSTEM]: Visual manifestation failed for ${npcData.name}.`, "var(--term-red)");
                        }
                    } catch (e) {
                        console.error("NPC Portrait generation error:", e);
                        UI.addLog(`[SYSTEM ERROR]: Portrait generation failed.`, "var(--term-red)");
                    }
                }

                if (!room.npcs) room.npcs = [];
                // Prevent duplicate NPCs if the GM keeps sending spawn_npc for the same entity
                const existingIdx = room.npcs.findIndex(n => n.name === npcData.name);
                if (existingIdx > -1) {
                    // Update existing NPC data but preserve image if new data doesn't have one
                    const oldNpc = room.npcs[existingIdx];
                    if (!npcData.image && oldNpc.image) npcData.image = oldNpc.image;
                    room.npcs[existingIdx] = npcData;
                } else {
                    room.npcs.push(npcData);
                }
                if (isSyncEnabled && !localPlayer.currentRoom.startsWith('astral_')) {
                    updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'maps', 'apartment_graph_live'), { [`nodes.${localPlayer.currentRoom}.npcs`]: room.npcs });
                }
                UI.updateRoomEntitiesUI(room.npcs);
                UI.addLog(`[SYSTEM]: A new presence detected: ${npcData.name}.`, "var(--term-amber)");
            }
        }
        
        const isLooking = val.toLowerCase().includes('look') || val.toLowerCase().includes('examine') || val.toLowerCase().includes('search');
        
        // AUTO-REPAIR MISSING NPC PORTRAITS ON LOOK
        if (isLooking && currentRoomData.npcs) {
            for (let npc of currentRoomData.npcs) {
                if (npc.visual_prompt && !npc.image) {
                    UI.addLog(`[REPAIR]: Re-weaving visual imprint for ${npc.name}...`, "var(--term-amber)");
                    const b64 = await generatePortrait(npc.visual_prompt, localPlayer.stratum);
                    if (b64) {
                        npc.image = await compressImage(`data:image/png;base64,${b64}`, 400, 0.7);
                        UI.updateRoomEntitiesUI(currentRoomData.npcs);
                    }
                }
            }
        }
        
        if (res.trigger_visual && !res.trigger_respawn && !res.trigger_teleport) {
            triggerVisualUpdate(res.trigger_visual, localPlayer, apartmentMap, user);
        } else if (res.trigger_stratum_shift || res.trigger_teleport || res.astral_jump || (res.world_edit && res.world_edit.type === 'spawn_npc') || isLooking) {
            triggerVisualUpdate(null, localPlayer, apartmentMap, user);
        }
    } catch (err) { 
        console.error(err);
        UI.addLog("SYSTEM EVALUATION FAILED!", "var(--term-red)"); 
    } finally { 
        document.getElementById('thinking-indicator')?.remove(); 
    }
}