// js/apiService.js

const API_GENERATE = "/api/generate";
const API_IMAGE = "/api/image";

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
    const res = await fetch(API_GENERATE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: userInput }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] },
            generationConfig: { responseMimeType: "application/json" }
        })
    });
    
    if (!res.ok) {
        let errorMessage = "Unknown API Error";
        try {
            const errorData = await res.json();
            errorMessage = errorData.error?.message || JSON.stringify(errorData);
        } catch (e) {
             errorMessage = `HTTP Error ${res.status}: ${res.statusText}`;
        }
        throw new Error(`Gemini API Error: ${errorMessage}`);
    }

    const data = await res.json();
    return JSON.parse(data.candidates[0].content.parts[0].text);
}

// Generates the image or returns the base64 string for processing
export async function projectVisual(prompt, stratum, addLogCallback, pinnedViewUrl = null) {
    // If an Architect has pinned a view for this room, skip AI entirely!
    if (pinnedViewUrl) {
        if (addLogCallback) addLogCallback(`[SYSTEM]: Retrieving Architect-pinned memory for this sector...`, "var(--term-green)");
        return pinnedViewUrl; // Return the URL directly
    }

    const styledPrompt = `Lofi glitch terminal art: ${prompt}. ${stratum} stratum aesthetic`;

    try {
        const res = await fetch(API_IMAGE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ instances: [{ prompt: styledPrompt }] })
        });
        
        if (!res.ok) throw new Error(`Image API returned status ${res.status}`);

        const data = await res.json();
        if (data.predictions && data.predictions[0]) {
            const b64 = data.predictions[0].bytesBase64Encoded;
            if (addLogCallback) addLogCallback(`VISUAL BUFFER PULSED.`, "var(--term-amber)");
            return b64; 
        }
    } catch (e) { 
        console.error("Image Projection Error:", e);
        if (addLogCallback) addLogCallback("VISUAL BUFFER ERROR", "var(--term-red)"); 
    }
    return null;
}

export async function generatePortrait(prompt, stratum) {
    const combinedPrompt = `Highly detailed character portrait, ${stratum} aesthetic, Magic the Gathering card art style: ${prompt}`;
    try {
        const res = await fetch(API_IMAGE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ instances: [{ prompt: combinedPrompt }] })
        });
        
        if (!res.ok) throw new Error(`Image API returned status ${res.status}`);

        const data = await res.json();
        if (data.predictions && data.predictions[0]) {
            return data.predictions[0].bytesBase64Encoded;
        }
    } catch (e) { 
        console.error("Portrait Generation Error:", e);
    }
    return null;
}
