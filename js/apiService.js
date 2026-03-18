// js/apiService.js
const API_GENERATE = "/api/generate";
const API_IMAGE = "/api/image";

const RESPONSE_SCHEMA = {
    type: "object",
    properties: {
        narrative: { type: "string" },
        speaker: { type: "string" },
        color: { type: "string" },
        suggested_actions: { type: "array", items: { type: "string" } },
        combat_active: { type: "boolean" },
        damage_to_player: { type: "number" },
        damage_to_npc: { type: "number" },
        astral_jump: { type: "boolean" },
        trigger_stratum_shift: { type: "string" },
        give_item: {
            type: "object",
            properties: {
                name: { type: "string" },
                type: { type: "string" },
                description: { type: "string" }
            }
        },
        trigger_respawn: { type: "boolean" },
        trigger_teleport: {
            type: "object",
            properties: {
                new_room_id: { type: "string" },
                name: { type: "string" },
                description: { type: "string" },
                visualPrompt: { type: "string" }
            }
        },
        create_lore: {
            type: "object",
            properties: {
                title: { type: "string" },
                content: { type: "string" },
                significance: { type: "string" }
            }
        },
        world_edit: {
            type: "object",
            properties: {
                type: { 
                    type: "string", 
                    description: "Select ONE action to alter the world state. Do not invent new types.",
                    enum: ["add_marginalia", "unlock_exit", "spawn_item", "spawn_npc", "none"] 
                },
                text: { type: "string" },
                direction: { type: "string" },
                item: {
                    type: "object",
                    properties: {
                        name: { type: "string" },
                        type: { type: "string" },
                        description: { type: "string" }
                    }
                },
                npc: {
                    type: "object",
                    properties: {
                        name: { type: "string" },
                        archetype: { type: "string" },
                        personality: { type: "string" },
                        visual_prompt: { type: "string" },
                        stats: {
                            type: "object",
                            properties: {
                                WILL: { type: "number" },
                                AWR: { type: "number" },
                                PHYS: { type: "number" },
                                AMN: { type: "number" }
                            }
                        }
                    }
                }
            }
        }
    },
    required: ["narrative", "speaker", "suggested_actions", "combat_active"]
};

/**
 * GLOBAL COST CONTROL
 * Set this to true to suppress room generation costs during development.
 * In a professional CI/CD pipeline, this can be injected via build-time environment variables.
 * Linked to window.DISABLE_ROOM_GENERATION for global state.
 */
const getDisableFlag = () => window.DISABLE_ROOM_GENERATION || false;

export async function fetchSystemConfig() {
    try {
        const res = await fetch(API_IMAGE);
        if (res.ok) {
            const data = await res.json();
            if (data.disableGen !== undefined) {
                window.DISABLE_ROOM_GENERATION = data.disableGen;
                if (data.disableGen) {
                    console.log("[SYSTEM]: Room generation is disabled by server environment.");
                }
            }
        }
    } catch (e) {
        console.warn("[SYSTEM]: Failed to fetch system config.", e);
    }
}

/**
 * Compresses an image data URI to prevent Firestore document size limits.
 */
export async function compressImage(base64Str, maxWidth = 400, quality = 0.7) {
    return new Promise((resolve) => {
        const img = new Image();
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
        img.src = base64Str;
    });
}

export async function callGemini(userInput, systemPrompt, customSchema = RESPONSE_SCHEMA) {
    try {
        const body = {
            contents: [{ role: "user", parts: [{ text: userInput }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] },
            generationConfig: { 
                temperature: 0.7 
            }
        };

        if (customSchema) {
            body.generationConfig.responseMimeType = "application/json";
            body.generationConfig.responseSchema = customSchema;
        } else {
            body.generationConfig.responseMimeType = "text/plain";
        }

        const res = await fetch(API_GENERATE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        const data = await res.json();
        const text = data.candidates[0].content.parts[0].text;

        if (!customSchema) return text;

        try {
            let cleanedText = text.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
            return JSON.parse(cleanedText);
        } catch (e) {
            console.error("Gemini Structured Output Parse Error:", e, text);
            return text; // Fallback to raw text if parsing fails
        }
    } catch (e) {
        console.error("Gemini API Parse Error:", e);
        return null;
    }
}

export async function projectVisual(prompt, stratum, addLogCallback, pinnedViewUrl = null, strata = {}, roomName = "") {
    if (pinnedViewUrl) return pinnedViewUrl;

    // --- COST CONTROL INTERCEPT ---
    if (getDisableFlag()) {
        if (addLogCallback) addLogCallback("[SYSTEM]: Room generation suppressed. Reality buffer standby...", "var(--term-amber)");
        return "https://placehold.co/1024x512/051505/4ade80.png?text=REALITY_BUFFER_STANDBY";
    }

    const dynamicStratum = strata[stratum?.toLowerCase()];
    let style = dynamicStratum?.visualStyle;

    if (!style) {
        const envStyleMap = {
            'technate': 'clinical brutalism, sterile white-on-cyan, severe geometric architecture, dystopian corporation, high contrast, oppressive',
            'mundane': 'gritty 1980s cyberpunk, claustrophobic dystopian sci-fi, Neuromancer aesthetic, dark and dirty, decaying, exposed wiring, CRT glow, heavy VHS tracking noise, indoors, enclosed architecture',
            'faen': 'dark surrealism, ethereal watercolor, fluid glitch-art, twisted nature, psychic resonance',
            'astral': 'abstract fractal, non-euclidean geometry, cosmic horror, shimmering neon purple and gold static'
        };
        style = envStyleMap[stratum?.toLowerCase()] || envStyleMap.mundane;
    }
    
    // Ensure vibrant, full-color rendering and lock the perspective.
    const gameContext = "This is a multi-planar RPG adventure game.";
    const subjectLine = roomName ? `Subject: [ ${roomName} ] - ${prompt}` : `Subject: ${prompt}`;
    
    const styledPrompt = `${gameContext} Cinematic interior shot of a room, highly detailed, vibrant full color. DO NOT INCLUDE PEOPLE. 
        Main ${subjectLine}. 
        Atmosphere and rendering style: ${style}. 
        Details: claustrophobic, indoors, enclosed, high fidelity, 8k resolution, cinematic lighting.`;

    try {
        const res = await fetch(API_IMAGE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ instances: [{ prompt: styledPrompt }] })
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        if (data.predictions && data.predictions[0]) {
            return data.predictions[0].bytesBase64Encoded;
        }
    } catch (e) { 
        console.error("Image Projection Error:", e); 
    }
    return null;
}

export async function generatePortrait(prompt, stratum, strata = {}) {
    const dynamicStratum = strata[stratum?.toLowerCase()];
    const flavor = dynamicStratum?.flavor || "near-future real-world critty retro-futuristic cyberpunk influenced by either high-sci-fi or high-fantasy";

    // HIGH FIDELITY CHARACTER PROMPT
    // Focuses strictly on personhood to prevent the model from drifting into cityscapes.
    const combinedPrompt = `Masterpiece digital portrait, hyper-vibrant full color, high saturation, MTG card art style. 
        SUBJECT: A close-up high-end character portrait of a humanoid person. 
        Focus on face, eyes, and clothing. NO BUILDINGS. NO EXTERIORS. 
        Aesthetic: ${flavor}. 
        Give the portrait a bit of glitchy, retro-futuristic finish (like the image itself is slightly corrupted or has a digital overlay).
        Character Details: ${prompt}`;
    
    try {
        const res = await fetch(API_IMAGE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ instances: [{ prompt: combinedPrompt }] })
        });

        if (!res.ok) {
            let errorMsg = `HTTP ${res.status}`;
            try {
                const errorData = await res.json();
                if (errorData.error) errorMsg += ` - ${errorData.error}`;
                if (errorData.details) errorMsg += ` - ${JSON.stringify(errorData.details)}`;
            } catch (e) {}
            throw new Error(errorMsg);
        }

        const data = await res.json();
        if (data.predictions && data.predictions[0]) {
            return data.predictions[0].bytesBase64Encoded;
        }
    } catch (e) { 
        console.error("Portrait Generation Error:", e); 
    }
    return null;
}