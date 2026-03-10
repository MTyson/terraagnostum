import { db, storage, appId } from './firebaseConfig.js';
import { getStorage, ref, uploadString, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";
import { projectVisual } from './apiService.js';
import * as UI from './ui.js';
import * as stateManager from './stateManager.js';
import * as syncEngine from './syncEngine.js';

// MODULE VARS
window.DISABLE_ROOM_GENERATION = false; // DEFAULT TO ENABLED (Server-side environment still protects if desired)

let activeVisualTicket = 0;
let lastRenderedUrl = null;
let lastRenderedRoom = null;
let lastTriggeredUrl = null;
let lastStratum = null;
let currentBase64 = null;
let isManifesting = false;
let manifestingRoomId = null;
const sessionVisualCache = new Map();
const activeProjections = new Map();

// SUBSCRIBE TO IMAGE UPDATES
stateManager.subscribe((state) => {
    const { localPlayer, user } = state;
    const activeMap = stateManager.getActiveMap();
    const room = activeMap?.[localPlayer.currentRoom];
    const currentImageUrl = room?.storedImageUrl;

    // Detect changes in Room, Stratum, or the arrival of a background Image URL
    if (localPlayer.currentRoom !== lastRenderedRoom || 
        localPlayer.stratum !== lastStratum || 
        (currentImageUrl && currentImageUrl !== lastTriggeredUrl)) {
        
        lastTriggeredUrl = currentImageUrl;
        lastStratum = localPlayer.stratum;
        triggerVisualUpdate(null, localPlayer, activeMap, user);
    }
});

function renderToCanvas(imageUrl, roomId, myTicket) {
    const canvas = document.getElementById('visual-canvas');
    const loader = document.getElementById('visual-loading');
    if (!canvas || !loader || myTicket !== activeVisualTicket) return;

    const img = new Image();
    let cleanUrl = imageUrl.replace(/['"\s\n\r]+/g, '');
    if (!cleanUrl.startsWith('data:')) img.crossOrigin = "anonymous";
    
    img.onload = () => {
        if (myTicket !== activeVisualTicket) return;
        const ctx = canvas.getContext('2d');
        canvas.width = img.width; canvas.height = img.height;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        
        let domImg = document.getElementById('sovereign-dom-image');
        if (!domImg) {
            domImg = document.createElement('img');
            domImg.id = 'sovereign-dom-image';
            domImg.className = "absolute inset-0 w-full h-full object-cover z-10 pointer-events-none";
            canvas.parentElement.style.position = 'relative';
            canvas.parentElement.appendChild(domImg);
        }
        domImg.src = img.src; 
        loader.classList.add('hidden');
        lastRenderedUrl = cleanUrl;
        lastRenderedRoom = roomId;
    };
    img.src = cleanUrl; // NO CACHE BUSTER
}

export async function triggerVisualUpdate(overridePrompt, localPlayer, activeMap, user, forceRebuild = false) {
    const roomId = localPlayer.currentRoom;
    const room = activeMap?.[roomId];
    if (!room) return;
    const capturedArea = localPlayer.currentArea;
    let validStoredUrl = room.storedImageUrl;

    // --- 0. PRE-FLIGHT CACHE CHECK (SOVEREIGN) ---
    // If we have it in session memory, or it's already in the DB, show it immediately and BAIL.
    if (!overridePrompt && !forceRebuild) {
        // PRIORITY 1: Local JS Memory (0ms, no network)
        let localSessionUri = sessionVisualCache.get(roomId);
        if (localSessionUri) {
            renderToCanvas(localSessionUri, roomId, activeVisualTicket);
            return;
        }
        // PRIORITY 2: Firebase URL (Browser Disk Cache)
        if (validStoredUrl) {
            renderToCanvas(validStoredUrl, roomId, activeVisualTicket);
            
            // ASYNC BLOB UPGRADER: Silently fetch the image into local JS memory.
            // This guarantees that the NEXT time the player visits this room this session, 
            // it will hit PRIORITY 1 and load in 0ms with zero network requests!
            fetch(validStoredUrl)
                .then(res => res.blob())
                .then(blob => {
                    const objectUrl = URL.createObjectURL(blob);
                    sessionVisualCache.set(roomId, objectUrl);
                })
                .catch(e => console.warn("[SOVEREIGN]: Blob cache upgrade failed.", e));
                
            return;
        }
    }

    const myTicket = ++activeVisualTicket;

    // 1. REPETITION GUARD
    if (!overridePrompt && validStoredUrl && validStoredUrl === lastRenderedUrl && roomId === lastRenderedRoom && !forceRebuild) {
        return;
    }

    isManifesting = true;
    manifestingRoomId = roomId;

    try {
        // 2. REQUEST COLLAPSING (DEDUPLICATION)
        if (activeProjections.has(roomId) && !overridePrompt && !forceRebuild) {
            const result = await activeProjections.get(roomId);
            if (result && myTicket === activeVisualTicket) {
                renderToCanvas(sessionVisualCache.get(roomId) || result, roomId, myTicket);
            }
            return;
        }

        // 3. BLACKOUT (ONLY FOR NEW GENERATION)
        const loader = document.getElementById('visual-loading');
        if (loader) loader.classList.remove('hidden');

        if (window.DISABLE_ROOM_GENERATION) {
            UI.addLog("[SYSTEM]: Room image generation skipped (DEV MODE).", "var(--term-amber)");
            if (loader) loader.innerHTML = "DEV MODE: VISUALS OFFLINE";
            isManifesting = false;
            return;
        }

        // Start projection and track it
        const projectionPromise = projectVisual(overridePrompt || room.visualPrompt || room.description, localPlayer.stratum, UI.addLog);
        activeProjections.set(roomId, projectionPromise);

        const result = await projectionPromise;
        activeProjections.delete(roomId); // Clean up
        
        if (result === null) {
            if (loader) loader.innerHTML = "DEV MODE: VISUALS OFFLINE";
            return;
        }
        
        if (result) {
            const dataUri = result.startsWith('data:') ? result : `data:image/png;base64,${result}`;
            sessionVisualCache.set(roomId, dataUri); 
        } else {
            return; 
        }

        const shouldRender = (myTicket === activeVisualTicket);

        // --- BUDGET PROTECTION: Anonymous users always use storedImageUrl anchor if available ---
        if (!user || user.isAnonymous) {
            if (validStoredUrl) {
                if (shouldRender) {
                    renderToCanvas(validStoredUrl, roomId, myTicket);
                }
                return;
            }
        }

        if (overridePrompt || !user || user.isAnonymous) {
            if (shouldRender) {
                renderToCanvas(sessionVisualCache.get(roomId), roomId, myTicket);
            }
            return;
        }

        // 4. ASYNC UPLOAD (Background process)
        try {
            currentBase64 = result;
            
            // Flat Architecture Storage Paths using the captured area
            let storagePath = capturedArea.startsWith('apartment_') || capturedArea.startsWith('astral_')
                ? `artifacts/${appId}/users/${user.uid}/areas/${capturedArea}/rooms/${roomId}.png`
                : `artifacts/${appId}/public/data/areas/${capturedArea}/rooms/${roomId}.png`;
                
            const fileRef = ref(storage, storagePath);
            const format = result.startsWith('data:') ? 'data_url' : 'base64';
            
            // Set aggressive Cache-Control so the browser never pings Firebase for 304s
            const metadata = {
                contentType: 'image/png',
                cacheControl: 'public, max-age=31536000'
            };

            await uploadString(fileRef, result, format, metadata);
            const downloadURL = await getDownloadURL(fileRef);
            
            // Persist to sync engine
            await syncEngine.updateMapNode(roomId, { storedImageUrl: downloadURL }, capturedArea);
            stateManager.updateMapNode(roomId, { storedImageUrl: downloadURL });
            
            // CRITICAL FIX: DO NOT overwrite the sessionVisualCache with the downloadURL here.
            // Leave the raw dataUri in the session memory for instant 0ms loads!

            if (shouldRender) {
                renderToCanvas(sessionVisualCache.get(roomId) || downloadURL, roomId, myTicket);
            }
        } catch (e) { console.error(e); }
    } finally {
        if (myTicket === activeVisualTicket) {
            isManifesting = false;
            manifestingRoomId = null;
        }
        activeProjections.delete(roomId); // Secondary safety cleanup
    }
}

/**
 * Anchors the current visual projection to consensus reality (Public/Private).
 */
export async function togglePinView(localPlayer, activeMap, user) {
    if (!user || user.isAnonymous) { 
        UI.addLog("[SYSTEM]: Identity verification required for reality anchoring.", "var(--term-red)");
        return;
    }
    
    const roomId = localPlayer.currentRoom;
    const room = activeMap[roomId] || {};

    if (room.pinnedView) {
        UI.togglePinButton(true, "UNPINNING...", "uploading");
        try {
            await syncEngine.updateMapNode(roomId, { pinnedView: null });
            stateManager.updateMapNode(roomId, { pinnedView: null });
            UI.addLog(`[SYSTEM]: Consensus reality anchor lifted. Space is fluid again.`, "var(--term-amber)");
            triggerVisualUpdate(null, localPlayer, activeMap, user); 
        } catch (e) {
            console.error("Unpinning error:", e);
            UI.togglePinButton(true, "ERROR", "normal");
            UI.addLog(`[SYSTEM ERROR]: Failed to lift anchor.`, "var(--term-red)");
        }
    } else {
        if (!currentBase64) {
            UI.addLog("[SYSTEM]: No projection active to anchor.", "var(--term-amber)");
            return;
        }
        
        UI.togglePinButton(true, "UPLOADING...", "uploading");
        try {
            const dataUrl = currentBase64.startsWith('data:') ? currentBase64 : `data:image/png;base64,${currentBase64}`;
            const fileRef = ref(storage, `maps/${appId}/${roomId}_pinned_${Date.now()}.png`);
            await uploadString(fileRef, dataUrl, 'data_url');
            const downloadUrl = await getDownloadURL(fileRef);
            
            await syncEngine.updateMapNode(roomId, { pinnedView: downloadUrl });
            stateManager.updateMapNode(roomId, { pinnedView: downloadUrl });
            
            UI.togglePinButton(true, "PINNED!", "pinned");
            UI.addLog(`[SYSTEM]: Consensus reality locked. The visual projection of ${activeMap[roomId].name || 'this sector'} is now canonical.`, "var(--gm-purple)");
            setTimeout(() => { UI.togglePinButton(true, "UNPIN VIEW", "normal"); }, 2000);
        } catch (e) {
            console.error("Pinning error:", e);
            UI.togglePinButton(true, "ERROR", "normal");
            UI.addLog(`[SYSTEM ERROR]: Failed to anchor memory to the cloud.`, "var(--term-red)");
        }
    }
}
