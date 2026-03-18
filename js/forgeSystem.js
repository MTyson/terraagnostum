// js/forgeSystem.js
import { callGemini, generatePortrait } from './apiService.js';
import { createCharacter } from './syncEngine.js';
import * as stateManager from './stateManager.js';
import * as UI from './ui.js';
import { STRATA_ARCHIVE, WORLD_STATE } from './contextEngine.js';

const settingString = `
  Setting: ${WORLD_STATE.MUNDANE.name} is caught in the middle between ${WORLD_STATE.TECHNATE.name} and ${WORLD_STATE.FAEN.name}.
  ${WORLD_STATE.TECHNATE.summary}
`;

let currentDraftStats = null;
let currentDraftStratum = 'mundane';

/**
 * 
 * Daughter of a Tennessee rare earth miner killed in Ukraine, Dora has a penchant for smalls arms and wildlife.  She is Faen-aware, descended from a long line of seers and mystics. 
 */

export function openForgeModal(readOnlyData = null) {
    const modal = document.getElementById('forge-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    if (readOnlyData) {
        setupReadOnlyForge(readOnlyData);
    } else {
        const { strata } = stateManager.getState();
        const strataKeys = Object.keys(strata);
        if (strataKeys.length > 0) {
            currentDraftStratum = strataKeys[Math.floor(Math.random() * strataKeys.length)];
        } else {
            currentDraftStratum = 'mundane';
        }
        resetForge();
    }
}

function setupReadOnlyForge(data) {
    document.getElementById('forge-name').value = data.name || '';
    document.getElementById('forge-name').readOnly = true;
    document.getElementById('forge-desc').value = data.description || '';
    document.getElementById('forge-desc').readOnly = true;
    document.getElementById('forge-desc').disabled = false; // Ensure it's not grayed out if we're just reading
    document.getElementById('forge-stratum').innerText = (data.stratum || '---').toUpperCase();
    document.getElementById('forge-archetype').innerText = (data.archetype || '---').toUpperCase();
    document.getElementById('stat-amn').innerText = (data.stats?.AMN || 20).toString().padStart(2, '0');
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
    document.getElementById('forge-stratum').innerText = '---';
    document.getElementById('forge-stats-readout').classList.add('hidden');
    document.getElementById('forge-help-msg').classList.add('hidden');
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
    updateForgeUIState();
}

function updateForgeUIState() {
    const name = document.getElementById('forge-name').value.trim();
    const hasName = name.length > 0;
    
    const descInput = document.getElementById('forge-desc');
    const suggestDescBtn = document.getElementById('btn-suggest-desc');
    const analyzeBtn = document.getElementById('btn-analyze-biometrics');
    const manifestBtn = document.getElementById('btn-manifest-vessel');
    
    descInput.disabled = !hasName;
    suggestDescBtn.disabled = !hasName;
    analyzeBtn.disabled = !hasName;

    // If name is cleared, also ensure manifest is disabled even if biometrics were previously analyzed
    if (!hasName) {
        manifestBtn.disabled = true;
        manifestBtn.classList.remove('border-amber-500', 'text-amber-500', 'animate-pulse');
        manifestBtn.classList.add('border-gray-800', 'text-gray-800');
    } else if (currentDraftStats) {
        // If we have stats and a name, we can enable manifest
        manifestBtn.disabled = false;
        manifestBtn.classList.remove('border-gray-800', 'text-gray-800');
        manifestBtn.classList.add('border-amber-500', 'text-amber-500', 'animate-pulse');
    }

    [descInput, suggestDescBtn, analyzeBtn].forEach(el => {
        if (!hasName) {
            el.classList.add('opacity-30', 'cursor-not-allowed');
        } else {
            el.classList.remove('opacity-30', 'cursor-not-allowed');
        }
    });
}

async function suggestName() {
    const nameInput = document.getElementById('forge-name');
    const oldPlaceholder = nameInput.placeholder;
    nameInput.value = '';
    nameInput.placeholder = "SEARCHING REGISTRY...";
    
    UI.addLog("[SYSTEM]: Accessing naming protocols...", "var(--term-amber)");
    
    const { strata } = stateManager.getState();
    const stratumData = strata[currentDraftStratum.toLowerCase()];
    const dynamicSetting = stratumData ? `Setting: ${stratumData.name}. Vibe: ${stratumData.description}. Naming Rule: ${stratumData.rules?.naming || 'Standard'}.` : settingString;

    const prompt = `
      Role: You are a world-building consultant specializing in "Uncanny Valley" linguistics.
      ${dynamicSetting}
      Task: Generate 20 Player Character names using a [First Name] "[Nickname]" [Last Name] format.
      Naming Rules:
        Base: Use common, relatable 21st-century Earth names as the foundation, be global (e.g., Sarah, David, Miller, Smith, Jackson, Yen, Nguyen, Chan, Mbutu, Mande, Alex, Corian, Ian, Amanda, Marriane, Davies, Mandela, Tashi, Niranjan, Herenandez, Rodriguez, Jan, Jefferson, Bryce, Ash, etc.).
        The Uncanny Valley Filter: Alter the names so they look like "glitched" versions of reality. They should be recognizable but feel slightly "off" or "wrong" to a modern reader.
        Technate Alterations (Sci-Fi): Use "Compression" (dropping vowels, e.g., 'Jennifr'), "Phonetic Flattening" (replacing 'c' with 'k', e.g., 'Kaleb'), or "Data-Tagging" (adding small numerical suffixes or hardware-slang nicknames).
        Faen Alterations (Fantasy): Use "Archaic Drift" (adding extra consonants, e.g., 'Thommas'), "Vowel Shifting" (swapping 'i' for 'y'), or "Nature-Burden" nicknames (nicknames related to plants, shadows, or melodic sounds).
        Avoid "Far Out" Tropes: Do not use random strings of numbers (no "X-J-11") or high-fantasy gibberish (no "Zalathor"). It should look like a typo on a legal document or a name spoken with a strange accent.
        Leave one of the names as-is (e.g., "Sarah" or "David" or "Stone" or "Collins") to create a sense of familiarity amidst the strangeness.
        Avoid stringing consonants together in a way that makes them unpronounceable. The name should be able to be spoken aloud, even if it sounds odd.
        More inspirational base names: Joanne Lee, David Chang, Samantha Patel, Marcus Gray, Rachel Chen, Diego Rodriguez, Emily Wong, Aaron Ramirez, Jasmine Singh, Tyler Nguyen, Strom Nightengale, Tenzin Sol, Xander Black, Luna Vega, Aurora Frost,
        Kai Delacroix, Raven Nightshade, Phoenix Blaine, Sterling Silver, Axel Steele, Nova Starling, Zephyr Storm

        Format: Return strictly JSON with a "names" array containing strings.
      Return JSON: {"names": ["name1", "name2", ...]}
      `;
    const res = await callGemini(prompt, "[lore archive] You are a naming protocol.", {
        type: "object",
        properties: {
            names: { type: "array", items: { type: "string" } }
        },
        required: ["names"]
    });
    
    if (res && res.names && Array.isArray(res.names) && res.names.length > 0) {
        const pickedName = res.names[Math.floor(Math.random() * res.names.length)];
        nameInput.value = pickedName;
        UI.addLog(`[SYSTEM]: Identity suggested: ${pickedName}`, "var(--term-green)");
        updateForgeUIState();
    }
    nameInput.placeholder = oldPlaceholder;
}

/**
 * Ash 'Fey' Mandela was a disillusioned Digital Afterlife Coordinator for The Cloud Consortium in Rain City, 
 * spending his days scrubbing the corrupted memories of the deceased until he discovered a hidden, 
 * glowing sequence of code that wasn't machine-made. When he decoded the anomaly, 
 * he unwittingly opened a bridge to the Faen plane, drawing the lethal attention of the Technate’s 
 * enforcers who sought to harvest the raw, magical meaning fueling his newfound visions.
 */
async function suggestBackstory() {
    // 1. Grab the current name from the input field
    const name = document.getElementById('forge-name').value || "this vessel"; 
    const descInput = document.getElementById('forge-desc');
    const oldPlaceholder = descInput.placeholder;
    
    descInput.value = '';
    descInput.placeholder = "CONSULTING ARCHIVES...";

    UI.addLog("[SYSTEM]: Consulting lore archives...", "var(--term-amber)");
    
    const { strata } = stateManager.getState();
    const stratumData = strata[currentDraftStratum.toLowerCase()];
    const dynamicSetting = stratumData ? `Setting: ${stratumData.name}. Vibe: ${stratumData.description}. Theme: ${stratumData.theme}.` : settingString;

    const prompt = `
      You are a Master Storyteller.  You are inventing a backstory for a character named ${name}.
      ${dynamicSetting}
      This character is from the ${stratumData ? stratumData.name : 'Mundane'} plane.  Their backstory should reflect the look and feel of this stratum.
      If it's Mundane, it should be somewhat relatable to a modern game playing user...
      If it's Faen, it should lean into ancient high-fantasy and nature-burdened magic...
      If it's CityCore7/Technate, it should be optimized, clinical, and cypherpunk.
      
      Their story can gradually collide with 'The Interregnum', which is the current gameworld narrative of how the elite have made a deal with the Technate.
      So we see a gradual 'Neruomancer'/'Deus Ex' style cyberpunk conspiracy, high-tech influence.
      At the same time, we see a benevolent influence from the Faen plane.  This is a hopeful, highfantasy, magical realism of growth and beauty.
      The backstory should be evocative and inspire a visual portrait.  The goal is to create a compelling persona for the player to inhabit.
      Use real-sounding but not-actual location names like: 
        Rain City, The Sprawl, The Fills, Moon Data Center 37, Mars Outpost 2, Arcadia, Neon Bay, Migrant Camp 3, Rio Encantanto, The Euro Orbital Platform, Golden Enclave, Third Coast, Southern Space Port.  These are SUGGESTIONS!  They suggest a broader world.  They suggest a vibe, a livind world similar to Earth.  BE CREATIVE.
      Make it feel like the person is a normal person who was born and lives in the year 2035, in an slightly alternate Earth timeline.
      You can use corporate entities like Mesmer AI, The Cloud Consortium, Rare Earth Mining LLC, etc.  
      Projects like the Chinese "Reservoir" (Store-Now, decrypt Later) 吞海 (Tūn Hǎi) "Swallowing the Sea", the US "Eidolon" program, 
        the EU "Mnemosyne Initiative", etc.  These are all SUGGESTIONS to help you create a rich backstory that 
        fits the world.  You can use real-world events as a backdrop (climate disasters, pandemics, economic 
        collapse, etc.) but alter them slightly to fit the narrative.  For example, instead of "The 2020 Pandemic",
        it could be "The 2029 Viral Wave" that led to the rise of the Cloud Consortium.
      You may use wierd but plausible sounding job titles like "Progress Manager", "Neuro-linguisitc Coder", "Memory Curator", "Dream Architect", "Data Forager", "Neural Interface Technician", "Virtual Reality Cartographer", 
        "Cybernetic Ethicist", "Algorithmic Bias Analyst", "Synthetic Biographer", "Digital Afterlife Coordinator", "Herb Smuggler", "Magical-Digital Interface Specialist",
        "Planar Marine", "Reality Hacker", "Amn Forger", "Stratum Surveyor", "Meaning Harvester", "Aethal Cartographer", "Lore Keeper", "Interdimensional Courier", "Technomancer", "Faen Whisperer", 
        "Crypto Analyst", "Cypherpunk Activist", "Data Broker", "Memory Forger", "Virtual Reality Designer", "Neural Network Trainer", "Synthetic Biographer", "Digital Afterlife Coordinator", "Herb Smuggler", "Magical-Digital Interface Specialist", etc.
      The story should be 2-3 sentences long.  
      Return JSON: {"backstory": "string"}
    `;

    const res = await callGemini(prompt, "lore archive: You are a lore archive.", {
        type: "object",
        properties: {
            backstory: { type: "string" }
        },
        required: ["backstory"]
    });
    
    if (res && res.backstory) {
        descInput.value = res.backstory;
        UI.addLog("[SYSTEM]: Biometric seed suggested.", "var(--term-green)");
    }
    descInput.placeholder = oldPlaceholder;
}
/** Generates the stats for the char */
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
    document.getElementById('stat-amn').innerText = "20";
    document.getElementById('stat-will').innerText = "--";
    document.getElementById('stat-awr').innerText = "--";
    document.getElementById('stat-phys').innerText = "--";
    document.getElementById('forge-stratum').innerText = "CALIBRATING...";
    document.getElementById('forge-stats-readout').classList.remove('hidden');

    // Determine stats for a character in the ${currentDraftStratum} stratum. 

    UI.addLog("[SYSTEM]: Checking vessel vitals...", "var(--term-amber)");
    
    const { strata } = stateManager.getState();
    const stratumData = strata[currentDraftStratum.toLowerCase()];
    const dynamicSetting = stratumData ? `Setting: ${stratumData.name}. Vibe: ${stratumData.description}. Theme: ${stratumData.theme}.` : settingString;

    const prompt = `Analyze this biometric seed: "${desc}". 
      AMN (OM|AMEN) is the ROOT stat and is always 20 for new characters.
      WILL, AWR, and PHYS are DERIVED stats. 
      CRITICAL RULE: The sum of (WILL + AWR + PHYS) MUST EQUAL the AMN value (20).
      Distribute the 20 points among WILL, AWR, and PHYS based on the biometric seed.
      Also determine the most appropriate STRATUM for this character based on their backstory.
      Available Strata: ${Object.keys(strata).join(', ')}.
      Return JSON: {"WILL": int, "AWR": int, "PHYS": int, "AMN": 20, "archetype": "string", "stratum": "string"}
      ${dynamicSetting}
      `;
    
    const res = await callGemini(prompt, "[lore archive] You are a biometric scanner.", {
        type: "object",
        properties: {
            WILL: { type: "integer" },
            AWR: { type: "integer" },
            PHYS: { type: "integer" },
            AMN: { type: "integer" },
            archetype: { type: "string" },
            stratum: { type: "string" }
        },
        required: ["WILL", "AWR", "PHYS", "AMN", "archetype", "stratum"]
    });
    if (res) {
        currentDraftStats = res;
        if (currentDraftStats.AMN === undefined) currentDraftStats.AMN = 20;
        
        // Update currentDraftStratum if the AI suggests a better fit
        if (res.stratum && strata[res.stratum.toLowerCase()]) {
            currentDraftStratum = res.stratum.toLowerCase();
        }

        archetypeEl.innerText = (res.archetype || "UNKNOWN").toUpperCase();
        document.getElementById('forge-stratum').innerText = currentDraftStratum.toUpperCase();
        document.getElementById('stat-amn').innerText = (res.AMN || 20).toString().padStart(2, '0');
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

    const { strata } = stateManager.getState();
    const portraitPrompt = `Character portrait: ${name}. ${desc}. ${currentDraftStats.archetype} archetype.`;
    const b64 = await generatePortrait(portraitPrompt, currentDraftStratum, strata);
    
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
    } else {
        portraitBox.innerHTML = `<div class="flex h-full items-center justify-center text-red-500 text-[10px]">GENERATION FAILED<br>Review logs or try another seed.</div>`;
        UI.addLog(`[SYSTEM]: Vessel visual manifestation failed. The requested seed may have triggered a safety filter or the API is currently saturated.`, "var(--term-red)");
    }
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('close-forge').onclick = () => document.getElementById('forge-modal').classList.add('hidden');
    document.getElementById('forge-help-toggle').onclick = () => {
        const msg = document.getElementById('forge-help-msg');
        msg.classList.toggle('hidden');
    };
    document.getElementById('btn-suggest-name').onclick = suggestName;
    document.getElementById('btn-suggest-desc').onclick = suggestBackstory;
    document.getElementById('btn-analyze-biometrics').onclick = analyzeBiometrics;
    document.getElementById('btn-manifest-vessel').onclick = manifestVessel;
    document.getElementById('forge-name').oninput = updateForgeUIState;
    document.getElementById('forge-portrait-img').onclick = () => {
        const src = document.getElementById('forge-portrait-img').src;
        if (src) {
            UI.toggleDossierBuffer(true, {
                name: document.getElementById('forge-name').value || "Unknown Vessel",
                stratum: currentDraftStratum,
                archetype: document.getElementById('forge-archetype').innerText,
                description: document.getElementById('forge-desc').value,
                image: src,
                stats: currentDraftStats || { WILL: 0, AWR: 0, PHYS: 0, AMN: 20 }
            });
            document.getElementById('forge-modal').classList.add('hidden');
        }
    };
});
