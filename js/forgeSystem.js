// js/forgeSystem.js
import { appId } from './firebaseConfig.js';
import { callGemini, generatePortrait } from './apiService.js';
import { createCharacter } from './syncEngine.js';
import * as stateManager from './stateManager.js';
import * as UI from './ui.js';

let currentDraftStats = null;

const PSYCHOTASY_STRATA = [
    { name: "Technate", vibe: "Clinical, transhumanist, matte-white, algorithmic" },
    { name: "Interregnum", vibe: "Gritty, analog, rain-slicked, survivalist" },
    { name: "Faen", vibe: "Surreal, dream-like, fluid, psychic, ethereal" },
    { name: "Trenchtown", vibe: "Rusted, industrial, makeshift, high-tech/low-life" }
];

export function openForgeModal(readOnlyData = null) {
    const modal = document.getElementById('forge-modal');
    if (modal) {
        modal.classList.remove('hidden');
        if (readOnlyData) {
            setupReadOnlyForge(readOnlyData);
        } else {
            resetForge();
        }
    }
}

function setupReadOnlyForge(data) {
    const nameInput = document.getElementById('forge-name');
    const descInput = document.getElementById('forge-desc');
    const archLabel = document.getElementById('forge-archetype');
    const statWill = document.getElementById('stat-will');
    const statAwr = document.getElementById('stat-awr');
    const statPhys = document.getElementById('stat-phys');
    const portraitImg = document.getElementById('forge-portrait-img');
    const asciiPlaceholder = document.getElementById('forge-ascii-placeholder');
    const manifestBtn = document.getElementById('btn-manifest-vessel');
    const analyzeBtn = document.getElementById('btn-analyze-biometrics');
    const suggestNameBtn = document.getElementById('btn-suggest-name');
    const suggestDescBtn = document.getElementById('btn-suggest-desc');

    nameInput.value = data.name || '';
    nameInput.readOnly = true;
    descInput.value = data.description || '';
    descInput.readOnly = true;

    archLabel.innerText = (data.archetype || '---').toUpperCase();
    statWill.innerText = (data.stats?.WILL || 0).toString().padStart(2, '0');
    statAwr.innerText = (data.stats?.AWR || 0).toString().padStart(2, '0');
    statPhys.innerText = (data.stats?.PHYS || 0).toString().padStart(2, '0');

    document.getElementById('forge-stats-readout').classList.remove('hidden');

    if (data.image) {
        portraitImg.src = data.image;
        portraitImg.classList.remove('hidden');
        asciiPlaceholder.classList.add('hidden');
    }

    manifestBtn.style.display = 'none';
    analyzeBtn.style.display = 'none';
    suggestNameBtn.style.display = 'none';
    suggestDescBtn.style.display = 'none';
}

function closeForgeModal() {
    const modal = document.getElementById('forge-modal');
    if (modal) {
        modal.classList.add('hidden');
        // Reset styles for next time
        document.getElementById('forge-name').readOnly = false;
        document.getElementById('forge-desc').readOnly = false;
        document.getElementById('btn-manifest-vessel').style.display = 'block';
        document.getElementById('btn-analyze-biometrics').style.display = 'block';
        document.getElementById('btn-suggest-name').style.display = 'block';
        document.getElementById('btn-suggest-desc').style.display = 'block';
    }
}

function resetForge() {
    const nameInput = document.getElementById('forge-name');
    const descInput = document.getElementById('forge-desc');
    nameInput.value = '';
    nameInput.readOnly = false;
    descInput.value = '';
    descInput.readOnly = false;

    document.getElementById('forge-stats-readout').classList.add('hidden');
    document.getElementById('forge-portrait-img').classList.add('hidden');
    document.getElementById('forge-ascii-placeholder').classList.remove('hidden');
    
    const manifestBtn = document.getElementById('btn-manifest-vessel');
    manifestBtn.disabled = true;
    manifestBtn.classList.remove('border-amber-500', 'text-amber-500');
    manifestBtn.style.display = 'block';

    document.getElementById('btn-analyze-biometrics').style.display = 'block';
    document.getElementById('btn-suggest-name').style.display = 'block';
    document.getElementById('btn-suggest-desc').style.display = 'block';
    
    currentDraftStats = null;
}

async function suggestName() {
    const btn = document.getElementById('btn-suggest-name');
    const originalText = btn.innerText;
    btn.innerText = '...';
    
    try {
        const seed = PSYCHOTASY_STRATA[Math.floor(Math.random() * PSYCHOTASY_STRATA.length)];
        const prompt = `Invent a single, unique character name for a ${seed.name} character in a gritty MUD. Vibe: ${seed.vibe}. Return JSON: {"name": "string"}`;
        const system = "You are the Technate Naming Protocol. Respond with JSON containing a single name.";
        
        const res = await callGemini(prompt, system);
        if (res && res.name) {
            document.getElementById('forge-name').value = res.name;
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
        const seed = PSYCHOTASY_STRATA[Math.floor(Math.random() * PSYCHOTASY_STRATA.length)];
        const prompt = `Invent a 2-sentence gritty biometric seed (backstory) for a character originating from the ${seed.name} stratum. Reference ${seed.vibe} elements. Return JSON: {"backstory": "string"}`;
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
        const prompt = `Analyze this character backstory: "${desc}".
Based on the strata of Psychotasy (Technate, Interregnum, Faen, Trenchtown), assign stats (1-20).
- WILL: Psychic manifestation/Technate override.
- AWR: Perception of glitches/Aethal scripts.
- PHYS: Analog/kinetic strength.

Return JSON: { "WILL": int, "AWR": int, "PHYS": int, "archetype": "string", "analysis": "1-sentence lore explanation" }`;
        const system = `You are the Technate Biometric Scanner. Assign stats based on the description and Psychotasy lore.`;
        
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
