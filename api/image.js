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

  // Exponential Backoff Fetch Helper
  async function fetchWithRetry(url, options, retries = 5, backoff = 1000) {
    try {
      const response = await fetch(url, options);
      const data = await response.json();

      // If rate limited or quota exceeded, retry unless we are out of attempts
      if (response.status === 429 && retries > 0) {
        const delay = backoff;
        await new Promise(resolve => setTimeout(resolve, delay));
        return fetchWithRetry(url, options, retries - 1, backoff * 2);
      }
      return { response, data };
    } catch (error) {
      if (retries > 0) {
        await new Promise(resolve => setTimeout(resolve, backoff));
        return fetchWithRetry(url, options, retries - 1, backoff * 2);
      }
      throw error;
    }
  }

  try {
    const incomingPayload = req.body;
    let promptText = "A lofi glitch terminal art piece.";
    
    if (incomingPayload.instances?.[0]?.prompt) {
      promptText = incomingPayload.instances[0].prompt;
    } else if (incomingPayload.contents?.[0]?.parts?.[0]?.text) {
      promptText = incomingPayload.contents[0].parts[0].text;
    }

    // We'll try the experimental model first, then the stable one
    const modelsToTry = [
      "gemini-2.0-flash-exp-image-generation",
      "gemini-2.0-flash"
    ];

    let lastError = null;

    for (const model of modelsToTry) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const geminiPayload = {
        contents: [{
          parts: [{ text: `Generate an image based on this description: ${promptText}` }]
        }],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"]
        }
      };

      const { response, data } = await fetchWithRetry(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiPayload)
      });

      if (response.ok) {
        const parts = data.candidates?.[0]?.content?.parts || [];
        const imagePart = parts.find(p => p.inlineData && p.inlineData.mimeType.startsWith('image/'));
        const base64Data = imagePart?.inlineData?.data;

        if (base64Data) {
          return res.status(200).json({
            predictions: [{ bytesBase64Encoded: base64Data }]
          });
        }
      }

      lastError = data;
      // If it's a 404, we move to the next model immediately. 
      // If it's a 429/403, we try the next model too.
    }

    // If we reach here, all attempts failed
    const isQuota = lastError?.error?.status === "RESOURCE_EXHAUSTED";
    return res.status(isQuota ? 429 : 500).json({
      error: isQuota ? "Source Quota Exceeded" : "Generation Failed",
      message: lastError?.error?.message || "All models failed to respond.",
      details: lastError
    });

  } catch (error) {
    console.error("Proxy execution error:", error);
    return res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
}
