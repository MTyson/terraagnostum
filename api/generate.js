/**
 * Vercel Serverless Function
 * Path: /api/generate.js
 * Optimized for gemini-2.5-flash-lite on v1beta.
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // API Key pulled from environment variables for security
  const apiKey = process.env.GEMINI_API_KEY; 

  if (!apiKey) {
    return res.status(500).json({ 
      error: 'Technate Secret Key (GEMINI_API_KEY) missing in environment.' 
    });
  }

  // Using v1beta and the new lite model for maximum speed
  const model = "gemini-2.5-flash-lite";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body) 
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("LOG: Source API Error:", JSON.stringify(data, null, 2));
      return res.status(response.status).json(data);
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error("LOG: Proxy execution error:", error);
    return res.status(500).json({ error: 'Failed to establish link with the Source.' });
  }
}