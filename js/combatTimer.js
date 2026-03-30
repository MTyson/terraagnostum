// js/combatTimer.js
import * as stateManager from './stateManager.js';
import { handleGMIntent } from './gmEngine.js';
import * as UI from './ui.js';
import * as syncEngine from './syncEngine.js';
import { triggerVisualUpdate } from './visualSystem.js';

let timerInterval = null;
const TURN_DURATION = 45000; // 45 seconds

export function isRunning() {
    return timerInterval !== null;
}

/**
 * Starts the combat turn timer.
 */
export function start() {
    stop(); // Ensure no duplicate timers
    
    const startTime = Date.now();
    
    // Set the timeout BEFORE updating state to prevent synchronous listener infinite loops
    timerInterval = setTimeout(() => {
        handleTimeout();
    }, TURN_DURATION);

    // Update state to reflect timer start
    const currentState = stateManager.getState();
    stateManager.updatePlayer({ 
        combat: { 
            ...currentState.localPlayer.combat,
            timerStartedAt: startTime 
        } 
    });
    
    // Sync UI Animation
    UI.resetCombatTimerUI();
}

/**
 * Stops the combat turn timer.
 */
export function stop() {
    if (timerInterval) {
        clearTimeout(timerInterval);
        timerInterval = null;
    }
}

/**
 * Resets the combat turn timer for a new turn.
 */
export function reset() {
    stop();
    start();
}

/**
 * Handles the turn timeout event.
 */
async function handleTimeout() {
    UI.addLog("[SYSTEM]: TURN TIMEOUT. PROCEEDING WITH IDLE NARRATION...", "var(--term-amber)");
    
    const state = stateManager.getState();
    
    // Only proceed if still in combat
    if (!state.localPlayer.combat.active) return;

    // Trigger "Basic Logic" move via GM Engine
    const timeoutInstruction = "PLAYER IDLE TIMEOUT: The player did not act in time. Narrate a turn where they hesitate or are caught off guard, and the enemy takes an opportunistic action (Basic Logic). Clearly describe the outcome of this idle turn.";
    
    // Import real actions dynamically or reference exported versions to avoid direct circular dependency issues
    // For now, we'll build the actions object from available imports.
    // Note: processRoomEvents and shiftStratum are in intentRouter which creates a circle.
    // We can use dynamic import for intentRouter to break the circle.
    
    try {
        const intentRouter = await import('./intentRouter.js');
        
        const realActions = {
            shiftStratum: intentRouter.shiftStratum,
            savePlayerState: syncEngine.savePlayerState,
            updateMapListener: syncEngine.updateGlobalMapListener,
            triggerVisualUpdate: (prompt) => triggerVisualUpdate(prompt, stateManager.getState().localPlayer, stateManager.getActiveMap(), stateManager.getState().user),
            processRoomEvents: intentRouter.processRoomEvents,
            syncAvatarStats: (id, stats) => syncEngine.syncAvatarStats(id, stats)
        };

        await handleGMIntent(timeoutInstruction, state, realActions, false);
        
        // After AI narration, reset for the next turn if combat is still active
        const nextState = stateManager.getState();
        if (nextState.localPlayer.combat.active) {
            reset();
        }
    } catch (error) {
        console.error("Combat timer timeout handling failed:", error);
    }
}
