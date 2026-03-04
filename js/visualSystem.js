import { db, storage, appId } from './firebaseConfig.js';
import { getStorage, ref, uploadString, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";
import { projectVisual } from './apiService.js';
import * as UI from './ui.js';
import * as stateManager from './stateManager.js';
import * as syncEngine from './syncEngine.js';
import { isArchiveRoom } from './mapData.js';

// --- MODULE-LEVEL AUTHORITY ---
let activeVisualTicket = 0;
let lastRenderedUrl = null;
let lastRenderedRoom = null;
let currentBase64 = null;
let lastRoomId = null;
let lastStratum = null;
let isManifesting = false;
let manifestingRoomId = null;

/**
 * SOVEREIGN RENDER: Final authority for drawing pixels to the canvas.
 */
function renderToCanvas(imageUrl, roomId, myTicket) {
    const canvas = document.getElementById('visual-canvas');
    const loader = document.getElementById('visual-loading');
    if (!canvas || !loader) return;

    // 1. STALE TICKET GUARD
    if (myTicket !== activeVisualTicket) {
        console.warn(`[SOVEREIGN]: Ticket #${myTicket} aborted; stale request.`);
        return;
    }

    const ctx = canvas.getContext('2d');
    const img = new Image();
    
    // 2. CORS AUTHORITY: Only request CORS for external URLs, NEVER for local Data URIs!
    if (!imageUrl.startsWith('data:')) {
        img.crossOrigin = "anonymous";
    }
    
    img.onload = () => {
        // 3. FINAL ONLOAD AUTHORITY CHECK
        if (myTicket !== activeVisualTicket) {
            console.warn(`[SOVEREIGN]: Ticket #${myTicket} aborted during load; stale request.`);
            return;
        }

        // 4. DIMENSION SYNC
        if (canvas.width !== img.width || canvas.height !== img.height) {
            canvas.width = img.width;
            canvas.height = img.height;
        }
        
        // 5. ABSOLUTE CLEAR & DRAW
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        
        loader.classList.add('hidden');
        
        // 6. RECORD MANIFESTATION
        lastRenderedUrl = imageUrl;
        lastRenderedRoom = roomId;
        console.log(`[SOVEREIGN]: Ticket #${myTicket} manifestation complete.`);
    };
    
    img.onerror = (err) => {
        if (myTicket !== activeVisualTicket) return;
        console.error(`[SOVEREIGN]: Ticket #${myTicket} manifestation failed: ${imageUrl}`, err);
        loader.classList.add('hidden');
    };

    // 7. CACHE BUSTER (Applied only at the point of browser request)
    let finalUrl = imageUrl;
    if (!imageUrl.startsWith('data:')) {
        const cacheBuster = imageUrl.includes('?') ? `&cb=${Date.now()}` : `?cb=${Date.now()}`;
        finalUrl += cacheBuster;
    }
    img.src = finalUrl;
}

// Subscribe to state changes for visual updates
stateManager.subscribe((state) => {
    const { localPlayer, user } = state;
    const activeMap = stateManager.getActiveMap();
    
    // Trigger if room or stratum changed
    if (localPlayer.currentRoom !== lastRoomId || localPlayer.stratum !== lastStratum) {
        lastRoomId = localPlayer.currentRoom;
        lastStratum = localPlayer.stratum;
        triggerVisualUpdate(null, localPlayer, activeMap, user);
    }
});

/**
 * SOVEREIGN UPDATE: Orchestrates the visual reality of a sector.
 */
export async function triggerVisualUpdate(overridePrompt, localPlayer, activeMap, user, forceRebuild = false) {
    const roomId = localPlayer.currentRoom;
    const room = activeMap?.[roomId];

    // 1. THE REPETITION GUARD (SILENCE THE OBSERVER)
    // Bail immediately if we are already showing this stable state
    if (room && !overridePrompt && room.storedImageUrl && 
        room.storedImageUrl === lastRenderedUrl && 
        roomId === lastRenderedRoom && 
        !forceRebuild) {
        return;
    }

    // Secondary Lock: Prevent redundant AI calls if we are already manifesting this room
    if (isManifesting && !forceRebuild && roomId === manifestingRoomId) {
        return;
    }

    // 2. TICKET-BASED AUTHORITY: Capture the heartbeat
    const myTicket = ++activeVisualTicket;
    console.log(`[SOVEREIGN]: Ticket #${myTicket} issued for ${roomId}`);
    
    isManifesting = true;
    manifestingRoomId = roomId;

    try {
        // 3. IMMEDIATE BLACKOUT: Movement clears the buffer
        const canvas = document.getElementById('visual-canvas');
        const loader = document.getElementById('visual-loading');
        if (canvas && loader) {
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = "#000";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            loader.innerHTML = `WEAVING REALITY<span class="loading-dots"></span>`;
            loader.classList.remove('hidden');
        }

        // 4. STALE CHECK
        if (myTicket !== activeVisualTicket) return;
        
        // Guard against empty map or missing room data
        if (!activeMap || !activeMap[roomId]) {
            isManifesting = false;
            return;
        }

        // 5. CACHE-FIRST RENDERING (Pinned or previously stored stable URL)
        if (!overridePrompt && room.storedImageUrl && !forceRebuild) {
            renderToCanvas(room.storedImageUrl, roomId, myTicket);
            return;
        }

        // ARCHITECTURAL AUTHORITY CHECK
        if (room.storedImageUrl && forceRebuild && !localPlayer.isArchitect) {
            if (myTicket === activeVisualTicket) {
                UI.addLog("[SYSTEM]: Authority verification failed. Only Architects can overwrite consensus reality.", "var(--term-red)");
                renderToCanvas(room.storedImageUrl, roomId, myTicket);
            }
            return;
        }

        // 6. AI GENERATION (BASE64)
        currentBase64 = null;
        const pinnedUrl = (!overridePrompt && room.pinnedView) ? room.pinnedView : null;
        let basePrompt = overridePrompt || room.visualPrompt || room.visual_prompt || "A glitching void.";
        
        // Enrich prompt with NPCs
        if (!overridePrompt && !pinnedUrl && room.npcs && room.npcs.length > 0) {
            const npcDesc = room.npcs.map(n => n.name).join(', ');
            basePrompt += ` Also present: ${npcDesc}.`;
        }
        
        if (myTicket === activeVisualTicket && user && !user.isAnonymous) {
            UI.togglePinButton(true, pinnedUrl ? "UNPIN VIEW" : "GENERATING...", pinnedUrl ? "normal" : "uploading");
        }
        
        const result = await projectVisual(basePrompt, localPlayer.stratum, UI.addLog, pinnedUrl);
        
        // STALE CHECK after async API call
        if (myTicket !== activeVisualTicket) return;

        // Route A: API returned a normal URL (e.g., pinned view)
        if (result && (result.startsWith('http') || result.startsWith('/'))) {
            renderToCanvas(result, roomId, myTicket);
            return;
        }

        // Route B: API returned raw base64 data
        if (result) {
            currentBase64 = result;
            
            // CRITICAL FIX: The API returns raw base64 (iVBORw0K...). 
            // We MUST wrap it in a Data URI so the browser knows it's an image, not a URL.
            const dataUri = result.startsWith('data:') ? result : `data:image/png;base64,${result}`;

            // PREVIEW PATH (Logged out or Override)
            if (overridePrompt || !user || user.isAnonymous) {
                if (!overridePrompt) {
                    // Save the base64 string to local state for the session
                    const mapType = roomId.startsWith('astral_') ? 'astral' : (isArchiveRoom(roomId) ? 'apartment' : 'mundane');
                    stateManager.updateMapNode(mapType, roomId, { storedImageUrl: dataUri });
                }
                renderToCanvas(dataUri, roomId, myTicket);
                return;
            }

            // SOVEREIGN PATH: Upload to storage first
            try {
                let storagePath = isArchiveRoom(roomId) || roomId.startsWith('astral_') 
                    ? `artifacts/${appId}/users/${user.uid}/rooms/${roomId}.png`
                    : `artifacts/${appId}/public/data/rooms/${roomId}.png`;

                const fileRef = ref(storage, storagePath);
                
                if (myTicket !== activeVisualTicket) return;
                
                // Fix Firebase format crash
                const format = currentBase64.startsWith('data:') ? 'data_url' : 'base64';
                await uploadString(fileRef, currentBase64, format);
                
                if (myTicket !== activeVisualTicket) return;
                const downloadURL = await getDownloadURL(fileRef);
                
                if (myTicket !== activeVisualTicket) return;
                await syncEngine.updateMapNode(roomId, { storedImageUrl: downloadURL });
                const mapType = roomId.startsWith('astral_') ? 'astral' : (isArchiveRoom(roomId) ? 'apartment' : 'mundane');
                stateManager.updateMapNode(mapType, roomId, { storedImageUrl: downloadURL });
                
                renderToCanvas(downloadURL, roomId, myTicket);
            } catch (e) {
                console.error("[SOVEREIGN]: Ticket manifestation failure during upload.", e);
                // Fallback: If upload fails, cache locally so we don't spam the AI API
                const mapType = roomId.startsWith('astral_') ? 'astral' : (isArchiveRoom(roomId) ? 'apartment' : 'mundane');
                stateManager.updateMapNode(mapType, roomId, { storedImageUrl: dataUri });
            }
        }

        // Update Pin Button UI
        if (myTicket === activeVisualTicket && user && !user.isAnonymous) {
            if (pinnedUrl) {
                UI.togglePinButton(true, "UNPIN VIEW", "normal");
            } else if (currentBase64) {
                UI.togglePinButton(true, "PIN VIEW", "normal");
            } else {
                UI.togglePinButton(false);
            }
        }
    } finally {
        // Reset isManifesting only if this ticket is still the sovereign authority
        if (myTicket === activeVisualTicket) {
            isManifesting = false;
            manifestingRoomId = null;
        }
    }
}

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
            const mapType = roomId.startsWith('astral_') ? 'astral' : 'apartment';
            stateManager.updateMapNode(mapType, roomId, { pinnedView: null });
            
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
            const dataUrl = `data:image/png;base64,${currentBase64}`;
            const fileRef = ref(storage, `maps/${appId}/${roomId}_pinned_${Date.now()}.png`);
            await uploadString(fileRef, dataUrl, 'data_url');
            const downloadUrl = await getDownloadURL(fileRef);
            
            await syncEngine.updateMapNode(roomId, { pinnedView: downloadUrl });
            const mapType = roomId.startsWith('astral_') ? 'astral' : 'apartment';
            stateManager.updateMapNode(mapType, roomId, { pinnedView: downloadUrl });
            
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
