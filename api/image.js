/**
 * Vercel Serverless Function: Universal Image Proxy
 * DEFAULT: Imagen 4 Fast ($0.02 / Image)
 * Path: /api/image.js
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Explicitly load .env.local for local development if not in production
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
} else {
    dotenv.config();
}

export default async function handler(req, res) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("CRITICAL: GEMINI_API_KEY is missing from environment.");
    return res.status(500).json({ error: 'GEMINI_API_KEY is not configured. Check your .env file.' });
  }

  /**
   * ENGINE SELECTION
   * DEFAULT: 'imagen' (Imagen 4 Fast)
   * To use Nano Banana, set IMAGE_ENGINE=nano in your Vercel/env settings.
   */
  const imageEngine = (process.env.IMAGE_ENGINE || 'imagen').toLowerCase(); //

  // --- GET: DIAGNOSTIC MODE ---
  if (req.method === 'GET') {
    const disableEnv = process.env.DISABLE_ROOM_GENERATION;
    const isRoomDisable = disableEnv === 'true' || disableEnv === true || (disableEnv && String(disableEnv).trim().toLowerCase() === 'true');
    return res.status(200).json({ 
      status: "Active",
      activeEngine: imageEngine,
      disableGen: isRoomDisable,
      message: "Send a POST request to generate an image. Rooms may be blocked by DISABLE_ROOM_GENERATION." 
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const incomingPayload = req.body;
    let promptText = "A lofi glitch terminal art piece.";
    
    // Safely extract the prompt text no matter what format the frontend sends
    if (incomingPayload.instances?.[0]?.prompt) {
      promptText = incomingPayload.instances[0].prompt;
    } else if (incomingPayload.contents?.[0]?.parts?.[0]?.text) {
      promptText = incomingPayload.contents[0].parts[0].text;
    }

    // --- DEV MODE ROOM BLOCK ---
    // Only block if DISABLE_ROOM_GENERATION is true AND it's a room prompt (not a portrait)
    const disableEnv = process.env.DISABLE_ROOM_GENERATION;
    const isRoomDisable = disableEnv === 'true' || disableEnv === true || (disableEnv && String(disableEnv).trim().toLowerCase() === 'true');
    const isPortrait = promptText.toLowerCase().includes("portrait") || promptText.toLowerCase().includes("character portrait");

    if (isRoomDisable && !isPortrait) {
      return res.status(200).json({ 
        predictions: [{ bytesBase64Encoded: null }],
        info: "DEV MODE: Room image generation is disabled via environment variable."
      });
    }

    let url, finalPayload;

    if (imageEngine === 'imagen') {
      /**
       * ENGINE 1: IMAGEN 4 FAST ($0.02 / Image)
       * Uses the :predict endpoint and instances/parameters structure.
       */
      const model = "imagen-4.0-fast-generate-001";
      url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${apiKey}`;
      finalPayload = {
        instances: [{ prompt: promptText }],
        parameters: { sampleCount: 1 }
      };
    } else {
      /**
       * ENGINE 2: NANO BANANA 2 (Gemini 3.1 Flash Image)
       * Uses the :generateContent endpoint and multimodal contents structure.
       */
      const model = "gemini-3.1-flash-image-preview";
      url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      finalPayload = {
        contents: [
          { parts: [{ text: promptText }] }
        ],
        // Required to force image output instead of text descriptions
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"]
        }
      };
    }

    // Execute the request to the Google API
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(finalPayload)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error(`[${imageEngine.toUpperCase()}] Error:`, JSON.stringify(data, null, 2));
      return res.status(response.status).json({
        error: data.error?.message || "Source Generation Error",
        engine: imageEngine,
        details: data
      });
    }

    /**
     * RESPONSE EXTRACTION
     * Normalizes the response so the frontend apiService.js always receives 
     * the exact format it expects.
     */
    let base64Data = null;
    let textResponseMetadata = null;

    if (imageEngine === 'imagen') {
      base64Data = data.predictions?.[0]?.bytesBase64Encoded; //
    } else {
      const parts = data.candidates?.[0]?.content?.parts || [];
      const imagePart = parts.find(p => p.inlineData && p.inlineData.mimeType.startsWith('image/'));
      base64Data = imagePart?.inlineData?.data; //
      textResponseMetadata = parts.find(p => p.text)?.text; 
    }

    if (!base64Data) {
      console.warn(`[${imageEngine.toUpperCase()}] No image data found.`);
      return res.status(500).json({ 
        error: `The ${imageEngine} model returned a response but no visual data was found.`,
        textMetadata: textResponseMetadata,
        details: data 
      });
    }

    // Return in the unified format required by apiService.js
    return res.status(200).json({
      predictions: [{ bytesBase64Encoded: base64Data }]
    });

  } catch (error) {
    console.error("Proxy execution error:", error);
    return res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
}