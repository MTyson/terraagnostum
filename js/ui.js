// js/ui.js
// Purpose: Handles all DOM manipulation, canvas rendering, and CSS theme transitions.
import * as stateManager from './stateManager.js';
import { openForgeModal } from './forgeSystem.js';

// Subscribe to state changes
stateManager.subscribe((state) => {
    const { activeAvatar, localPlayer, activeTerminal, wizardState } = state;
    const activeMap = stateManager.getActiveMap();
    const tier = stateManager.getUserTier();
    
    // Update Command Prompt
    const roomShort = activeMap[localPlayer.currentRoom]?.shortName || localPlayer.currentRoom.toUpperCase();
    const wizardPlaceholder = wizardState.active ? (wizardState.type === 'login' ? '[ AWAITING EMAIL... ]' : '[ AWAITING INPUT... ]') : null;
    let combatSuffix = localPlayer.combat.active ? `[COMBAT vs ${localPlayer.combat.opponent}]` : null;
    
    updateCommandPrompt(tier, roomShort, activeTerminal, wizardPlaceholder, activeAvatar, combatSuffix);

    // Update Sidebars/HUD
    updateStatusUI(roomShort, localPlayer.stratum);
    updateAvatarUI(activeAvatar);
    updateInventoryUI(localPlayer.inventory);
    
    const room = activeMap[localPlayer.currentRoom];
    updateRoomItemsUI(room?.items);
    updateRoomEntitiesUI(room?.npcs);
    updateCompassUI(room);
    renderMapHUD(activeMap, localPlayer.currentRoom, localPlayer.stratum);
    updateContextualSuggestions(state.suggestions);
});

export function initHUDWidgets() {
    // Mobile Nav Rail Listeners
    const railButtons = {
        'nav-map': 'SYSTEM.TOPOLOGY',
        'nav-bio': 'SYSTEM.BIOMETRICS',
        'nav-inv': 'SYSTEM.INVENTORY'
    };

    const sidebar = document.getElementById('right-sidebar');

    Object.keys(railButtons).forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.onclick = (e) => {
                e.stopPropagation();
                const wasActive = sidebar.classList.contains('active');
                
                // Toggle active class on sidebar
                sidebar.classList.toggle('active');
                
                // If opening, scroll to the relevant section
                if (!wasActive) {
                    const sectionHeader = [...sidebar.querySelectorAll('.section-header')]
                        .find(el => el.innerText.includes(railButtons[id]));
                    if (sectionHeader) {
                        sectionHeader.scrollIntoView({ behavior: 'smooth' });
                    }
                }
            };
        }
    });

    // Close sidebar when clicking main terminal area (on mobile)
    document.getElementById('main-terminal-area').onclick = () => {
        if (window.innerWidth < 1024) {
            sidebar.classList.remove('active');
        }
    };

    // Compass Listeners
    const compassButtons = {
        'compass-n': 'n',
        'compass-s': 's',
        'compass-e': 'e',
        'compass-w': 'w'
    };

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
        suggestions.push("ATTACK WITH WILL FORCE");
        suggestions.push("CREATE ASTRAL WEAPON");
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

export function updateCommandPrompt(tier, roomShort, activeTerminal = false, wizardPlaceholder = null, activeAvatar = null, combatSuffix = null) {
    const prefixEl = document.getElementById('prompt-prefix');
    const inputEl = document.getElementById('cmd-input');
    if (!prefixEl || !inputEl) return;

    if (wizardPlaceholder) {
        inputEl.placeholder = wizardPlaceholder;
    } else if (activeTerminal) {
        inputEl.placeholder = "TANDEM_OS // Awaiting command ('exit' to disconnect)...";
    } else if (combatSuffix) {
        inputEl.placeholder = "BATTLE OF WILLS // Describe your resistance...";
    } else {
        inputEl.placeholder = "Enter command...";
    }

    const displayName = activeAvatar ? activeAvatar.name.toUpperCase() : tier;
    let colorClass = "text-green-400";
    if (tier === 'VOID') colorClass = "text-purple-500";
    if (tier === 'GUEST') colorClass = "text-gray-500";
    if (tier === 'ARCHITECT') colorClass = "text-blue-400";

    const combatDisplay = combatSuffix ? `<span class="text-red-500 ml-1">${combatSuffix}</span>` : "";
    prefixEl.innerHTML = `<span class="${colorClass} font-bold">${displayName}@${roomShort}:~$</span>${combatDisplay}&nbsp;`;
}

export function updateStatusUI(roomShort, stratum = 'MUNDANE') {
    const roomEl = document.getElementById('room-display');
    if (roomEl) roomEl.innerText = roomShort;
    
    const stratumEl = document.getElementById('stratum-name');
    if (stratumEl) stratumEl.innerText = stratum.toUpperCase();
}

export function updateAvatarUI(activeAvatar) {
    const container = document.getElementById('avatar-container');
    if (!container) return;
    
    if (!activeAvatar) {
        container.innerHTML = `
            <div class="text-amber-500 text-[10px] text-center border border-dashed border-amber-900 p-4 mt-2 uppercase tracking-tighter">
                NO VESSEL DETECTED<br>DISEMBODIED STATE<br><br>
                <span class="text-gray-600">Navigate to character_room and type 'CREATE AVATAR'.</span>
            </div>`;
        return;
    }
    
    const portrait = activeAvatar.image 
        ? `<img src="${activeAvatar.image}" id="avatar-portrait-main" class="w-full h-32 object-cover border border-[#1a3a1a] mb-2 contrast-125 cursor-pointer hover:border-amber-500 transition-colors">`
        : `<div class="w-full h-32 bg-gray-900 border border-[#1a3a1a] mb-2 flex items-center justify-center text-[10px] text-gray-700">[ NO VISUAL DATA ]</div>`;

    container.innerHTML = `
        <div class="char-card w-full m-0 mt-2 p-3 bg-transparent border-[#1a3a1a]">
            ${portrait}
            <div class="char-card-header pb-2 mb-2 border-b border-[#1a3a1a]">
                <span class="char-card-title text-[10px] text-amber-500 font-bold uppercase tracking-widest">[ACTV] ${activeAvatar.name}</span>
            </div>
            <div class="char-card-stats flex flex-col gap-1 text-[9px] font-mono text-green-700 uppercase">
                <div class="flex justify-between"><span>WILLFORCE:</span> <span>${activeAvatar.stats.WILL || 10}</span></div>
                <div class="flex justify-between"><span>AWARENESS:</span> <span>${activeAvatar.stats.AWR || 10}</span></div>
                <div class="flex justify-between"><span>PHYSICALITY:</span> <span>${activeAvatar.stats.PHYS || 10}</span></div>
            </div>
        </div>
    `;

    // Add click listener to the portrait
    const portraitImg = document.getElementById('avatar-portrait-main');
    if (portraitImg) {
        portraitImg.onclick = () => openForgeModal(activeAvatar);
    }
}

export function updateInventoryUI(inventory) {
    const container = document.getElementById('inventory-container');
    if (!container) return;
    if (!inventory || inventory.length === 0) {
        container.innerHTML = "[EMPTY]";
        return;
    }
    container.innerHTML = inventory.map(item => `
        <div class="border border-[#1a3a1a] p-2 rounded bg-black/40 border-l-4 border-l-green-900">
            <span class="text-amber-500 font-bold block">${item.name}</span>
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
    container.innerHTML = items.map(item => `<div class="text-xs text-amber-600">> ${item.name}</div>`).join('');
}

export function updateRoomEntitiesUI(npcs) {
    const container = document.getElementById('room-entities-container');
    if (!container) return;
    if (!npcs || npcs.length === 0) {
        container.innerHTML = "[NONE]";
        return;
    }
    container.innerHTML = npcs.map(npc => `<div class="text-xs text-blue-400">> ${npc.name} (${npc.archetype})</div>`).join('');
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
    if (output) output.scrollTop = output.scrollHeight;
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
 * Real-time Topology Renderer: Draws the active map graph with labeled nodes.
 */
export function renderMapHUD(activeMap, currentRoomKey, stratum) {
    const canvas = document.getElementById('map-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    const rect = canvas.parentElement.getBoundingClientRect();
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
        if (rect.width > 0 && rect.height > 0) {
            canvas.width = rect.width;
            canvas.height = rect.height;
        }
    }

    if (!activeMap || Object.keys(activeMap).length === 0 || canvas.width === 0) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const spacingX = 60;
    const spacingY = 50;

    const room = activeMap[currentRoomKey];
    if (!room) return;

    // Use hex codes for canvas compatibility
    const currentGreen = "#4ade80";
    const dimGreen = "#3a7a3a";
    const astralPurple = "#b084e8";

    ctx.strokeStyle = stratum === 'astral' ? astralPurple : '#3a7a3a';
    ctx.lineWidth = 2;

    // Draw Connections & Adjacent Nodes
    if (room.exits) {
        Object.entries(room.exits).forEach(([dir, target]) => {
            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            
            let tx = centerX;
            let ty = centerY;

            if (dir === 'north') ty -= spacingY;
            if (dir === 'south') ty += spacingY;
            if (dir === 'east') tx += spacingX;
            if (dir === 'west') tx -= spacingX;
            
            ctx.lineTo(tx, ty);
            ctx.stroke();

            // Draw adjacent node box
            const targetRoom = activeMap[typeof target === 'string' ? target : target.target];
            const label = targetRoom ? (targetRoom.shortName || targetRoom.name).substring(0, 4).toUpperCase() : "???";
            
            ctx.fillStyle = "#051505";
            ctx.strokeStyle = stratum === 'astral' ? astralPurple : dimGreen;
            ctx.lineWidth = 1;
            ctx.fillRect(tx - 16, ty - 12, 32, 24);
            ctx.strokeRect(tx - 16, ty - 12, 32, 24);
            
            // Draw label
            ctx.fillStyle = stratum === 'astral' ? astralPurple : dimGreen;
            ctx.font = "10px monospace";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(label, tx, ty);
            
            ctx.lineWidth = 2; // Restore line width for next connection
        });
    }

    // Draw Current Node
    ctx.fillStyle = "#051505";
    ctx.strokeStyle = stratum === 'astral' ? "#d8b4fe" : currentGreen;
    ctx.shadowBlur = 10; 
    ctx.shadowColor = stratum === 'astral' ? "#d8b4fe" : currentGreen;
    ctx.fillRect(centerX - 16, centerY - 12, 32, 24);
    ctx.strokeRect(centerX - 16, centerY - 12, 32, 24);
    ctx.shadowBlur = 0;
    
    // Draw Current Label
    ctx.fillStyle = stratum === 'astral' ? "#d8b4fe" : currentGreen;
    ctx.font = "bold 11px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const currentLabel = (room.shortName || room.name).substring(0, 4).toUpperCase();
    ctx.fillText(currentLabel, centerX, centerY);
}

export function materializeEffect() {
    const flash = document.createElement('div');
    flash.style = "position:fixed;inset:0;background:white;z-index:9999;pointer-events:none;animation:flash-out 0.8s forwards;";
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 800);
}

export function applyStratumTheme(stratum, isTransitioning) {
    const stratumNameEl = document.getElementById('stratum-name');
    if (stratumNameEl) {
        stratumNameEl.innerText = stratum.toUpperCase();
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

export function toggleStratumModal(currentStratum) {
    const modal = document.getElementById('stratum-modal');
    if (modal) {
        modal.classList.toggle('hidden');
    }
}

export function printRoomDescription(room, isAstral, activeMap, activeAvatar) {
    if (!room) {
        addLog("[SYSTEM]: The frequency is shifting. Reality is rendering...", "var(--gm-purple)");
        return;
    }

    const color = isAstral ? "var(--gm-purple)" : "var(--term-green)";
    addLog(`\n--- ${room.name.toUpperCase()} ---`, color);
    addLog(room.description, "#ccc");

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