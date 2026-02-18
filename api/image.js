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
     * "gemini-2.0-flash-exp-image-generation" is an Imagen-style model.
     * It requires the ":predict" endpoint, NOT ":generateContent".
     */
    const model = "gemini-2.0-flash-exp-image-generation";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${apiKey}`;

    try {
      const incomingPayload = req.body;
      
      // Extract prompt from the "instances" format sent by the frontend
      let promptText = "A lofi glitch terminal art piece.";
      if (incomingPayload.instances && incomingPayload.instances[0]?.prompt) {
        promptText = incomingPayload.instances[0].prompt;
      } else if (incomingPayload.contents) {
        promptText = incomingPayload.contents[0].parts[0].text;
      }

      /**
       * PREDICT PAYLOAD:
       * This model expects "instances" containing the prompt.
       */
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
        headers: { 
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(predictPayload)
      });

      const data = await response.json();

      if (!response.ok) {
        console.error("Imagen Predict API Error:", JSON.stringify(data, null, 2));
        return res.status(response.status).json(data);
      }

      /**
       * PREDICT RESPONSE:
       * The output is usually at predictions[0].bytesBase64Encoded.
       */
      const base64Data = data.predictions?.[0]?.bytesBase64Encoded;

      if (!base64Data) {
        return res.status(500).json({ 
          error: "No image data returned from source.",
          details: data 
        });
      }

      // Return in the format the frontend expects
      return res.status(200).json({
        predictions: [{ bytesBase64Encoded: base64Data }]
      });
    } catch (error) {
      console.error("Proxy execution error:", error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
