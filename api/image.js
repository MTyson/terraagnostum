/**
 * Vercel Serverless Function: Image Proxy
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

  const incomingPayload = req.body;
  let promptText = "A lofi glitch terminal art piece.";
  if (incomingPayload.instances && incomingPayload.instances[0]?.prompt) {
    promptText = incomingPayload.instances[0].prompt;
  } else if (incomingPayload.contents && incomingPayload.contents[0]?.parts[0]?.text) {
    promptText = incomingPayload.contents[0].parts[0].text;
  }

  /**
   * FALLBACK STRATEGY:
   * 1. Try Imagen 3.0 via :predict (Native Image Model)
   * 2. Fallback to Gemini 2.0 Flash EXP via :generateContent (Multimodal Output)
   * * Note: The "exp" version is crucial here because the stable 2.0-flash often
   * has image modality generation restricted in the v1beta gate.
   */
  
  async function tryImagen() {
    const model = "imagen-3.0-generate-001";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt: promptText }],
        parameters: { sampleCount: 1 }
      })
    });
    return response;
  }

  async function tryGeminiMultimodal() {
    // Switching to the -exp suffix to bypass the modality restriction
    const model = "gemini-2.0-flash-exp";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: promptText }] }],
        generationConfig: { responseModalities: ["IMAGE"] }
      })
    });
    return response;
  }

  try {
    // Attempt 1: Imagen
    let response = await tryImagen();
    let data = await response.json();

    // If Imagen fails with 404 or Billing errors, try Gemini Multimodal
    if (!response.ok && (response.status === 404 || data.error?.message?.includes("billed users"))) {
      console.log("Imagen failed, attempting Gemini Multimodal fallback...");
      response = await tryGeminiMultimodal();
      data = await response.json();
    }

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error?.message || "Source Error",
        details: data
      });
    }

    // Extraction logic based on which model responded
    let base64Data = null;
    
    // Check Imagen format
    if (data.predictions?.[0]?.bytesBase64Encoded) {
      base64Data = data.predictions[0].bytesBase64Encoded;
    } 
    // Check Gemini format
    else if (data.candidates?.[0]?.content?.parts) {
      const part = data.candidates[0].content.parts.find(p => p.inlineData);
      base64Data = part?.inlineData?.data;
    }

    if (!base64Data) {
      return res.status(500).json({ error: "No image data in Source response.", details: data });
    }

    return res.status(200).json({
      predictions: [{ bytesBase64Encoded: base64Data }]
    });

  } catch (error) {
    return res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
}
