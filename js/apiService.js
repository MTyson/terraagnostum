// js/apiService.js
const API_GENERATE = "/api/generate";
const API_IMAGE = "/api/image";

/**
 * GLOBAL COST CONTROL
 * Set this to true to suppress room generation costs during development.
 * In a professional CI/CD pipeline, this can be injected via build-time environment variables.
 */
const DISABLE_ROOM_GENERATION = false; 

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

export async function callGemini(userInput, systemPrompt) {
    try {
        const res = await fetch(API_GENERATE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ role: "user", parts: [{ text: userInput }] }],
                systemInstruction: { parts: [{ text: systemPrompt }] },
                generationConfig: { 
                    responseMimeType: "application/json",
                    temperature: 0.7 
                }
            })
        });

        const data = await res.json();
        let text = data.candidates[0].content.parts[0].text;

        // CRITICAL: Scrub markdown backticks and trailing garbage.
        const firstBrace = text.indexOf('{');
        const lastBrace = text.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1) {
            text = text.substring(firstBrace, lastBrace + 1);
        }

        try {
            return JSON.parse(text);
        } catch (initialError) {
            // Aggressive recursive parsing for partial JSON returns
            for (let i = lastBrace; i > firstBrace; i--) {
                if (text[i - firstBrace] === '}') {
                    try {
                        const candidate = text.substring(0, i - firstBrace + 1);
                        return JSON.parse(candidate);
                    } catch (e) {
                        // Keep trying smaller segments
                    }
                }
            }
            throw initialError;
        }
    } catch (e) {
        console.error("Gemini API Parse Error:", e);
        return null;
    }
}

export async function projectVisual(prompt, stratum, addLogCallback, pinnedViewUrl = null) {
    if (pinnedViewUrl) return pinnedViewUrl;

    // --- COST CONTROL INTERCEPT ---
    if (DISABLE_ROOM_GENERATION) {
        if (addLogCallback) addLogCallback("[SYSTEM]: Room generation suppressed. Reality buffer standby...", "var(--term-amber)");
        return "https://placehold.co/1024x512/051505/4ade80.png?text=REALITY_BUFFER_STANDBY";
    }

    const envStyleMap = {
        'technate': 'clinical brutalism, sterile white-on-cyan, severe geometric architecture, dystopian corporation, high contrast, oppressive',
        'mundane': 'gritty 1980s cyberpunk, claustrophobic dystopian sci-fi, Neuromancer aesthetic, dark and dirty, decaying, exposed wiring, CRT glow, heavy VHS tracking noise, indoors, enclosed architecture',
        'faen': 'dark surrealism, ethereal watercolor, fluid glitch-art, twisted nature, psychic resonance',
        'astral': 'abstract fractal, non-euclidean geometry, cosmic horror, shimmering neon purple and gold static'
    };
    const style = envStyleMap[stratum?.toLowerCase()] || envStyleMap.mundane;
    
    // Ensure vibrant, full-color rendering and lock the perspective.
    const styledPrompt = `Cinematic interior shot, highly detailed, vibrant full color. DO NOT INCLUDE PEOPLE UNLESS EXPLICITLY REQUESTED. Subject: [ ${prompt} ]. Atmosphere and rendering style MUST BE: ${style}. Claustrophobic, indoors, enclosed.`;

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

export async function generatePortrait(prompt, stratum) {
    const styleMap = {
        'technate': 'clinical brutalism, high-key lighting, geometric, vibrant cyan and electric violet accents',
        'mundane': 'gritty 1980s cyberpunk, high-saturation neon, heavy rain, chrome reflections, vibrant pink and teal lighting, VHS glitch',
        'faen': 'surrealist, dream-like, watercolor glitch, ethereal, prismatic colors',
        'astral': 'abstract fractal, shimmering, non-euclidean geometry, cosmic nebula colors'
    };
    const style = styleMap[stratum?.toLowerCase()] || styleMap.mundane;
    
    // HIGH FIDELITY CHARACTER PROMPT
    // Focuses strictly on personhood to prevent the model from drifting into cityscapes.
    const combinedPrompt = `Masterpiece digital painting, hyper-vibrant full color, high saturation, MTG card art style. 
        SUBJECT: A close-up high-end character portrait of a humanoid person. 
        Focus on face, eyes, and clothing. NO BUILDINGS. NO EXTERIORS. 
        Aesthetic: ${style}. 
        Character Details: ${prompt}`;
    
    try {
        const res = await fetch(API_IMAGE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ instances: [{ prompt: combinedPrompt }] })
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        if (data.predictions && data.predictions[0]) {
            return data.predictions[0].bytesBase64Encoded;
        }
    } catch (e) { 
        console.error("Portrait Generation Error:", e); 
    }
    return null;
}