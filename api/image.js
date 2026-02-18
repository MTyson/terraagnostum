/**
 * Vercel Serverless Function: Imagen Proxy
 * Path: /api/image.js
 * * This proxy handles requests to the Imagen 4.0 model.
 * It expects a JSON body with an "instances" array.
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
    // Ensure we are sending a valid instances structure
    const payload = req.body;
    
    // If for some reason the frontend sends just a prompt string, wrap it.
    // Our index.html sends { instances: [...] }, so this is just a safety check.
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
      // Log the specific error from Google to Vercel logs for easier debugging
      console.error("Imagen API Error Detail:", JSON.stringify(data, null, 2));
      
      // Pass the specific error back to the frontend
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
