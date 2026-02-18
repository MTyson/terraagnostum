/**
 * Vercel Serverless Function: Image Proxy (Gemini 2.0 Native Edition)
 * Path: /api/image.js
 * * This version respects the "Native Image Generation" specs for Gemini 2.0:
 * - Uses :generateContent endpoint
 * - Uses responseModalities: ["IMAGE"]
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
    
    // Support both 'instances' (legacy) and 'contents' (standard) formats
    if (incomingPayload.instances?.[0]?.prompt) {
      promptText = incomingPayload.instances[0].prompt;
    } else if (incomingPayload.contents?.[0]?.parts?.[0]?.text) {
      promptText = incomingPayload.contents[0].parts[0].text;
    }

    /**
     * NATIVE IMAGE GENERATION SPECS:
     * Model: gemini-2.0-flash-exp-image-generation
     * Endpoint: :generateContent
     * Config: responseModalities: ["IMAGE"]
     */
    const model = "gemini-2.0-flash-exp-image-generation";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const geminiPayload = {
      contents: [
        {
          parts: [
            { text: promptText }
          ]
        }
      ],
      generationConfig: {
        // As per Google Dev Blog: 'IMAGE' is the required modality
        responseModalities: ["IMAGE"]
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
        details: data
      });
    }

    /**
     * NATIVE RESPONSE PARSING:
     * The image is returned as a part with inlineData containing the base64.
     */
    const parts = data.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find(p => p.inlineData && p.inlineData.mimeType.startsWith('image/'));
    const base64Data = imagePart?.inlineData?.data;

    if (!base64Data) {
      return res.status(500).json({ 
        error: "The Source completed the request but returned no visual part.",
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
