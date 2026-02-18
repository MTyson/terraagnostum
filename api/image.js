/**
 * Vercel Serverless Function: Imagen Proxy
 * Path: /api/image.js
 * * This proxy handles requests to the Imagen 4.0 model.
 * It expects a JSON body with an "instances" array.
 * * NOTE: If you see "Imagen API is only accessible to billed users",
 * you must enable billing on your Google Cloud project or use a 
 * Gemini model that supports image generation as a modality instead.
 */

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY is not configured in Vercel.' });
  }

  // Use the specific Imagen 4.0 model
  const model = "imagen-4.0-generate-001";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${apiKey}`;

  try {
    const payload = req.body;
    
    if (!payload.instances) {
      return res.status(400).json({ error: 'Payload must contain an "instances" array.' });
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      // Log the specific error from Google for debugging
      console.error("Imagen API Error Detail:", JSON.stringify(data, null, 2));
      
      // Handle the specific "Billed Users" restriction
      if (data.error?.message?.includes("billed users")) {
        return res.status(403).json({
          error: "IMAGEN_BILLING_REQUIRED",
          message: "The Source requires a paid Google Cloud account to project visuals.",
          details: data.error.message
        });
      }

      return res.status(response.status).json({
        error: data.error?.message || 'Imagen Source rejected the request.',
        details: data
      });
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error("Proxy execution error:", error);
    return res.status(500).json({ error: 'Internal Server Error while communicating with Imagen.' });
  }
}
