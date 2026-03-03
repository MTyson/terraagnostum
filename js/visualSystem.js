import { db, storage, appId } from './firebaseConfig.js';
import { ref, uploadString, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";
import { projectVisual } from './apiService.js';
import * as UI from './ui.js';
import * as stateManager from './stateManager.js';
import * as syncEngine from './syncEngine.js';

let currentBase64 = null;
let lastRoomId = null;
let lastStratum = null;

// Subscribe to state changes for visual updates
stateManager.subscribe((state) => {
    const { localPlayer, user } = state;
    const activeMap = stateManager.getActiveMap();
    
    // Only trigger if room or stratum changed
    if (localPlayer.currentRoom !== lastRoomId || localPlayer.stratum !== lastStratum) {
        lastRoomId = localPlayer.currentRoom;
        lastStratum = localPlayer.stratum;
        triggerVisualUpdate(null, localPlayer, activeMap, user);
    }
});

export async function triggerVisualUpdate(overridePrompt, localPlayer, activeMap, user) {
    const roomId = localPlayer.currentRoom;
    const room = activeMap[roomId];
    
    if (!room) {
        console.warn(`Visual Update: Room ${roomId} not found in map reference. Skipping projection.`);
        return;
    }
    
    currentBase64 = null;
    
    const pinnedUrl = (!overridePrompt && room.pinnedView) ? room.pinnedView : null;
    let basePrompt = overridePrompt || room.visualPrompt || room.visual_prompt || "A glitching void.";
    
    // Enrich prompt with NPCs if no override and not pinned
    if (!overridePrompt && !pinnedUrl && room.npcs && room.npcs.length > 0) {
        const npcDesc = room.npcs.map(n => n.name).join(', ');
        basePrompt += ` Also present in the scene: ${npcDesc}.`;
    }
    
    if (user && !user.isAnonymous) {
        if (pinnedUrl) {
            UI.togglePinButton(true, "UNPIN VIEW", "normal");
        } else {
            UI.togglePinButton(true, "GENERATING...", "uploading");
        }
    } else {
        UI.togglePinButton(false);
    }
    
    currentBase64 = await projectVisual(basePrompt, localPlayer.stratum, UI.addLog, pinnedUrl);
    
    if (user && !user.isAnonymous) {
        if (pinnedUrl) {
            UI.togglePinButton(true, "UNPIN VIEW", "normal");
        } else if (currentBase64) {
            UI.togglePinButton(true, "PIN VIEW", "normal");
        } else {
            UI.togglePinButton(false);
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
            stateManager.updateMapNode(roomId.startsWith('astral_') ? 'astral' : 'apartment', roomId, { pinnedView: null });
            
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
            stateManager.updateMapNode(roomId.startsWith('astral_') ? 'astral' : 'apartment', roomId, { pinnedView: downloadUrl });
            
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
