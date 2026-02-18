/**
 * Vercel Serverless Function: Image Proxy
 * Path: /api/image.js
 */

export default async function handler(req, res) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY is not configured in Vercel.' });
  }

  // --- GET: DIAGNOSTIC MODE (For the LIST command) ---
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

  // --- POST: GENERATION MODE (For the LOOK command) ---
  if (req.method === 'POST') {
    const model = "gemini-2.0-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    try {
      const incomingPayload = req.body;
      const promptText = incomingPayload.instances?.[0]?.prompt || "A lofi glitch terminal art piece.";

      const geminiPayload = {
        contents: [{ parts: [{ text: promptText }] }],
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
        return res.status(response.status).json(data);
      }

      const imagePart = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
      const base64Data = imagePart?.inlineData?.data;

      if (!base64Data) {
        return res.status(500).json({ error: "No image data returned from source." });
      }

      return res.status(200).json({
        predictions: [{ bytesBase64Encoded: base64Data }]
      });
    } catch (error) {
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  // If method is neither GET nor POST
  return res.status(405).json({ error: 'Method not allowed' });
}
