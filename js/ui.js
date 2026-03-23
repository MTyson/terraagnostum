// js/ui.js
// Purpose: Handles all DOM manipulation, canvas rendering, and CSS theme transitions.
import * as stateManager from './stateManager.js';

// Subscribe to state changes
stateManager.subscribe((state) => {
    const { activeAvatar, localPlayer, activeTerminal, wizardState } = state;
    const activeMap = stateManager.getActiveMap();
    const tier = stateManager.getUserTier();
    
    // Update Command Prompt
    updateCommandPrompt(tier);

    // Update Sidebars/HUD
    const roomShort = activeMap[localPlayer.currentRoom]?.shortName || localPlayer.currentRoom.toUpperCase();
    updateStatusUI(roomShort, localPlayer.stratum);
    updateVitalsUI(activeAvatar);
    updateAvatarUI(activeAvatar);
    updateInventoryUI(localPlayer.inventory);
    updateQuestsUI(localPlayer.quests);
    
    // Header Vitals Sync
    syncHeaderVitals(activeAvatar);
    
    const room = activeMap[localPlayer.currentRoom];
    const playersInRoom = Object.values(state.otherPlayers || {}).filter(p => p.roomId === localPlayer.currentRoom);
    
    updateRoomItemsUI(room?.items);
    updateRoomEntitiesUI(room?.npcs, playersInRoom);
    updateRoomNPCPreviews(room?.npcs, playersInRoom);
    updateCompassUI(room);
    renderMapHUD(activeMap, localPlayer.currentRoom, localPlayer.stratum);
    updateContextualSuggestions(state.suggestions);

    // Pin Button Visibility (Architects Only)
    const pinBtn = document.getElementById('pin-view-btn');
    if (pinBtn) {
        if (tier === 'ARCHITECT' && !localPlayer.combat.active) {
            pinBtn.classList.remove('hidden');
            // Only update if not currently in a transient state (uploading)
            if (!pinBtn.classList.contains('animate-pulse')) {
                // Update label based on room state
                if (room?.pinnedView) {
                    pinBtn.innerText = "UNPIN VIEW";
                    pinBtn.classList.add('bg-amber-600', 'border-amber-400');
                    pinBtn.classList.remove('bg-blue-600', 'border-blue-400', 'bg-green-600', 'border-green-400');
                } else {
                    pinBtn.innerText = "PIN VIEW";
                    pinBtn.classList.remove('bg-amber-600', 'border-amber-400', 'bg-green-600', 'border-green-400');
                    pinBtn.classList.add('bg-blue-600', 'border-blue-400');
                }
            }
        } else {
            pinBtn.classList.add('hidden');
        }
    }

    // Combat UI Toggle
    if (localPlayer.combat.active) {
        // Find opponent in current room with fuzzy matching
        let opponent = room?.npcs?.find(n => {
            const search = (localPlayer.combat.opponent || "").toLowerCase();
            const name = (n.name || "").toLowerCase();
            const isFallbackMatch = search.includes('narrator') || search.includes('system') || search.includes('tandy');
            return name === search || name.includes(search) || search.includes(name) || isFallbackMatch || (search.includes('narrator') && name.includes('shadow'));
        });

        // If there's only one NPC in the room anyway, it's virtually guaranteed to be the combat target
        if (!opponent && room?.npcs?.length === 1) {
            opponent = room.npcs[0];
        }

        let fallbackTarget = opponent;
        if (!fallbackTarget) {
            let n = localPlayer.combat.opponent || "Shadow Entity";
            if (n.toLowerCase().includes('narrator') || n.toLowerCase().includes('system')) n = "Shadow Entity";
            
            fallbackTarget = {
                name: n,
                stats: { PHYS: 10, WILL: 10, AWR: 10 },
                description: "[DATA FRAGMENTED] An unregistered localized anomaly."
            };
        }
        
        toggleCombatUI(true, fallbackTarget);
    } else {
        toggleCombatUI(false);
    }
});

export function initHUDWidgets() {
    // Compass Listeners
    const compassButtons = {
        'compass-n': 'n',
        'compass-s': 's',
        'compass-e': 'e',
        'compass-w': 'w'
    };

    const closeDossierBtn = document.getElementById('close-dossier-modal');
    const closeDossierBtn2 = document.getElementById('btn-close-dossier');
    if (closeDossierBtn) closeDossierBtn.onclick = () => toggleDossierBuffer(false);
    if (closeDossierBtn2) closeDossierBtn2.onclick = () => toggleDossierBuffer(false);

    Object.entries(compassButtons).forEach(([id, dir]) => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.onclick = () => {
                const input = document.getElementById('cmd-input');
                if (input) {
                    input.value = dir;
                    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                }
            };
        }
    });
}

export function initMobileDrawer() {
    const sidebar = document.getElementById('right-sidebar');
    const toggleBtn = document.getElementById('mobile-menu-toggle');
    const closeBtn = document.getElementById('mobile-menu-close');

    if (!sidebar) return;

    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            sidebar.classList.add('open');
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            sidebar.classList.remove('open');
        });
    }
}

// Call it on load
document.addEventListener('DOMContentLoaded', () => {
    initMobileDrawer();
    initMobileRadar();
    setupMapResizeObservers();
});

export function initMobileRadar() {
    const radar = document.getElementById('mobile-radar-widget');
    const input = document.getElementById('cmd-input');
    
    if (!radar || !input) return;

    radar.addEventListener('click', (e) => {
        const rect = radar.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        const cx = rect.width / 2;
        const cy = rect.height / 2;
        
        const dx = x - cx;
        const dy = y - cy;
        
        // Ignore dead-center clicks
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;

        let cmdDir = '';
        if (Math.abs(dx) > Math.abs(dy)) {
            cmdDir = dx > 0 ? 'e' : 'w';
        } else {
            cmdDir = dy > 0 ? 's' : 'n';
        }

        // Visual feedback
        radar.style.borderColor = "var(--term-amber)";
        setTimeout(() => radar.style.borderColor = "var(--term-green)", 150);

        // Directly call the command handler to bypass any event inconsistencies
        import('./intentRouter.js').then(({ handleCommand }) => {
            // Log what the user "typed" via the radar
            addLog(cmdDir, "#ffffff");
            
            // Execute the command
            handleCommand(cmdDir);
            
            // Clear input
            const inputEl = document.getElementById('cmd-input');
            if (inputEl) inputEl.value = '';
        });
    });
}

export function updateCompassUI(room) {
    const directions = ['north', 'south', 'east', 'west'];
    const btnMap = { north: 'compass-n', south: 'compass-s', east: 'compass-e', west: 'compass-w' };

    directions.forEach(dir => {
        const btn = document.getElementById(btnMap[dir]);
        if (!btn) return;
        const hasExit = room && room.exits && room.exits[dir];
        btn.disabled = !hasExit;
    });
}

export function updateContextualSuggestions(aigmSuggestions = []) {
    const { wizardState, localPlayer } = stateManager.getState();
    if (wizardState.active) {
        renderContextualCommands(['Exit Wizard']);
        return;
    }

    const activeMap = stateManager.getActiveMap();
    const room = activeMap[localPlayer.currentRoom];
    if (!room) return;

    let suggestions = [];

    if (room.npcs && room.npcs.length > 0) {
        room.npcs.forEach(npc => {
            suggestions.push(`Look at ${npc.name}`);
        });
    }

    if (localPlayer.combat.active) {
        suggestions.push("ATTACK WITH WILLFORCE");
        suggestions.push("MANIFEST ASTRAL SHIELD");
        suggestions.push("FORGE ASTRAL WEAPON");
    }

    const safeAigm = Array.isArray(aigmSuggestions) ? aigmSuggestions : [];
    suggestions = [...suggestions, ...safeAigm];

    if (suggestions.length < 4) {
        suggestions.push("Look");
        suggestions.push("Inventory");
    }
    suggestions.push("💡 Suggest");

    const uniqueSuggestions = [...new Set(suggestions)];
    renderContextualCommands(uniqueSuggestions);
}

export function updateCommandPrompt(tier) {
    const prefixEl = document.getElementById('prompt-prefix');
    const inputEl = document.getElementById('cmd-input');
    if (!prefixEl || !inputEl) return;

    inputEl.placeholder = "Enter command...";

    let colorClass = "text-green-400";
    if (tier === 'VOID') colorClass = "text-purple-500";
    if (tier === 'GUEST') colorClass = "text-gray-500";
    if (tier === 'ARCHITECT') colorClass = "text-blue-400";

    prefixEl.innerHTML = `<span class="${colorClass} font-bold">$</span>&nbsp;`;
}

export function updateStatusUI(roomShort, stratum = 'MUNDANE') {
    const roomEl = document.getElementById('room-display');
    if (roomEl) roomEl.innerText = roomShort;
    
    const stratumEl = document.getElementById('stratum-name');
    if (stratumEl) stratumEl.innerText = stratum.toUpperCase();

    // Update Prompt Inspector
    const { localPlayer } = stateManager.getState();
    const activeMap = stateManager.getActiveMap();
    const room = activeMap[localPlayer.currentRoom];
    const inspector = document.getElementById('prompt-text-display');
    if (inspector && room) {
        inspector.innerText = room.visualPrompt || room.description || "[ NO DATA ]";
    }
}

export function updateVitalsUI(activeAvatar) {
    const hpBar = document.getElementById('hp-bar');
    const willBar = document.getElementById('will-bar');
    const awrBar = document.getElementById('awr-bar');

    if (!activeAvatar) {
        if (hpBar) hpBar.style.width = '0%';
        if (willBar) willBar.style.width = '0%';
        if (awrBar) awrBar.style.width = '0%';
        return;
    }

    // Assuming stats are 1-20 or similar, mapping to % for now
    const stats = activeAvatar.stats || {};
    const getStatValue = (pool) => {
        const p = stats[pool];
        if (!p) return 0;
        return typeof p === 'object' ? (p.total || 0) : p;
    };

    const will = getStatValue('WILL');
    const awr = getStatValue('AWR');
    const phys = getStatValue('PHYS');
    
    // For now use phys as HP base
    const currentHP = activeAvatar.hp || phys;
    const maxHP = phys;
    const currentWill = activeAvatar.will || will;
    const maxWill = will;

    if (hpBar) hpBar.style.width = `${Math.max(0, Math.min(100, (currentHP / maxHP) * 100))}%`;
    if (willBar) willBar.style.width = `${Math.max(0, Math.min(100, (currentWill / maxWill) * 100))}%`;
    if (awrBar) awrBar.style.width = `${(awr / 20) * 100}%`;
}

function syncHeaderVitals(activeAvatar) {
    if (!activeAvatar) return;
    updateVitalsUI(activeAvatar);
}

function generateVisualBar(current, max, colorClass = 'bg-green-500', isSubStat = false) {
    const percentage = Math.round(Math.min(100, Math.max(0, (current / (max || 1)) * 100)));
    const barHeight = isSubStat ? 'h-1' : 'h-1.5';
    // Remove fixed min-widths and large margins for mobile
    const containerClasses = isSubStat ? 'opacity-70 ml-2 sm:ml-4' : 'w-full';
    return `
        <div class="flex items-center gap-2 flex-grow ${containerClasses}">
            <div class="${barHeight} w-full bg-black/60 border border-green-900/30 relative overflow-hidden">
                <div class="h-full ${colorClass} transition-all duration-700" style="width: ${percentage}%"></div>
            </div>
            <span class="min-w-[30px] text-right font-mono text-[9px] sm:text-[10px] opacity-80">${current}/${max}</span>
        </div>
    `;
}

export function updateAvatarUI(activeAvatar) {
    const container = document.getElementById('avatar-container');
    if (!container) return;
    
    if (!activeAvatar) {
        container.innerHTML = `
            <div class="text-amber-500 text-[10px] absolute inset-0 flex items-center justify-center text-center border border-dashed border-amber-900 p-4 m-2 uppercase tracking-tighter">
                NO VESSEL DETECTED<br>DISEMBODIED STATE
            </div>`;
        return;
    }
    
    const portrait = activeAvatar.image 
        ? `<img src="${activeAvatar.image}" id="avatar-portrait-main" class="absolute inset-0 w-full h-full object-contain transition-transform duration-500 group-hover:scale-105 cursor-pointer">`
        : `<div class="absolute inset-0 w-full h-full bg-gray-900 flex items-center justify-center text-[10px] text-gray-700">[ NO VISUAL DATA ]</div>`;

    container.innerHTML = `
        <div class="relative w-full aspect-square group overflow-hidden border border-[#1a3a1a] rounded-sm bg-black cursor-pointer">
            <!-- Full Un-obscured Portrait -->
            ${portrait}
            
            <!-- VIEW DOSSIER Overlay (UX Discovery) -->
            <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center z-20 pointer-events-none">
                <div class="border border-green-500 px-2 py-1 text-[8px] bg-black text-green-400 font-bold tracking-widest uppercase shadow-[0_0_10px_rgba(74,222,128,0.4)]">
                    [ VIEW DOSSIER ]
                </div>
            </div>

            <!-- Always-visible Name Bar (Top Overlay) -->
            <div class="absolute top-0 left-0 w-full bg-gradient-to-b from-black/80 via-black/40 to-transparent p-3 z-10 pointer-events-none">
                <div class="font-bold text-green-400 text-sm tracking-widest drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)]">${activeAvatar.name.toUpperCase()}</div>
                <div class="text-[10px] text-green-500/80 font-bold tracking-tighter drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]">${activeAvatar.stratum?.toUpperCase() || 'UNKNOWN'}</div>
            </div>

            <!-- Stats Overlay (Slides up on Hover) -->
            <div class="absolute bottom-0 left-0 w-full bg-black/80 backdrop-blur-md border-t border-green-900 p-3 
                        transform translate-y-full group-hover:translate-y-0 transition-transform duration-300">
                <div class="text-[10px] text-green-500 font-bold mb-1 border-b border-green-900 pb-1">BIOMETRICS</div>
                <div class="flex justify-between text-xs font-mono">
                    <span class="text-amber-500 font-bold">ROOT/AMN:${activeAvatar.stats?.AMN ?? 20}</span>
                    <span class="text-purple-400">WILL:${activeAvatar.stats?.WILL || 0}</span>
                    <span class="text-blue-400">AWR:${activeAvatar.stats?.AWR || 0}</span>
                    <span class="text-amber-400">PHYS:${activeAvatar.stats?.PHYS || 0}</span>
                </div>
            </div>
        </div>
    `;

    // Add click listener to the portrait to trigger Dossier
    const avatarBox = container.querySelector('.group');
    if (avatarBox) {
        avatarBox.onclick = () => toggleDossierBuffer(true);
    }
}

export function updateQuestsUI(quests) {
    const container = document.getElementById('quests-container');
    if (!container) return;
    if (!quests || quests.length === 0) {
        container.innerHTML = "[EMPTY]";
        return;
    }
    container.innerHTML = quests.filter(q => q.status === 'active').map(quest => `
        <div class="border border-[#1a3a1a] p-1 bg-black/40 border-l-2 border-l-purple-900">
            <span class="text-purple-400 font-bold block truncate">${quest.title.toUpperCase()}</span>
            <span class="text-[8px] text-gray-400 block break-words mt-1">${quest.description}</span>
        </div>
    `).join('');
}

export function updateInventoryUI(inventory) {
    const container = document.getElementById('inventory-container');
    if (!container) return;
    if (!inventory || inventory.length === 0) {
        container.innerHTML = "[EMPTY]";
        return;
    }
    container.innerHTML = inventory.map(item => `
        <div class="border border-[#1a3a1a] p-1 bg-black/40 border-l-2 border-l-green-900">
            <span class="text-gray-400 font-bold block truncate">${item.name}</span>
        </div>
    `).join('');
}

export function updateRoomItemsUI(items) {
    const container = document.getElementById('room-items-container');
    if (!container) return;
    if (!items || items.length === 0) {
        container.innerHTML = "[EMPTY]";
        return;
    }
    container.innerHTML = items.map(item => `<div class="text-amber-600 truncate">> ${item.name}</div>`).join('');
}

export function updateRoomEntitiesUI(npcs = [], players = []) {
    const container = document.getElementById('room-entities-container');
    if (!container) return;
    if ((!npcs || npcs.length === 0) && (!players || players.length === 0)) {
        container.innerHTML = "[NONE]";
        return;
    }
    
    container.innerHTML = '';
    
    // Render Players first
    players.forEach((player) => {
        const card = document.createElement('div');
        card.className = "flex justify-between items-center p-1 border border-green-500 bg-green-900/20 cursor-pointer hover:border-green-400 transition-colors mb-1";
        card.innerHTML = `
            <div class="w-8 h-8 flex-shrink-0 mr-2 border border-green-500 bg-black overflow-hidden">
                ${player.avatarImage ? `<img src="${player.avatarImage}" class="w-full h-full object-cover">` : `<div class="w-full h-full flex items-center justify-center text-[6px] text-green-500">[PLAYER]</div>`}
            </div>
            <div class="flex-grow min-w-0 pointer-events-none">
                <div class="text-green-400 font-bold uppercase truncate">${player.avatarName}</div>
                <div class="text-[8px] text-green-600 font-mono">RESONANT SIGNATURE</div>
            </div>
            ${player.inCombat ? `<div class="text-[8px] text-red-500 font-bold ml-2 animate-pulse">[IN COMBAT]</div>` : ''}
        `;
        container.appendChild(card);
    });

    // Render NPCs
    npcs.forEach((npc, index) => {
        const stats = npc.stats || { WILL: '??', AWR: '??', PHYS: '??', AMN: '??' };
            
        const stratum = npc.stratum || 'MUNDANE';
        const card = document.createElement('div');
        card.className = "flex justify-between items-center p-1 border border-[#1a3a1a] bg-black/40 cursor-pointer hover:border-blue-500 transition-colors";
        card.innerHTML = `
            <div class="w-8 h-8 flex-shrink-0 mr-2 border border-[#1a3a1a] bg-black overflow-hidden npc-thumbnail-mini" data-stratum="${stratum.toLowerCase()}">
                ${npc.image ? `<img src="${npc.image}" class="w-full h-full object-cover">` : `<div class="w-full h-full flex items-center justify-center text-[6px] text-blue-900">[?]</div>`}
            </div>
            <div class="flex-grow min-w-0 pointer-events-none">
                <div class="text-blue-400 font-bold uppercase truncate">${npc.name}</div>
            </div>
            <div class="flex gap-1 text-[8px] font-mono text-blue-900 flex-shrink-0">
                <span>M:${stats.AMN ?? 20}</span>
                <span>W:${stats.WILL}</span>
                <span>A:${stats.AWR}</span>
                <span>P:${stats.PHYS}</span>
            </div>
        `;
        
        card.onclick = () => {
            // Map NPC data to Forge schema
            const detailData = {
                ...npc,
                description: npc.behavior || npc.visualPrompt || npc.visual_prompt || "No additional data available."
            };
            toggleDossierBuffer(true, detailData);
        };
        
        container.appendChild(card);
    });
}

export function updateRoomNPCPreviews(npcs = [], players = []) {
    const container = document.getElementById('room-npc-overlays');
    if (!container) return;
    container.innerHTML = '';
    
    if ((!npcs || npcs.length === 0) && (!players || players.length === 0)) return;

    // Player Tokens
    players.forEach(player => {
        if (!player.avatarImage) return;
        const thumb = document.createElement('div');
        thumb.className = `npc-thumbnail-token w-12 h-12 rounded-full border-2 border-green-500 bg-cover bg-center pointer-events-auto cursor-pointer transition-all hover:scale-110 relative`;
        thumb.style.backgroundImage = `url('${player.avatarImage}')`;
        thumb.title = player.avatarName;
        
        if (player.inCombat) {
            const badge = document.createElement('div');
            badge.className = "absolute -top-1 -right-1 w-4 h-4 bg-red-600 rounded-full border border-white animate-pulse";
            thumb.appendChild(badge);
        }

        container.appendChild(thumb);
    });

    // NPC Tokens
    npcs.forEach(npc => {
        if (!npc.image) return;
        
        const thumb = document.createElement('div');
        thumb.className = `npc-thumbnail-token w-12 h-12 rounded-full border-2 bg-cover bg-center pointer-events-auto cursor-pointer transition-all hover:scale-110`;
        thumb.style.backgroundImage = `url('${npc.image}')`;
        thumb.title = npc.name;
        
        // Determine border color based on stratum if npc has one, or default to current
        const stratum = npc.stratum || stateManager.getState().localPlayer.stratum || 'MUNDANE';
        thumb.setAttribute('data-stratum', stratum.toLowerCase());

        thumb.onclick = (e) => {
            e.stopPropagation();
            // Map NPC data to Forge schema for dossier
            const detailData = {
                ...npc,
                description: npc.behavior || npc.visualPrompt || npc.visual_prompt || "No additional data available."
            };
            toggleDossierBuffer(true, detailData);
        };
        
        container.appendChild(thumb);
    });
}

export function addLog(text, color = 'var(--term-green)') {
    const log = document.getElementById('log');
    if (!log) return;
    const p = document.createElement('div');
    p.style.color = color;
    p.className = 'mb-1';
    p.innerHTML = `> ${text.replace(/\n/g, '<br>')}`;
    log.appendChild(p);
    
    const output = document.getElementById('output');
    if (output) {
        // Use requestAnimationFrame to ensure DOM is updated before scrolling
        requestAnimationFrame(() => {
            output.scrollTo({
                top: output.scrollHeight,
                behavior: 'smooth'
            });
        });
    }

    // Route to combat log if active
    const combatOverlay = document.getElementById('combat-overlay');
    const combatLog = document.getElementById('combat-log');
    if (combatOverlay && !combatOverlay.classList.contains('hidden') && combatLog) {
        const pCombat = document.createElement('div');
        pCombat.style.color = color;
        pCombat.className = 'mb-1';
        pCombat.innerHTML = `> ${text.replace(/\n/g, '<br>')}`;
        combatLog.appendChild(pCombat);
        combatLog.scrollTop = combatLog.scrollHeight;
    }
}

export function renderContextualCommands(commands) {
    const bar = document.getElementById('context-bar');
    if (!bar) return;
    bar.innerHTML = '';
    commands.forEach(cmd => {
        const btn = document.createElement('button');
        btn.className = 'context-chip';
        btn.innerText = cmd;
        btn.onclick = () => {
            const input = document.getElementById('cmd-input');
            if (input) {
                input.value = cmd;
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            }
        };
        bar.appendChild(btn);
    });
}

/**
 * Real-time Topology Renderer: Draws the map to target canvases.
 */
export function renderMapHUD(activeMap, currentRoomKey, stratum) {
    // Render to Desktop Sidebar
    drawTopologyToCanvas('map-canvas', activeMap, currentRoomKey, stratum, true);
    // Render to Mobile Radar
    drawTopologyToCanvas('mobile-radar-canvas', activeMap, currentRoomKey, stratum, false);
    // Render to Large Map (Modal)
    drawTopologyToCanvas('large-map-canvas', activeMap, currentRoomKey, stratum, true);
}

/**
 * Ensures maps are redrawn whenever their containers change size.
 */
export function setupMapResizeObservers() {
    // Select all canvas containers
    const containers = [
        document.getElementById('map-canvas-container'),
        document.getElementById('mobile-radar-widget'),
        document.getElementById('large-map-canvas')?.parentElement
    ].filter(Boolean);

    const observer = new ResizeObserver(() => {
        const state = stateManager.getState();
        const activeMap = stateManager.getActiveMap();
        if (activeMap && state.localPlayer.currentRoom) {
            renderMapHUD(activeMap, state.localPlayer.currentRoom, state.localPlayer.stratum);
        }
    });

    containers.forEach(target => observer.observe(target));
}

function drawTopologyToCanvas(canvasId, activeMap, currentRoomKey, stratum, drawLabels) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    // Auto-resize
    const rect = canvas.parentElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return; // Skip if parent is hidden/not laid out

    if (canvas.width !== rect.width || canvas.height !== rect.height) {
        canvas.width = rect.width;
        canvas.height = rect.height;
    }

    if (!activeMap || Object.keys(activeMap).length === 0 || canvas.width === 0) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    
    // Wider spacing on mobile to accommodate the larger tap targets
    const spacingX = drawLabels ? 60 : 36;
    const spacingY = drawLabels ? 50 : 36;

    const room = activeMap[currentRoomKey];
    if (!room) return;

    const currentGreen = "#4ade80";
    const dimGreen = "#1a3a1a";
    
    const { strata } = stateManager.getState();
    const stratumData = strata[stratum.toLowerCase()];
    const stratumColor = stratumData ? stratumData.color : (stratum === 'astral' ? "#b084e8" : '#2a5a2a');

    ctx.strokeStyle = stratumColor;
    ctx.lineWidth = 2;

    // Draw Connections
    if (room.exits) {
        Object.entries(room.exits).forEach(([dir, target]) => {
            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            
            let tx = centerX, ty = centerY;
            if (dir === 'north') ty -= spacingY;
            if (dir === 'south') ty += spacingY;
            if (dir === 'east') tx += spacingX;
            if (dir === 'west') tx -= spacingX;
            
            ctx.lineTo(tx, ty);
            ctx.stroke();

            // Draw adjacent nodes
            ctx.fillStyle = "#051505";
            ctx.strokeStyle = stratumData ? stratumData.color : dimGreen;
            ctx.lineWidth = 1;
            
            if (drawLabels) {
                ctx.fillRect(tx - 16, ty - 12, 32, 24);
                ctx.strokeRect(tx - 16, ty - 12, 32, 24);
                const targetRoom = activeMap[typeof target === 'string' ? target : target.target];
                const rawLabel = targetRoom ? (targetRoom.shortName || targetRoom.name || "???") : "???";
                const label = String(rawLabel).substring(0, 4).toUpperCase();
                ctx.fillStyle = stratumData ? stratumData.color : dimGreen;
                ctx.font = "10px monospace";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(label, tx, ty);
            } else {
                // Larger tap targets for mobile radar
                ctx.fillRect(tx - 10, ty - 10, 20, 20);
                ctx.strokeRect(tx - 10, ty - 10, 20, 20);
            }
            ctx.lineWidth = 2;
        });
    }

    // Draw Current Node
    ctx.fillStyle = "#051505";
    ctx.strokeStyle = stratumData ? stratumData.color : currentGreen;
    ctx.shadowBlur = 10; 
    ctx.shadowColor = stratumData ? stratumData.color : currentGreen;
    
    if (drawLabels) {
        ctx.fillRect(centerX - 16, centerY - 12, 32, 24);
        ctx.strokeRect(centerX - 16, centerY - 12, 32, 24);
        ctx.shadowBlur = 0;
        ctx.fillStyle = stratumData ? stratumData.color : currentGreen;
        ctx.font = "bold 11px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const rawCurrentLabel = room.shortName || room.name || "???";
        ctx.fillText(String(rawCurrentLabel).substring(0, 4).toUpperCase(), centerX, centerY);
    } else {
        // Larger player node for mobile radar
        ctx.fillRect(centerX - 12, centerY - 12, 24, 24);
        ctx.strokeRect(centerX - 12, centerY - 12, 24, 24);
        ctx.shadowBlur = 0;
    }
}

export function materializeEffect() {
    const flash = document.createElement('div');
    flash.style = "position:fixed;inset:0;background:white;z-index:9999;pointer-events:none;animation:flash-out 0.8s forwards;";
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 800);
}

export function applyStratumTheme(stratum, isTransitioning) {
    const { strata } = stateManager.getState();
    const stratumData = strata[stratum.toLowerCase()];
    const stratumNameEl = document.getElementById('stratum-name');
    if (stratumNameEl) {
        stratumNameEl.innerText = stratumData ? stratumData.name.toUpperCase() : stratum.toUpperCase();
    }
    document.body.setAttribute('data-stratum', stratum);
    if (isTransitioning) {
        materializeEffect();
    }
}

export function toggleMapModal() {
    const modal = document.getElementById('map-modal');
    if (modal) {
        modal.classList.toggle('hidden');
    }
}

export function toggleDossierBuffer(show, data = null) {
    const modal = document.getElementById('dossier-modal');
    if (!modal) return;

    if (show) {
        const displayData = data || stateManager.getState().activeAvatar;
        if (!displayData) return;

        // MOBILE BEST PRACTICE: If on mobile, close the sidebar first to prevent overlap
        const sidebar = document.getElementById('right-sidebar');
        if (sidebar && window.innerWidth < 1024) { // 1024 is the 'lg' breakpoint
            sidebar.classList.remove('open');
        }

        modal.classList.remove('hidden');

        // Populate Dossier
        const imgElement = document.getElementById('dossier-img');
        const imgFallback = document.getElementById('dossier-img-fallback');
        if (imgElement && imgFallback) {
            if (displayData.image) {
                imgElement.src = displayData.image;
                imgElement.classList.remove('hidden');
                imgFallback.classList.add('hidden');
            } else {
                imgElement.classList.add('hidden');
                imgFallback.classList.remove('hidden');
                imgFallback.classList.add('flex');
                
                // Special stylized fallback for Shadow/Unknown
                if (displayData.name.toLowerCase().includes('shadow') || displayData.name.toLowerCase().includes('unknown')) {
                    imgFallback.innerHTML = `<div class="w-full h-full bg-gradient-to-br from-purple-900 to-black border border-purple-500 flex items-center justify-center text-[8px] text-purple-300 text-center p-1 uppercase">SHADOW<br>ENTITY</div>`;
                } else {
                    imgFallback.innerHTML = `[ NO VISUAL DATA ]`;
                }
            }
        }

        const stratumElement = document.getElementById('dossier-stratum');
        if (stratumElement) {
            stratumElement.innerText = displayData.stratum?.toUpperCase() || 'UNKNOWN';
        }

        const statsArea = document.getElementById('dossier-stats');

        if (statsArea) {
            const stats = displayData.stats || { AMN: 20, WILL: { total: 0 }, PHYS: { total: 0 }, AWR: { total: 0 } };
            
            // Format stats regardless of structure
            const getStatValue = (pool, sub) => {
                const p = stats[pool];
                if (!p) return 0;
                if (typeof p === 'object') {
                    if (sub) return p[sub] || 0;
                    return p.total || 0;
                }
                return sub ? 0 : p;
            };

            const amnBar = generateVisualBar(getStatValue('AMN'), 20, 'bg-amber-600');
            const willBar = generateVisualBar(displayData.will || getStatValue('WILL'), getStatValue('WILL'), 'bg-emerald-600');
            const physBar = generateVisualBar(displayData.hp || getStatValue('PHYS'), getStatValue('PHYS'), 'bg-emerald-600');
            const awrBar = generateVisualBar(getStatValue('AWR'), 20, 'bg-emerald-600');

            // Sub-stat Bars
            const stabilityBar = generateVisualBar(getStatValue('WILL', 'stability'), getStatValue('WILL', 'stability'), 'bg-blue-500', true);
            const projectionBar = generateVisualBar(getStatValue('WILL', 'projection'), getStatValue('WILL', 'projection'), 'bg-purple-500', true);
            
            const strengthBar = generateVisualBar(getStatValue('PHYS', 'strength'), getStatValue('PHYS', 'strength'), 'bg-red-500', true);
            const agilityBar = generateVisualBar(getStatValue('PHYS', 'agility'), getStatValue('PHYS', 'agility'), 'bg-yellow-500', true);
            
            const focusBar = generateVisualBar(getStatValue('AWR', 'focus'), getStatValue('AWR', 'focus'), 'bg-cyan-500', true);
            const perceptionBar = generateVisualBar(getStatValue('AWR', 'perception'), getStatValue('AWR', 'perception'), 'bg-white', true);
            
            const inventoryHtml = displayData.inventory && displayData.inventory.length > 0 
                ? displayData.inventory.map(item => `
                    <div class="border border-[#1a3a1a] p-1 bg-black/40 border-l-2 border-l-green-900 mb-1">
                        <span class="text-gray-400 font-bold block truncate text-xs">${item.name}</span>
                    </div>`).join('')
                : '<div class="text-gray-600 italic text-xs">[ NO ITEMS ]</div>';

            statsArea.innerHTML = `
                <div class="mb-4">
                    <div class="text-amber-500 font-bold text-lg mb-1 leading-tight">${displayData.name.toUpperCase()}</div>
                    <div class="text-gray-500 text-[10px] italic mb-2">${displayData.archetype || 'VESSEL'}</div>
                    <details class="group">
                        <summary class="text-[9px] text-green-900 uppercase tracking-widest cursor-pointer hover:text-green-500 mb-1 list-none">
                            [ + ] Biometric_History
                        </summary>
                        <div class="text-gray-400 leading-relaxed text-[11px] sm:text-sm border-l border-green-900/30 pl-2 mt-1 mb-4">
                            ${displayData.description || 'No biometric history on file.'}
                        </div>
                    </details>
                </div>
                <div class="space-y-1 border-t border-green-900 pt-4 mb-4 font-mono text-[10px] sm:text-xs">
                    <div class="flex justify-between items-center text-amber-500 font-bold mb-2"><span>AMN</span>  ${amnBar}</div>
                    
                    <div class="flex flex-col gap-0.5 mb-2">
                        <div class="flex justify-between items-center pl-2 border-l border-emerald-900/50"><span>WILLPOWER</span> ${willBar}</div>
                        <div class="flex justify-between items-center pl-4 border-l border-blue-900/30 text-[9px] text-blue-400 opacity-80"><span>├ STABILITY</span> ${stabilityBar}</div>
                        <div class="flex justify-between items-center pl-4 border-l border-purple-900/30 text-[9px] text-purple-400 opacity-80"><span>└ PROJECTION</span> ${projectionBar}</div>
                    </div>
                    
                    <div class="flex flex-col gap-0.5 mb-2">
                        <div class="flex justify-between items-center pl-2 border-l border-emerald-900/50"><span>PHYSIQUE</span>  ${physBar}</div>
                        <div class="flex justify-between items-center pl-4 border-l border-red-900/30 text-[9px] text-red-400 opacity-80"><span>├ STRENGTH</span> ${strengthBar}</div>
                        <div class="flex justify-between items-center pl-4 border-l border-yellow-900/30 text-[9px] text-yellow-400 opacity-80"><span>└ AGILITY</span> ${agilityBar}</div>
                    </div>
                    
                    <div class="flex flex-col gap-0.5">
                        <div class="flex justify-between items-center pl-2 border-l border-emerald-900/50"><span>AWARENESS</span> ${awrBar}</div>
                        <div class="flex justify-between items-center pl-4 border-l border-cyan-900/30 text-[9px] text-cyan-400 opacity-80"><span>├ FOCUS</span> ${focusBar}</div>
                        <div class="flex justify-between items-center pl-4 border-l border-white/30 text-[9px] text-white opacity-80"><span>└ PERCEPTION</span> ${perceptionBar}</div>
                    </div>
                </div>
                <div class="border-t border-green-900 pt-4">
                    <div class="text-[10px] text-green-500 font-bold mb-2 tracking-widest uppercase">Possessions</div>
                    <div id="dossier-inventory-list">
                        ${inventoryHtml}
                    </div>
                </div>
            `;
        }
    } else {
        modal.classList.add('hidden');
    }
}

export function toggleCombatUI(active, opponentData = null) {
    const output = document.getElementById('output');
    const overlay = document.getElementById('combat-overlay');
    const timerBar = document.getElementById('combat-timer-bar');
    const visualsEl = document.getElementById('visuals');
    if (!output || !overlay) return;

    if (active && opponentData) {
        document.body.style.overflow = 'hidden';
        document.getElementById('ability-hand')?.classList.remove('hidden');
        
        output.classList.add('hidden');
        overlay.classList.remove('hidden');
        overlay.classList.add('flex');

        // Shrink visuals during combat
        if (visualsEl) {
            visualsEl.classList.add('h-[10vh]', 'sm:h-[20%]');
            visualsEl.classList.remove('h-[25vh]', 'sm:h-[45%]', 'max-h-[250px]');
        }

        // Reset and start timer animation
        if (timerBar) {
            timerBar.classList.remove('timer-active');
            void timerBar.offsetWidth; // Trigger reflow
            timerBar.classList.add('timer-active');
        }

        // --- TACTICAL INTEL (Phase 6) ---
        const intelPanel = document.getElementById('tactical-intel-panel');
        if (intelPanel) {
            intelPanel.classList.remove('hidden');
            intelPanel.classList.add('flex');
            
            const intelName = document.getElementById('intel-name');
            const intelDesc = document.getElementById('intel-desc');
            const intelPhys = document.getElementById('intel-phys');
            const intelWill = document.getElementById('intel-will');
            const intelAwr = document.getElementById('intel-awr');
            
            if (intelName) intelName.innerText = opponentData.name || 'UNKNOWN ENTITY';
            if (intelDesc) intelDesc.innerText = opponentData.description || 'No biometric data retrieved for this entity.';
            if (intelPhys) intelPhys.innerText = opponentData.stats?.PHYS ?? '???';
            if (intelWill) intelWill.innerText = opponentData.stats?.WILL ?? '???';
            if (intelAwr) intelAwr.innerText = opponentData.stats?.AWR ?? '???';
        }

        const { activeAvatar } = stateManager.getState();

        // 1. POPULATE OPPONENT CARD
        const oppPortrait = document.getElementById('opponent-portrait');
        const oppFallback = document.getElementById('opponent-portrait-fallback');
        const oppName = document.getElementById('opponent-name');
        const oppStats = document.getElementById('opponent-stats');
        
        if (oppPortrait && oppFallback) {
            if (opponentData.image) {
                oppPortrait.src = opponentData.image;
                oppPortrait.classList.remove('hidden');
                oppFallback.classList.add('hidden');
            } else {
                oppPortrait.classList.add('hidden');
                oppFallback.classList.remove('hidden');
                oppFallback.classList.add('flex');
                // Stylized placeholder for missing image
                oppFallback.innerHTML = `<div class="w-full h-full bg-gradient-to-br from-purple-900 to-black border border-purple-500 flex items-center justify-center text-[8px] text-purple-300 text-center p-1 uppercase">SHADOW<br>ENTITY</div>`;
            }
        }

        if (oppName) oppName.innerText = opponentData.name.toUpperCase();
        
        if (oppStats) {
            const currentConsc = opponentData.consc !== undefined ? opponentData.consc : 10;
            const maxConsc = opponentData.stats?.CONSC || 10;
            const currentPhys = opponentData.hp !== undefined ? opponentData.hp : 10;
            const maxPhys = opponentData.stats?.PHYS || 10;

            oppStats.innerHTML = `
                ${renderStatBarHTML('WILL', currentConsc, maxConsc, 'var(--term-amber)')}
                ${renderStatBarHTML('PHYS', currentPhys, maxPhys, 'var(--term-red)')}
            `;
        }

        // 2. POPULATE PLAYER CARD
        const playerPortrait = document.getElementById('player-portrait');
        const playerFallback = document.getElementById('player-portrait-fallback');
        const playerName = document.getElementById('player-name');
        const playerStats = document.getElementById('player-stats');
        const abilityContainer = document.getElementById('ability-chips');

        if (activeAvatar) {
            if (playerPortrait && playerFallback) {
                if (activeAvatar.image) {
                    playerPortrait.src = activeAvatar.image;
                    playerPortrait.classList.remove('hidden');
                    playerFallback.classList.add('hidden');
                } else {
                    playerPortrait.classList.add('hidden');
                    playerFallback.classList.remove('hidden');
                    playerFallback.classList.add('flex');
                }
            }

            if (playerName) playerName.innerText = activeAvatar.name.toUpperCase();

            if (playerStats) {
                const stats = activeAvatar.stats || {};
                const getStatValue = (pool, sub) => {
                    const p = stats[pool];
                    if (!p) return 0;
                    if (typeof p === 'object') {
                        if (sub) return p[sub] || 0;
                        return p.total || 0;
                    }
                    return sub ? 0 : p;
                };

                const curWill = activeAvatar.will !== undefined ? activeAvatar.will : getStatValue('WILL');
                const maxWill = getStatValue('WILL');
                const curPhys = activeAvatar.hp !== undefined ? activeAvatar.hp : getStatValue('PHYS');
                const maxPhys = getStatValue('PHYS');

                const isAstral = stateManager.getState().localPlayer.stratum === 'astral';

                playerStats.innerHTML = `
                    ${renderStatBarHTML('WILL', curWill, maxWill, 'var(--gm-purple)', isAstral ? 'stat-will-astral' : '')}
                    ${renderStatBarHTML('PHYS', curPhys, maxPhys, 'var(--term-green)', isAstral ? 'stat-phys-astral' : '')}
                `;
            }

            if (abilityContainer) {
                renderAbilityChips(abilityContainer);
            }
        }
    } else {
        document.body.style.overflow = '';
        document.getElementById('ability-hand')?.classList.add('hidden');
        document.getElementById('tactical-intel-panel')?.classList.add('hidden');
        document.getElementById('tactical-intel-panel')?.classList.remove('flex');
        
        overlay.classList.add('hidden');
        overlay.classList.remove('flex');
        if (timerBar) timerBar.classList.remove('timer-active');
        
        // Restore original visuals height
        if (visualsEl) {
            visualsEl.classList.remove('h-[10vh]', 'sm:h-[20%]');
            visualsEl.classList.add('h-[25vh]', 'sm:h-[45%]', 'max-h-[250px]');
        }

        output.classList.remove('hidden');
    }
}

/**
 * Renders a blocky HTML stat bar.
 */
function renderStatBarHTML(label, current, max, color, extraClass = '') {
    const percent = Math.max(0, Math.min(100, (current / max) * 100));
    return `
        <div class="combat-stat-row ${extraClass}">
            <div class="combat-stat-label">${label}</div>
            <div class="combat-stat-bar-bg">
                <div class="combat-stat-bar-fill" style="width: ${percent}%; background-color: ${color}; color: ${color};"></div>
            </div>
            <div class="text-[8px] text-gray-500 w-8 text-right">${current}/${max}</div>
        </div>
    `;
}

/**
 * Renders interactive ability chips.
 */
function renderAbilityChips(container) {
    container.innerHTML = '';
    const abilities = [
        { name: 'Force Weave', stat: 'WILL', cmd: 'Force Weave' },
        { name: 'Kinetic Strike', stat: 'PHYS', cmd: 'Kinetic Strike' },
        { name: 'Defensive Glitch', stat: 'AWR', cmd: 'Defensive Glitch' }
    ];

    abilities.forEach(ability => {
        const btn = document.createElement('button');
        btn.className = 'ability-chip';
        btn.innerHTML = `${ability.name} <span class="opacity-50 text-[7px]">(${ability.stat})</span>`;
        btn.onclick = () => {
            const combatOverlay = document.getElementById('combat-overlay');
            if (combatOverlay) {
                combatOverlay.classList.remove('animate-combat-shake');
                void combatOverlay.offsetWidth;
                combatOverlay.classList.add('animate-combat-shake');
            }

            const input = document.getElementById('cmd-input');
            if (input) {
                input.value = ability.cmd;
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

                // Immediate feedback in the combat log
                const combatLog = document.getElementById('combat-log');
                if (combatLog) {
                    const echo = document.createElement('div');
                    echo.className = 'text-blue-400 mb-1';
                    echo.innerHTML = `> [INTENT LOCKED]: ${ability.name.toUpperCase()}`;
                    combatLog.appendChild(echo);
                    combatLog.scrollTop = combatLog.scrollHeight;
                }
            }
        };
        container.appendChild(btn);
    });
}

export function toggleStratumModal(currentStratum) {
    const modal = document.getElementById('stratum-modal');
    if (!modal) return;
    
    const nameEl = document.getElementById('modal-stratum-name');
    const descEl = document.getElementById('stratum-description');
    
    const { strata } = stateManager.getState();
    const stratumData = strata[currentStratum.toLowerCase()];

    if (nameEl) nameEl.innerText = stratumData ? stratumData.name : currentStratum;
    if (descEl) {
        descEl.innerText = stratumData ? stratumData.description : "An unidentified layer of reality.";
    }

    modal.classList.toggle('hidden');
}

export function setWizardPrompt(promptText) {
    const prefixEl = document.getElementById('prompt-prefix');
    if (prefixEl) {
        prefixEl.innerText = promptText;
    }
}

export function printRoomDescription(room, isAstral, activeMap, activeAvatar) {
    if (!room) {
        addLog("[SYSTEM]: The frequency is shifting. Reality is rendering...", "var(--gm-purple)");
        return;
    }

    const { strata, localPlayer } = stateManager.getState();
    const stratumData = strata[localPlayer.stratum.toLowerCase()];
    const color = stratumData ? stratumData.color : (isAstral ? "var(--gm-purple)" : "var(--term-green)");
    
    const roomTitle = room.name ? room.name.toUpperCase() : (room.shortName ? room.shortName.toUpperCase() : "UNKNOWN LOCATION");
    addLog(`\n--- ${roomTitle} ---`, color);
    
    if (room.description) {
        addLog(room.description, "#ccc");
    } else {
        addLog("Sensory data unavailable.", "#ccc");
    }

    if (room.items && room.items.length > 0) {
        const itemNames = room.items.map(i => `[${i.name}]`).join(", ");
        addLog(`Items here: ${itemNames}`, "var(--term-amber)");
    }

    if (room.npcs && room.npcs.length > 0) {
        room.npcs.forEach(npc => {
            addLog(`Presence detected: ${npc.name} (${npc.archetype || 'Entity'})`, "var(--crayola-blue)");
        });
    }

    const exits = Object.keys(room.exits || {}).join(", ").toUpperCase();
    if (exits) addLog(`Visible Exits: ${exits}`, "#888");
}

/**
 * Toggle the Pin Button state during async operations.
 */
export function togglePinButton(show, label, style = 'normal') {
    const btn = document.getElementById('pin-view-btn');
    if (!btn) return;

    if (show) {
        btn.classList.remove('hidden');
        btn.innerText = label;

        // Reset styles
        btn.classList.remove('bg-blue-600', 'border-blue-400', 'bg-amber-600', 'border-amber-400', 'bg-green-600', 'border-green-400', 'animate-pulse');

        if (style === 'uploading') {
            btn.classList.add('bg-amber-600', 'border-amber-400', 'animate-pulse');
        } else if (style === 'pinned') {
            btn.classList.add('bg-green-600', 'border-green-400');
        } else {
            // normal style depends on current pinned state which we don't have here easily
            // but we can just use the default blue for now or rely on the state subscription
            // to reset it to the correct state after a timeout in visualSystem.js
            btn.classList.add('bg-blue-600', 'border-blue-400');
        }
    } else {
        btn.classList.add('hidden');
    }
}