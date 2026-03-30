import { callGemini, generatePortrait, compressImage } from './apiService.js';
import { buildSystemPrompt } from './contextEngine.js';
import { triggerVisualUpdate } from './visualSystem.js';
import * as UI from './ui.js';
import * as stateManager from './stateManager.js';
import * as syncEngine from './syncEngine.js';
import { startAstralAmbushTimer } from './intentRouter.js';

import * as CombatTimer from './combatTimer.js';

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
        let targetRoomId = localPlayer.currentRoom;

        // Manual Damage Override: Ensure keywords do damage if AI is being stingy
        const isActuallyCombat = localPlayer.combat.active || res.combat_active;
        if (stratumData?.rules?.combat === 'Battle of Wills' && isActuallyCombat) {
            const v = val.toLowerCase();
            if (v.includes('will force') || v.includes('astral weapon') || v.includes('attack')) {
                res.damage_to_npc = Math.max(5, res.damage_to_npc || 0);
            }
        }

        // --- PHASE 1: TELEPORTATION & ROOM SHIFTS ---
        // Handle this first so world edits happen in the correct location.
        if (res.trigger_teleport && !res.trigger_respawn) {
            let t = res.trigger_teleport;
            const existingEntry = Object.entries(activeMap).find(([id, r]) => 
                (t.new_room_id && id.toLowerCase() === t.new_room_id.toLowerCase()) || 
                (t.name && r.name && r.name.toLowerCase() === t.name.toLowerCase())
            );
            if (existingEntry) t.new_room_id = existingEntry[0];

            if (t.new_room_id) {
                targetRoomId = t.new_room_id;
                if (!activeMap[targetRoomId]) {
                    const newRoom = { 
                        ...t, 
                        shortName: t.name ? t.name.substring(0, 7).toUpperCase() : "AREA", 
                        exits: { back: localPlayer.currentRoom }, 
                        pinnedView: null, items: [], marginalia: [], npcs: [],
                        metadata: { stratum: localPlayer.stratum, isInstance: true, owner: user?.uid || 'guest' }
                    };
                    stateManager.updateMapNode(targetRoomId, newRoom);
                    await syncEngine.updateMapNode(targetRoomId, newRoom);
                }
                stateManager.updatePlayer({ currentRoom: targetRoomId });
                stateChanged = true;
                if (!isSilent) UI.addLog(`Reality warp successful.`, "var(--gm-purple)");
            }
        }

        // --- PHASE 2: WORLD EDITS (Manifesting Entities/Items) ---
        if (res.world_edit) {
            const currentMap = stateManager.getActiveMap();
            const room = currentMap[targetRoomId] || { npcs: [], items: [], marginalia: [], exits: {} };
            
            if (res.world_edit.type === 'add_marginalia' && res.world_edit.text) {
                const marginalia = [...(room.marginalia || []), res.world_edit.text];
                stateManager.updateMapNode(targetRoomId, { marginalia });
                syncEngine.addArrayElementToNode(targetRoomId, 'marginalia', res.world_edit.text);
            } else if (res.world_edit.type === 'spawn_npc' && res.world_edit.npc) {
                const edit = res.world_edit.npc;
                let v_prompt = edit.visual_prompt || edit.description || edit.personality;
                
                if (localPlayer.stratum === 'astral' && edit.name?.toLowerCase().includes('shadow') && activeAvatar) {
                    const avatarDesc = activeAvatar.visual_prompt || activeAvatar.description || activeAvatar.archetype;
                    v_prompt = avatarDesc
                        ? `${avatarDesc}. Stylized as a distorted digital reflection with neon glitch effects and purple energy.`
                        : `A mysterious humanoid figure with neon purple glitch effects, digital distortion, futuristic aesthetic.`;
                }

                const newNpc = { 
                    id: `npc_${Date.now()}`, 
                    name: edit.name || "Unknown Entity", 
                    description: edit.description || edit.personality || "A strange entity.",
                    visual_prompt: v_prompt || "A strange entity.",
                    archetype: edit.archetype || "Unknown",
                    stats: edit.stats || { AMN: 20, WILL: 7, AWR: 7, PHYS: 6 },
                    image: (edit.name?.toLowerCase().includes('shadow')) ? "https://placehold.co/400x512/1a0033/a855f7.png?text=SHADOW+ENTITY" : null 
                };
                
                console.log(`[GM DEBUG] Spawning NPC [${newNpc.name}] in room [${targetRoomId}]`);
                
                // Fetch FRESH state before updating NPCs to avoid race conditions with teleport room creation
                const latestMap = stateManager.getActiveMap();
                const latestRoom = latestMap[targetRoomId] || { npcs: [] };
                const currentNpcs = [...(latestRoom.npcs || [])];
                currentNpcs.push(newNpc);
                
                stateManager.updateMapNode(targetRoomId, { npcs: currentNpcs });
                await syncEngine.addArrayElementToNode(targetRoomId, 'npcs', newNpc);
                
                if (!isSilent) UI.addLog(`[SYSTEM]: WARNING. Entity [${newNpc.name}] has manifested in the sector.`, "var(--term-amber)");

                // --- PORTRAIT GENERATION ---
                (async () => {
                    try {
                        const { strata } = stateManager.getState();
                        console.log(`[GM DEBUG] PORTRAIT GENERATION START for ${newNpc.name}. Prompt: ${newNpc.visual_prompt.substring(0, 50)}...`);
                        
                        const b64 = await generatePortrait(newNpc.visual_prompt, localPlayer.stratum, strata);
                        const finalImage = b64
                            ? await compressImage(`data:image/png;base64,${b64}`, 400, 0.7)
                            : "https://placehold.co/400x512/1a0033/a855f7.png?text=SHADOW+ENTITY";

                        newNpc.image = finalImage;

                        // Re-fetch room to avoid clobbering any other concurrent state changes
                        const mapNow = stateManager.getActiveMap();
                        const roomNow = mapNow[targetRoomId];
                        if (roomNow?.npcs) {
                            const updatedNpcs = roomNow.npcs.map(n => n.id === newNpc.id ? { ...newNpc } : n);
                            stateManager.updateMapNode(targetRoomId, { npcs: updatedNpcs });
                            syncEngine.updateMapNode(targetRoomId, { npcs: updatedNpcs });
                            console.log(`[GM DEBUG] NPC [${newNpc.name}] updated with portrait in state.`);
                        }
                    } catch (e) {
                        console.error(`[GM DEBUG] PORTRAIT GENERATION ERROR for ${newNpc.name}:`, e);
                    }
                })();
            } else if (res.world_edit.type === 'spawn_item' && res.world_edit.item) {
                const items = [...(room.items || []), res.world_edit.item];
                stateManager.updateMapNode(targetRoomId, { items });
                syncEngine.addArrayElementToNode(targetRoomId, 'items', res.world_edit.item);
                const itemName = (typeof res.world_edit.item === 'string') ? res.world_edit.item : res.world_edit.item.name;
                if (!isSilent) UI.addLog(`[SYSTEM]: ${itemName} has manifested in the room.`, "var(--term-green)");
            }
        }

        // --- PHASE 3: COMBAT & IDENTITY ---
        if (res.combat_active !== undefined) {
            if (res.combat_active && !localPlayer.combat.active) {
                let opponentName = res.speaker || "Shadow";
                if (res.world_edit?.type === 'spawn_npc' && res.world_edit.npc?.name) {
                    opponentName = res.world_edit.npc.name;
                }
                const lowerO = opponentName.toLowerCase();
                if (lowerO === 'narrator' || lowerO === 'system' || lowerO === 'tandy') opponentName = "Shadow Entity";
                
                stateManager.updatePlayer({ combat: { active: true, opponent: opponentName } });
                if (!isSilent) UI.addLog(`[SYSTEM]: COMBAT INITIALIZED. BATTLE OF WILLS ENGAGED.`, "var(--term-red)");
                stateChanged = true;

                // AUTO-SPAWN FALLBACK: If no NPC was explicitly spawned by Phase 2,
                // we guarantee one exists in the room for portrait + dossier rendering.
                const freshMap = stateManager.getActiveMap();
                const freshRoom = freshMap[targetRoomId] || { npcs: [] };
                const hasCombatant = (freshRoom.npcs || []).some(n => 
                    n.name.toLowerCase().includes(opponentName.toLowerCase()) ||
                    opponentName.toLowerCase().includes(n.name.toLowerCase())
                );

                if (!hasCombatant) {
                    // Build a safe portrait prompt using the avatar's actual appearance if available
                    const avatarDesc = activeAvatar?.visual_prompt || activeAvatar?.description || activeAvatar?.archetype;
                    const shadowVisualPrompt = avatarDesc
                        ? `${avatarDesc}. Stylized as a distorted digital reflection with neon glitch effects and purple energy.`
                        : `A mysterious hooded humanoid figure with neon purple glitch effects, digital distortion, futuristic aesthetic.`;

                    const autoNpc = {
                        id: `npc_${Date.now()}`,
                        name: opponentName,
                        description: "A glass-serrated, digital shadow of your own form.",
                        visual_prompt: shadowVisualPrompt,
                        archetype: "Astral Mirror",
                        stats: { AMN: 20, WILL: 20, AWR: 20, PHYS: 20 },
                        image: "https://placehold.co/400x512/1a0033/a855f7.png?text=MANIFESTING..."
                    };

                    const currentNpcs = [...(freshRoom.npcs || []), autoNpc];
                    stateManager.updateMapNode(targetRoomId, { npcs: currentNpcs });
                    syncEngine.updateMapNode(targetRoomId, { npcs: currentNpcs });

                    console.log(`[GM DEBUG] Auto-spawned [${autoNpc.name}] in [${targetRoomId}] as combat fallback.`);

                    // Generate portrait async without blocking
                    (async () => {
                        try {
                            const { strata } = stateManager.getState();
                            const b64 = await generatePortrait(autoNpc.visual_prompt, localPlayer.stratum, strata);
                            const finalImage = b64
                                ? await compressImage(`data:image/png;base64,${b64}`, 400, 0.7)
                                : "https://placehold.co/400x512/1a0033/a855f7.png?text=SHADOW+ENTITY";
                            
                            const mapNow = stateManager.getActiveMap();
                            const roomNow = mapNow[targetRoomId];
                            if (roomNow?.npcs) {
                                const updatedNpcs = roomNow.npcs.map(n => n.id === autoNpc.id ? { ...n, image: finalImage } : n);
                                stateManager.updateMapNode(targetRoomId, { npcs: updatedNpcs });
                                syncEngine.updateMapNode(targetRoomId, { npcs: updatedNpcs });
                                console.log(`[GM DEBUG] Auto-spawned portrait updated for [${autoNpc.name}].`);
                            }
                        } catch (e) {
                            console.error(`[GM DEBUG] Auto-spawn portrait failed:`, e);
                        }
                    })();
                }

            } else if (!res.combat_active && localPlayer.combat.active) {
                const opponentName = (localPlayer.combat.opponent || "Shadow").toLowerCase();
                if (opponentName.includes('shadow')) {
                    res.combat_active = true;
                } else {
                    stateManager.updatePlayer({ combat: { active: false, opponent: null } });
                    CombatTimer.stop();
                    if (!isSilent) UI.addLog(`[SYSTEM]: Combat resolved.`, "var(--term-green)");
                    stateChanged = true;
                }
            }
        }

        // --- PHASE 4: DAMAGE & MECHANICS ---
        if (res.damage_to_player && activeAvatar) {
            const dmg = parseInt(res.damage_to_player) || 0;
            const physStat = activeAvatar.stats?.PHYS?.total !== undefined ? activeAvatar.stats.PHYS.total : (activeAvatar.stats?.PHYS || 20);
            const currentHP = (activeAvatar.hp !== undefined && !isNaN(activeAvatar.hp)) ? activeAvatar.hp : physStat;
            const newHP = Math.max(0, currentHP - dmg);
            const updatedAvatar = { ...activeAvatar, hp: newHP };
            stateManager.setActiveAvatar(updatedAvatar);
            if (!isSilent) UI.addLog(`>>> [ ASTRAL FEEDBACK ]: YOU TOOK ${dmg} PHYSICAL DMG <<<`, "#ff0055");
            if (actions.syncAvatarStats) actions.syncAvatarStats(activeAvatar.id, { hp: newHP });

            if (newHP <= 0) {
                stateManager.updatePlayer({ currentRoom: user ? `instance_${user.uid}_bedroom` : 'bedroom', stratum: "mundane", combat: { active: false, opponent: null } });
                if (updateMapListener) await updateMapListener();
                if (triggerVisual) triggerVisual();
                if (shiftStratum) shiftStratum('mundane');
                stateChanged = true;
                if (!isSilent) UI.addLog(`[NARRATOR]: You gasp as you wake up in your bedroom...`, "#888");
            }
        }

        if (res.damage_to_npc && (stateManager.getState().localPlayer.combat.active || res.combat_active)) {
            const currentMap = stateManager.getActiveMap();
            const room = currentMap[targetRoomId] || { npcs: [] };
            let opponentName = (localPlayer.combat.opponent || res.speaker || "Shadow").toLowerCase();
            let npc = room.npcs?.find(n => n.name.toLowerCase().includes(opponentName) || opponentName.includes(n.name.toLowerCase()));
            if (!npc && room.npcs?.length === 1) npc = room.npcs[0];
            
            if (npc) {
                if (!npc.stats) npc.stats = { AMN: 20, WILL: 7, AWR: 7, PHYS: 6 };
                const newWill = Math.max(0, (npc.stats.WILL || 7) - res.damage_to_npc);
                npc.stats.WILL = newWill;
                stateManager.updateMapNode(targetRoomId, { npcs: room.npcs });
                await syncEngine.updateMapNode(targetRoomId, { npcs: room.npcs });
                if (!isSilent) UI.addLog(`>>> [ ASTRAL FEEDBACK ]: ${npc.name.toUpperCase()} TOOK ${res.damage_to_npc} WILL DMG <<<`, "#00ffff");
                
                if (newWill <= 0) {
                    room.npcs = room.npcs.filter(n => n.id !== npc.id);
                    stateManager.updateMapNode(targetRoomId, { npcs: room.npcs });
                    await syncEngine.updateMapNode(targetRoomId, { npcs: room.npcs });
                    stateManager.updatePlayer({ combat: { active: false, opponent: null } });
                    CombatTimer.stop();
                    stateChanged = true;
                    if (!isSilent) UI.addLog(`[SYSTEM]: ${npc.name} dissipate. Victory!`, "var(--term-green)");
                }
            }
        }

        // --- FINALIZATION ---
        if (stateChanged && actions.savePlayerState) actions.savePlayerState();
        if (!isSilent) {
            const speakerPrefix = (res.speaker === 'SYSTEM' || res.speaker === 'NARRATOR') ? `[${res.speaker}]` : `${res.speaker.toUpperCase()}`;
            UI.addLog(`${speakerPrefix}: ${res.narrative}`, res.color);
        }
        if (res.trigger_visual && triggerVisual) triggerVisual();

        return res.suggested_actions || [];
    } catch (err) { 
        console.error(err);
        if (!isSilent) UI.addLog("SYSTEM EVALUATION FAILED!", "var(--term-red)"); 
        return [];
    } finally { 
        if (!isSilent) document.getElementById('thinking-indicator')?.remove(); 
    }
}
