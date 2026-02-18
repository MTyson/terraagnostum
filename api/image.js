/**
 * Vercel Serverless Function: Image Proxy (Imagen Predict Edition)
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
  async function fetchWithRetry(url, options, retries = 3, backoff = 2000) {
    try {
      const response = await fetch(url, options);
      const data = await response.json();

      if (response.status === 429 && retries > 0) {
        await new Promise(resolve => setTimeout(resolve, backoff));
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

    /**
     * IMAGEN PREDICT STRATEGY
     * We use the specific image-generation model identifier found in your list.
     * This requires the :predict endpoint.
     */
    const model = "gemini-2.0-flash-exp-image-generation";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${apiKey}`;

    const { response, data } = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt: promptText }],
        parameters: { sampleCount: 1 }
      })
    });

    if (!response.ok) {
      // Check for billing errors specifically to help debug the AI Studio issue
      if (data.error?.message?.includes("billed users")) {
        return res.status(403).json({
          error: "BILLING_REQUIRED",
          message: "The Source requires a Pay-As-You-Go plan in AI Studio to project visuals.",
          details: data
        });
      }

      return res.status(response.status).json({
        error: data.error?.message || "Source Error",
        details: data
      });
    }

    // Extraction for Imagen-style response
    const base64Data = data.predictions?.[0]?.bytesBase64Encoded;

    if (!base64Data) {
      return res.status(500).json({ 
        error: "The Source returned success but no binary image data.",
        details: data 
      });
    }

    return res.status(200).json({
      predictions: [{ bytesBase64Encoded: base64Data }]
    });

  } catch (error) {
    console.error("Proxy execution error:", error);
    return res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
}
