/**
 * Vercel Serverless Function: Imagen Proxy (Fallback Version)
 * Path: /api/image.js
 * * This version pivots from the restricted Imagen 4.0 endpoint to 
 * gemini-2.5-flash-image-preview, which is typically available 
 * on the AI Studio free tier.
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY is not configured in Vercel.' });
  }

  // Pivoting to the modality-based generation model
  const model = "gemini-2.5-flash-image-preview";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  try {
    const incomingPayload = req.body;
    
    // Extract prompt from the "instances" format sent by the frontend
    const promptText = incomingPayload.instances?.[0]?.prompt || "A glitchy digital terminal landscape";

    // Reformat payload for gemini-2.5-flash-image-preview
    const geminiPayload = {
      contents: [
        {
          parts: [{ text: promptText }]
        }
      ],
      generationConfig: {
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
      console.error("Gemini Image Error:", JSON.stringify(data, null, 2));
      return res.status(response.status).json(data);
    }

    // Extract the base64 image data from the parts
    const imagePart = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
    const base64Data = imagePart?.inlineData?.data;

    if (!base64Data) {
      return res.status(500).json({ error: "The Source failed to generate a visual projection." });
    }

    /**
     * Translate the response back to the format the frontend expects 
     * (the Imagen "predictions" format) so we don't have to edit index.html
     */
    const legacyFormattedResponse = {
      predictions: [
        {
          bytesBase64Encoded: base64Data
        }
      ]
    };

    return res.status(200).json(legacyFormattedResponse);
  } catch (error) {
    console.error("Proxy execution error:", error);
    return res.status(500).json({ error: 'Internal Server Error while communicating with the Image Source.' });
  }
}
