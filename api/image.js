/**
 * Vercel Serverless Function: Image Proxy (Native Gemini 2.0 Edition)
 * Path: /api/image.js
 */

export default async function handler(req, res) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY is not configured in Vercel.' });
  }

  // --- GET: DIAGNOSTIC MODE ---
  if (req.method === 'GET') {
    try {
      const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
      const listRes = await fetch(listUrl);
      const listData = await listRes.json();
      return res.status(200).json(listData);
    } catch (e) {
      return res.status(500).json({ error: "Failed to list models." });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const incomingPayload = req.body;
    let promptText = "A lofi glitch terminal art piece.";
    
    // Extract prompt from whatever format the frontend sends
    if (incomingPayload.instances?.[0]?.prompt) {
      promptText = incomingPayload.instances[0].prompt;
    } else if (incomingPayload.contents?.[0]?.parts?.[0]?.text) {
      promptText = incomingPayload.contents[0].parts[0].text;
    }

    /**
     * GEMINI 2.0 NATIVE IMAGE GENERATION
     * Model: gemini-2.0-flash-exp-image-generation (from your LIST)
     * Endpoint: generateContent
     * Requirement: responseModalities must include BOTH ["TEXT", "IMAGE"]
     */
    const model = "gemini-2.0-flash-exp-image-generation";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const geminiPayload = {
      contents: [{
        parts: [{ text: `Generate an image based on this description: ${promptText}` }]
      }],
      generationConfig: {
        // Critical: Using both TEXT and IMAGE often bypasses the "modality not supported" error
        responseModalities: ["TEXT", "IMAGE"]
      }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiPayload)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini Native Image Error:", JSON.stringify(data, null, 2));
      return res.status(response.status).json({
        error: data.error?.message || "Source Generation Error",
        details: data
      });
    }

    // Native generation returns parts. We look for the part with inlineData (the image).
    const parts = data.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find(p => p.inlineData && p.inlineData.mimeType.startsWith('image/'));
    const base64Data = imagePart?.inlineData?.data;

    if (!base64Data) {
      // If no image was generated, check if the model sent a text explanation instead (like a safety block)
      const textPart = parts.find(p => p.text);
      return res.status(500).json({ 
        error: "The Source provided a response but no visual data.",
        reason: textPart?.text || "Unknown safety or modality restriction.",
        fullResponse: data 
      });
    }

    // Transform back to the "predictions" format the terminal (index.html) expects
    return res.status(200).json({
      predictions: [{ bytesBase64Encoded: base64Data }]
    });

  } catch (error) {
    console.error("Proxy execution error:", error);
    return res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
}
