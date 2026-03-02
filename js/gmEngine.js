import { doc, updateDoc, arrayUnion } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { callGemini, generatePortrait, compressImage } from './apiService.js';
import { triggerVisualUpdate } from './visualSystem.js';
import * as UI from './ui.js';

export async function handleGMIntent(
    val,
    state,
    actions,
    isSilent = false
) {
    const { activeMap, localPlayer, user, activeAvatar, isSyncEnabled, db, appId, userTier } = state;
    const { shiftStratum, savePlayerState, refreshStatusUI, renderMapHUD, setActiveAvatar, syncAvatarStats } = actions;

    if (!isSilent) {
        UI.addLog(`<span id="thinking-indicator" class="italic" style="color: var(--gm-purple)">EVALUATING INTENT...</span>`);
    }
    
    try {
        const currentRoomData = activeMap[localPlayer.currentRoom];
        if (!currentRoomData) {
            console.error("Room not found in map:", localPlayer.currentRoom);
            if (!isSilent) UI.addLog(`[SYSTEM ERROR]: Location data corrupted for ${localPlayer.currentRoom}.`, "var(--term-red)");
            return [];
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
            const targetRoom = activeMap[targetId];
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
        Player Cohesion: ${activeAvatar ? 'MATERIALIZED' : 'VOID (Disembodied)'}.
        Player Auth Tier: ${userTier || 'GUEST'}.
        Environment Flags: { closetDoorClosed: ${localPlayer.closetDoorClosed || false} }.
        Combat Status: ${localPlayer.combat.active ? `ACTIVE with ${localPlayer.combat.opponent}` : 'INACTIVE'}.
        Player Stats: ${activeAvatar ? `WILL: ${activeAvatar.stats.WILL}, CONS: ${activeAvatar.stats.CONS}, PHYS: ${activeAvatar.stats.PHYS}` : 'N/A'}.
        
        GUIDELINES FOR SUGGESTIONS:
        - If the player's Auth Tier is GUEST or VOID, and there is a computer console, terminal, or Tandem device mentioned in the room description, you MUST strongly suggest "Login".
        - If the player is a VOID (no avatar) and in a room that mentions character sheets, archives of forms, or vessel forging, strongly suggest "Create Avatar".
        - In Schrödinger's Closet (or any room with the Resonance Generator) AND stratum is MUNDANE:
            - If the 'closetDoorClosed' flag is FALSE, you MUST suggest "Close Door".
            - If the 'closetDoorClosed' flag is TRUE, you MUST suggest "Use Resonator".
        - If NPCs are present and the player is a VOID, suggest "Assume [NPC Name]".
        - If NPCs are present and the player is MATERIALIZED, suggest "Talk to [NPC Name]".
        
        SPECIAL QUEST: If the user is in the ASTRAL stratum, they are on a quest to obtain a 'Resonant Key' to escape the apartment. 
        The Astral Plane takes shape based on the user's actions. Create bizarre challenges, non-euclidean puzzles, or social encounters with memory-fragments.
        
        ASTRAL ENCOUNTER: If the user is in the ASTRAL stratum and there is NO 'Shadow Avatar' (or a shadow reflection NPC) currently present in the 'Entities Present' list, you MUST immediately manifest one using "spawn_npc". 
        The Shadow Avatar is a dark, flickering reflection of the user's current avatar. It should challenge the player's identity or purpose. 
        Create a 'visual_prompt' for it that is a dark, glitchy, debased, sci-fi/fantasy bad guy version of the player character's description.
        Required Action if NPC missing: "world_edit": {"type": "spawn_npc", "npc": {"name": "Shadow ${activeAvatar ? activeAvatar.name : 'Self'}", "archetype": "Glitch Reflection", "personality": "Challenging and cryptic", "stats": {"WILL": 5}, "visual_prompt": "A dark, glitching shadow silhouette of the player character, digital corruption artifacts, eerie astral plane background, glowing eyes, highly detailed."}}
        
        BATTLE OF WILLS: If the Shadow Avatar is present, it will eventually attack the player. 
        - When combat is active, the player will attempt narrative actions. 
        - You must resolve the player's action and then describe the Shadow's counter-attack in the 'narrative' field.
        - The Shadow's attack ALWAYS deals 1 WILL damage to the player if it hits. 
        - IMPORTANT: If combat is active, you MUST set "damage_to_player": 1 in your JSON response whenever the Shadow strikes (which should be almost every turn once combat starts).
        - IMPORTANT: Describe the Shadow's attack in the narrative so the player knows they are being hit.
        - The player's attacks (like 'ATTACK WITH WILL FORCE') deal damage to the Shadow's WILL.
        - You decide if the Shadow hits or if the player successfully resists/dodges based on their narrative.
        - If the player's WILL hits 0, they are defeated.
        - If the Shadow's WILL hits 0, it is defeated and vanishes.
        - Set "combat_active": true to start or continue combat.
        - Set "damage_to_player": 1 if the Shadow successfully strikes the player's Will.
        - Set "damage_to_npc": number if the player successfully strikes the Shadow's Will.

        Once the user has sufficiently overcome an obstacle or demonstrated creative intent (or defeated the Shadow), you can grant them the 'Resonant Key' using "give_item": {"name": "Resonant Key", "type": "Key Item", "description": "..."}.
        After they get the key, you should trigger a shift back to 'mundane'.  

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
          "trigger_respawn": false,
          "combat_active": boolean,
          "damage_to_player": number or null,
          "damage_to_npc": number or null,
          "suggested_actions": ["Action string 1", "Action string 2"]
        }
        ${isSilent ? 'IMPORTANT: This is a silent context-check. Focus primarily on providing 3-5 high-quality, relevant "suggested_actions". Keep "narrative" brief as it will not be displayed.' : ''}`;
        
        const res = await callGemini(`User: ${val}`, sysPrompt);
        let stateChanged = false;

        // Handle Combat State from AI
        if (res.combat_active !== undefined) {
            if (res.combat_active && !localPlayer.combat.active) {
                localPlayer.combat.active = true;
                localPlayer.combat.opponent = res.speaker || "Shadow";
                if (!isSilent) UI.addLog(`[SYSTEM]: COMBAT INITIALIZED. BATTLE OF WILLS ENGAGED.`, "var(--term-red)");
            } else if (!res.combat_active && localPlayer.combat.active) {
                localPlayer.combat.active = false;
                localPlayer.combat.opponent = null;
                if (!isSilent) UI.addLog(`[SYSTEM]: Combat resolved.`, "var(--term-green)");
            }
            stateChanged = true;
        }

        // Handle Damage to Player
        if (res.damage_to_player && activeAvatar) {
            activeAvatar.stats.WILL = Math.max(0, (activeAvatar.stats.WILL || 20) - res.damage_to_player);
            if (!isSilent) UI.addLog(`[COMBAT]: You took ${res.damage_to_player} WILL damage!`, "var(--term-red)");
            UI.updateAvatarUI(activeAvatar);
            if (syncAvatarStats) syncAvatarStats();

            if (activeAvatar.stats.WILL <= 0) {
                if (!isSilent) UI.addLog(`[SYSTEM]: Your Will has withered. Your vessel collapses...`, "var(--term-red)");
                // Defeat Sequence: Teleport to bedroom, restore WILL
                activeAvatar.stats.WILL = 20; // Restore
                if (syncAvatarStats) syncAvatarStats();
                localPlayer.currentRoom = "bedroom";
                localPlayer.stratum = "mundane";
                localPlayer.combat.active = false;
                localPlayer.combat.opponent = null;
                shiftStratum('mundane');
                stateChanged = true;
                if (!isSilent) UI.addLog(`[NARRATOR]: You gasp as you wake up in your bedroom, the astral nightmare fading into a cold sweat.`, "#888");
            }
        }

        // Handle Damage to NPC (Battle of Wills)
        if (res.damage_to_npc && localPlayer.combat.active) {
            const room = activeMap[localPlayer.currentRoom];
            const npc = room.npcs?.find(n => n.name === localPlayer.combat.opponent);
            if (npc) {
                if (!npc.stats) npc.stats = { WILL: 5, CONS: 20, PHYS: 20 };
                npc.stats.WILL = Math.max(0, (npc.stats.WILL || 5) - res.damage_to_npc);
                if (!isSilent) UI.addLog(`[COMBAT]: ${npc.name} took ${res.damage_to_npc} WILL damage!`, "var(--term-amber)");
                
                if (npc.stats.WILL <= 0) {
                    if (!isSilent) UI.addLog(`[SYSTEM]: ${npc.name} has been dissipated. Victory!`, "var(--term-green)");
                    
                    // Remove NPC from room
                    room.npcs = room.npcs.filter(n => n.name !== npc.name);
                    if (isSyncEnabled && !localPlayer.currentRoom.startsWith('astral_')) {
                        updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'maps', 'apartment_graph_live'), { [`nodes.${localPlayer.currentRoom}.npcs`]: room.npcs });
                    }
                    UI.updateRoomEntitiesUI(room.npcs);

                    // Reset Combat State
                    localPlayer.combat.active = false;
                    localPlayer.combat.opponent = null;
                    stateChanged = true;

                    // Auto-grant Resonant Key and Shift Stratum if Shadow is defeated
                    if (npc.name.startsWith("Shadow")) {
                        const key = { name: "Resonant Key", type: "Key Item", description: "A vibrating, semi-translucent key that resonates with the apartment's front door." };
                        if (!localPlayer.inventory.some(i => i.name === key.name)) {
                            localPlayer.inventory.push(key);
                            if (!isSilent) UI.addLog(`[REWARD]: You have obtained [${key.name}].`, "var(--term-green)");
                            UI.updateInventoryUI(localPlayer.inventory);
                        }
                        
                        if (localPlayer.stratum !== 'mundane') {
                            shiftStratum('mundane');
                            if (!isSilent) UI.addLog(`[SYSTEM]: Harmonic resonance achieved. Shifting back to mundane stratum...`, "var(--term-green)");
                        }
                    }
                }
            }
        }
        
        if (res.astral_jump && localPlayer.stratum !== 'astral') {
            if (localPlayer.currentRoom === 'closet' || val.toLowerCase().includes('aethal')) {
                shiftStratum('astral');
                localPlayer.currentRoom = 'astral_entry';
                activeMap['astral_entry'] = {
                    name: "Astral Nexus", shortName: "NEXUS",
                    description: "The entry point to the astral plane. Space is fluid and glowing.",
                    visualPrompt: "Glowing astral nexus portal.",
                    exits: {}, pinnedView: null, items: [], marginalia: [], npcs: []
                };
                stateChanged = true;
                if (!isSilent) UI.addLog(`[SYSTEM]: Conventional geometry discarded. Welcome to the Astral Plane.`, "var(--faen-pink)");
            } else {
                if (!isSilent) UI.addLog("[SYSTEM]: Dimensional shift failed. Anchors too strong in this node.", "var(--term-red)");
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
            if (!isSilent) UI.addLog(`[REWARD]: You have obtained [${res.give_item.name}].`, "var(--term-green)");
            UI.updateInventoryUI(localPlayer.inventory);
            stateChanged = true;
        }

        if (res.trigger_respawn) {
            if (activeAvatar && user) updateDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'characters', activeAvatar.id), { deceased: true });
            setActiveAvatar(null);
            localPlayer.currentRoom = "spare_room"; 
            localPlayer.stratum = "mundane";
            stateChanged = true; 
            if (!isSilent) UI.addLog(`Vessel destroyed. Connection severed.`, "var(--term-red)"); 
            shiftStratum('mundane');
        }
        
        if (res.trigger_teleport && !res.trigger_respawn) {
            const t = res.trigger_teleport;
            if (!activeMap[t.new_room_id]) {
                activeMap[t.new_room_id] = { ...t, shortName: t.name.substring(0, 7).toUpperCase(), exits: {}, pinnedView: null, items: [], marginalia: [], npcs: [] };
                if (isSyncEnabled) updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'maps', 'apartment_graph_live'), { [`nodes.${t.new_room_id}`]: activeMap[t.new_room_id] });
            }
            localPlayer.currentRoom = t.new_room_id; 
            stateChanged = true; 
            if (!isSilent) UI.addLog(`Reality warp successful.`, "var(--gm-purple)");
        }
        
        if (stateChanged) { 
            refreshStatusUI(); 
            savePlayerState(); 
            renderMapHUD(activeMap, localPlayer.currentRoom, localPlayer.stratum); 
        }
        
        if (!isSilent) {
            const speakerPrefix = (res.speaker === 'SYSTEM' || res.speaker === 'NARRATOR') ? `[${res.speaker}]` : `${res.speaker.toUpperCase()}`;
            UI.addLog(`${speakerPrefix}: ${res.narrative}`, res.color);
        }
        
        if (res.world_edit) {
            stateChanged = true;
            const room = activeMap[localPlayer.currentRoom];
            if (res.world_edit.type === 'add_marginalia') {
                if (!room.marginalia) room.marginalia = [];
                room.marginalia.push(res.world_edit.text);
                if (isSyncEnabled) updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'maps', 'apartment_graph_live'), { [`nodes.${localPlayer.currentRoom}.marginalia`]: arrayUnion(res.world_edit.text) });
            } else if (res.world_edit.type === 'unlock_exit') {
                const unlockDir = res.world_edit.direction.toLowerCase();
                if (room.exits[unlockDir] && typeof room.exits[unlockDir] === 'object') {
                    room.exits[unlockDir].locked = false;
                    if (isSyncEnabled) updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'maps', 'apartment_graph_live'), { [`nodes.${localPlayer.currentRoom}.exits.${unlockDir}.locked`]: false });
                    if (!isSilent) UI.addLog(`[SYSTEM]: The path ${unlockDir.toUpperCase()} has been opened.`, "var(--term-green)");
                }
            } else if (res.world_edit.type === 'spawn_item') {
                if (!room.items) room.items = [];
                room.items.push(res.world_edit.item);
                if (isSyncEnabled && !localPlayer.currentRoom.startsWith('astral_')) {
                    updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'maps', 'apartment_graph_live'), { [`nodes.${localPlayer.currentRoom}.items`]: arrayUnion(res.world_edit.item) });
                }
                UI.updateRoomItemsUI(room.items);
                if (!isSilent) UI.addLog(`[SYSTEM]: ${res.world_edit.item.name} has manifested in the room.`, "var(--term-green)");
            } else if (res.world_edit.type === 'spawn_npc') {
                const npcData = res.world_edit.npc;
                
                // Generate portrait for NPC if visual_prompt provided and no image
                if (npcData.visual_prompt && !npcData.image) {
                    if (!isSilent) UI.addLog(`[SYSTEM]: Manifesting visual imprint for ${npcData.name}...`, "var(--term-amber)");
                    try {
                        const b64 = await generatePortrait(npcData.visual_prompt, localPlayer.stratum);
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
                if (!isSilent) UI.addLog(`[SYSTEM]: A new presence detected: ${npcData.name}.`, "var(--term-amber)");
            }
        }
        
        const isLooking = val.toLowerCase().includes('look') || val.toLowerCase().includes('examine') || val.toLowerCase().includes('search');
        
        // AUTO-REPAIR MISSING NPC PORTRAITS ON LOOK
        if (isLooking && currentRoomData.npcs) {
            for (let npc of currentRoomData.npcs) {
                if (npc.visual_prompt && !npc.image) {
                    if (!isSilent) UI.addLog(`[REPAIR]: Re-weaving visual imprint for ${npc.name}...`, "var(--term-amber)");
                    const b64 = await generatePortrait(npc.visual_prompt, localPlayer.stratum);
                    if (b64) {
                        npc.image = await compressImage(`data:image/png;base64,${b64}`, 400, 0.7);
                        UI.updateRoomEntitiesUI(currentRoomData.npcs);
                    }
                }
            }
        }
        
        if (res.trigger_visual && !res.trigger_respawn && !res.trigger_teleport) {
            triggerVisualUpdate(res.trigger_visual, localPlayer, activeMap, user);
        } else if (res.trigger_stratum_shift || res.trigger_teleport || res.astral_jump || (res.world_edit && res.world_edit.type === 'spawn_npc') || isLooking) {
            triggerVisualUpdate(null, localPlayer, activeMap, user);
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
