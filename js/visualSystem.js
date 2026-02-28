import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { ref, uploadString, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";
import { db, storage, appId } from './firebaseConfig.js';
import { projectVisual } from './apiService.js';
import * as UI from './ui.js';

let currentBase64 = null;

export async function triggerVisualUpdate(overridePrompt, localPlayer, apartmentMap, user) {
    const roomId = localPlayer.currentRoom;
    const room = apartmentMap[roomId] || {};
    
    currentBase64 = null;
    
    const pinnedUrl = (!overridePrompt && room.pinnedView) ? room.pinnedView : null;
    const basePrompt = overridePrompt || room.visualPrompt || room.visual_prompt || "A glitching void.";
    
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

// TEST git

export async function togglePinView(localPlayer, apartmentMap, user) {
    if (!user || user.isAnonymous) { 
        UI.addLog("[SYSTEM]: Identity verification required for reality anchoring.", "var(--term-red)");
        return;
    }
    
    const roomId = localPlayer.currentRoom;
    const room = apartmentMap[roomId] || {};

    if (room.pinnedView) {
        UI.togglePinButton(true, "UNPINNING...", "uploading");
        try {
            const mapRef = doc(db, 'artifacts', appId, 'public', 'data', 'maps', 'apartment_graph_live');
            await updateDoc(mapRef, { [`nodes.${roomId}.pinnedView`]: null });
            apartmentMap[roomId].pinnedView = null;
            
            UI.addLog(`[SYSTEM]: Consensus reality anchor lifted. Space is fluid again.`, "var(--term-amber)");
            triggerVisualUpdate(null, localPlayer, apartmentMap, user); 
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
            
            const mapRef = doc(db, 'artifacts', appId, 'public', 'data', 'maps', 'apartment_graph_live');
            await updateDoc(mapRef, { [`nodes.${roomId}.pinnedView`]: downloadUrl });
            apartmentMap[roomId].pinnedView = downloadUrl;
            
            UI.togglePinButton(true, "PINNED!", "pinned");
            UI.addLog(`[SYSTEM]: Consensus reality locked. The visual projection of ${apartmentMap[roomId].name || 'this sector'} is now canonical.`, "var(--gm-purple)");
            
            setTimeout(() => { UI.togglePinButton(true, "UNPIN VIEW", "normal"); }, 2000);
        } catch (e) {
            console.error("Pinning error:", e);
            UI.togglePinButton(true, "ERROR", "normal");
            UI.addLog(`[SYSTEM ERROR]: Failed to anchor memory to the cloud.`, "var(--term-red)");
        }
    }
}