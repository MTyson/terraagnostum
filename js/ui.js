// js/ui.js
// Purpose: Handles all DOM manipulation, canvas rendering, and CSS theme transitions.
// It manages no global state, relying entirely on the main game engine to pass the correct data.

// Inject Void Mode CSS
const style = document.createElement('style');
style.innerHTML = `
.void-mode img { filter: grayscale(1) brightness(0.6) contrast(1.3) !important; }
.void-mode #log div { color: var(--gm-purple) !important; }
.void-mode #log div[style*="color: #fff"] { color: #fff !important; }
.materialize-flash { position: fixed; inset: 0; background: white; z-index: 9999; pointer-events: none; animation: flash-out 1.2s ease-out forwards; }
@keyframes flash-out { from { opacity: 1; } to { opacity: 0; } }
#right-sidebar { overflow-y: auto; overflow-x: hidden; }
#right-sidebar > div { flex-shrink: 0; min-height: min-content; }
@keyframes inv-flash { 0% { box-shadow: 0 0 20px var(--term-green); border-color: var(--term-green); } 100% { box-shadow: none; border-color: inherit; } }
.flash-inv { animation: inv-flash 1s ease-out; }
.faen-mode #log div { text-shadow: none !important; filter: none !important; }
`;
document.head.appendChild(style);

export function applyStratumTheme(stratum, isTransitioningToFaen) {
    const root = document.documentElement;
    const stratDisp = document.getElementById('stratum-display');
    
    if (isTransitioningToFaen) {
        document.body.classList.add('desaturated');
        addLog("[SYSTEM]: REALITY_RENDER_STUTTER_DETECTED...", "var(--term-red)");
        setTimeout(() => {
            document.body.classList.remove('desaturated');
            document.body.classList.add('faen-mode');
        }, 1000);
    } else if (stratum !== 'faen') {
        document.body.classList.remove('faen-mode');
    }

    if (stratum === 'faen' || stratum === 'weave') {
        root.style.setProperty('--term-green', '#e2b714');
        root.style.setProperty('--term-amber', '#ff9d00');
        root.style.setProperty('--term-red', '#e53935'); 
        root.style.setProperty('--term-bg', '#1c0f1a');
        root.style.setProperty('--crayola-blue', '#b084e8'); 
        root.style.setProperty('--gm-purple', '#ff77ff');
        stratDisp.innerText = `STRATA: ${stratum.toUpperCase()}`;
        stratDisp.style.color = 'var(--crayola-blue)';
    } else if (stratum === 'technate') {
        root.style.setProperty('--term-green', '#e0f7fa');
        root.style.setProperty('--term-amber', '#ff2a2a');
        root.style.setProperty('--term-red', '#ff0000'); 
        root.style.setProperty('--term-bg', '#010a0f');
        root.style.setProperty('--crayola-blue', '#00ffff'); 
        root.style.setProperty('--gm-purple', '#ffffff');
        stratDisp.innerText = 'STRATA: TECHNATE';
        stratDisp.style.color = 'var(--term-green)';
    } else {
        root.style.setProperty('--term-green', '#00ff41');
        root.style.setProperty('--term-amber', '#ffb000');
        root.style.setProperty('--term-red', '#ff3e3e');
        root.style.setProperty('--term-bg', '#050505');
        root.style.setProperty('--crayola-blue', '#3b82f6');
        root.style.setProperty('--gm-purple', '#a855f7');
        stratDisp.innerText = 'STRATA: MUNDANE';
        stratDisp.style.color = '#888';
    }
}

export function updateCommandPrompt(tier, roomShort, activeTerminal = false, wizardPlaceholder = null, activeAvatar = null) {
    const prefixEl = document.getElementById('prompt-prefix');
    const inputEl = document.getElementById('cmd-input');
    if (!prefixEl || !inputEl) return;

    inputEl.className = "w-full bg-transparent text-white outline-none font-mono text-sm sm:text-base";

    if (wizardPlaceholder) {
        inputEl.placeholder = wizardPlaceholder;
        inputEl.classList.add("border-b", "border-amber-500");
    } else if (activeTerminal) {
        inputEl.placeholder = "TANDEM_OS // Awaiting command ('exit' to disconnect)...";
        inputEl.classList.add("border-b", "border-emerald-500");
    } else {
        inputEl.placeholder = "Enter command...";
    }

    if (activeTerminal) {
        prefixEl.innerHTML = '<span class="text-emerald-400 font-bold tracking-widest">TANDEM:~$</span>&nbsp;';
        return;
    }

    const displayName = activeAvatar ? activeAvatar.name.toUpperCase() : tier;
    let colorClass = "text-green-400";
    if (tier === 'VOID') colorClass = "text-purple-500";
    if (tier === 'GUEST') colorClass = "text-gray-500";
    if (tier === 'ARCHITECT') colorClass = "text-blue-400";

    prefixEl.innerHTML = `<span class="${colorClass} font-bold">${displayName}@${roomShort}:~$</span>&nbsp;`;
}

export function setWizardPrompt(promptText) {
    document.getElementById('prompt-prefix').innerHTML = `<span class="text-amber-500">${promptText}</span>&nbsp;`;
}

export function updateAvatarUI(activeAvatar) {
    const container = document.getElementById('avatar-container');
    if (!activeAvatar) {
        container.innerHTML = `
            <div class="text-amber-500 text-[10px] text-center border border-dashed border-amber-900 p-4 mt-2">
                NO VESSEL DETECTED<br>DISEMBODIED STATE<br><br><span class="text-gray-500 text-[8px]">Go to the Archive and type 'CREATE AVATAR' to forge a form.</span>
            </div>`;
        return;
    }

    container.innerHTML = `
        <div class="char-card w-full m-0 mt-2 p-3 bg-transparent shadow-none border-[#1a3a1a]" onclick="document.getElementById('cmd-input').value = 'stat'; document.getElementById('cmd-input').dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter'}));">
            <div class="char-card-header border-b border-[#1a3a1a] pb-2 mb-2">
                <span class="char-card-title text-[10px] text-amber-500">[ACTV] ${activeAvatar.name}</span>
                <span class="char-card-archetype text-[8px]">${activeAvatar.archetype}</span>
            </div>
            <div class="char-card-img-container h-32 border-[#1a3a1a] mb-2">
                ${activeAvatar.image ? `<img class="char-card-img" src="${activeAvatar.image}" alt="${activeAvatar.name}">` : `<div style="padding: 20px; text-align:center; color:#555;">[NO IMG]</div>`}
            </div>
            <div class="char-card-stats border-[#1a3a1a] bg-transparent pb-0 flex-col text-[9px] gap-1">
                <span>WILL (Mng): ${activeAvatar.stats.WILL || 20}</span>
                <span>CONS (Amn): ${activeAvatar.stats.CONS || 20}</span>
                <span>PHYS (HP): ${activeAvatar.stats.PHYS || 20}</span>
            </div>
        </div>
    `;
}

export function updateInventoryUI(inventory) {
    const container = document.getElementById('inventory-container');
    if (!inventory || inventory.length === 0) {
        container.innerHTML = "[EMPTY]";
        return;
    }
    container.innerHTML = inventory.map(item => `
        <div class="border border-[#1a3a1a] p-2 rounded bg-black/40 border-l-4 border-l-green-900">
            <span class="text-amber-500 font-bold block">${item.name}</span>
            <span class="text-[9px] text-blue-400 uppercase">${item.type}</span>
            <div class="mt-1 leading-tight">${item.description}</div>
        </div>
    `).join('');
}

export function updateRoomItemsUI(items) {
    const container = document.getElementById('room-items-container');
    if (!items || items.length === 0) {
        container.innerHTML = "[EMPTY]";
        return;
    }
    container.innerHTML = items.map(item => `
        <div class="border border-[#1a3a1a] p-2 rounded bg-black/40 border-l-4 border-l-amber-700">
            <span class="text-amber-500 font-bold block">${item.name}</span>
            <span class="text-[9px] text-blue-400 uppercase">${item.type}</span>
            <div class="mt-1 leading-tight">${item.description}</div>
        </div>
    `).join('');
}

export function updateRoomEntitiesUI(npcs) {
    const container = document.getElementById('room-entities-container');
    if (!npcs || npcs.length === 0) {
        container.innerHTML = "[NONE]";
        return;
    }
    container.innerHTML = npcs.map(npc => `
        <div class="border border-[#1a3a1a] p-2 rounded bg-black/40 border-l-4 cursor-pointer transition-colors flex items-center gap-3 hover:bg-[#001a33]"
             style="border-left-color: var(--crayola-blue);"
             onclick="document.getElementById('cmd-input').value = 'look at ${npc.name}'; document.getElementById('cmd-input').focus();">
            ${npc.image 
                ? `<img src="${npc.image}" style="width: 36px; height: 36px; object-fit: cover; border: 1px solid #333; border-radius: 4px;" alt="${npc.name}">` 
                : `<div style="width: 36px; height: 36px; background: #111; border: 1px solid #333; display: flex; align-items: center; justify-content: center; font-size: 8px; border-radius: 4px; color: #555;">[?]</div>`
            }
            <div style="flex: 1; min-width: 0;">
                <span style="color: var(--crayola-blue); font-weight: bold; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 11px;" class="uppercase">${npc.name}</span>
                <span class="text-[9px] text-gray-500 uppercase block truncate">${npc.archetype}</span>
            </div>
        </div>
    `).join('');
}

export function printRoomDescription(room, isFaen, fullMap = null, activeAvatar = null) {
    if (!room) { console.error('UI: Room is undefined'); return; }
    addLog(`[NARRATOR]: ${room.description}`, "#888");
    if (room.marginalia && room.marginalia.length > 0) {
        room.marginalia.forEach(note => {
            addLog(`[MARGINALIA]: ${note}`, "var(--crayola-blue)");
        });
    }
    if (room.items && room.items.length > 0) {
        const itemNames = room.items.map(i => `<span class="text-amber-400">${i.name}</span>`).join(', ');
        addLog(`You see items resting here: ${itemNames}`, "#aaa");
    }
    if (room.npcs && room.npcs.length > 0) {
        const npcNames = room.npcs.map(n => `<span class="text-crayola-blue font-bold">${n.name} (${n.archetype})</span>`).join(', ');
        addLog(`Entities Present: ${npcNames}`, "#aaa");
    }
    
    // Check for ADJACENT NPCs through exits
    if (fullMap && !isFaen) {
        let adjacentNpcs = [];
        for (let [dir, exitData] of Object.entries(room.exits || {})) {
            const targetId = typeof exitData === 'object' ? exitData.target : exitData;
            const targetRoom = fullMap[targetId];
            if (targetRoom && targetRoom.npcs && targetRoom.npcs.length > 0) {
                targetRoom.npcs.forEach(n => {
                    adjacentNpcs.push(`<span class="text-crayola-blue font-bold">${n.name}</span> (to the ${dir})`);
                });
            }
        }
        if (adjacentNpcs.length > 0) {
            addLog(`You can see nearby: ${adjacentNpcs.join(', ')}`, "#aaa");
        }
    }
    
    if (!isFaen) {
        const exits = Object.keys(room.exits || {}).map(e => e.toUpperCase()).join(', ');
        addLog(`Obvious Exits: ${exits || 'NONE'}`, "#555");
    } else {
        addLog(`The ethereal plane stretches infinitely.`, "var(--faen-pink)");
    }

    if (!activeAvatar) {
        addLog(`[TANDY]: Is someone there? I feel a ripple... Ian? No, the signature is different.  You're too thin, Wanderer. Find the Character Room and sketch a life.`, "var(--gm-purple)");
    }
}

export function renderMapHUD(apartmentMap, currentRoomKey, stratum) {
    const canvasContainer = document.getElementById('map-canvas-container');
    const canvas = document.getElementById('map-canvas');
    if (!canvas || !canvasContainer) return;
    const ctx = canvas.getContext('2d');
    const existingZones = canvasContainer.querySelectorAll('.map-clickable-zone');
    existingZones.forEach(zone => zone.remove());
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (stratum === 'faen') return;

    const computedStyle = getComputedStyle(document.body);
    const termGreen = computedStyle.getPropertyValue('--term-green').trim() || '#00ff41';
    const termAmber = computedStyle.getPropertyValue('--term-amber').trim() || '#ffb000';
    const termBg = computedStyle.getPropertyValue('--term-bg').trim() || '#050505';

    const nodeSize = 30;
    const spacing = 60;
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    let coords = {}; 
    let queue = [{key: currentRoomKey, logicalX: 0, logicalY: 0}];
    coords[currentRoomKey] = {x: 0, y: 0};
    let processed = new Set();

    while(queue.length > 0) {
        let curr = queue.shift();
        if (processed.has(curr.key)) continue;
        processed.add(curr.key);
        let node = apartmentMap[curr.key];
        if(!node) continue;
        if (node.exits) {
            const nId = typeof node.exits.north === 'object' ? node.exits.north.target : node.exits.north;
            if (nId && !coords[nId]) {
                coords[nId] = {x: curr.logicalX, y: curr.logicalY - 1};
                queue.push({key: nId, logicalX: curr.logicalX, logicalY: curr.logicalY - 1});
            }
            
            const sId = typeof node.exits.south === 'object' ? node.exits.south.target : node.exits.south;
            if (sId && !coords[sId]) {
                coords[sId] = {x: curr.logicalX, y: curr.logicalY + 1};
                queue.push({key: sId, logicalX: curr.logicalX, logicalY: curr.logicalY + 1});
            }
            
            const eId = typeof node.exits.east === 'object' ? node.exits.east.target : node.exits.east;
            if (eId && !coords[eId]) {
                coords[eId] = {x: curr.logicalX + 1, y: curr.logicalY};
                queue.push({key: eId, logicalX: curr.logicalX + 1, logicalY: curr.logicalY});
            }
            
            const wId = typeof node.exits.west === 'object' ? node.exits.west.target : node.exits.west;
            if (wId && !coords[wId]) {
                coords[wId] = {x: curr.logicalX - 1, y: curr.logicalY};
                queue.push({key: wId, logicalX: curr.logicalX - 1, logicalY: curr.logicalY});
            }
        }
    }

    ctx.strokeStyle = termGreen;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.4; 
    processed.forEach(key => {
        let node = apartmentMap[key];
        let p1 = coords[key];
        if(!node || !p1) return;
        const drawEdge = (targetData, colorOverride) => {
            const targetKey = typeof targetData === 'object' ? targetData.target : targetData;
            const isLocked = typeof targetData === 'object' && targetData.locked;
            let p2 = coords[targetKey];
            if(p2) {
                ctx.beginPath();
                ctx.moveTo(centerX + p1.x * spacing, centerY + p1.y * spacing);
                ctx.lineTo(centerX + p2.x * spacing, centerY + p2.y * spacing);
                ctx.strokeStyle = isLocked ? '#ff0000' : termGreen; // Draw red line if locked
                ctx.stroke();
            }
        };
        if(node.exits) {
            if(node.exits.north) drawEdge(node.exits.north);
            if(node.exits.south) drawEdge(node.exits.south);
            if(node.exits.east) drawEdge(node.exits.east);
            if(node.exits.west) drawEdge(node.exits.west);
        }
    });

    ctx.globalAlpha = 1.0;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 9px monospace";
    processed.forEach(key => {
        let node = apartmentMap[key];
        let p = coords[key];
        if(!node || !p) return;
        let x = centerX + p.x * spacing;
        let y = centerY + p.y * spacing;
        let isCurrent = (key === currentRoomKey);
        if (x < 0 || x > canvas.width || y < 0 || y > canvas.height) return;
        if (isCurrent) {
            ctx.shadowColor = termGreen;
            ctx.shadowBlur = 10;
            ctx.fillStyle = termGreen; 
        } else {
            ctx.shadowBlur = 0;
            ctx.fillStyle = termBg; 
        }
        ctx.strokeStyle = isCurrent ? '#000' : termGreen;
        ctx.fillRect(x - nodeSize/2, y - nodeSize/2, nodeSize, nodeSize);
        ctx.strokeRect(x - nodeSize/2, y - nodeSize/2, nodeSize, nodeSize);
        ctx.fillStyle = isCurrent ? '#000' : termAmber; 
        ctx.shadowBlur = 0;
        let shortName = (node.shortName || "???").substring(0, 4);
        ctx.fillText(shortName, x, y);
        if (!isCurrent) {
            let clickZone = document.createElement('div');
            clickZone.className = 'map-clickable-zone';
            clickZone.style.left = `${x - nodeSize/2}px`;
            clickZone.style.top = `${y - nodeSize/2}px`;
            clickZone.style.width = `${nodeSize}px`;
            clickZone.style.height = `${nodeSize}px`;
            clickZone.title = `Go to ${node.name}`;
            clickZone.onclick = () => {
                document.getElementById('cmd-input').value = `go to ${node.name}`;
                document.getElementById('cmd-input').dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter'}));
            };
            canvasContainer.appendChild(clickZone);
        }
    });
}

export function addLog(text, color = 'var(--term-green)') {
    const log = document.getElementById('log');
    const p = document.createElement('div');
    
    if (color === 'var(--term-green)') {
        if (text.startsWith('[TANDY]')) color = '#b084e8';
        else if (text.startsWith('[SYSTEM]')) color = '#f59e0b';
        else if (text.startsWith('[NARRATOR]')) color = '#888888';
    }

    p.style.color = color;
    p.className = 'mb-1';
    p.innerHTML = `> ${text}`;
    log.appendChild(p);
    document.getElementById('output').scrollTop = document.getElementById('output').scrollHeight;
}

export function updateStatusUI(posture, roomShort) {
    const posShort = posture === 'standing' ? 'STND' : (posture === 'sitting' ? 'SIT' : 'LAY');
    document.getElementById('player-status').innerText = `POS: ${posShort}`;
    document.getElementById('room-display').innerText = roomShort;
}

export function renderCharacterCard(charData, imgSrc) {
    const log = document.getElementById('log');
    const wrapper = document.createElement('div');
    const deceasedClass = charData.deceased ? 'deceased' : '';
    const statusLabel = charData.deceased ? '[DECEASED]' : (charData.deployed ? '[DEPLOYED]' : '[ACTV]');
    
    wrapper.innerHTML = `
        <div class="char-card ${deceasedClass}">
            <div class="char-card-header">
                <span class="char-card-title">${statusLabel} ${charData.name}</span>
                <span class="char-card-archetype">${charData.archetype}</span>
            </div>
            <div class="char-card-img-container">
                ${imgSrc ? `<img class="char-card-img" src="${imgSrc}" alt="${charData.name}">` : `<div style="padding: 20px; text-align:center; color:#555;">[IMAGE UNAVAILABLE]</div>`}
            </div>
            <div class="char-card-desc">
                ${charData.visual_prompt}
            </div>
            <div class="char-card-stats">
                <span>WIL: ${charData.stats.WILL || 20}</span>
                <span>CON: ${charData.stats.CONS || 20}</span>
                <span>PHY: ${charData.stats.PHYS || 20}</span>
            </div>
        </div>
    `;
    log.appendChild(wrapper);
    document.getElementById('output').scrollTop = document.getElementById('output').scrollHeight;
}

export function togglePinButton(isVisible, text = "PIN VIEW", state = "normal") {
    const pinBtn = document.getElementById('pin-view-btn');
    if (!pinBtn) return;
    if (isVisible) {
        pinBtn.classList.remove('hidden');
        pinBtn.innerText = text;
        if (state === "uploading") {
            pinBtn.disabled = true;
        } else if (state === "pinned") {
            pinBtn.classList.add('bg-green-600', 'border-green-400');
            pinBtn.disabled = false;
        } else {
            pinBtn.classList.remove('bg-green-600', 'border-green-400');
            pinBtn.disabled = false;
        }
    } else {
        pinBtn.classList.add('hidden');
        pinBtn.classList.remove('bg-green-600', 'border-green-400');
        pinBtn.disabled = false;
    }
}

export function materializeEffect() {
    document.body.classList.remove('void-mode');
    const flash = document.createElement('div');
    flash.className = 'materialize-flash';
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 1200);
}

export function flashInventory() {
    const inv = document.getElementById('inventory-container');
    if(inv) {
        inv.classList.remove('flash-inv');
        void inv.offsetWidth;
        inv.classList.add('flash-inv');
    }
}