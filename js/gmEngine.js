import { callGemini, generatePortrait, compressImage } from './apiService.js';
import { buildSystemPrompt } from './contextEngine.js';
import { triggerVisualUpdate } from './visualSystem.js';
import * as UI from './ui.js';
import * as stateManager from './stateManager.js';
import * as syncEngine from './syncEngine.js';
import { startAstralAmbushTimer } from './intentRouter.js';

export async function handleGMIntent(
    val,
    state,
    actions,
    isSilent = false
) {
    const { localPlayer, user, activeAvatar } = state;
    const { shiftStratum, savePlayerState, updateMapListener, triggerVisualUpdate: triggerVisual, processRoomEvents } = actions;

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
            if (n.stats) statsStr = ` (AMN: ${n.stats.AMN ?? 20}, WILL: ${n.stats.WILL}, AWR: ${n.stats.AWR}, PHYS: ${n.stats.PHYS})`;
            const bio = n.description || "A mysterious entity.";
            const personal = n.personality || n.behavior || "Standing idle.";
            return `[NPC] ${n.name}${statsStr}\n- LORE: ${bio}\n- PERSONALITY: ${personal}`;
        }).join('\n') || "None";
        
        // 1. BUILD MODULAR CONTEXT
        const systemPrompt = buildSystemPrompt(localPlayer, currentRoomData, inventoryNames, npcText, state.strata);

        // 2. USER INTENT
        let userPrompt = `PLAYER ACTION: "${val}"\n\nEvaluate this intent against the system rules and current room state. Respond ONLY in the requested JSON format.`;
        
        // STRATUM-SPECIFIC COMBAT INJECTION
        const { strata } = stateManager.getState();
        const stratumData = strata[localPlayer.stratum.toLowerCase()];
        
        if (stratumData?.rules?.combat === 'Battle of Wills' && (localPlayer.combat.active || val.toLowerCase().includes('attack') || val.toLowerCase().includes('will force'))) {
            userPrompt += `\n\n[SYSTEM REMINDER]: The player is in ASTRAL COMBAT (Battle of Wills). Attacks like "WILL FORCE" or "ASTRAL WEAPON" MUST deal 5-10 "damage_to_npc". Ensure "combat_active" stays true until the NPC's WILL is 0. Do NOT resolve combat just because the player looks around.`;
            if (localPlayer.combat.active) {
                userPrompt += ` The enemy is already spawned. DO NOT use world_edit: { type: "spawn_npc" } again.`;
            }
        }

        if (localPlayer.stratum === 'astral' && activeAvatar && !localPlayer.combat.active) {
            userPrompt += `\n\n[ASTRAL MIRROR DIRECTIVE]: If spawning a Shadow or hostile anomaly, instruct the AI to manifest a "corrupted, glass-serrated, non-Euclidean shadow" version of the player's own character. Player Avatar: Name=${activeAvatar.name}, Desc=${activeAvatar.visual_prompt || activeAvatar.archetype}.`;
        }

        // 3. API CALL
        let res = await callGemini(userPrompt, systemPrompt);
        
        if (typeof res === 'string') {
            console.warn("[SYSTEM ERROR] Gemini returned unparseable string. Constructing fallback object.");
            res = {
                narrative: "The system shudders. A cognitive error disrupts your intent.",
                speaker: "SYSTEM",
                combat_active: localPlayer.combat.active,
                suggested_actions: ["Try again", "Observe surroundings"]
            };
        }
        
        let stateChanged = false;

        // Manual Damage Override: Ensure keywords do damage if AI is being stingy
        // Check both current state and the AI's intended state
        const isActuallyCombat = localPlayer.combat.active || res.combat_active;
        if (stratumData?.rules?.combat === 'Battle of Wills' && isActuallyCombat) {
            const v = val.toLowerCase();
            if (v.includes('will force') || v.includes('astral weapon') || v.includes('attack')) {
                res.damage_to_npc = Math.max(5, res.damage_to_npc || 0);
            }
        }

        // Handle Combat State from AI
        if (res.combat_active !== undefined) {
            if (res.combat_active && !localPlayer.combat.active) {
                let opponentName = res.speaker || "Shadow";
                if (res.world_edit?.type === 'spawn_npc' && res.world_edit.npc?.name) {
                    opponentName = res.world_edit.npc.name;
                }
                
                // Absolute Prevent: Don't set the system or narrator as the combat target
                const lowerO = opponentName.toLowerCase();
                if (lowerO === 'narrator' || lowerO === 'system' || lowerO === 'tandy') {
                    opponentName = "Shadow Entity"; 
                }
                
                stateManager.updatePlayer({ 
                    combat: { active: true, opponent: opponentName } 
                });
                if (!isSilent) UI.addLog(`[SYSTEM]: COMBAT INITIALIZED. BATTLE OF WILLS ENGAGED.`, "var(--term-red)");
                stateChanged = true;
            } else if (!res.combat_active && localPlayer.combat.active) {
                const opponentName = (localPlayer.combat.opponent || "Shadow").toLowerCase();
                
                if (opponentName.includes('shadow')) {
                    // Absolute Combat Locking
                    // Ignore AI attempts to end combat prematurely against Astral Shadows.
                    // HP/WILL conditions further down will override cleanly upon death.
                    res.combat_active = true;
                } else {
                    stateManager.updatePlayer({ 
                        combat: { active: false, opponent: null } 
                    });
                    if (!isSilent) UI.addLog(`[SYSTEM]: Combat resolved.`, "var(--term-green)");
                    stateChanged = true;
                }
            }
        }

        // Handle Damage to Player
        if (res.damage_to_player && activeAvatar) {
            const dmg = res.damage_to_player || 0;
            const currentHP = activeAvatar.hp !== undefined ? activeAvatar.hp : (activeAvatar.stats.PHYS || 20);
            const newHP = Math.max(0, currentHP - dmg);
            
            const updatedAvatar = { 
                ...activeAvatar, 
                hp: newHP
            };
            
            stateManager.updatePlayer({ activeAvatar: updatedAvatar });
            if (!isSilent) UI.addLog(`>>> [ ASTRAL FEEDBACK ]: YOU TOOK ${res.damage_to_player} PHYSICAL DMG <<<`, "#ff0055");
            if (actions.syncAvatarStats) actions.syncAvatarStats(activeAvatar.id, { hp: newHP });

            if (newHP <= 0) {
                if (!isSilent) UI.addLog(`[SYSTEM]: Your physical form has failed. Connection severed.`, "var(--term-red)");
                // Defeat Sequence: Teleport to bedroom, restore HP
                const restoredAvatar = { ...updatedAvatar, hp: activeAvatar.stats.PHYS || 20 };
                stateManager.updatePlayer({ activeAvatar: restoredAvatar });
                if (actions.syncAvatarStats) actions.syncAvatarStats(activeAvatar.id, { hp: restoredAvatar.hp });
                stateManager.updatePlayer({ 
                    currentRoom: "bedroom", 
                    stratum: "mundane",
                    combat: { active: false, opponent: null }
                });
                if (updateMapListener) await updateMapListener();
                if (triggerVisual) triggerVisual();
                shiftStratum('mundane');
                stateChanged = true;
                if (!isSilent) UI.addLog(`[NARRATOR]: You gasp as you wake up in your bedroom, the nightmare fading into a cold sweat.`, "#888");
            }
        }

        // Handle Lore Creation
        if (res.create_lore) {
            syncEngine.saveLoreFragment(localPlayer.currentRoom, res.create_lore);
            if (!isSilent) UI.addLog(`[SYSTEM]: Lore fragment crystallized: ${res.create_lore.title}`, "var(--term-amber)");
        }

        // Handle Damage to NPC (Battle of Wills)
        const isCombatTurn = stateManager.getState().localPlayer.combat.active || res.combat_active;
        if (res.damage_to_npc && isCombatTurn) {
            const currentState = stateManager.getState();
            const activeMap = stateManager.getActiveMap();
            const room = activeMap[currentState.localPlayer.currentRoom] || { npcs: [] };
            
            // Try to find the opponent name from state, then from AI response speaker, then fallback to "Shadow"
            let opponentName = (currentState.localPlayer.combat.opponent || res.speaker || "Shadow").toLowerCase();
            if (opponentName === 'narrator' || opponentName === 'system') opponentName = "shadow";
            
            // Fuzzy match for NPC name, or grab the only available target if unambiguous
            let npc = room.npcs?.find(n => {
                const lname = (n.name || "").toLowerCase();
                const isFallbackMatch = opponentName.includes('narrator') || opponentName.includes('system') || opponentName.includes('shadow');
                return lname === opponentName || lname.includes(opponentName) || opponentName.includes(lname) || isFallbackMatch;
            });

            if (!npc && room.npcs?.length === 1) npc = room.npcs[0];
            
            if (npc) {
                if (!npc.stats) npc.stats = { AMN: 20, WILL: 7, AWR: 7, PHYS: 6 };
                const dmg = res.damage_to_npc || 0;
                const currentWill = npc.stats.WILL !== undefined ? npc.stats.WILL : 7;
                const newNpcWill = Math.max(0, currentWill - dmg);
                npc.stats.WILL = newNpcWill;
                
                // CRITICAL FIX: Update the state so the damage persists even if NPC hasn't reached 0 WILL
                stateManager.updateMapNode(currentState.localPlayer.currentRoom, { npcs: room.npcs });
                syncEngine.updateMapNode(currentState.localPlayer.currentRoom, { npcs: room.npcs });

                if (!isSilent) UI.addLog(`>>> [ ASTRAL FEEDBACK ]: ${npc.name.toUpperCase()} TOOK ${res.damage_to_npc} WILL DMG <<< (Remaining: ${newNpcWill})`, "#00ffff");
                
                if (newNpcWill <= 0) {
                    if (!isSilent) UI.addLog(`[SYSTEM]: ${npc.name} has been dissipated. Victory!`, "var(--term-green)");
                    // FIX: Remove all shadow clones from the room to clean up corrupted game states
                    room.npcs = room.npcs.filter(n => {
                        const lname = n.name.toLowerCase();
                        return !lname.includes('shadow') && !lname.includes(npc.name.toLowerCase()) && !lname.includes('unknown entity');
                    });
                    
                    stateManager.updateMapNode(currentState.localPlayer.currentRoom, { npcs: room.npcs });
                    syncEngine.updateMapNode(currentState.localPlayer.currentRoom, { npcs: room.npcs });

                    // Reset Combat State
                    stateManager.updatePlayer({ combat: { active: false, opponent: null } });
                    stateChanged = true;

                    // Auto-grant Resonant Key and Shift Stratum if Shadow is defeated
                    const isNexusBoss = npc.name.toLowerCase().includes("shadow") || 
                                        npc.name.toLowerCase().includes("unknown entity") || 
                                        currentState.localPlayer.currentRoom.includes('astral_entry');
                                        
                    if (isNexusBoss) {
                        const key = { name: "Resonant Key", type: "Key Item", description: "A vibrating, semi-translucent key that resonates with the apartment's front door." };
                        const currentLocalPlayer = stateManager.getState().localPlayer;
                        if (!currentLocalPlayer.inventory.some(i => i.name === key.name)) {
                            stateManager.updatePlayer({ inventory: [...currentLocalPlayer.inventory, key] });
                        }
                        
                        if (currentLocalPlayer.stratum !== 'mundane') {
                            // 1. Break the generator in the physical realm
                            // Derive the instanced closet ID from the current player state.
                            // The astral room is `astral_entry_{avatarId}`; the closet is `instance_{uid}_closet`.
                            const { user: currentUser } = stateManager.getState();
                            const closetRoomId = currentUser
                                ? `instance_${currentUser.uid}_closet`
                                : 'closet'; // Fallback for guests
                            const activeMap = stateManager.getActiveMap();
                            const closet = activeMap[closetRoomId] || activeMap['closet'];
                            const resolvedClosetId = activeMap[closetRoomId] ? closetRoomId : 'closet';
                            if (closet && closet.description) {
                                const newDesc = closet.description.replace('arcing with potential energy', 'smoking, its quantum core shattered');
                                stateManager.updateMapNode(resolvedClosetId, { description: newDesc });
                                syncEngine.updateMapNode(resolvedClosetId, { description: newDesc });
                            }
                            
                            // 2. Queue the async MacGuffin Quest Generator
                            (async () => {
                                try {
                                    const macGuffinRes = await callGemini(
                                        `A hyper-advanced, occult-scientific "Hacked Schumann Resonance Generator" just shattered. Create a highly creative, 1-3 word name for the single critical component that needs to be replaced. Example: "Flux Capacitor", "Quantum Lobe", "Resonant Focusing Crystal", "Aetheric Diode". Output ONLY JSON format.`, 
                                        "You are a sci-fi game engineer.",
                                        { type: "object", properties: { part_name: { type: "string" } }, required: ["part_name"] }
                                    );
                                    
                                    const partName = macGuffinRes?.part_name || "Aethal Relay Tube";
                                    const newQuest = {
                                        id: `quest_${Date.now()}`,
                                        title: "Fix Resonator",
                                        rank: 5,
                                        description: `Your internal clash destabilized the Schumann Generator in your closet. To restore targeted planar traversal, you must locate a [${partName.toUpperCase()}] and install it.`,
                                        status: "active",
                                        objectives: [
                                            { desc: `Find a ${partName}`, completed: false },
                                            { desc: `Install ${partName} in the Schumann Generator`, completed: false }
                                        ]
                                    };
                                    
                                    const pState = stateManager.getState().localPlayer;
                                    stateManager.updatePlayer({ quests: [...(pState.quests || []), newQuest] });
                                    UI.addLog(`[SYSTEM]: NEW QUEST ADDED: 'Fix Resonator'. Consult your active tickets.`, "var(--term-amber)");
                                } catch(e) {
                                    console.error("Quest Generation Error", e);
                                }
                            })();

                            stateManager.updatePlayer({ 
                                currentRoom: 'closet', 
                                stratum: 'mundane' 
                            });
                            if (updateMapListener) await updateMapListener();
                            if (triggerVisual) triggerVisual();
                            shiftStratum('mundane');
                            
                            if (!isSilent) UI.addLog(`[NARRATOR]: The frequency stabilizes. The Nexus collapses into static, and you are thrown back into your physical shell. You clench the Resonant Key in your hand.`, "#888");
                            
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
                const entryId = currentLocalPlayer.activeAvatarId ? `astral_entry_${currentLocalPlayer.activeAvatarId}` : 'astral_entry';
                const entryNode = {
                    name: "Astral Nexus", shortName: "NEXUS",
                    description: "The entry point to your isolated astral shard. Space is fluid and glowing.",
                    visualPrompt: "Glowing astral nexus portal.",
                    exits: {}, pinnedView: null, items: [], marginalia: [], npcs: []
                };
                stateManager.setLocalAreaCache({ [entryId]: entryNode });
                stateManager.updatePlayer({ currentRoom: entryId });
                stateChanged = true;
                const welcomeMsg = stratumData?.description || "Conventional geometry discarded.";
                if (!isSilent) UI.addLog(`[SYSTEM]: ${welcomeMsg}`, "var(--astral-pink)");
                startAstralAmbushTimer(entryId, 45000);
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
            const target = res.give_item.target;
            
            if (target && target !== 'player') {
                const activeMap = stateManager.getActiveMap();
                const currentRoomData = activeMap[updatedLocalPlayer.currentRoom];
                
                // Find NPC in current room
                const npc = currentRoomData.npcs?.find(n => 
                    n.name.toLowerCase() === target.toLowerCase() || 
                    n.id === target
                );

                if (npc) {
                    if (!npc.inventory) npc.inventory = [];
                    npc.inventory.push(res.give_item);
                    
                    // Update locally
                    stateManager.updateMapNode(updatedLocalPlayer.currentRoom, { npcs: currentRoomData.npcs });
                    
                    // Persist to Firestore
                    await syncEngine.updateNPCInRoom(updatedLocalPlayer.currentRoom, npc.id || npc.name, { inventory: npc.inventory });
                    
                    if (!isSilent) UI.addLog(`[SYSTEM]: ${npc.name} has received [${res.give_item.name}].`, "var(--term-amber)");
                } else {
                    // Fallback to player if target not found
                    stateManager.updatePlayer({ inventory: [...updatedLocalPlayer.inventory, res.give_item] });
                    if (!isSilent) UI.addLog(`[REWARD]: You have obtained [${res.give_item.name}].`, "var(--term-green)");
                }
            } else {
                stateManager.updatePlayer({ inventory: [...updatedLocalPlayer.inventory, res.give_item] });
                if (!isSilent) UI.addLog(`[REWARD]: You have obtained [${res.give_item.name}].`, "var(--term-green)");
            }
            stateChanged = true;
        }

        if (res.trigger_respawn) {
            const currentAvatar = stateManager.getState().activeAvatar;
            if (currentAvatar && user) syncEngine.markCharacterDeceased(currentAvatar.id);
            stateManager.updatePlayer({ 
                activeAvatar: null,
                currentRoom: "bedroom", 
                stratum: "mundane" 
            });
            if (updateMapListener) await updateMapListener();
            if (triggerVisual) triggerVisual();
            stateChanged = true;
            if (!isSilent) UI.addLog(`Vessel destroyed. Connection severed.`, "var(--term-red)"); 
            shiftStratum('mundane');
        }
        
        if (res.trigger_teleport && !res.trigger_respawn) {
            let t = res.trigger_teleport;
            const activeMap = stateManager.getActiveMap();
            const currentLocalPlayer = stateManager.getState().localPlayer;
            
            // Fuzzy Match Protection: Check if the AI invented a new ID for an existing room name
            const existingEntry = Object.entries(activeMap).find(([id, r]) => 
                id.toLowerCase() === t.new_room_id.toLowerCase() || 
                r.name.toLowerCase() === t.name.toLowerCase()
            );

            if (existingEntry) {
                t.new_room_id = existingEntry[0];
            }

            // --- EXIT LOCK ENFORCEMENT (mirrors intentRouter.js) ---
            // Find the exit definition in the current room that leads to this target,
            // so we can enforce reqAuth and itemReq locks even for AI-directed movement.
            const currentRoomData = activeMap[currentLocalPlayer.currentRoom] || {};
            const matchingExit = Object.values(currentRoomData.exits || {}).find(exit =>
                typeof exit === 'object' && exit.target === t.new_room_id
            );
            if (matchingExit) {
                if (matchingExit.reqAuth && (!user || user.isAnonymous)) {
                    if (!isSilent) {
                        UI.addLog(matchingExit.lockMsg || "[SYSTEM]: Identity anchor required. Type 'LOGIN' to register your frequency.", "#b084e8");
                        window.dispatchEvent(new CustomEvent('trigger-login-wizard'));
                    }
                    return; // Abort the teleport
                }
                if (matchingExit.itemReq) {
                    const hasItem = (currentLocalPlayer.inventory || []).some(i =>
                        i.name.toLowerCase().includes(matchingExit.itemReq.toLowerCase())
                    );
                    if (!hasItem) {
                        if (!isSilent) UI.addLog(matchingExit.lockMsg || `[SYSTEM]: Required item missing: [${matchingExit.itemReq}].`, "var(--term-amber)");
                        return; // Abort the teleport
                    }
                }
            }

            if (!activeMap[t.new_room_id]) {
                // It's a truly new room, link it back to the current room so they aren't trapped
                const returnDir = "back"; 
                const newRoom = { 
                    ...t, 
                    shortName: t.name.substring(0, 7).toUpperCase(), 
                    exits: { [returnDir]: currentLocalPlayer.currentRoom }, 
                    pinnedView: null, 
                    items: [], 
                    marginalia: [], 
                    npcs: [] 
                };
                
                stateManager.updateMapNode(t.new_room_id, newRoom);
                syncEngine.updateMapNode(t.new_room_id, newRoom);
            }
            stateManager.updatePlayer({ currentRoom: t.new_room_id }); 
            if (triggerVisual) triggerVisual(t.visualPrompt);
            stateChanged = true;
            if (!isSilent) UI.addLog(`Reality warp successful.`, "var(--gm-purple)");
            if (processRoomEvents) processRoomEvents(activeMap[t.new_room_id]);
        }
        
        // Handle Bespoke Detail Projection
        if (res.project_detail) {
            const { prompt, is_permanent } = res.project_detail;
            if (triggerVisual) {
                triggerVisual(prompt, is_permanent);
            }
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
                const currentState = stateManager.getState();
                const activeMap = stateManager.getActiveMap();
                const roomId = currentState.localPlayer.currentRoom;
                
                // Safely get the room, ensuring arrays exist
                const room = activeMap[roomId] || {};
                const currentNpcs = room.npcs || [];
                
                const edit = res.world_edit.npc || {};
                let v_prompt = edit.visual_prompt || edit.description || edit.personality;
                
                // ASTRAL MIRROR VISUAL OVERRIDE
                if (currentState.localPlayer.stratum === 'astral' && edit.name?.toLowerCase().includes('shadow') && currentState.activeAvatar) {
                    v_prompt = `${currentState.activeAvatar.visual_prompt || currentState.activeAvatar.archetype}. Dark mirror, cosmic horror, void static.`;
                }

                const newNpc = { 
                    id: `npc_${Date.now()}`, 
                    name: edit.name || "Unknown Entity", 
                    description: edit.description || edit.personality || "A strange entity.",
                    visual_prompt: v_prompt || "A strange entity.",
                    archetype: edit.archetype || "Unknown",
                    stats: edit.stats || { AMN: 20, WILL: 7, AWR: 7, PHYS: 6 },
                    image: null 
                };
                
                // 1. Push to local array
                currentNpcs.push(newNpc);
                
                // 2. Update local state immediately so UI updates
                stateManager.updateMapNode(roomId, { npcs: currentNpcs });
                
                // 3. Save to Firebase Room Document
                syncEngine.updateMapNode(roomId, { npcs: currentNpcs });
                
                if (!isSilent) UI.addLog(`[SYSTEM]: WARNING. Entity [${newNpc.name}] has manifested in the sector.`, "var(--term-amber)");

                // 4. If combat is active, immediately trigger portrait generation
                if (res.combat_active || currentState.localPlayer.combat.active) {
                    (async () => {
                        try {
                            const { strata } = stateManager.getState();
                            const b64 = await generatePortrait(newNpc.visual_prompt, currentState.localPlayer.stratum, strata);
                            if (b64) {
                                newNpc.image = await compressImage(`data:image/png;base64,${b64}`, 400, 0.7);
                                stateManager.updateMapNode(roomId, { npcs: currentNpcs });
                                syncEngine.updateMapNode(roomId, { npcs: currentNpcs });
                            }
                        } catch (e) {
                            console.error("Portrait auto-gen failed for spawned combatant:", e);
                        }
                    })();
                }
            }
        }
        
        const isLooking = val.toLowerCase().includes('look') || val.toLowerCase().includes('examine') || val.toLowerCase().includes('search');
        
        // AUTO-REPAIR MISSING NPC PORTRAITS ON LOOK OR COMBAT
        if ((isLooking || isCombatTurn) && currentRoomData.npcs) {
            // Display stats if looking at a specific NPC
            const lookMatch = val.toLowerCase().match(/(?:look at|examine|search)\s+(.+)/);
            if (lookMatch) {
                const targetName = lookMatch[1].trim();
                const targetedNpc = currentRoomData.npcs.find(n => 
                    n.name.toLowerCase() === targetName || 
                    n.name.toLowerCase().includes(targetName) ||
                    targetName.includes(n.name.toLowerCase())
                );
                if (targetedNpc && targetedNpc.stats) {
                    const s = targetedNpc.stats;
                    UI.addLog(`[ANALYSIS]: ${targetedNpc.name} - AMN: ${s.AMN ?? 20}, WILL: ${s.WILL ?? 0}, AWR: ${s.AWR ?? 0}, PHYS: ${s.PHYS ?? 0}`, "var(--term-amber)");
                }
            }

            for (let [idx, npc] of currentRoomData.npcs.entries()) {
                // Ensure visual_prompt exists (fallback to description)
                if (!npc.visual_prompt) {
                    npc.visual_prompt = npc.description || npc.personality || "A mysterious figure.";
                }

                if (npc.visual_prompt && !npc.image) {
                    if (!isSilent) UI.addLog(`[REPAIR]: Re-weaving visual imprint for ${npc.name}...`, "var(--term-amber)");
                    const { strata } = stateManager.getState();
                    const b64 = await generatePortrait(npc.visual_prompt, stateManager.getState().localPlayer.stratum, strata);
                    if (b64) {
                        currentRoomData.npcs[idx].image = await compressImage(`data:image/png;base64,${b64}`, 400, 0.7) || null;
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
