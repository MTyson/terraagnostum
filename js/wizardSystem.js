import { collection, addDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { sendSignInLinkToEmail } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { auth, db, appId, isSyncEnabled } from './firebaseConfig.js';
import { callGemini, projectVisual, generatePortrait } from './apiService.js'; // Added generatePortrait
import * as UI from './ui.js';

const CHAR_COLLECTION = 'v3_characters'; // Matches main.js for safety

export let wizardState = { active: false, type: null, step: 0, pendingData: {} };

export function startWizard(type, initialData = {}) {
    wizardState = { active: true, type, step: 1, pendingData: initialData };
}

export function resetWizard() {
    wizardState = { active: false, type: null, step: 0, pendingData: {} };
}

// Built-in Compression Utility to prevent 1MB Firestore limits
async function compressImage(base64Str, maxWidth = 512, quality = 0.7) {
    return new Promise((resolve) => {
        if (!base64Str || !base64Str.startsWith('data:image')) return resolve(base64Str);
        const img = new Image();
        img.src = base64Str;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;
            if (width > maxWidth) {
                height = Math.round((height * maxWidth) / width);
                width = maxWidth;
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = () => resolve(base64Str);
    });
}

// The Core Handler (Now Context-Aware!)
export async function handleWizardInput(val, context = {}, callbacks = {}) {
    let currentVal = val.trim();
    
    // Unpack the state passed from main.js
    const { apartmentMap, localPlayer, user, activeAvatar } = context;
    const { refreshAllUI, updateMapListener, setActiveAvatar, addLocalCharacter } = callbacks;

    const endWizard = () => {
        resetWizard();
        if (refreshAllUI) refreshAllUI();
    };

    // 1. LOGIN WIZARD
    if (wizardState.type === 'login') {
        const email = currentVal;
        UI.addLog(`[SYSTEM]: Transmitting anchoring frequency to ${email}...`, "var(--term-amber)");
        const actionCodeSettings = { url: window.location.href.split('?')[0], handleCodeInApp: true };
        try {
            await sendSignInLinkToEmail(auth, email, actionCodeSettings);
            window.localStorage.setItem('emailForSignIn', email);
            UI.addLog("[TANDY]: Pulse sent. Check your inbox to fuse your signature.", "#b084e8");
        } catch(e) { UI.addLog(`[ERROR]: ${e.message}`, "var(--term-red)"); }
        endWizard();
        return;
    }

    // 2. AVATAR WIZARD (With AI Assists & Compression)
    if (wizardState.type === 'avatar') {
        if (wizardState.step === 1) {
            if (!currentVal) {
                UI.addLog("[SYSTEM]: Querying Archive for designation...", "var(--term-amber)");
                const aiRes = await callGemini("Generate 1 cool cyberpunk name. Name only.");
                currentVal = aiRes.trim();
            }
            wizardState.pendingData.name = currentVal;
            UI.addLog(`[WIZARD]: Name confirmed: '${currentVal}'. Enter Archetype or press ENTER:`, "var(--term-amber)");
            wizardState.step++;
        } 
        else if (wizardState.step === 2) {
            if (!currentVal) {
                UI.addLog("[SYSTEM]: Querying Archive for archetype...", "var(--term-amber)");
                const aiRes = await callGemini(`Suggest a 1-word cyberpunk archetype for ${wizardState.pendingData.name}.`);
                currentVal = aiRes.replace(/["']/g, '').trim();
            }
            wizardState.pendingData.archetype = currentVal;
            UI.addLog(`[WIZARD]: Archetype logged. Press ENTER for an AI visual imprint:`, "var(--term-amber)");
            wizardState.step++;
        } 
        else if (wizardState.step === 3) {
            if (!currentVal) {
                UI.addLog("[SYSTEM]: Extrapolating visual imprint...", "var(--term-amber)");
                currentVal = await callGemini(`1-sentence visual description of ${wizardState.pendingData.name}, a ${wizardState.pendingData.archetype} in a cyberpunk world.`);
            }
            wizardState.pendingData.visual_prompt = currentVal;
            UI.addLog(`[SYSTEM]: Collapsing quantum state... Materializing vessel...`, "var(--gm-purple)");
            
            let finalImage = null;
            try {
                UI.addLog(`[SYSTEM]: Rendering vessel matrix...`, "var(--term-amber)");
                const b64 = await generatePortrait(wizardState.pendingData.visual_prompt, localPlayer.stratum);
                
                if (b64) {
                    UI.addLog(`[SYSTEM]: Optimizing visual signature for stability...`, "var(--term-amber)");
                    const dataUrl = `data:image/png;base64,${b64}`;
                    finalImage = await compressImage(dataUrl, 512, 0.7);
                }
            } catch(e) { 
                UI.addLog("[SYSTEM ERROR]: Render failed.", "var(--term-red)"); 
                console.error("Avatar render error:", e);
            }

            const finalData = {
                name: wizardState.pendingData.name,
                archetype: wizardState.pendingData.archetype,
                visual_prompt: wizardState.pendingData.visual_prompt,
                image: finalImage,
                stats: { WILL: 20, CONS: 20, PHYS: 20 },
                deceased: false, deployed: false, timestamp: Date.now()
            };

            const currentUser = user || auth.currentUser;
            if (currentUser) {
                addDoc(collection(db, 'artifacts', appId, 'users', currentUser.uid, CHAR_COLLECTION), finalData).then(docRef => {
                    finalData.id = docRef.id;
                    if (setActiveAvatar) setActiveAvatar(finalData);
                    if (addLocalCharacter) addLocalCharacter(finalData);
                    UI.materializeEffect(); 
                    UI.addLog(`[SYSTEM]: VESSEL COLLAPSE COMPLETE. YOU ARE REAL.`, "var(--term-green)");
                    UI.addLog(`[TANDY]: You have a shape now. Good. But your signature is fragile... a stiff breeze could scatter you. Go to the Lore Archive and use the Tandem Terminal to 'login'. Anchor yourself.`, "#b084e8");
                    
                    // Set flag for new user hint after login
                    if (!currentUser || currentUser.isAnonymous) {
                        localStorage.setItem('awaitingNewUserHint', 'true');
                    }
                    
                    endWizard();
                }).catch(e => {
                    UI.addLog("[SYSTEM ERROR]: Failed to persist vessel.", "var(--term-red)");
                    console.error(e);
                    endWizard();
                });
            } else {
                endWizard();
            }
        }
        return;
    }

    // === 3. RESTORED ARCHITECT COMMANDS ===
    if (wizardState.type === 'item') {
        if (!currentVal) return;
        const room = apartmentMap[localPlayer.currentRoom];
        if (!room.items) room.items = [];
        room.items.push({ name: currentVal, type: "Constructed Object" });
        UI.addLog(`[SYSTEM]: Materialized [${currentVal}].`, "var(--term-green)");
        if (isSyncEnabled && updateMapListener) updateMapListener();
        endWizard();
        return;
    }

    if (wizardState.type === 'room') {
        if (currentVal) {
            apartmentMap[localPlayer.currentRoom].name = currentVal;
            apartmentMap[localPlayer.currentRoom].shortName = currentVal.substring(0, 7).toUpperCase();
            UI.addLog(`[SYSTEM]: Sector identity overwritten.`, "var(--term-green)");
            if (isSyncEnabled && updateMapListener) updateMapListener();
        }
        endWizard();
        return;
    }

    if (wizardState.type === 'lock_exit') {
        if (!currentVal) return;
        const dir = wizardState.pendingData.direction;
        const room = apartmentMap[localPlayer.currentRoom];
        const target = typeof room.exits[dir] === 'string' ? room.exits[dir] : room.exits[dir].target;
        room.exits[dir] = { target: target, locked: true, lockMsg: currentVal };
        UI.addLog(`[SYSTEM]: Exit ${dir.toUpperCase()} locked.`, "var(--term-amber)");
        if (isSyncEnabled && updateMapListener) updateMapListener();
        endWizard();
        return;
    }

    if (wizardState.type === 'expand') {
        if (!currentVal) return;
        const dir = wizardState.pendingData.direction;
        const newRoomId = 'room_' + crypto.randomUUID().split('-')[0];
        const getOpposite = (d) => ({'north':'south','north':'north','east':'west','west':'east'})[d] || 'out';
        
        apartmentMap[newRoomId] = {
            name: currentVal,
            shortName: currentVal.substring(0, 7).toUpperCase(),
            description: "A newly woven pocket of reality. It is waiting for definition.",
            visualPrompt: "An empty, newly constructed cyberpunk room, wireframe elements solidifying into reality.",
            exits: { [getOpposite(dir)]: localPlayer.currentRoom },
            items: [], npcs: []
        };
        
        apartmentMap[localPlayer.currentRoom].exits[dir] = newRoomId;
        UI.addLog(`[SYSTEM]: Reality expanded ${dir.toUpperCase()}.`, "var(--term-green)");
        if (isSyncEnabled && updateMapListener) updateMapListener();
        endWizard();
        return;
    }

    if (wizardState.type === 'auto_expand') {
         if (!currentVal) return;
         const dir = wizardState.pendingData.direction;
         UI.addLog(`[SYSTEM]: Handing seed phrase to the AI Architect...`, "var(--gm-purple)");
         try {
             const prompt = `Generate a room definition based on this seed: "${currentVal}". Stratum: ${localPlayer.stratum}. Respond strictly in JSON: {"name":"...","description":"...","visual_prompt":"..."}`;
             const res = await callGemini("Generate room", prompt);
             if (res && res.name) {
                 const newRoomId = 'room_' + crypto.randomUUID().split('-')[0];
                 const getOpposite = (d) => ({'north':'south','south':'north','east':'west','west':'east'})[d] || 'out';
                 
                 apartmentMap[newRoomId] = {
                     name: res.name,
                     shortName: res.name.substring(0, 7).toUpperCase(),
                     description: res.description,
                     visualPrompt: res.visual_prompt,
                     exits: { [getOpposite(dir)]: localPlayer.currentRoom },
                     items: [], npcs: []
                 };
                 
                 if (dir !== 'here') apartmentMap[localPlayer.currentRoom].exits[dir] = newRoomId;
                 UI.addLog(`[SYSTEM]: Sector generated.`, "var(--term-green)");
                 if (isSyncEnabled && updateMapListener) updateMapListener();
             }
         } catch(e) { UI.addLog("[SYSTEM ERROR]: Weave failed.", "var(--term-red)"); }
         endWizard();
         return;
    }

    if (wizardState.type === 'deploy_npc') {
        if (!currentVal) return;
        const room = apartmentMap[localPlayer.currentRoom];
        if (!room.npcs) room.npcs = [];
        
        const newNpc = {
            name: activeAvatar.name,
            archetype: activeAvatar.archetype,
            visualPrompt: activeAvatar.visual_prompt,
            image: activeAvatar.image,
            behavior: currentVal
        };
        room.npcs.push(newNpc);
        UI.addLog(`[SYSTEM]: Vessel detached and autonomous protocol initialized.`, "var(--term-amber)");
        if (isSyncEnabled && updateMapListener) updateMapListener();
        if (setActiveAvatar) setActiveAvatar(null);
        endWizard();
        return;
    }

    if (wizardState.type === 'create_npc') {
        if (wizardState.step === 1) {
            if (!currentVal) return;
            wizardState.pendingData.name = currentVal;
            UI.addLog(`[WIZARD]: Name logged. Enter Archetype (e.g., 'Vendor', 'Guard'):`, "var(--term-amber)");
            wizardState.step++;
        } else if (wizardState.step === 2) {
            if (!currentVal) return;
            wizardState.pendingData.archetype = currentVal;
            UI.addLog(`[WIZARD]: Archetype logged. Enter Visual Description:`, "var(--term-amber)");
            wizardState.step++;
        } else if (wizardState.step === 3) {
            if (!currentVal) return;
            wizardState.pendingData.visualPrompt = currentVal;
            UI.addLog(`[SYSTEM]: Compiling NPC...`, "var(--term-amber)");
            
            let npcImg = null;
            try {
                const b64 = await generatePortrait(wizardState.pendingData.visualPrompt, localPlayer.stratum);
                if (b64) {
                    const dataUrl = `data:image/png;base64,${b64}`;
                    npcImg = await compressImage(dataUrl, 512, 0.7);
                }
            } catch(e) {
                console.error("NPC render error:", e);
            }
            
            const newNpc = {
                name: wizardState.pendingData.name,
                archetype: wizardState.pendingData.archetype,
                visualPrompt: wizardState.pendingData.visualPrompt,
                image: npcImg,
                behavior: "Standing idle."
            };
            
            const room = apartmentMap[localPlayer.currentRoom];
            if (!room.npcs) room.npcs = [];
            room.npcs.push(newNpc);
            UI.addLog(`[SYSTEM]: Entity [${newNpc.name}] spawned successfully.`, "var(--term-green)");
            if (isSyncEnabled && updateMapListener) updateMapListener();
            endWizard();
        }
        return;
    }

    // === 4. TUTORIAL CYOA WIZARD ===
    if (wizardState.type === 'tutorial_cyoa') {
        if (wizardState.step === 1) {
            if (!currentVal) return;
            UI.addLog(`[SYSTEM]: Processing your action in the Astral Plane...`, "var(--gm-purple)");
            const prompt = `The player is in the Astral Plane (Astral stratum) in a cyberpunk world. They are facing a fragmented memory-entity. They decided to: "${currentVal}". Describe the atmospheric outcome in 2-3 sentences, and present ONE final obstacle or choice before they can stabilize their connection. Respond in plain text.`;
            try {
                const response = await callGemini("Process CYOA turn 1", prompt);
                UI.addLog(`[NARRATOR]: ${response}`, "#888");
                UI.addLog(`[WIZARD]: How do you proceed?`, "var(--term-amber)");
                wizardState.step++;
            } catch (e) {
                UI.addLog(`[SYSTEM ERROR]: The connection destabilized. Try your action again.`, "var(--term-red)");
            }
        } else if (wizardState.step === 2) {
            if (!currentVal) return;
            UI.addLog(`[SYSTEM]: Resolving final quantum state...`, "var(--gm-purple)");
            const prompt = `The player is completing a cyberpunk astral plane tutorial. Their final action is: "${currentVal}". Determine if they succeed. Respond STRICTLY in JSON: { "narrative": "A 2-sentence atmospheric conclusion.", "success": true or false }`;
            try {
                const responseStr = await callGemini("Process CYOA turn 2", prompt);
                
                // Gemini might return markdown JSON blocks, so we clean it up
                const cleanJson = responseStr.replace(/```json/g, '').replace(/```/g, '').trim();
                const response = JSON.parse(cleanJson);
                
                UI.addLog(`[NARRATOR]: ${response.narrative}`, "#888");
                
                if (response.success) {
                    UI.addLog(`[SYSTEM]: ANOMALY RESOLVED. REWARD DISTRIBUTED.`, "var(--term-green)");
                    localPlayer.inventory.push({ 
                        name: "Resonance Key", 
                        type: "Key Item", 
                        description: "A fractal shard of crystallized Meaning. It hums with the frequency of the front door." 
                    });
                    UI.addLog(`[TANDY]: You did it. You synthesized a Resonance Key. Now get to the kitchen and use it to open the front door.`, "#b084e8");
                } else {
                    UI.addLog(`[SYSTEM]: ANOMALY UNRESOLVED. YOU WERE EJECTED FROM THE ASTRAL PLANE.`, "var(--term-red)");
                    UI.addLog(`[TANDY]: That was close. The field collapsed. You'll need to tune the generator and try again when you're ready.`, "#b084e8");
                }
                
                // Update the inventory UI
                if (refreshAllUI) refreshAllUI();
                endWizard();
            } catch (e) {
                UI.addLog(`[SYSTEM ERROR]: The connection destabilized. Try your action again.`, "var(--term-red)");
            }
        }
        return;
    }

    // Fallback cancel
    UI.addLog("[WIZARD]: Protocol terminated.", "var(--term-amber)");
    endWizard();
}