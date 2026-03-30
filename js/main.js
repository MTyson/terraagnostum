import { signInAnonymously, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

// IMPORT DECOMPOSED DATA & SERVICES
import { triggerVisualUpdate } from './visualSystem.js';
import { handleWizardInput } from './wizardSystem.js';
import * as UI from './ui.js';
import { auth, isSyncEnabled } from './firebaseConfig.js';
import * as stateManager from './stateManager.js';
import * as syncEngine from './syncEngine.js';
import { handleCommand, executeMovement, shiftStratum } from './intentRouter.js';
import './forgeSystem.js';

// --- CONFIG & DB VERSION ---
let hasInitialized = false;

// Initial config fetch
import { fetchSystemConfig } from './apiService.js';
await fetchSystemConfig();

// Sync app version from dedicated version file
import { APP_VERSION } from './version.js';
const versionEl = document.querySelector('#utc-version-display a');
if (versionEl) {
    versionEl.textContent = `v${APP_VERSION}`;
}

// --- AUTHENTICATION & SYNC ---
if (isSyncEnabled) {
    onAuthStateChanged(auth, async (u) => {
        if (!u) {
            signInAnonymously(auth);
            return;
        }

        stateManager.setUser(u);
        const { localPlayer, user } = stateManager.getState();
        if (user && !hasInitialized) {
            hasInitialized = true;
            const userType = user.isAnonymous ? "GUEST" : "ARCHITECT";
            UI.addLog(`${userType} LINKED: ${user.uid.substring(0,8)}`, "var(--crayola-blue)");
            
            await syncEngine.bootSyncEngine();
            
            const updatedState = stateManager.getState();
            shiftStratum(updatedState.localPlayer.stratum);
            
            const activeMap = stateManager.getActiveMap();
            
            const currentRoom = activeMap[stateManager.getState().localPlayer.currentRoom];
            if (currentRoom) {
                const { strata } = stateManager.getState();
                const isAstral = updatedState.localPlayer.stratum === 'astral' || strata[updatedState.localPlayer.stratum.toLowerCase()]?.rules?.combat === 'Battle of Wills';
                UI.printRoomDescription(currentRoom, isAstral, activeMap, updatedState.activeAvatar);
            }
            
            if (!user.isAnonymous && localStorage.getItem('awaitingNewUserHint') === 'true') {
                localStorage.removeItem('awaitingNewUserHint');
                setTimeout(() => {
                    UI.addLog(`[TANDY]: Your signature is anchored. Good. Now, go investigate the resonator in the closet.`, "#b084e8");
                }, 1500);
            }
        }
        UI.initHUDWidgets();
    });
}

// Listen for auth gate events dispatched by gmEngine (which can't import wizardSystem directly)
window.addEventListener('trigger-login-wizard', () => {
    handleCommand('/login');
});


const becomeArchitectLink = document.getElementById('become-architect-link');
if (becomeArchitectLink) {
    becomeArchitectLink.addEventListener('click', (e) => {
        const { user, localPlayer } = stateManager.getState();
        if (localPlayer.isArchitect) return;

        if (!user || user.isAnonymous) {
            UI.addLog("[SYSTEM]: Identity verification required before acquiring an Architect license.", "var(--term-red)");
            handleCommand('/login'); 
        } else {
            handleCommand('become architect');
        }
    });
}

const pinBtnEl = document.getElementById('pin-view-btn');
if (pinBtnEl) {
    pinBtnEl.addEventListener('click', () => {
        const { localPlayer, user } = stateManager.getState();
        import('./visualSystem.js').then(({ togglePinView }) => {
            togglePinView(localPlayer, stateManager.getActiveMap(), user);
        });
    });
}

const newImageBtnEl = document.getElementById('new-image-btn');
if (newImageBtnEl) {
    newImageBtnEl.addEventListener('click', () => {
        const { localPlayer, user } = stateManager.getState();
        const icon = newImageBtnEl.querySelector('span');
        if (icon && icon.classList.contains('animate-spin')) return;
        
        if (icon) icon.classList.add('animate-spin');
        
        import('./visualSystem.js').then(({ triggerVisualUpdate }) => {
            triggerVisualUpdate(null, localPlayer, stateManager.getActiveMap(), user, true).finally(() => {
                if (icon) icon.classList.remove('animate-spin');
            });
        });
    });
}

// --- INPUT LISTENERS ---
const input = document.getElementById('cmd-input');

if (input) {
    input.addEventListener('keydown', async (e) => {
        const { wizardState, isProcessing, localPlayer, user, activeAvatar } = stateManager.getState();
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && input.value === '') {
            e.preventDefault();
            if (wizardState.active || isProcessing) return;
            let dir = '';
            if (e.key === 'ArrowUp') dir = 'north';
            if (e.key === 'ArrowDown') dir = 'south';
            if (e.key === 'ArrowLeft') dir = 'west';
            if (e.key === 'ArrowRight') dir = 'east';
            UI.addLog(dir, "#ffffff");
            executeMovement(dir);
            return;
        }

        if (e.key === 'Enter') {
            e.preventDefault();
            const val = input.value.trim();
            input.value = '';
            
            if (!val && !wizardState.active) return;
            if (isProcessing) return;
            if (val) {
                if (wizardState.active && (wizardState.type === 'login' || wizardState.type === 'register') && wizardState.step === 2) {
                    UI.addLog("********", "#ffffff");
                } else {
                    UI.addLog(val, "#ffffff");
                }
            }
            
            if (wizardState.active) { 
                const activeMap = stateManager.getActiveMap();
                const { localCharacters } = stateManager.getState();
                const { handleGMIntent } = await import('./gmEngine.js');
                await handleWizardInput(val, 
                    { activeMap, localPlayer, user, activeAvatar, isSyncEnabled: true },
                    { 
                        updateMapListener: () => syncEngine.updateGlobalMapListener(), 
                        shiftStratum,
                        savePlayerState: syncEngine.savePlayerState,
                        renderMapHUD: UI.renderMapHUD,
                        setActiveAvatar: stateManager.setActiveAvatar, 
                        addLocalCharacter: (c) => { stateManager.setLocalCharacters([...localCharacters, c]); },
                        handleGMIntent 
                    }
                );
                return; 
            }
            
            await handleCommand(val);
        }
    });
}

// STRATUM CLICK LISTENER
const statusDisplay = document.getElementById('combined-status-display');
if (statusDisplay) {
    statusDisplay.addEventListener('click', (e) => {
        e.stopPropagation();
        const { localPlayer } = stateManager.getState();
        const cmd = `tell me a bout strata ${localPlayer.stratum}`;
        UI.addLog(cmd, "#ffffff");
        handleCommand(cmd);
    });
}

// MAP MODAL LISTENERS
const mapCanvasContainer = document.getElementById('map-canvas-container');
if (mapCanvasContainer) {
    mapCanvasContainer.addEventListener('click', (e) => {
        UI.toggleMapModal();
    });
}

const closeMapModal = document.getElementById('close-map-modal');
if (closeMapModal) {
    closeMapModal.addEventListener('click', () => {
        UI.toggleMapModal();
    });
}

document.addEventListener('click', (e) => {
    const mModal = document.getElementById('map-modal');
    if (mModal && !mModal.classList.contains('hidden')) {
        const mapContainer = document.getElementById('map-canvas-container');
        if (!mModal.contains(e.target) && !mapContainer.contains(e.target)) {
            UI.toggleMapModal();
        }
    }
});

setInterval(() => { 
    const timeEl = document.getElementById('utc-time');
    if(timeEl) {
        const now = new Date();
        const utcStr = now.toISOString().split('T')[1].split('.')[0];
        timeEl.innerText = utcStr; 
    }
}, 1000);
