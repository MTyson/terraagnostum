// js/forgeSystem.js
import { appId } from './firebaseConfig.js';
import { callGemini, generatePortrait } from './apiService.js';
import { createCharacter } from './syncEngine.js';
import * as stateManager from './stateManager.js';
import * as UI from './ui.js';

let currentDraftStats = null;

export function openForgeModal() {
    const modal = document.getElementById('forge-modal');
    if (modal) {
        modal.classList.remove('hidden');
        resetForge();
    }
}

function closeForgeModal() {
    const modal = document.getElementById('forge-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

function resetForge() {
    document.getElementById('forge-name').value = '';
    document.getElementById('forge-desc').value = '';
    document.getElementById('forge-stats-readout').classList.add('hidden');
    document.getElementById('forge-portrait-img').classList.add('hidden');
    document.getElementById('forge-ascii-placeholder').classList.remove('hidden');
    
    const manifestBtn = document.getElementById('btn-manifest-vessel');
    manifestBtn.disabled = true;
    manifestBtn.classList.remove('border-amber-500', 'text-amber-500');
    
    currentDraftStats = null;
}

async function suggestName() {
    const btn = document.getElementById('btn-suggest-name');
    const originalText = btn.innerText;
    btn.innerText = '...';
    
    try {
        const prompt = "Suggest a single evocative cyberpunk/psychic character name for a MUD. Return ONLY the name.";
        const system = "You are the Technate Naming Protocol. Respond with a single name only.";
        // We use a simplified call or wrap the existing one. 
        // Note: callGemini expects (userInput, systemPrompt) and returns parsed JSON.
        // We might need to adjust based on how callGemini is implemented (it expects JSON).
        const res = await callGemini(prompt, system);
        // If callGemini forces JSON, we should ask for JSON.
        // Assuming callGemini returns the parsed object from the API which is configured for JSON.
        if (res && res.name) {
            document.getElementById('forge-name').value = res.name;
        } else if (typeof res === 'string') {
            document.getElementById('forge-name').value = res;
        } else {
             // Fallback if callGemini response structure is rigid
             const res2 = await callGemini("Suggest a name. Return JSON: {\"name\": \"...\"}", system);
             document.getElementById('forge-name').value = res2.name;
        }
    } catch (e) {
        console.error("Name suggestion failed", e);
    } finally {
        btn.innerText = originalText;
    }
}

async function suggestBackstory() {
    const btn = document.getElementById('btn-suggest-desc');
    const originalText = btn.innerText;
    btn.innerText = '[ WEAVING... ]';
    
    try {
        const prompt = "Suggest a 2-sentence gritty biometric seed/history for a cyberpunk character.";
        const system = "You are the Technate History Archive. Return JSON: {\"backstory\": \"...\"}";
        const res = await callGemini(prompt, system);
        if (res && res.backstory) {
            document.getElementById('forge-desc').value = res.backstory;
        }
    } catch (e) {
        console.error("Backstory suggestion failed", e);
    } finally {
        btn.innerText = originalText;
    }
}

async function analyzeBiometrics() {
    const name = document.getElementById('forge-name').value;
    const desc = document.getElementById('forge-desc').value;
    
    if (!name || !desc) {
        UI.addLog("[SYSTEM]: Biometric analysis requires both Name and Description.", "var(--term-red)");
        return;
    }

    const btn = document.getElementById('btn-analyze-biometrics');
    btn.innerText = "[ ANALYZING... ]";
    btn.disabled = true;

    try {
        const prompt = `Analyze this vessel's biometrics: Name: ${name}, Description: ${desc}.`;
        const system = `You are the Technate Biometric Scanner. Assign stats based on the description. 
        Total points should be around 45. WILL (mental/psychic), AWR (perception/awareness), PHYS (physical/body). 
        Return JSON: {"WILL": int, "AWR": int, "PHYS": int, "archetype": "string"}`;
        
        const res = await callGemini(prompt, system);
        
        if (res && res.WILL !== undefined) {
            currentDraftStats = res;
            
            // Populate UI
            document.getElementById('forge-archetype').innerText = res.archetype.toUpperCase();
            document.getElementById('stat-will').innerText = res.WILL.toString().padStart(2, '0');
            document.getElementById('stat-awr').innerText = res.AWR.toString().padStart(2, '0');
            document.getElementById('stat-phys').innerText = res.PHYS.toString().padStart(2, '0');
            
            document.getElementById('forge-stats-readout').classList.remove('hidden');
            
            const manifestBtn = document.getElementById('btn-manifest-vessel');
            manifestBtn.disabled = false;
            manifestBtn.classList.add('border-amber-500', 'text-amber-500');
        }
    } catch (e) {
        console.error("Analysis failed", e);
        UI.addLog("[SYSTEM]: Biometric analysis failed. Quantum interference detected.", "var(--term-red)");
    } finally {
        btn.innerText = "[ ANALYZE BIOMETRICS ]";
        btn.disabled = false;
    }
}

async function manifestVessel() {
    const name = document.getElementById('forge-name').value;
    const desc = document.getElementById('forge-desc').value;
    
    if (!currentDraftStats) return;

    const btn = document.getElementById('btn-manifest-vessel');
    const loading = document.getElementById('forge-manifest-loading');
    
    btn.disabled = true;
    loading.classList.remove('hidden');

    try {
        // 1. Generate Portrait
        const portraitPrompt = `Cyberpunk character portrait: ${name}. ${desc}. ${currentDraftStats.archetype} archetype.`;
        const b64 = await generatePortrait(portraitPrompt, stateManager.getState().localPlayer.stratum);
        
        if (b64) {
            const dataUri = b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`;
            
            // Display it instantly to the user
            const portraitImg = document.getElementById('forge-portrait-img');
            portraitImg.src = dataUri;
            portraitImg.classList.remove('hidden');
            document.getElementById('forge-ascii-placeholder').classList.add('hidden');
            
            // 2. Save to Firestore
            const characterData = {
                name: name,
                description: desc,
                archetype: currentDraftStats.archetype,
                stats: {
                    WILL: currentDraftStats.WILL,
                    AWR: currentDraftStats.AWR,
                    PHYS: currentDraftStats.PHYS
                },
                visual_prompt: portraitPrompt,
                image: dataUri, // syncEngine will handle Storage upload
                stratum: stateManager.getState().localPlayer.stratum,
                timestamp: Date.now(),
                deceased: false,
                deployed: false
            };
            
            const charId = await createCharacter(characterData);
            characterData.id = charId;
            
            // 3. Set as Active
            stateManager.setActiveAvatar(characterData);
            const { localCharacters } = stateManager.getState();
            stateManager.setLocalCharacters([...localCharacters, characterData]);
            
            UI.addLog(`[SYSTEM]: Vessel [${name}] successfully manifested. Connection stable.`, "var(--term-green)");
            
            // Close modal after brief delay
            setTimeout(() => {
                closeForgeModal();
            }, 2000);
        }
    } catch (e) {
        console.error("Manifestation failed", e);
        UI.addLog("[SYSTEM]: Manifestation failure. Vessel collapsed during quantum transition.", "var(--term-red)");
        btn.disabled = false;
    } finally {
        loading.classList.add('hidden');
    }
}

// Global initialization
document.addEventListener('DOMContentLoaded', () => {
    const closeBtn = document.getElementById('close-forge');
    if (closeBtn) closeBtn.onclick = closeForgeModal;

    const suggestNameBtn = document.getElementById('btn-suggest-name');
    if (suggestNameBtn) suggestNameBtn.onclick = suggestName;

    const suggestDescBtn = document.getElementById('btn-suggest-desc');
    if (suggestDescBtn) suggestDescBtn.onclick = suggestBackstory;

    const analyzeBtn = document.getElementById('btn-analyze-biometrics');
    if (analyzeBtn) analyzeBtn.onclick = analyzeBiometrics;

    const manifestBtn = document.getElementById('btn-manifest-vessel');
    if (manifestBtn) manifestBtn.onclick = manifestVessel;
});
