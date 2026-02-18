/**
 * Vercel Serverless Function: Image Proxy (Gemini 2.0 Native Edition)
 * Path: /api/image.js
 * * Spec: https://developers.googleblog.com/experiment-with-gemini-20-flash-native-image-generation/
 * * This version is optimized for a billed/pay-as-you-go AI Studio project.
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
    
    // Support both 'instances' and 'contents' formats for maximum frontend compatibility
    if (incomingPayload.instances?.[0]?.prompt) {
      promptText = incomingPayload.instances[0].prompt;
    } else if (incomingPayload.contents?.[0]?.parts?.[0]?.text) {
      promptText = incomingPayload.contents[0].parts[0].text;
    }

    /**
     * NATIVE IMAGE GENERATION SPECS (REFINED)
     * Model: gemini-2.0-flash-exp-image-generation
     * Endpoint: generateContent
     * * FIX: Many tiers currently require ["TEXT", "IMAGE"] even for the 
     * image-generation specific model to prevent the 400 Modality error.
     */
    const model = "gemini-2.0-flash-exp-image-generation";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const geminiPayload = {
      contents: [{
        parts: [{ text: `Generate a high-fidelity visual for the following prompt: ${promptText}` }]
      }],
      generationConfig: {
        // Including TEXT alongside IMAGE is the documented fix for the 400 error
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
      console.error("Native Gen Error:", JSON.stringify(data, null, 2));
      return res.status(response.status).json({
        error: data.error?.message || "Source Generation Error",
        code: response.status,
        details: data
      });
    }

    /**
     * NATIVE RESPONSE PARSING:
     * We filter parts to find the image. Since we requested TEXT as well,
     * there may be multiple parts in the candidate.
     */
    const parts = data.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find(p => p.inlineData && p.inlineData.mimeType.startsWith('image/'));
    const base64Data = imagePart?.inlineData?.data;

    if (!base64Data) {
      const textResponse = parts.find(p => p.text)?.text;
      return res.status(500).json({ 
        error: "The Source returned a text response but no visual part.",
        textMetadata: textResponse,
        details: data 
      });
    }

    // Return in the format index.html expects (predictions array)
    return res.status(200).json({
      predictions: [{ bytesBase64Encoded: base64Data }]
    });

  } catch (error) {
    console.error("Proxy execution error:", error);
    return res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
}
