// js/terminalSystem.js
// BBS Terminal Engine — drives the #bbs-overlay fullscreen interface.
import * as stateManager from './stateManager.js';

// ─── Internal state ────────────────────────────────────────────────────────────
let terminalState = {
    mode: 'MAIN_MENU', // MAIN_MENU | LOGS | DIAGNOSTICS | HACKING
    traceLevel: 0,
    focusedIndex: 0,
    menuItems: [],
    activeItemEls: []
};

// Keep a stable reference so we can remove the listener on exit
function onBBSKeydown(e) {
    if (e.key === 'Escape') {
        fireExit();
        return;
    }
    if (e.key === 'Enter') {
        const val = e.target.value.trim();
        e.target.value = '';
        if (val) handleTerminalInput(val);
    }
}

/** Attach input listener and auto-focus the BBS input field. */
function initBBSInput() {
    const input = el('bbs-input');
    if (!input) return;
    input.value = '';
    // Remove any previous listener before adding a fresh one
    input.removeEventListener('keydown', onBBSKeydown);
    input.addEventListener('keydown', onBBSKeydown);
    // Small delay so the focus lands after the boot animation
    setTimeout(() => input.focus(), 100);
}

// ─── DOM helpers ───────────────────────────────────────────────────────────────
function el(id) { return document.getElementById(id); }

/**
 * Write a line to the BBS output log (NOT the game's #log).
 * @param {string} text
 * @param {'green'|'amber'|'red'|'purple'|'dim'} [tint]
 */
function bbsWrite(text, tint = 'green') {
    const log = el('bbs-log');
    if (!log) return;

    const line = document.createElement('div');
    line.className = `bbs-line${tint !== 'green' ? ' bbs-' + tint : ''}`;
    line.innerHTML = text.replace(/\n/g, '<br>');
    log.appendChild(line);

    // Scroll to bottom
    const output = el('bbs-output');
    if (output) {
        requestAnimationFrame(() => {
            output.scrollTo({ top: output.scrollHeight, behavior: 'smooth' });
        });
    }
}

/** Clear the BBS output log. */
function bbsClear() {
    const log = el('bbs-log');
    if (log) log.innerHTML = '';
}

/**
 * Render an interactive BBS menu into #bbs-menu-area.
 * Each item: { key, label, tag?, danger?, locked?, action }
 */
function renderBBSMenu(items) {
    const area = el('bbs-menu-area');
    if (!area) return;

    area.innerHTML = '';
    terminalState.menuItems = items;
    terminalState.activeItemEls = [];

    items.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = 'bbs-item';
        row.setAttribute('tabindex', item.locked ? '-1' : '0');
        row.setAttribute('role', 'button');
        row.setAttribute('aria-label', `${item.label}. Press Enter or tap to select.`);

        if (item.danger)  row.classList.add('bbs-item-danger');
        if (item.locked)  row.classList.add('bbs-item-locked');

        row.innerHTML = `
            <span class="bbs-item-key">[${item.key}]</span>
            <span class="bbs-item-label">${item.label}</span>
            ${item.tag ? `<span class="bbs-item-tag">${item.tag}</span>` : ''}
        `;

        if (!item.locked) {
            // Mouse click
            row.addEventListener('click', () => fireSelection(item));

            // Touch — use .bbs-item-active class for tap highlight (avoid :hover issues on mobile)
            row.addEventListener('touchstart', () => {
                row.classList.add('bbs-item-active');
            }, { passive: true });
            row.addEventListener('touchend', () => {
                setTimeout(() => row.classList.remove('bbs-item-active'), 200);
                fireSelection(item);
            }, { passive: true });
            row.addEventListener('touchcancel', () => {
                row.classList.remove('bbs-item-active');
            }, { passive: true });

            // Keyboard
            row.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    fireSelection(item);
                }
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    moveFocus(1);
                }
                if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    moveFocus(-1);
                }
                if (e.key === 'Escape') {
                    fireExit();
                }
            });
        }

        area.appendChild(row);
        terminalState.activeItemEls.push(row);
    });
}

/** Move keyboard focus up/down within the menu. */
function moveFocus(delta) {
    const els = terminalState.activeItemEls.filter(e => !e.classList.contains('bbs-item-locked'));
    if (!els.length) return;

    const current = document.activeElement;
    const currentIdx = els.indexOf(current);
    let nextIdx = (currentIdx + delta + els.length) % els.length;
    els[nextIdx].focus();
}

/** Execute a menu item's action after echoing the selection. */
function fireSelection(item) {
    bbsWrite(`&gt; ${item.key}`, 'amber');
    setTimeout(() => item.action(), 80);
}

/** Update the trace level display in the BBS header. */
function updateTraceHUD() {
    const traceEl = el('bbs-trace-level');
    if (!traceEl) return;
    const t = terminalState.traceLevel;
    traceEl.textContent = String(t).padStart(3, '0') + '%';
    traceEl.className = t >= 70 ? 'bbs-trace-crit' : t >= 35 ? 'bbs-trace-warn' : 'bbs-trace-ok';
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Called by intentRouter when the player uses a console.
 * Shows the BBS overlay and runs the boot sequence.
 */
export function startTerminal() {
    stateManager.setTerminal(true);
    terminalState.mode = 'MAIN_MENU';
    terminalState.traceLevel = 0;

    bbsClear();
    updateTraceHUD();

    // Update node ID from player context
    const { localPlayer } = stateManager.getState();
    const nodeEl = el('bbs-node-id');
    if (nodeEl) nodeEl.textContent = `TECHNATE NODE 0x${localPlayer.currentRoom.slice(-4).toUpperCase().padStart(4, '0')}`;

    // Attach and focus the BBS input
    initBBSInput();

    // Boot sequence — type out messages with delays
    const bootLines = [
        { text: '// INITIALIZING SECURE HANDSHAKE...', tint: 'dim', delay: 0 },
        { text: '// AUTHENTICATING RESONANT SIGNATURE...', tint: 'dim', delay: 350 },
        { text: 'ACCESS GRANTED.', tint: 'green', delay: 700 },
        { text: '', tint: 'green', delay: 900 },
        { text: 'TANDY: Be quick. Every second jacked in increases trace exposure.', tint: 'purple', delay: 950 },
        { text: '', tint: 'green', delay: 1200 },
    ];

    bootLines.forEach(({ text, tint, delay }) => {
        setTimeout(() => bbsWrite(text, tint), delay);
    });

    setTimeout(() => showMainMenu(), 1400);
}

/**
 * Handle raw text input forwarded from intentRouter while terminal is active.
 * Supports numeric shortcut keys even without clicking a menu item.
 * @returns {boolean} true — consume the input always when terminal is active.
 */
export function handleTerminalInput(val) {
    const input = val.trim().toLowerCase();

    // Exit shortcuts
    if (input === 'exit' || input === 'jack out' || input === 'disconnect') {
        fireExit();
        return true;
    }

    // Match input to a menu item's key
    const match = terminalState.menuItems.find(m => m.key.toLowerCase() === input);
    if (match && !match.locked) {
        bbsWrite(`&gt; ${match.key}`, 'amber');
        setTimeout(() => match.action(), 80);
    } else {
        bbsWrite(`[ERROR]: Unknown selection "${val}". Use the menu or type the option number.`, 'red');
    }

    return true;
}

// ─── Screens ──────────────────────────────────────────────────────────────────

function showMainMenu() {
    terminalState.mode = 'MAIN_MENU';

    bbsWrite('─────────────────────────────────────────', 'dim');
    bbsWrite('  ■ TECHNATE LOCAL NODE — v4.F.2A', 'amber');
    bbsWrite('─────────────────────────────────────────', 'dim');

    const { localPlayer } = stateManager.getState();
    const hasImplant = (localPlayer.inventory || []).some(i =>
        i.name.toLowerCase().includes('hacking implant')
    );

    renderBBSMenu([
        {
            key: '1',
            label: 'Read Local Archive Logs',
            action: showLogs
        },
        {
            key: '2',
            label: 'System Diagnostics',
            action: showDiagnostics
        },
        {
            key: '3',
            label: 'Siphon Credits',
            tag: hasImplant ? '[IMPLANT OK]' : '[NEEDS IMPLANT]',
            locked: !hasImplant,
            action: attemptHacking
        },
        {
            key: '4',
            label: 'Security Override: [FRONT_DOOR]',
            action: attemptDoorOverride
        },
        {
            key: '5',
            label: 'The Ziggurat',
            tag: '[MINIGAME]',
            action: startZiggurat
        },
        {
            key: '6',
            label: 'Sever Connection',
            danger: true,
            action: fireExit
        },
    ]);

    // Auto-focus first item (desktop UX)
    requestAnimationFrame(() => {
        const first = el('bbs-menu-area')?.querySelector('.bbs-item:not(.bbs-item-locked)');
        if (first) first.focus();
    });
}

function returnToMenu() {
    renderBBSMenu([
        {
            key: 'ENTER',
            label: 'Back to Main Menu',
            action: () => {
                bbsClear();
                showMainMenu();
            }
        }
    ]);
    requestAnimationFrame(() => {
        el('bbs-menu-area')?.querySelector('.bbs-item')?.focus();
    });
}

function showLogs() {
    terminalState.mode = 'LOGS';
    bbsClear();
    bbsWrite('─────────────────────────────────────────', 'dim');
    bbsWrite('  ■ LOCAL ARCHIVE LOGS', 'amber');
    bbsWrite('─────────────────────────────────────────', 'dim');
    bbsWrite('LOG_01: Sector purge scheduled for cycle 8.4.');
    bbsWrite('LOG_02: FAEN interference detected in Schrödinger\'s Closet.');
    bbsWrite('LOG_03: [ENCRYPTED] \'The Shadow Avatar is the anchor.\'', 'amber');
    bbsWrite('─────────────────────────────────────────', 'dim');
    returnToMenu();
}

function showDiagnostics() {
    terminalState.mode = 'DIAGNOSTICS';
    bbsClear();
    const { localPlayer } = stateManager.getState();

    bbsWrite('─────────────────────────────────────────', 'dim');
    bbsWrite('  ■ SYSTEM DIAGNOSTICS', 'amber');
    bbsWrite('─────────────────────────────────────────', 'dim');
    bbsWrite(`Vessel Signature  : ${localPlayer.activeAvatarId || 'UNKNOWN'}`);
    bbsWrite(`Trace Level       : ${terminalState.traceLevel}%`, terminalState.traceLevel > 50 ? 'red' : 'green');
    bbsWrite(`AWR Status        : ${localPlayer.stats.AWR.total} [P:${localPlayer.stats.AWR.Perception} / I:${localPlayer.stats.AWR.Insight}]`);
    bbsWrite(`PHYS Status       : ${localPlayer.stats.PHYS.total} [STR:${localPlayer.stats.PHYS.Strength} / AGI:${localPlayer.stats.PHYS.Agility}]`);
    bbsWrite(`Current Sector    : ${localPlayer.currentRoom}`);
    bbsWrite(`Stratum Anchor    : ${localPlayer.stratum.toUpperCase()}`);
    bbsWrite('─────────────────────────────────────────', 'dim');
    returnToMenu();
}

function attemptHacking() {
    terminalState.mode = 'HACKING';
    bbsClear();
    const { localPlayer } = stateManager.getState();

    bbsWrite('─────────────────────────────────────────', 'dim');
    bbsWrite('  ■ CREDIT SIPHON PROTOCOL', 'amber');
    bbsWrite('─────────────────────────────────────────', 'dim');
    bbsWrite('[SYSTEM]: Initiating unauthorized credit transfer...');

    const hasImplant = (localPlayer.inventory || []).some(i =>
        i.name.toLowerCase().includes('hacking implant')
    );
    if (!hasImplant) {
        bbsWrite('[ACCESS DENIED]: Hacking Implant not detected in slot 0.', 'red');
        setTimeout(returnToMenu, 1200);
        return;
    }

    const insight = localPlayer.stats.AWR.Insight;
    const roll = Math.floor(Math.random() * 20) + 1;
    const success = (roll + insight) >= 15;

    bbsWrite(`[ANALYSIS]: Insight: ${insight}  Roll: ${roll}  Target: ≥15`, 'dim');

    setTimeout(() => {
        if (success) {
            const credits = Math.floor(Math.random() * 100) + 50;
            terminalState.traceLevel = Math.min(100, terminalState.traceLevel + 15);
            bbsWrite(`[SUCCESS]: ${credits} Credits extrapolated from data-stream.`);
            bbsWrite(`[WARNING]: Trace level increased to ${terminalState.traceLevel}%.`, 'amber');
            
            const currentCredits = stateManager.getState().localPlayer.credits || 0;
            stateManager.updatePlayer({ credits: currentCredits + credits });
        } else {
            terminalState.traceLevel = Math.min(100, terminalState.traceLevel + 30);
            bbsWrite('[FAILURE]: Counter-measures triggered! Trace spiked.', 'red');
            bbsWrite(`[WARNING]: Trace level now at ${terminalState.traceLevel}%.`, 'red');
        }
        updateTraceHUD();
        setTimeout(returnToMenu, 1500);
    }, 900);
}

function attemptDoorOverride() {
    bbsClear();
    bbsWrite('─────────────────────────────────────────', 'dim');
    bbsWrite('  ■ SECURITY OVERRIDE: [FRONT_DOOR]', 'amber');
    bbsWrite('─────────────────────────────────────────', 'dim');
    bbsWrite('[SYSTEM]: Targeting sector-level door lock...');
    setTimeout(() => {
        bbsWrite('[ERROR]: Local node lacks authority for sector-level overrides.', 'red');
        bbsWrite('TANDY: The Resonant Key from the Shadow Avatar would unlock this remotely.', 'purple');
        setTimeout(returnToMenu, 2000);
    }, 700);
}

// ─── The Ziggurat Minigame ───────────────────────────────────────────────────

let zigguratState = {
    floor: 0,
    resonance: 3,
    chance: 70
};

function startZiggurat() {
    terminalState.mode = 'ZIGGURAT';
    zigguratState = { floor: 0, resonance: 3, chance: 70 };
    bbsClear();
    bbsWrite('─────────────────────────────────────────', 'dim');
    bbsWrite('  ▲ THE ZIGGURAT ▲', 'purple');
    bbsWrite('─────────────────────────────────────────', 'dim');
    bbsWrite('A flickering pyramid of light towers before you.', 'dim');
    bbsWrite('Its apex is lost in neon clouds.');
    bbsWrite('');
    updateZiggurat();
}

function updateZiggurat() {
    bbsWrite(`CURRENT FLOOR : ${zigguratState.floor}`, 'amber');
    bbsWrite(`RESONANCE     : ${zigguratState.resonance}`, 'blue');
    bbsWrite(`STABILITY     : ${zigguratState.chance}%`, 'green');
    bbsWrite('');

    renderBBSMenu([
        {
            key: 'A',
            label: 'ASCEND',
            action: zigguratAscend
        },
        {
            key: 'R',
            label: 'RITUAL',
            tag: zigguratState.resonance > 0 ? `(-1 RESONANCE)` : '[EMPTY]',
            locked: zigguratState.resonance <= 0,
            action: zigguratRitual
        },
        {
            key: 'W',
            label: 'WITHDRAW',
            action: zigguratWithdraw
        }
    ]);
}

function zigguratAscend() {
    const roll = Math.floor(Math.random() * 100);
    if (roll < zigguratState.chance) {
        zigguratState.floor++;
        // Climbing gets harder
        zigguratState.chance = Math.max(10, zigguratState.chance - 5);
        bbsWrite('SUCCESS. You climb higher into the static.', 'green');
        updateZiggurat();
    } else {
        bbsWrite('COLLAPSE! Reality rejects your presence.', 'red');
        bbsWrite(`You fell from floor ${zigguratState.floor}.`, 'dim');
        setTimeout(returnToMenu, 2000);
    }
}

function zigguratRitual() {
    if (zigguratState.resonance > 0) {
        zigguratState.resonance--;
        zigguratState.chance = Math.min(95, zigguratState.chance + 15);
        bbsWrite('You burn a fragment of memory to stabilize the climb.', 'purple');
        updateZiggurat();
    }
}

function zigguratWithdraw() {
    bbsWrite('You step back from the Ziggurat.', 'amber');
    bbsWrite(`Final Floor: ${zigguratState.floor}`, 'green');
    if (zigguratState.floor > 0) {
        const reward = zigguratState.floor * 10;
        bbsWrite(`A faint echo of ${reward} credits manifests...`, 'dim');

        const currentCredits = stateManager.getState().localPlayer.credits || 0;
        stateManager.updatePlayer({ credits: currentCredits + reward });
    }
    setTimeout(returnToMenu, 2000);
}

function fireExit() {
    // Clean up input listener
    const input = el('bbs-input');
    if (input) input.removeEventListener('keydown', onBBSKeydown);

    stateManager.setTerminal(false);
    // Overlay hidden by ui.js state subscriber

    // Return focus to the main game input
    setTimeout(() => el('cmd-input')?.focus(), 50);
}
