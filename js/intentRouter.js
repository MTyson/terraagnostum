// js/intentRouter.js
import { auth as firebaseAuth, isSyncEnabled } from './firebaseConfig.js';
import { signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import * as stateManager from './stateManager.js';
import * as syncEngine from './syncEngine.js';
import * as UI from './ui.js';
import { handleGMIntent } from './gmEngine.js';
import { startWizard } from './wizardSystem.js';
import { triggerVisualUpdate, togglePinView } from './visualSystem.js';
import { callGemini } from './apiService.js';
import { openForgeModal } from './forgeSystem.js';
import { startTerminal, handleTerminalInput } from './terminalSystem.js';
import { blueprintApartment } from './mapData.js';

import * as CombatTimer from './combatTimer.js';

// --- HELPER WRAPPERS (Local to Router) ---

function getActiveMap() {
    return stateManager.getActiveMap();
}

function getUserTier() {
    return stateManager.getUserTier();
}

export function shiftStratum(targetStratum) {
    const { localPlayer } = stateManager.getState();
    const isChanging = targetStratum !== localPlayer.stratum;
    UI.applyStratumTheme(targetStratum, isChanging);
    stateManager.updatePlayer({ stratum: targetStratum });
    // Force a save to Firestore for stratum changes
    syncEngine.savePlayerState();
}

/**
 * Process any automated events defined in a room's metadata.
 * @param {Object} room - The room object from mapData
 */
export function processRoomEvents(room) {
    if (!room || !room.specialEvents) return;

    const events = Array.isArray(room.specialEvents) ? room.specialEvents : [room.specialEvents];

    events.forEach(event => {
        if (event.when === 'always_upon_entry') {
            if (event.type === 'console_msg' && event.content) {
                UI.addLog(event.content, "var(--term-amber)");
            }
        }
    });
}

// --- NARRATIVE MOVEMENT ENGINE ---
export async function executeMovement(targetDir) {
    const state = stateManager.getState();
    const { localPlayer, user, activeAvatar } = state;

    if (localPlayer.combat.active) {
        UI.addLog(`[SYSTEM]: You cannot disengage while in combat with ${localPlayer.combat.opponent}!`, "var(--term-red)");
        return;
    }
    const activeMap = getActiveMap();
    const currentRoom = activeMap[localPlayer.currentRoom];
    
    if (!currentRoom) {
        UI.addLog('[SYSTEM]: Dimensional synchronization in progress. Please wait for the sector to stabilize.', 'var(--term-amber)');
        UI.addLog('[SYSTEM]: If synchronization fails, type "/RECALIBRATE" to return to your primary anchor.', 'var(--term-amber)');
        return;
    }
    
    const { strata } = stateManager.getState();
    const stratumData = strata[localPlayer.stratum.toLowerCase()];
    const isAstral = localPlayer.stratum === 'astral' || 
                     localPlayer.currentRoom.toLowerCase().includes('astral') ||
                     stratumData?.rules?.combat === 'Battle of Wills';

    if (isAstral) {
        const currentRoomData = activeMap[localPlayer.currentRoom];
        
        if (currentRoomData.exits && currentRoomData.exits[targetDir]) {
            const nextId = typeof currentRoomData.exits[targetDir] === 'string' ? currentRoomData.exits[targetDir] : currentRoomData.exits[targetDir].target;
            
            stateManager.updatePlayer({ currentRoom: nextId });
            syncEngine.savePlayerState();
            const updatedActiveMap = getActiveMap();
            const nextRoom = updatedActiveMap[nextId];
            const travelMsg = stratumData ? `You traverse the ${stratumData.name} currents to ${nextRoom.name}.` : `You traverse the astral currents to ${nextRoom.name}.`;
            UI.addLog(`[SYSTEM]: ${travelMsg}`, "var(--term-green)");
            UI.printRoomDescription(nextRoom, true, updatedActiveMap, activeAvatar);
            processRoomEvents(nextRoom);
            return;
        }

        // No exit exists yet, start the generation sequence
        startWizard('astral_voyage', { direction: targetDir, fromId: localPlayer.currentRoom });
        const promptLabel = stratumData ? stratumData.id.toUpperCase() : 'ASTRAL';
        UI.setWizardPrompt(`${promptLabel}@VOYAGE:~$`);
        const voidMsg = stratumData ? `into the ${stratumData.flavor || 'kaleidoscopic void'}` : `into the kaleidoscopic void`;
        UI.addLog(`[SYSTEM]: You move ${targetDir.toUpperCase()} ${voidMsg}.`, "var(--term-green)");
        UI.addLog(`[WIZARD]: As the colors shift and reality warps, what do you see manifesting before you? (Describe the next sector)`, "var(--term-amber)");
        return;
    }
    
    if (currentRoom.exits && currentRoom.exits[targetDir]) {
        const targetExit = currentRoom.exits[targetDir];
        let targetRoomId = typeof targetExit === 'string' ? targetExit : targetExit.target;

        // --- INSTANCED HOME ROUTING ---
        // Funnel players traversing back from global public zones into their private dimension
        if (blueprintApartment[targetRoomId] && user) {
            targetRoomId = `instance_${user.uid}_${targetRoomId}`;
        }

        // --- GENERIC EXIT LOCKS ---
        if (typeof targetExit === 'object') {
            if (targetExit.locked) {
                UI.addLog(targetExit.lockMsg || "The way is locked.", "var(--term-amber)");
                return;
            }
            if (targetExit.reqAuth && (!user || user.isAnonymous)) {
                UI.addLog("[SYSTEM]: You need to anchor your vessel. /login or /register.", "#b084e8");
                return;
            }
            if (targetExit.itemReq) {
                const hasItem = (localPlayer.inventory || []).some(i => i.name.toLowerCase().includes(targetExit.itemReq.toLowerCase()));
                if (!hasItem) {
                    UI.addLog(targetExit.lockMsg || `[SYSTEM]: Required item missing: [${targetExit.itemReq}].`, "var(--term-amber)");
                    return;
                }
            }
        }

        // --- CACHE VALIDATION ---
        if (!activeMap[targetRoomId]) {
            UI.addLog("[SYSTEM]: Dimensional synchronization in progress. Please wait for the sector to stabilize.", "var(--term-amber)");
            UI.addLog('[SYSTEM]: Type "/RECALIBRATE" if you are stuck.', 'var(--term-amber)');
            return;
        }

        // --- INTERNAL MOVEMENT ---
        UI.addLog(`[SYSTEM]: You move ${targetDir.toUpperCase()}.`, "var(--term-green)");
        stateManager.updatePlayer({ currentRoom: targetRoomId });
        
        syncEngine.savePlayerState();
        triggerVisualUpdate(null, stateManager.getState().localPlayer, stateManager.getActiveMap(), user);
        processRoomEvents(activeMap[targetRoomId]);
    } else if (localPlayer.explorerMode) {
        await handleExploration(targetDir);
    } else {
        UI.addLog(`[SYSTEM]: You cannot go that way.`, "var(--term-amber)");
    }
}

async function handleExploration(targetDir) {
    const state = stateManager.getState();
    const { localPlayer, activeAvatar, user } = state;
    const activeMap = getActiveMap();
    const currentRoom = activeMap[localPlayer.currentRoom];
    
    stateManager.setProcessing(true);
    UI.addLog(`<span id="thinking-indicator" class="italic" style="color: var(--gm-purple)">CONSULTING THE ARCHITECT...</span>`);
    
    try {
        const sysPrompt = `You are the Architect of Terra Agnostum. The player is moving ${targetDir.toUpperCase()}.
        Based on the current room: "${currentRoom.name}" - "${currentRoom.description}", determine if movement in this direction is logical.
        For example, if the description says there's a door to the north, then north is logical. 
        If the player is in an open field, any direction might be logical.
        If movement is possible, generate a new room. 
        Respond STRICTLY in JSON: 
        { 
            "possible": true/false, 
            "reasoning": "Brief explanation if movement is not possible",
            "name": "New Room Name", 
            "description": "Atmospheric narrative description", 
            "visual_prompt": "Detailed prompt for image generation" 
        }`;
        
        const res = await callGemini(`Can I move ${targetDir}?`, sysPrompt);
        
        if (res && res.possible) {
            const newRoomId = 'room_' + crypto.randomUUID().split('-')[0];
            const getOpposite = (d) => ({'north':'south','south':'north','east':'west','west':'east'})[d] || 'out';
            const backDir = getOpposite(targetDir);
            
            const newRoom = {
                name: res.name,
                shortName: res.name.substring(0, 7).toUpperCase(),
                description: res.description,
                visualPrompt: res.visual_prompt,
                exits: { [backDir]: localPlayer.currentRoom },
                items: [], npcs: [],
                metadata: { stratum: localPlayer.stratum, isEditable: true }
            };
            
            // 1. Save new room
            stateManager.updateMapNode(newRoomId, newRoom);
            syncEngine.updateMapNode(newRoomId, newRoom);

            // 2. Link current room to new room
            const currentExits = { ...(currentRoom.exits || {}), [targetDir]: newRoomId };
            stateManager.updateMapNode(localPlayer.currentRoom, { exits: currentExits });
            syncEngine.updateMapNode(localPlayer.currentRoom, { [`exits.${targetDir}`]: newRoomId });

            // 3. Move player
            UI.addLog(`[SYSTEM]: Reality warps as you move ${targetDir.toUpperCase()}.`, "var(--term-green)");
            stateManager.updatePlayer({ currentRoom: newRoomId });
            syncEngine.savePlayerState();
            
            const updatedActiveMap = getActiveMap();
            UI.printRoomDescription(newRoom, localPlayer.stratum === 'astral', updatedActiveMap, activeAvatar);
            triggerVisualUpdate(res.visual_prompt, stateManager.getState().localPlayer, updatedActiveMap, user, true);
            processRoomEvents(newRoom);
        } else {
            UI.addLog(`[SYSTEM]: ${res.reasoning || "The logic of this sector forbids movement in that direction."}`, "var(--term-amber)");
        }
    } catch (err) {
        console.error("Exploration error:", err);
        UI.addLog("[SYSTEM ERROR]: Reality stabilization failed.", "var(--term-red)");
    } finally {
        document.getElementById('thinking-indicator')?.remove();
        stateManager.setProcessing(false);
    }
}

// --- COMMAND PARSER ---
export async function handleCommand(val) {
    const state = stateManager.getState();
    const { localPlayer, activeAvatar, user, activeTerminal, localCharacters } = state;
    const cmd = val.toLowerCase();

    // --- TERMINAL MODE INTERCEPT ---
    if (activeTerminal) {
        if (handleTerminalInput(val)) return;
    }

    try {
        // INTERCEPT AI SUGGESTION REQUEST
        if (cmd === '💡 suggest' || cmd === 'suggest') {
            UI.renderContextualCommands(['Thinking...']);
        try {
            const activeMap = getActiveMap();
            const suggestions = await handleGMIntent(
                "Provide context-sensitive suggestions.",
                { activeMap, localPlayer, user, activeAvatar, isSyncEnabled: true },
                { 
                    shiftStratum, 
                    savePlayerState: syncEngine.savePlayerState, 
                    refreshStatusUI: () => {}, 
                    renderMapHUD: UI.renderMapHUD,
                    setActiveAvatar: stateManager.setActiveAvatar,
                    syncAvatarStats: () => syncEngine.syncAvatarStats(stateManager.getState().activeAvatar?.id, stateManager.getState().activeAvatar?.stats),
                    updateMapListener: () => syncEngine.updateGlobalMapListener(),
                    processRoomEvents
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

    if (cmd === '🔗 share victory' || cmd === 'share victory' || cmd === 'share') {
        const shareText = `I just defeated a Shadow Entity in the Astral Nexus of Terra Agnostum — a living, AI-mediated text adventure. Come find your vessel. 🔮`;
        const shareUrl = window.location.origin;
        const tweetUrl = `https://x.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`;
        window.open(tweetUrl, '_blank', 'noopener,noreferrer,width=600,height=400');
        import('./stateManager.js').then(({ setShowShareChip }) => setShowShareChip(false));
        UI.addLog(`[SYSTEM]: Transmission broadcast. The signal spreads.`, "var(--term-green)");
        return;
    }

    // =========================================================
    // === ANCHOR PORTAL SYSTEM ================================
    // =========================================================

    // --- ANCHOR PORTAL HERE ---
    const anchorAliases = ['anchor portal here', 'anchor portal', 'set anchor here', 'set anchor', 'mark anchor', '⬡ anchor portal here'];
    if (anchorAliases.includes(cmd)) {
        if (!activeAvatar) {
            UI.addLog('[SYSTEM]: You must have an active vessel to resonate an anchor.', 'var(--term-amber)');
            return;
        }
        if (localPlayer.currentRoom.startsWith('instance_')) {
            UI.addLog('[SYSTEM]: Portals must be anchored in the shared world, not within private instances.', 'var(--term-amber)');
            return;
        }
        if (localPlayer.stratum === 'astral' || localPlayer.currentRoom.includes('astral')) {
            UI.addLog('[SYSTEM]: The Astral is already the source. Anchor from a physical stratum.', 'var(--term-amber)');
            return;
        }

        const activeMap = getActiveMap();
        const astralEntryId = `astral_entry_${activeAvatar.id}`;

        // Remove old portal item if one existed elsewhere
        if (localPlayer.anchorPortal?.roomId && localPlayer.anchorPortal.roomId !== localPlayer.currentRoom) {
            const oldRoom = activeMap[localPlayer.anchorPortal.roomId];
            const oldPortalItem = (oldRoom?.items || []).find(i => i.id === `portal_${user.uid}`);
            if (oldPortalItem) {
                syncEngine.removeItemFromRoom(localPlayer.anchorPortal.roomId, oldPortalItem);
                stateManager.updateMapNode(localPlayer.anchorPortal.roomId, {
                    items: (oldRoom.items || []).filter(i => i.id !== `portal_${user.uid}`)
                });
            }
            UI.addLog('[SYSTEM]: Previous anchor dissolved.', '#888');
        }

        // Build portal item
        const portalItem = {
            id: `portal_${user.uid}`,
            name: 'Resonance Portal',
            type: 'Portal',
            description: `A shimmering fold in the air. It hums with ${activeAvatar.name}'s frequency — warm and familiar to those who know the sign.`,
            scenery: false,
            portalTargetId: astralEntryId,
            portalOwnerName: activeAvatar.name,
            portalOwnerUid: user.uid,
            portalOwnerAvatarId: activeAvatar.id
        };

        // Seed portal item into current room
        const currentRoom = activeMap[localPlayer.currentRoom];
        const updatedItems = [...(currentRoom.items || []).filter(i => i.id !== portalItem.id), portalItem];
        stateManager.updateMapNode(localPlayer.currentRoom, { items: updatedItems });
        await syncEngine.addArrayElementToNode(localPlayer.currentRoom, 'items', portalItem);

        // Add resonator exit to the astral entry room so visitors can return
        const closetId = `instance_${user.uid}_closet`;
        await syncEngine.updateMapNode(astralEntryId, { 'exits.resonator': closetId });

        // Persist anchor to player state
        stateManager.updatePlayer({
            anchorPortal: {
                roomId: localPlayer.currentRoom,
                stratum: localPlayer.stratum,
                astralEntryId,
                active: true
            }
        });
        await syncEngine.savePlayerState();

        // Write to portals registry (used by AIGM Weave in Phase 3)
        await syncEngine.savePortal({
            ownerAvatarName: activeAvatar.name,
            ownerAvatarId: activeAvatar.id,
            astralEntryId,
            anchorRoomId: localPlayer.currentRoom,
            anchorStratum: localPlayer.stratum,
            active: true
        });

        UI.addLog('[SYSTEM]: Resonance anchor set. A fold has materialized here.', 'var(--term-green)');
        UI.addLog(`[TANDY]: Your frequency is now tethered to this place. Anyone who finds this fold can walk your Astral — and exit through your Resonator. Guard it, or leave it open. Your choice.`, '#b084e8');
        return;
    }

    // --- LOCK / UNLOCK PORTAL ---
    if (cmd === 'lock portal' || cmd === 'close portal' || cmd === 'close my portal') {
        if (!localPlayer.anchorPortal?.roomId) {
            UI.addLog('[SYSTEM]: No active anchor portal found.', 'var(--term-amber)');
            return;
        }
        const activeMap = getActiveMap();
        const anchorRoom = activeMap[localPlayer.anchorPortal.roomId];
        const portalItem = (anchorRoom?.items || []).find(i => i.id === `portal_${user.uid}`);
        if (portalItem) {
            syncEngine.removeItemFromRoom(localPlayer.anchorPortal.roomId, portalItem);
            stateManager.updateMapNode(localPlayer.anchorPortal.roomId, {
                items: (anchorRoom.items || []).filter(i => i.id !== `portal_${user.uid}`)
            });
        }
        stateManager.updatePlayer({ anchorPortal: { ...localPlayer.anchorPortal, active: false } });
        await syncEngine.savePlayerState();
        await syncEngine.setPortalActive(user.uid, false);
        UI.addLog('[SYSTEM]: The fold collapses. Your anchor still exists — use \'open portal\' to rekindle it.', 'var(--term-amber)');
        return;
    }

    if (cmd === 'open portal' || cmd === 'unlock portal' || cmd === 'open my portal') {
        if (!localPlayer.anchorPortal?.roomId) {
            UI.addLog('[SYSTEM]: No anchor set. Use \'anchor portal here\' first.', 'var(--term-amber)');
            return;
        }
        if (localPlayer.anchorPortal.active) {
            UI.addLog('[SYSTEM]: Your portal is already open.', '#888');
            return;
        }
        if (!activeAvatar) {
            UI.addLog('[SYSTEM]: You need an active vessel to reopen a portal.', 'var(--term-amber)');
            return;
        }
        const portalItem = {
            id: `portal_${user.uid}`,
            name: 'Resonance Portal',
            type: 'Portal',
            description: `A shimmering fold in the air. It hums with ${activeAvatar.name}'s frequency.`,
            scenery: false,
            portalTargetId: localPlayer.anchorPortal.astralEntryId,
            portalOwnerName: activeAvatar.name,
            portalOwnerUid: user.uid,
            portalOwnerAvatarId: activeAvatar.id
        };
        await syncEngine.addArrayElementToNode(localPlayer.anchorPortal.roomId, 'items', portalItem);
        stateManager.updatePlayer({ anchorPortal: { ...localPlayer.anchorPortal, active: true } });
        await syncEngine.savePlayerState();
        await syncEngine.setPortalActive(user.uid, true);
        UI.addLog('[SYSTEM]: The fold reopens. Your resonance anchor is live.', 'var(--term-green)');
        return;
    }

    // --- ENTER PORTAL (traverse into owner's Astral) ---
    const enterPortalAliases = ['enter portal', 'use portal', 'enter resonance portal', 'use resonance portal', 'step through portal', 'touch portal'];
    // Also handle chip labels like "⬡ Enter Kira Vex's Portal" — match by prefix
    const isEnterPortalCmd = enterPortalAliases.some(a => cmd.startsWith(a)) || cmd.startsWith('⬡ enter') || (cmd.startsWith('enter') && cmd.includes('portal'));
    if (isEnterPortalCmd) {
        const activeMap = getActiveMap();
        const currentRoom = activeMap[localPlayer.currentRoom];
        const portalItem = (currentRoom?.items || []).find(i => i.type === 'Portal' && i.portalTargetId);

        if (!portalItem) {
            UI.addLog('[SYSTEM]: No portal fold detected here.', 'var(--term-amber)');
            return;
        }

        const isOwnPortal = portalItem.portalOwnerUid === user?.uid;
        const targetEntryId = portalItem.portalTargetId;

        UI.addLog(`[NARRATOR]: The fold shimmers. Reality peels back like wet paper. You step through.`, '#888');
        UI.addLog(`[TANDY]: You're in ${isOwnPortal ? 'your own' : `${portalItem.portalOwnerName}'s`} Astral. The Resonator echo is accessible — or explore deeper.`, '#b084e8');

        shiftStratum('astral');
        stateManager.updatePlayer({ currentRoom: targetEntryId });

        // Load entry room from Firestore (it may not be in local cache)
        let entryRoom = activeMap[targetEntryId];
        if (!entryRoom) {
            entryRoom = await syncEngine.loadRoom(targetEntryId);
            if (entryRoom) stateManager.updateMapNode(targetEntryId, entryRoom);
        }

        syncEngine.savePlayerState();

        if (entryRoom) {
            UI.printRoomDescription(entryRoom, true, stateManager.getActiveMap(), activeAvatar);
        } else {
            UI.addLog(`[SYSTEM]: The Astral entry is dark. The owner hasn't shaped it yet.`, 'var(--term-amber)');
        }

        // Notify the portal owner (persisted to Firestore for future login display)
        if (!isOwnPortal && portalItem.portalOwnerUid) {
            const travelerName = activeAvatar?.name || 'An unknown vessel';
            const anchorDesc = currentRoom?.name || 'an unknown place';
            syncEngine.sendNotification(portalItem.portalOwnerUid, {
                type: 'portal_traversal',
                message: `${travelerName} entered your Astral via your portal at ${anchorDesc}.`,
                fromUid: user?.uid || null,
                fromAvatarName: travelerName,
                anchorRoomName: anchorDesc
            });
        }
        return;
    }


    // --- RESONATOR (return through the owner's Resonator from their Astral) ---
    if (cmd === 'resonator' || cmd === 'use resonator' || cmd === 'enter resonator' || cmd === '↩ resonator' || cmd.startsWith('↩')) {
        const activeMap = getActiveMap();
        const currentRoom = activeMap[localPlayer.currentRoom];
        const resonatorTarget = currentRoom?.exits?.resonator;

        if (!resonatorTarget) {
            UI.addLog('[SYSTEM]: No Resonator echo detected in this sector.', 'var(--term-amber)');
            return;
        }

        UI.addLog('[NARRATOR]: You press your consciousness toward the resonator echo. Reality tears. A dim apartment closet appears around you.', '#888');

        // Load the closet room (it's an instanced room, may need loading)
        let closetRoom = activeMap[resonatorTarget];
        if (!closetRoom) {
            closetRoom = await syncEngine.loadRoom(resonatorTarget);
            if (closetRoom) stateManager.updateMapNode(resonatorTarget, closetRoom);
        }

        shiftStratum('mundane');
        stateManager.updatePlayer({ currentRoom: resonatorTarget });
        syncEngine.savePlayerState();

        const updatedMap = stateManager.getActiveMap();
        UI.printRoomDescription(updatedMap[resonatorTarget] || closetRoom, false, updatedMap, activeAvatar);
        return;
    }

    // =========================================================

    if (cmd === 'logout') {
        if (user && user.isAnonymous) {
            UI.addLog("[SYSTEM]: You are currently a GUEST. Logging out will PERMANENTLY DESTROY your vessel and progress. Type '/login' to anchor your signature first, or type 'force logout' to proceed anyway.", "var(--term-amber)");
            return;
        }
        UI.addLog("[SYSTEM]: Severing connection to the Technate...", "var(--term-amber)");
        if (firebaseAuth) {
            signOut(firebaseAuth).then(() => window.location.href = window.location.pathname);
        } else {
            window.location.href = window.location.pathname;
        }
        return;
    }

    if (cmd === 'force logout') {
        UI.addLog("[SYSTEM]: Purging guest signature...", "var(--term-red)");
        if (firebaseAuth) {
            signOut(firebaseAuth).then(() => window.location.href = window.location.pathname);
        } else {
            window.location.href = window.location.pathname;
        }
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

    if (cmd === 'explorer' || cmd === 'explorer mode') {
        stateManager.updatePlayer({ explorerMode: !localPlayer.explorerMode });
        syncEngine.savePlayerState();
        UI.addLog(`[SYSTEM]: Explorer Mode: ${stateManager.getState().localPlayer.explorerMode ? 'ENABLED' : 'DISABLED'}`, "var(--term-amber)");
        if (stateManager.getState().localPlayer.explorerMode) {
            UI.addLog(`[SYSTEM]: The AI Architect will now facilitate movement into unrendered sectors.`, "#888");
        }
        return;
    }

    if (cmd === '/recalibrate' || cmd === 'recalibrate' || cmd === 'home' || cmd === 'unstuck') {
        const targetRoom = user ? `instance_${user.uid}_bedroom` : 'bedroom';
        stateManager.updatePlayer({ 
            currentRoom: targetRoom, 
            stratum: 'mundane',
            combat: { active: false, opponent: null }
        });
        await syncEngine.updateGlobalMapListener();
        shiftStratum('mundane');
        UI.addLog(`[SYSTEM]: Recalibrating reality to primary anchor (${targetRoom})...`, "var(--term-green)");
        const finalMap = getActiveMap();
        triggerVisualUpdate(null, stateManager.getState().localPlayer, finalMap, user);
        processRoomEvents(finalMap[targetRoom]);
        return;
    }

    if (cmd === 'become architect' || cmd === 'upgrade') {
        if (!user || user.isAnonymous) {
            UI.addLog("[SYSTEM]: You must '/login' with a verified frequency (email) before acquiring an Architect license.", "var(--term-red)");
            return;
        }
        if (localPlayer.isArchitect) {
            UI.addLog("[SYSTEM]: You are already bound as an ARCHITECT.", "var(--term-amber)");
            return;
        }
        
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
        
        // NPC SPEECH REACTION
        const activeMap = getActiveMap();
        const room = activeMap[localPlayer.currentRoom];
        if (room && room.npcs && room.npcs.length > 0) {
            stateManager.setProcessing(true);
            try {
                const suggestions = await handleGMIntent(
                    `The player said to the room: "${speech}"`,
                    { 
                        get activeMap() { return getActiveMap(); }, 
                        localPlayer, user, activeAvatar, isSyncEnabled: true 
                    },
                    { 
                        shiftStratum, 
                        savePlayerState: syncEngine.savePlayerState, 
                        refreshStatusUI: () => {}, 
                        renderMapHUD: UI.renderMapHUD,
                        setActiveAvatar: stateManager.setActiveAvatar,
                        syncAvatarStats: () => syncEngine.syncAvatarStats(stateManager.getState().activeAvatar?.id, stateManager.getState().activeAvatar?.stats),
                        updateMapListener: () => syncEngine.updateGlobalMapListener(),
                        triggerVisualUpdate: (prompt) => triggerVisualUpdate(prompt, stateManager.getState().localPlayer, stateManager.getActiveMap(), stateManager.getState().user)
                    }
                );
                stateManager.setSuggestions(suggestions);
            } finally { 
                stateManager.setProcessing(false); 
            }
        }
        return;
    }

    if (cmd.match(/^(use|access|hack)\s+(terminal|tandem|console)/)) {
        if (localPlayer.currentRoom.endsWith('_lore1') || localPlayer.currentRoom === 'lore1') {
            startTerminal();
            return;
        }
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
        syncEngine.savePlayerState();
        UI.addLog(`[SYSTEM]: Consciousness transferred to ${stateManager.getState().activeAvatar.name}.`, "var(--term-green)");
        return;
    }

    if (localPlayer.currentRoom.endsWith('closet') || localPlayer.currentRoom === 'closet') {
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
            
            // Initialize Astral Map (Local cache only, will be synced if edited)
            const entryId = activeAvatar ? `astral_entry_${activeAvatar.id}` : (user ? `astral_entry_${user.uid}` : 'astral_entry');
            const newAstralMap = {
                [entryId]: {
                    name: "Astral Nexus", shortName: "NEXUS",
                    description: "A mind-bending cosmic nexus where reality dissolves into abstract patterns. The space is a swirl of neon static and half-formed memories.",
                    visualPrompt: "Strange non-euclidean geometries, swirling lightforms of neon purple and gold, a mind-bending cosmic nexus.",
                    exits: {}, pinnedView: null, items: [], marginalia: [], npcs: [],
                    metadata: { stratum: 'astral', isInstance: true, owner: user?.uid || 'guest' }
                }
            };
            
            // 1. First, persist the room to Firestore
            await syncEngine.updateMapNode(entryId, newAstralMap[entryId]);
            
            // 2. Then update local cache and move player
            stateManager.setLocalAreaCache(newAstralMap);
            stateManager.updatePlayer({ currentRoom: entryId });
            
            await syncEngine.savePlayerState(); 
            const activeMap = getActiveMap();

            UI.addLog("[NARRATOR]: The walls of the closet dissolve into raw, static data. You are pulled into the Astral Plane.", "#888");
            UI.addLog("[TANDY]: You're in. The Astral Plane is a reflection of your intent. To escape the apartment, you must find a way to synthesize a Resonant Key here.", "#b084e8");
            
            UI.printRoomDescription(activeMap[entryId], true, activeMap, activeAvatar);
            
            // Let the AI take initiative
            await handleGMIntent("Describe the strange astral nexus and present an initial challenge to gain the Resonant Key.", 
                { activeMap: newAstralMap, localPlayer: stateManager.getState().localPlayer, user, activeAvatar, isSyncEnabled: true },
                { shiftStratum, savePlayerState: syncEngine.savePlayerState, refreshStatusUI: () => {}, renderMapHUD: UI.renderMapHUD, setActiveAvatar: stateManager.setActiveAvatar, syncAvatarStats: () => syncEngine.syncAvatarStats(stateManager.getState().activeAvatar?.id, stateManager.getState().activeAvatar?.stats) }
            );

            // Trigger the 45-second ambush timer
            startAstralAmbushTimer(entryId, 45000);
            return;
        }
    }

    if (cmd === '/room') {
        const activeMap = getActiveMap();
        const roomId = localPlayer.currentRoom;
        const roomData = activeMap[roomId];
        
        if (!roomData) {
            UI.addLog(`[SYSTEM]: Room data for [${roomId}] is missing from local cache.`, "var(--term-red)");
            return;
        }

        UI.addLog(`[DIAGNOSTIC]: ROOM DATA`, "var(--term-green)");
        UI.addLog(`- UUID/ID: ${roomId}`, "var(--term-amber)");
        UI.addLog(`- NAME: ${roomData.name}`, "var(--term-amber)");
        UI.addLog(`- DESCRIPTION: ${roomData.description || 'none'}`, "var(--term-amber)");
        UI.addLog(`- PROMPT: ${roomData.visualPrompt || 'none'}`, "var(--term-amber)");
        UI.addLog(`- STRATUM: ${roomData.metadata?.stratum || 'unknown'}`, "var(--term-amber)");
        UI.addLog(`- OWNER: ${roomData.metadata?.owner || 'global'}`, "var(--term-amber)");
        UI.addLog(`- INSTANCE: ${roomData.metadata?.isInstance ? 'YES' : 'NO'}`, "var(--term-amber)");
        
        const exits = Object.keys(roomData.exits || {}).join(', ') || 'none';
        UI.addLog(`- EXITS: ${exits}`, "var(--term-amber)");
        
        const npcs = (roomData.npcs || []).map(n => n.name).join(', ') || 'none';
        UI.addLog(`- NPCS: ${npcs}`, "var(--term-amber)");
        
        const items = (roomData.items || []).map(i => i.name).join(', ') || 'none';
        UI.addLog(`- ITEMS: ${items}`, "var(--term-amber)");

        if (roomData.pinnedView) {
            UI.addLog(`- PINNED VIEW: <br><img src="${roomData.pinnedView}" style="max-width: 100%; max-height: 200px; border: 1px solid var(--gm-purple); margin-top: 5px; cursor: zoom-in;" onclick="window.open('${roomData.pinnedView}', '_blank')">`, "var(--term-amber)");
        }
        
        return;
    }

    if (cmd === '/strata' || cmd === 'strata') {
        const { strata } = stateManager.getState();
        if (!strata || Object.keys(strata).length === 0) {
            UI.addLog("[SYSTEM]: No strata definitions found in local cache.", "var(--term-red)");
            return;
        }

        UI.addLog(`[DIAGNOSTIC]: KNOWN STRATA`, "var(--term-green)");
        Object.values(strata).forEach(s => {
            const isActive = localPlayer.stratum === s.id ? " (ACTIVE)" : "";
            UI.addLog(`- ${s.name.toUpperCase()} [${s.id}]${isActive}`, "var(--term-amber)");
            UI.addLog(`  > Theme: ${s.theme}`, "#888");
            UI.addLog(`  > Style: ${s.visualStyle}`, "#888");
        });
        return;
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

    if (cmd === '/login') {
        startWizard('login');
        UI.setWizardPrompt("AUTH@LOGIN:~$");
        UI.addLog("[WIZARD]: Terminal Authentication sequence initiated.", "var(--term-amber)");
        UI.addLog("[WIZARD]: Enter your EMAIL ADDRESS:", "var(--term-amber)");
        return;
    }

    if (cmd === '/register') {
        startWizard('register');
        UI.setWizardPrompt("AUTH@REGISTER:~$");
        UI.addLog("[WIZARD]: New Vessel Registration sequence initiated.", "var(--term-amber)");
        UI.addLog("[WIZARD]: Enter a valid EMAIL ADDRESS:", "var(--term-amber)");
        return;
    }

    // CORE SYSTEM COMMANDS
    if (cmd === 'create avatar' || cmd === 'forge form' || cmd === 'make avatar' || cmd === '✦ create avatar') {
        if (!localPlayer.currentRoom.endsWith('character_room') && localPlayer.currentRoom !== 'character_room') {
            UI.addLog("[SYSTEM]: Vessel manifestation is only possible within The Forge (character_room).", "var(--term-amber)");
            return;
        }
        openForgeModal();
        return;
    }

    if (!activeAvatar && !cmd.startsWith('help') && !cmd.startsWith('create avatar') && !cmd.startsWith('assume')) {
        const physicalVerbs = ['take', 'get', 'pick up', 'use', 'search', 'examine', 'touch', 'push', 'pull', 'open', 'close', 'move', 'grab', 'collect', 'investigate'];
        const isPhysicalAction = physicalVerbs.some(verb => cmd.startsWith(verb));

        if (!localPlayer.currentRoom.endsWith('character_room') && localPlayer.currentRoom !== 'character_room' && 
            !localPlayer.currentRoom.endsWith('spare_room') && localPlayer.currentRoom !== 'spare_room') {
            
            if (isPhysicalAction) {
                UI.addLog(`[SYSTEM]: You are an itinerant void. Your phantom fingers pass through reality. You lack the Meaning to influence the Mundane.`, "var(--term-amber)");
                UI.addLog(`[SYSTEM]: Go to the Archive to forge your form.`, "var(--term-amber)");
                return;
            } else {
                UI.addLog(`[SYSTEM]: You are an itinerant void. Go to the Archive to forge your form.`, "var(--term-amber)");
            }
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
        const activeMap = getActiveMap();
        const room = activeMap[localPlayer.currentRoom];
        const npcs = room.npcs || [];

        const npcIndex = npcs.findIndex(n => n.name.toLowerCase().includes(targetName));

        if (npcIndex > -1) {
            const npc = npcs[npcIndex];

            // 1. Remove exactly ONE from the local array
            npcs.splice(npcIndex, 1);
            
            // 2. OVERWRITE the array in Firestore to avoid arrayRemove wiping clones
            stateManager.updateMapNode(localPlayer.currentRoom, { npcs });
            syncEngine.updateMapNode(localPlayer.currentRoom, { npcs });

            const newCharData = {
                name: npc.name,
                archetype: npc.archetype || "Unknown",
                visual_prompt: npc.visual_prompt || npc.visualPrompt || "A borrowed form.",
                image: npc.image || null,
                stats: npc.stats || { AMN: 20, WILL: 7, AWR: 7, PHYS: 6 },
                deceased: false, deployed: false, timestamp: Date.now()
            };

            UI.addLog(`[SYSTEM]: You have assumed control of [${npc.name}].`, "var(--term-green)");

            if (user && !user.isAnonymous) {
                syncEngine.createCharacter(newCharData).then(id => {
                    newCharData.id = id;
                    stateManager.setActiveAvatar(newCharData);
                    const { localCharacters } = stateManager.getState();
                    stateManager.setLocalCharacters([...localCharacters, newCharData]);
                    syncEngine.savePlayerState(); // Update presence with new avatar
                });
            } else {
                stateManager.setActiveAvatar(newCharData);
                const { localCharacters } = stateManager.getState();
                stateManager.setLocalCharacters([...localCharacters, newCharData]);
                syncEngine.savePlayerState(); // Update presence with new avatar
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
        const activeMap = getActiveMap();
        const currentRoomData = activeMap[localPlayer.currentRoom];
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
            const res = await callGemini("Generate a full room definition.", sysPrompt, {
                type: "object",
                properties: {
                    name: { type: "string" },
                    description: { type: "string" },
                    visual_prompt: { type: "string" }
                },
                required: ["name", "description", "visual_prompt"]
            });
            if (res && res.name && res.description) {
                const updates = {
                    name: res.name,
                    shortName: res.name.substring(0, 7).toUpperCase(),
                    description: res.description,
                    visualPrompt: res.visual_prompt,
                    pinnedView: null
                };
                stateManager.updateMapNode(null, localPlayer.currentRoom, updates);
                syncEngine.updateMapNode(localPlayer.currentRoom, updates);
                
                UI.addLog(`[SYSTEM]: Sector successfully rendered.`, "var(--term-green)");
                const updatedActiveMap = getActiveMap();
                UI.printRoomDescription(updatedActiveMap[localPlayer.currentRoom], localPlayer.stratum === 'astral', updatedActiveMap, activeAvatar);
                triggerVisualUpdate(res.visual_prompt, stateManager.getState().localPlayer, updatedActiveMap, user, true);
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
        return;
    } else if (cmd === 'stat' || cmd === 'stats') {
        if (!activeAvatar) return;
        UI.addLog(`IDENTITY: ${activeAvatar.name} | CLASS: ${activeAvatar.archetype}`, "var(--term-green)");
        UI.addLog(`AMN: ${activeAvatar.stats.AMN ?? 20} | WILL: ${activeAvatar.stats.WILL} | AWR: ${activeAvatar.stats.AWR} | PHYS: ${activeAvatar.stats.PHYS}`, "var(--term-amber)");
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
            stateManager.updateMapNode(null, localPlayer.currentRoom, { items });
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
    } else if (cmd.startsWith('/feedback ') || cmd.startsWith('/bug ')) {
        const msg = val.replace(/^\/(?:feedback|bug)\s+/i, '').trim();
        if (!msg) {
            UI.addLog("[SYSTEM]: Provide a message with your feedback. Example: /feedback The portal is stuck.", "var(--term-amber)");
            return;
        }
        
        UI.addLog("[SYSTEM]: Transmitting feedback to the Technate Architects...", "var(--term-green)");
        syncEngine.saveFeedback({ message: msg, type: cmd.startsWith('/bug') ? 'bug' : 'feedback' });
        return;
    } else if (cmd === '/about' || cmd === 'about') {
        UI.addLog(`[SYSTEM]: --- TERRA AGNOSTUM // SYSTEM MANIFEST ---`, "var(--term-green)");
        UI.addLog(`v0.4.0-beta | Shared Reality Terminal`, "#888");
        UI.addLog(`[SYSTEM]: A living, AI-mediated text adventure spanning multiple planes of existence.`, "var(--term-amber)");
        UI.addLog(`[SYSTEM]: Woven by human intent. Rendered by machine imagination.`, "var(--term-amber)");
        UI.addLog(`[SYSTEM]: Source Code ....... <a href="https://github.com/mindframegames/terraagnostum" target="_blank" class="text-green-400 hover:underline">github.com/mindframegames/terraagnostum</a>`, "#888");
        UI.addLog(`[SYSTEM]: Feedback ......... /feedback [your message]`, "#888");
        UI.addLog(`[SYSTEM]: Bug Reports ....... /bug [description]`, "#888");
        UI.addLog(`[TANDY]: Thanks for being here. The universe is paying attention.`, "#b084e8");
        return;
    } else if (cmd === 'help') {
        UI.addLog(`[SYSTEM]: --- TERMINAL COMMAND GUIDANCE ---`, "var(--term-amber)");
        
        UI.addLog(`[MOVEMENT & SENSORY]`, "var(--term-green)");
        UI.addLog(`LOOK (L) ........ Analyze immediate surroundings.`, "#888");
        UI.addLog(`N / S / E / W ... Traverse the sector topology.`, "#888");
        UI.addLog(`MAP ............. Toggle the topological HUD readout.`, "#888");

        UI.addLog(`[IDENTITY & SYNC]`, "var(--crayola-blue)");
        UI.addLog(`WHOAMI .......... Verify current frequency and tier.`, "#888");
        UI.addLog(`/LOGIN [EMAIL] .. Anchor your signature to the Technate.`, "#888");
        UI.addLog(`CREATE AVATAR ... Forge a vessel (at The Forge / Archive).`, "#888");
        UI.addLog(`STAT ............ Display vessel biometric data.`, "#888");
        UI.addLog(`INV ............. Access vessel storage.`, "#888");

        UI.addLog(`[INTERACTION]`, "var(--gm-purple)");
        UI.addLog(`ASSUME [NPC] .... Materialize into an unoccupied vessel.`, "#888");
        UI.addLog(`LEAVE VESSEL .... Return to a disembodied void state.`, "#888");
        UI.addLog(`CREATE NPC ...... Spawn a new autonomous entity.`, "#888");
        UI.addLog(`LOCK [DIR] ...... Obstruct a sector exit with narrative force.`, "#888");

        UI.addLog(`[ARCHITECT / BETA]`, "var(--astral-cyan)");
        UI.addLog(`BUILD [DIR] ..... Expand reality. Use '--auto' for AI weaving.`, "#888");
        UI.addLog(`EDIT ROOM ....... Rewrite current sector description.`, "#888");
        UI.addLog(`GENERATE ROOM ... Let the AI render the current sector.`, "#888");
        UI.addLog(`PIN VIEW ........ Affix current projection to the room.`, "#888");

        UI.addLog(`[UTILITIES]`, "var(--term-amber)");
        UI.addLog(`/RECALIBRATE .... Return to your primary anchor (Home).`, "#888");
        UI.addLog(`/STRATA ......... List known reality layers.`, "#888");
        UI.addLog(`/FEEDBACK [MSG] . Transmit data to the Architects.`, "#888");

        UI.addLog(`[ASTRAL & PORTALS]`, "#b084e8");
        UI.addLog(`ANCHOR PORTAL HERE .. Tether your Astral to this location.`, "#888");
        UI.addLog(`ENTER PORTAL ........ Step through a fold in reality.`, "#888");
        UI.addLog(`RESONATOR ........... Return through an Astral resonator echo.`, "#888");
        UI.addLog(`LOCK PORTAL ......... Collapse your portal fold (keeps anchor).`, "#888");
        UI.addLog(`OPEN PORTAL ......... Rekindle a locked portal fold.`, "#888");
        
        UI.addLog(`[TIP]: If you're lost, just type your intent in plain English. Tandy is listening.`, "#666");
        return;
    }


    // COMBAT TIMER RESET: If the player acts during combat, reset the 45s timer
    if (localPlayer.combat.active) {
        CombatTimer.reset();
    }

    // --- THE UNIVERSAL GM INTENT ENGINE ---
    stateManager.setProcessing(true);
    try {
            const suggestions = await handleGMIntent(
                val,
                { 
                    get activeMap() { return getActiveMap(); }, 
                    localPlayer, user, activeAvatar, isSyncEnabled: true 
                },
                { 
                    shiftStratum, 
                    savePlayerState: syncEngine.savePlayerState, 
                    refreshStatusUI: () => {}, 
                    renderMapHUD: UI.renderMapHUD,
                    setActiveAvatar: stateManager.setActiveAvatar,
                    syncAvatarStats: () => syncEngine.syncAvatarStats(stateManager.getState().activeAvatar?.id, stateManager.getState().activeAvatar?.stats),
                    updateMapListener: () => syncEngine.updateGlobalMapListener(),
                    triggerVisualUpdate: (prompt) => triggerVisualUpdate(prompt, stateManager.getState().localPlayer, stateManager.getActiveMap(), stateManager.getState().user),
                    processRoomEvents
                }
            );
            stateManager.setSuggestions(suggestions);
        } finally { 
            stateManager.setProcessing(false); 
        }
    } catch (err) {
        console.error("Command processing error:", err);
        UI.addLog(`[SYSTEM ERROR]: Internal command failure - ${err.message}`, "var(--term-red)");
    } finally {
        stateManager.setProcessing(false);
    }
}

// --- ASTRAL NEXUS AMBUSH TIMER ---
export function startAstralAmbushTimer(entryId = 'astral_entry', delayMs = 45000) {
    setTimeout(async () => {
        const state = stateManager.getState();
        const { localPlayer, user, activeAvatar } = state;
        
        // If player is still in the entry room and NOT already in combat
        if (localPlayer.currentRoom === entryId && !localPlayer.combat?.active) {
            UI.addLog(`[SYSTEM WARN]: The astral static thickens. An ambient hostility takes form...`, "var(--term-amber)");
            
            if (stateManager.getState().isProcessing) return; // Wait, don't interrupt active generation
            
            stateManager.setProcessing(true);
            try {
                const suggestions = await handleGMIntent(
                    "The player lingered too long in the Astral Nexus. Spawn an aggressively hostile astral anomaly (e.g. Static Stalker or Memory Shadow) to ambush them immediately and initiate a Battle of Wills combat.",
                    { 
                        get activeMap() { return getActiveMap(); }, 
                        localPlayer: stateManager.getState().localPlayer, 
                        user, 
                        activeAvatar: stateManager.getState().activeAvatar, 
                        isSyncEnabled: true 
                    },
                    { 
                        shiftStratum, 
                        savePlayerState: syncEngine.savePlayerState, 
                        refreshStatusUI: () => {}, 
                        renderMapHUD: UI.renderMapHUD,
                        setActiveAvatar: stateManager.setActiveAvatar,
                        syncAvatarStats: () => syncEngine.syncAvatarStats(stateManager.getState().activeAvatar?.id, stateManager.getState().activeAvatar?.stats),
                        updateMapListener: () => syncEngine.updateGlobalMapListener(),
                        triggerVisualUpdate: (prompt) => triggerVisualUpdate(prompt, stateManager.getState().localPlayer, stateManager.getActiveMap(), stateManager.getState().user)
                    },
                    false
                );
                stateManager.setSuggestions(suggestions);
            } catch (err) {
                console.error("Ambush Timer Error:", err);
            } finally {
                stateManager.setProcessing(false);
            }
        }
    }, delayMs);
}
