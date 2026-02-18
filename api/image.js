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

  // --- POST: GENERATION MODE ---
  if (req.method === 'POST') {
    /**
     * TARGET MODEL: gemini-2.0-flash-exp-image-generation
     * This model was found in your ListModels output. 
     * It is an Imagen-based model that requires the :predict endpoint.
     */
    const model = "gemini-2.0-flash-exp-image-generation";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${apiKey}`;

    try {
      const incomingPayload = req.body;
      let promptText = "A lofi glitch terminal art piece.";
      
      if (incomingPayload.instances && incomingPayload.instances[0]?.prompt) {
        promptText = incomingPayload.instances[0].prompt;
      } else if (incomingPayload.contents && incomingPayload.contents[0]?.parts[0]?.text) {
        promptText = incomingPayload.contents[0].parts[0].text;
      }

      // Minimal payload for the :predict endpoint
      const predictPayload = {
        instances: [
          { prompt: promptText }
        ],
        parameters: {
          sampleCount: 1
        }
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(predictPayload)
      });

      const data = await response.json();

      if (!response.ok) {
        // Log the specific error to help distinguish between 403 (Billing) and 400 (Syntax)
        return res.status(response.status).json({
          error: data.error?.message || "Source Error",
          code: data.error?.code,
          status: data.error?.status,
          detailedError: data
        });
      }

      // Extract the Base64 string from the Google response
      const base64Data = data.predictions?.[0]?.bytesBase64Encoded;

      if (!base64Data) {
        return res.status(500).json({ 
          error: "The Source returned a success code but no image data (Base64 string).",
          details: data 
        });
      }

      // Return the JSON object containing the Base64 string to the frontend
      return res.status(200).json({
        predictions: [{ bytesBase64Encoded: base64Data }]
      });
    } catch (error) {
      return res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
