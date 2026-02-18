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
     * MODEL PIVOT:
     * We are switching to the dedicated Imagen 3.0 model.
     * This model requires the ":predict" endpoint and an "instances" payload.
     */
    const model = "imagen-3.0-generate-001";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${apiKey}`;

    try {
      const incomingPayload = req.body;
      
      let promptText = "A lofi glitch terminal art piece.";
      
      // Handle different possible frontend payload structures
      if (incomingPayload.instances && incomingPayload.instances[0]?.prompt) {
        promptText = incomingPayload.instances[0].prompt;
      } else if (incomingPayload.contents && incomingPayload.contents[0]?.parts[0]?.text) {
        promptText = incomingPayload.contents[0].parts[0].text;
      }

      // Payload structure required for Imagen predict endpoint
      const predictPayload = {
        instances: [
          {
            prompt: promptText
          }
        ],
        parameters: {
          sampleCount: 1,
          aspectRatio: "1:1",
          outputMimeType: "image/png"
        }
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(predictPayload)
      });

      const data = await response.json();

      if (!response.ok) {
        console.error("Imagen API Error:", JSON.stringify(data, null, 2));
        return res.status(response.status).json({
          error: data.error?.message || "Imagen Source Error",
          code: data.error?.code,
          status: data.error?.status,
          detailedError: data
        });
      }

      // Imagen returns data in predictions[0].bytesBase64Encoded
      const base64Data = data.predictions?.[0]?.bytesBase64Encoded;

      if (!base64Data) {
        return res.status(500).json({ 
          error: "No image data returned from Imagen source.",
          details: data 
        });
      }

      // Return in the format the frontend (index.html) expects
      return res.status(200).json({
        predictions: [{ bytesBase64Encoded: base64Data }]
      });
    } catch (error) {
      console.error("Proxy execution error:", error);
      return res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
