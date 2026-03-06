import { signInAnonymously, onAuthStateChanged, isSignInWithEmailLink, signInWithEmailLink, sendSignInLinkToEmail, signOut, EmailAuthProvider, linkWithCredential } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

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
let isProcessingAuthLink = false;

// --- AUTHENTICATION & SYNC ---
if (isSyncEnabled) {
    onAuthStateChanged(auth, async (u) => {
        // 1. HANDLE EMAIL LINK UPGRADES
        if (isSignInWithEmailLink(auth, window.location.href) && !isProcessingAuthLink) {
            isProcessingAuthLink = true;
            let email = window.localStorage.getItem('emailForSignIn');
            
            if (!email) {
                email = window.prompt('Please provide your email for confirmation');
            }
            
            if (email) {
                try {
                    if (u && u.isAnonymous) {
                        // UPGRADE THE ANONYMOUS ACCOUNT (Keeps characters)
                        const credential = EmailAuthProvider.credentialWithLink(email, window.location.href);
                        await linkWithCredential(u, credential);
                        console.log("[AUTH]: Anonymous account upgraded successfully.");
                    } else {
                        // NORMAL SIGN IN
                        await signInWithEmailLink(auth, email, window.location.href);
                        console.log("[AUTH]: Signed in via email link.");
                    }
                } catch (error) {
                    if (error.code === 'auth/credential-already-in-use') {
                        // Email already registered to another account. Fallback to normal sign-in.
                        await signInWithEmailLink(auth, email, window.location.href);
                    } else {
                        console.error("Auth Link Error:", error);
                    }
                } finally {
                    window.localStorage.removeItem('emailForSignIn');
                    window.history.replaceState(null, '', window.location.pathname);
                    isProcessingAuthLink = false;
                }
                // Return so the new auth state event handles the boot sequence
                return;
            } else {
                window.history.replaceState(null, '', window.location.pathname);
                isProcessingAuthLink = false;
            }
        }

        // 2. NORMAL AUTH INITIALIZATION
        if (!u) {
            if (!isSignInWithEmailLink(auth, window.location.href)) signInAnonymously(auth);
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
                UI.printRoomDescription(currentRoom, updatedState.localPlayer.stratum === 'astral', activeMap, updatedState.activeAvatar);
            }
            
            if (!user.isAnonymous && localStorage.getItem('awaitingNewUserHint') === 'true') {
                localStorage.removeItem('awaitingNewUserHint');
                setTimeout(() => {
                    UI.addLog(`[TANDY]: Your signature is anchored. Good. Now, go investigate the resonator in the closet.`, "#b084e8");
                }, 1500);
            }
        }
    });
}

// --- HUD LINK LISTENERS ---
const becomeArchitectLink = document.getElementById('become-architect-link');
if (becomeArchitectLink) {
    becomeArchitectLink.addEventListener('click', (e) => {
        const { user, localPlayer } = stateManager.getState();
        if (localPlayer.isArchitect) return;

        if (!user || user.isAnonymous) {
            UI.addLog("[SYSTEM]: Identity verification required before acquiring an Architect license.", "var(--term-red)");
            handleCommand('login'); 
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
            if (val) UI.addLog(val, "#ffffff");
            
            if (wizardState.active) { 
                const activeMap = stateManager.getActiveMap();
                const { localCharacters } = stateManager.getState();
                const { handleGMIntent } = await import('./gmEngine.js');
                await handleWizardInput(val, 
                    { activeMap, localPlayer, user, activeAvatar, isSyncEnabled: true, appId: 'ignored' },
                    { 
                        updateMapListener: () => syncEngine.updateAreaListener(stateManager.getState().localPlayer.currentArea), 
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

// STRATUM MODAL LISTENERS
const stratumDisplay = document.getElementById('stratum-display');
if (stratumDisplay) {
    stratumDisplay.addEventListener('click', (e) => {
        e.stopPropagation();
        const { localPlayer } = stateManager.getState();
        UI.toggleStratumModal(localPlayer.stratum);
    });
}

const closeStratumModal = document.getElementById('close-stratum-modal');
if (closeStratumModal) {
    closeStratumModal.addEventListener('click', () => {
        const modal = document.getElementById('stratum-modal');
        if (modal) modal.classList.add('hidden');
    });
}

document.addEventListener('click', (e) => {
    const modal = document.getElementById('stratum-modal');
    if (modal && !modal.classList.contains('hidden')) {
        if (!modal.contains(e.target) && e.target !== stratumDisplay) {
            modal.classList.add('hidden');
        }
    }
});

setInterval(() => { 
    const timeEl = document.getElementById('time-display');
    if(timeEl) timeEl.innerText = `T+${new Date().toLocaleTimeString([], {hour12:false})}`; 
}, 1000);
