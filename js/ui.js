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
    updateVitalsUI(activeAvatar);
    updateAvatarUI(activeAvatar);
    updateInventoryUI(localPlayer.inventory);
    
    // Header Vitals Sync
    syncHeaderVitals(activeAvatar);
    
    const room = activeMap[localPlayer.currentRoom];
    updateRoomItemsUI(room?.items);
    updateRoomEntitiesUI(room?.npcs);
    updateCompassUI(room);
    renderMapHUD(activeMap, localPlayer.currentRoom, localPlayer.stratum);
    updateContextualSuggestions(state.suggestions);

    // Combat UI Toggle
    if (localPlayer.combat.active) {
        // Find opponent in current room
        const opponent = room?.npcs?.find(n => n.name === localPlayer.combat.opponent);
        toggleCombatUI(true, opponent || { name: localPlayer.combat.opponent });
    } else {
        toggleCombatUI(false);
    }
});

export function initHUDWidgets() {
    // Mobile Nav Rail Listeners
    const railButtons = {
        'nav-map': 'SYSTEM.TOPOLOGY',
        'nav-bio': 'SYSTEM.BIOMETRICS',
        'nav-ent': 'SYSTEM.ENTITIES',
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

    const jackOutBtn = document.getElementById('btn-jack-out');
    if (jackOutBtn) {
        jackOutBtn.onclick = () => toggleDossierBuffer(false);
    }

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
    const will = activeAvatar.stats.WILL || 10;
    const awr = activeAvatar.stats.AWR || 10;
    const phys = activeAvatar.stats.PHYS || 10;
    
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

function generateAsciiBar(current, max, length = 10) {
    const filledLength = Math.round((current / max) * length);
    const emptyLength = length - filledLength;
    const bar = '|'.repeat(Math.max(0, filledLength)) + ' '.repeat(Math.max(0, emptyLength));
    return `[${bar}] ${current}/${max}`;
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
        ? `<img src="${activeAvatar.image}" id="avatar-portrait-main" class="w-full h-full object-cover cursor-pointer hover:opacity-80 transition-opacity">`
        : `<div class="w-full h-full bg-gray-900 flex items-center justify-center text-[10px] text-gray-700">[ NO VISUAL DATA ]</div>`;

    const willBar = generateAsciiBar(activeAvatar.will || activeAvatar.stats.WILL, activeAvatar.stats.WILL);
    const physBar = generateAsciiBar(activeAvatar.hp || activeAvatar.stats.PHYS, activeAvatar.stats.PHYS);

    container.innerHTML = `
        <div class="relative w-full h-full">
            ${portrait}
            <div class="absolute bottom-0 left-0 right-0 bg-black/80 p-2 border-t border-[#1a3a1a]">
                <div class="text-[10px] text-amber-500 font-bold uppercase mb-1">${activeAvatar.name}</div>
                <div class="text-[8px] font-mono text-green-500">HP:   ${physBar}</div>
                <div class="text-[8px] font-mono text-blue-400">WILL: ${willBar}</div>
            </div>
        </div>
    `;

    // Add click listener to the portrait to trigger Dossier
    const portraitImg = document.getElementById('avatar-portrait-main');
    if (portraitImg) {
        portraitImg.onclick = () => toggleDossierBuffer(true);
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

export function updateRoomEntitiesUI(npcs) {
    const container = document.getElementById('room-entities-container');
    if (!container) return;
    if (!npcs || npcs.length === 0) {
        container.innerHTML = "[NONE]";
        return;
    }
    
    container.innerHTML = '';
    npcs.forEach((npc, index) => {
        const stats = npc.stats || { WILL: '??', AWR: '??', PHYS: '??' };
            
        const card = document.createElement('div');
        card.className = "flex justify-between items-center p-1 border border-[#1a3a1a] bg-black/40 cursor-pointer hover:border-blue-500 transition-colors";
        card.innerHTML = `
            <div class="flex-grow min-w-0 pointer-events-none">
                <div class="text-blue-400 font-bold uppercase truncate">${npc.name}</div>
            </div>
            <div class="flex gap-1 text-[8px] font-mono text-blue-900 flex-shrink-0">
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
            openForgeModal(detailData);
        };
        
        container.appendChild(card);
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

    // --- ASTRAL INTERFERENCE ---
    if (stratum === 'astral' || currentRoomKey.startsWith('astral_')) {
        // Draw digital static
        for (let i = 0; i < 200; i++) {
            const x = Math.random() * canvas.width;
            const y = Math.random() * canvas.height;
            const size = Math.random() * 2;
            ctx.fillStyle = Math.random() > 0.5 ? "rgba(176, 132, 232, 0.4)" : "rgba(0, 245, 255, 0.2)";
            ctx.fillRect(x, y, size, size);
        }
        
        ctx.fillStyle = "#b084e8";
        ctx.font = "bold 10px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("ASTRAL INTERFERENCE: TOPOLOGY MASKED", canvas.width / 2, canvas.height / 2);
        return;
    }

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

export function toggleDossierBuffer(show) {
    const output = document.getElementById('output');
    const buffer = document.getElementById('dossier-buffer');
    if (!output || !buffer) return;

    if (show) {
        const { activeAvatar } = stateManager.getState();
        if (!activeAvatar) return;

        output.classList.add('hidden');
        buffer.classList.remove('hidden');
        buffer.classList.add('flex');

        // Populate Dossier
        const portraitLarge = document.getElementById('dossier-portrait-large');
        const statsArea = document.getElementById('dossier-stats');
        
        if (portraitLarge) {
            portraitLarge.innerHTML = activeAvatar.image 
                ? `<img src="${activeAvatar.image}" class="w-full h-full object-cover">`
                : `<div class="w-full h-full flex items-center justify-center text-gray-700">[ NO VISUAL ]</div>`;
        }

        if (statsArea) {
            const willBar = generateAsciiBar(activeAvatar.will || activeAvatar.stats.WILL, activeAvatar.stats.WILL, 20);
            const physBar = generateAsciiBar(activeAvatar.hp || activeAvatar.stats.PHYS, activeAvatar.stats.PHYS, 20);
            
            statsArea.innerHTML = `
                <div class="mb-4">
                    <div class="text-amber-500 font-bold text-lg mb-1">${activeAvatar.name.toUpperCase()}</div>
                    <div class="text-gray-500 text-xs italic mb-2">${activeAvatar.archetype || 'VESSEL'}</div>
                    <div class="text-gray-400 leading-relaxed">${activeAvatar.description || 'No biometric history on file.'}</div>
                </div>
                <div class="space-y-2 border-t border-green-900 pt-4">
                    <div class="flex justify-between"><span>WILLPOWER</span> <span>${willBar}</span></div>
                    <div class="flex justify-between"><span>PHYSIQUE</span>  <span>${physBar}</span></div>
                    <div class="flex justify-between"><span>AWARENESS</span> <span>[${'|'.repeat(activeAvatar.stats.AWR)}${' '.repeat(20 - activeAvatar.stats.AWR)}] ${activeAvatar.stats.AWR}/20</span></div>
                </div>
            `;
        }
    } else {
        buffer.classList.add('hidden');
        buffer.classList.remove('flex');
        output.classList.remove('hidden');
    }
}

export function toggleCombatUI(active, opponentData = null) {
    const output = document.getElementById('output');
    const overlay = document.getElementById('combat-overlay');
    if (!output || !overlay) return;

    if (active && opponentData) {
        output.classList.add('hidden');
        overlay.classList.remove('hidden');
        overlay.classList.add('flex');

        // Populate Combat UI
        const opponentArea = document.getElementById('combat-opponent');
        const playerArea = document.getElementById('combat-player');
        const { activeAvatar } = stateManager.getState();

        if (opponentArea) {
            const oppWill = opponentData.will || opponentData.stats?.WILL || 10;
            const maxWill = opponentData.stats?.WILL || 10;
            opponentArea.innerHTML = `
                <div class="flex justify-between items-center mb-1">
                    <span class="text-amber-500 font-bold">${opponentData.name.toUpperCase()}</span>
                    <span class="text-xs text-amber-900">${opponentData.archetype || 'ENTITY'}</span>
                </div>
                <div class="text-[10px] font-mono text-amber-700">
                    WILL: ${generateAsciiBar(oppWill, maxWill, 15)}
                </div>
            `;
        }

        if (playerArea && activeAvatar) {
            const pWill = activeAvatar.will || activeAvatar.stats.WILL;
            const maxWill = activeAvatar.stats.WILL;
            playerArea.innerHTML = `
                <div class="flex justify-between items-center mb-1">
                    <span class="text-blue-500 font-bold">${activeAvatar.name.toUpperCase()}</span>
                    <span class="text-xs text-blue-900">VESSEL</span>
                </div>
                <div class="text-[10px] font-mono text-blue-700">
                    WILL: ${generateAsciiBar(pWill, maxWill, 15)}
                </div>
            `;
        }
    } else {
        overlay.classList.add('hidden');
        overlay.classList.remove('flex');
        // Only show output if dossier is not active
        if (document.getElementById('dossier-buffer').classList.contains('hidden')) {
            output.classList.remove('hidden');
        }
    }
}

export function toggleStratumModal(currentStratum) {
    const modal = document.getElementById('stratum-modal');
    if (!modal) return;
    
    const nameEl = document.getElementById('modal-stratum-name');
    const descEl = document.getElementById('stratum-description');
    
    if (nameEl) nameEl.innerText = currentStratum;
    if (descEl) {
        const descs = {
            mundane: "The Mundane stratum represents base consensus reality. Physics are deterministic, and the Technate's surveillance is absolute. Most vessels are anchored here by default.",
            astral: "The Astral stratum is a realm of pure information and intent. Conventional geometry fails here, and reality is shaped by the observer's Willforce.",
            faen: "The Faen stratum is a twilight realm of myth and memory, where the boundaries between biological and digital life are blurred.",
            technate: "The Technate stratum is the core processing layer of the world's governing AI. It is a place of cold, geometric perfection and overwhelming data flow."
        };
        descEl.innerText = descs[currentStratum.toLowerCase()] || "An unidentified layer of reality.";
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