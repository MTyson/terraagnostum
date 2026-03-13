// js/forgeSystem.js
import { callGemini, generatePortrait } from './apiService.js';
import { createCharacter } from './syncEngine.js';
import * as stateManager from './stateManager.js';
import * as UI from './ui.js';
import { STRATA_ARCHIVE } from './contextEngine.js';

let currentDraftStats = null;
let currentDraftStratum = 'mundane';

export function openForgeModal(readOnlyData = null) {
    const modal = document.getElementById('forge-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    if (readOnlyData) {
        setupReadOnlyForge(readOnlyData);
    } else {
        const strataKeys = Object.keys(STRATA_ARCHIVE);
        currentDraftStratum = strataKeys[Math.floor(Math.random() * strataKeys.length)];
        resetForge();
    }
}

function setupReadOnlyForge(data) {
    document.getElementById('forge-name').value = data.name || '';
    document.getElementById('forge-name').readOnly = true;
    document.getElementById('forge-desc').value = data.description || '';
    document.getElementById('forge-desc').readOnly = true;
    document.getElementById('forge-archetype').innerText = (data.archetype || '---').toUpperCase();
    document.getElementById('stat-will').innerText = (data.stats?.WILL || 0).toString().padStart(2, '0');
    document.getElementById('stat-awr').innerText = (data.stats?.AWR || 0).toString().padStart(2, '0');
    document.getElementById('stat-phys').innerText = (data.stats?.PHYS || 0).toString().padStart(2, '0');
    document.getElementById('forge-stats-readout').classList.remove('hidden');
    if (data.image) {
        const img = document.getElementById('forge-portrait-img');
        img.src = data.image;
        img.classList.remove('hidden');
        document.getElementById('forge-ascii-placeholder').classList.add('hidden');
    }
    document.getElementById('btn-manifest-vessel').classList.add('hidden');
    document.getElementById('btn-analyze-biometrics').classList.add('hidden');
    document.getElementById('btn-suggest-name').classList.add('hidden');
    document.getElementById('btn-suggest-desc').classList.add('hidden');
}

function resetForge() {
    document.getElementById('forge-name').value = '';
    document.getElementById('forge-name').readOnly = false;
    document.getElementById('forge-desc').value = '';
    document.getElementById('forge-desc').readOnly = false;
    document.getElementById('forge-stats-readout').classList.add('hidden');
    document.getElementById('forge-portrait-img').classList.add('hidden');
    document.getElementById('forge-ascii-placeholder').classList.remove('hidden');
    
    const manifestBtn = document.getElementById('btn-manifest-vessel');
    manifestBtn.disabled = true;
    manifestBtn.classList.remove('border-amber-500', 'text-amber-500', 'animate-pulse');
    manifestBtn.classList.add('border-gray-800', 'text-gray-800');
    
    document.getElementById('btn-manifest-vessel').classList.remove('hidden');
    document.getElementById('btn-analyze-biometrics').classList.remove('hidden');
    document.getElementById('btn-suggest-name').classList.remove('hidden');
    document.getElementById('btn-suggest-desc').classList.remove('hidden');
    currentDraftStats = null;
}

async function suggestName() {
    const nameInput = document.getElementById('forge-name');
    const oldPlaceholder = nameInput.placeholder;
    nameInput.value = '';
    nameInput.placeholder = "SEARCHING REGISTRY...";
    
    UI.addLog("[SYSTEM]: Accessing naming protocols...", "var(--term-amber)");
    // Let's try just a miniamalist prompt first to see if we can get a good name without overloading the model with info. We can always iterate on this.
    //const lore = STRATA_ARCHIVE[currentDraftStratum];
    //const prompt = `Invent a unique name for a character belonging to this world stratum: ${currentDraftStratum} (${lore}). Return JSON: {"name": "string"}`;
    const prompt = `
      Role: You are a world-building consultant specializing in "Uncanny Valley" linguistics.
      Setting: A near-future Earth (The Mundane) is merging with a high-tech plane (The Technate) and a high-fantasy plane (The Faen).
      Task: Generate 20 Player Character names using a [First Name] "[Nickname]" [Last Name] format.
      Naming Rules:
Base: Use common, relatable 21st-century Earth names as the foundation (e.g., Sarah, David, Miller, Smith).
The Uncanny Valley Filter: Alter the names so they look like "glitched" versions of reality. They should be recognizable but feel slightly "off" or "wrong" to a modern reader.
Technate Alterations (Sci-Fi): Use "Compression" (dropping vowels, e.g., 'Jennifr'), "Phonetic Flattening" (replacing 'c' with 'k', e.g., 'Kaleb'), or "Data-Tagging" (adding small numerical suffixes or hardware-slang nicknames).
Faen Alterations (Fantasy): Use "Archaic Drift" (adding extra consonants, e.g., 'Thommas'), "Vowel Shifting" (swapping 'i' for 'y'), or "Nature-Burden" nicknames (nicknames related to plants, shadows, or melodic sounds).
Avoid "Far Out" Tropes: Do not use random strings of numbers (no "X-J-11") or high-fantasy gibberish (no "Zalathor"). It should look like a typo on a legal document or a name spoken with a strange accent.
Format: Return strictly JSON with a "names" array containing strings.
      Return JSON: {"names": ["name1", "name2", ...]}
      `;
    const res = await callGemini(prompt, "You are a naming protocol.");
    
    if (res && res.names && Array.isArray(res.names) && res.names.length > 0) {
        const pickedName = res.names[Math.floor(Math.random() * res.names.length)];
        nameInput.value = pickedName;
        UI.addLog(`[SYSTEM]: Identity suggested: ${pickedName}`, "var(--term-green)");
    }
    nameInput.placeholder = oldPlaceholder;
}

async function suggestBackstory() {
    const descInput = document.getElementById('forge-desc');
    const oldPlaceholder = descInput.placeholder;
    descInput.value = '';
    descInput.placeholder = "CONSULTING ARCHIVES...";

    UI.addLog("[SYSTEM]: Consulting lore archives...", "var(--term-amber)");
    const lore = STRATA_ARCHIVE[currentDraftStratum];
    const prompt = `Invent a 2-sentence backstory for a character from the ${currentDraftStratum} stratum (${lore}). Return JSON: {"backstory": "string"}`;
    const res = await callGemini(prompt, "You are a lore archive.");
    
    if (res && res.backstory) {
        descInput.value = res.backstory;
        UI.addLog("[SYSTEM]: Biometric seed suggested.", "var(--term-green)");
    }
    descInput.placeholder = oldPlaceholder;
}

async function analyzeBiometrics() {
    const desc = document.getElementById('forge-desc').value;
    if (!desc) return;
    
    const analyzeBtn = document.getElementById('btn-analyze-biometrics');
    const oldBtnText = analyzeBtn.innerText;
    analyzeBtn.disabled = true;
    analyzeBtn.innerText = "[ ANALYZING... ]";
    
    const archetypeEl = document.getElementById('forge-archetype');
    const oldArchetype = archetypeEl.innerText;
    archetypeEl.innerText = "CHECKING VITALS...";
    
    // Clear and show the stats readout area while waiting
    document.getElementById('stat-will').innerText = "--";
    document.getElementById('stat-awr').innerText = "--";
    document.getElementById('stat-phys').innerText = "--";
    document.getElementById('forge-stats-readout').classList.remove('hidden');

    UI.addLog("[SYSTEM]: Checking vessel vitals...", "var(--term-amber)");
    const prompt = `Analyze this biometric seed: "${desc}". Determine stats for a character in the ${currentDraftStratum} stratum. Return JSON: {"WILL": int, "AWR": int, "PHYS": int, "archetype": "string"}`;
    
    const res = await callGemini(prompt, "You are a biometric scanner.");
    if (res) {
        currentDraftStats = res;
        archetypeEl.innerText = (res.archetype || "UNKNOWN").toUpperCase();
        document.getElementById('stat-will').innerText = (res.WILL || 10).toString().padStart(2, '0');
        document.getElementById('stat-awr').innerText = (res.AWR || 10).toString().padStart(2, '0');
        document.getElementById('stat-phys').innerText = (res.PHYS || 10).toString().padStart(2, '0');
        
        const manifestBtn = document.getElementById('btn-manifest-vessel');
        manifestBtn.disabled = false;
        manifestBtn.classList.remove('border-gray-800', 'text-gray-800');
        manifestBtn.classList.add('border-amber-500', 'text-amber-500', 'animate-pulse');
        
        UI.addLog("[SYSTEM]: Vitals verified. Stats synchronized.", "var(--term-green)");
    } else {
        archetypeEl.innerText = oldArchetype;
        document.getElementById('forge-stats-readout').classList.add('hidden');
    }
    analyzeBtn.disabled = false;
    analyzeBtn.innerText = oldBtnText;
}

async function manifestVessel() {
    const name = document.getElementById('forge-name').value;
    const desc = document.getElementById('forge-desc').value;
    if (!name || !currentDraftStats) return;

    const portraitBox = document.getElementById('forge-image-display');
    portraitBox.innerHTML = `<div class="flex h-full items-center justify-center text-amber-500 text-[10px] animate-pulse">MATERIALIZING...</div>`;

    const portraitPrompt = `Character portrait: ${name}. ${desc}. ${currentDraftStats.archetype} archetype.`;
    const b64 = await generatePortrait(portraitPrompt, currentDraftStratum);
    
    if (b64) {
        const dataUri = `data:image/png;base64,${b64}`;
        // The syncEngine will handle Storage upload automatically
        const charData = {
            name, description: desc, archetype: currentDraftStats.archetype,
            stats: currentDraftStats, image: dataUri, stratum: currentDraftStratum,
            timestamp: Date.now(), deceased: false, deployed: false
        };
        
        UI.addLog(`[SYSTEM]: Manifesting vessel footprint...`, "var(--term-amber)");
        const id = await createCharacter(charData);
        charData.id = id;
        stateManager.setActiveAvatar(charData);
        UI.addLog(`[SYSTEM]: Vessel [${name}] anchored to Archive.`, "var(--term-green)");
        document.getElementById('forge-modal').classList.add('hidden');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('close-forge').onclick = () => document.getElementById('forge-modal').classList.add('hidden');
    document.getElementById('btn-suggest-name').onclick = suggestName;
    document.getElementById('btn-suggest-desc').onclick = suggestBackstory;
    document.getElementById('btn-analyze-biometrics').onclick = analyzeBiometrics;
    document.getElementById('btn-manifest-vessel').onclick = manifestVessel;
    document.getElementById('forge-portrait-img').onclick = () => {
        const src = document.getElementById('forge-portrait-img').src;
        if (src) {
            UI.toggleDossierBuffer(true, {
                name: document.getElementById('forge-name').value || "Unknown Vessel",
                stratum: currentDraftStratum,
                archetype: document.getElementById('forge-archetype').innerText,
                description: document.getElementById('forge-desc').value,
                image: src,
                stats: currentDraftStats || { WILL: 0, AWR: 0, PHYS: 0 }
            });
            document.getElementById('forge-modal').classList.add('hidden');
        }
    };
});
