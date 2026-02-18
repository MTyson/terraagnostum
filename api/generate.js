/**
 * Vercel Serverless Function
 * Path: /api/generate.js
 * * FIXED VERSION: Uses gemini-1.5-flash-latest to resolve Google's 404 model error.
 */

export default async function handler(req, res) {
  // 1. Only allow POST requests (prevents the "Method not allowed" when visiting in browser)
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // PASTE YOUR KEY HERE
  const apiKey = "AIzaSyA27FcclPlGatD2-8pPWCmMumHzNVHc5KQ"; 

  if (!apiKey) {
    return res.status(500).json({ 
      error: 'Technate Secret Key missing in generate.js. Please paste it into the apiKey variable.' 
    });
  }

  // The 'gemini-1.5-flash-latest' identifier is more robust than the alias.
  const model = "gemini-1.5-flash-latest";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body) 
    });

    const data = await response.json();

    if (!response.ok) {
      // Log the specific error from Google to the terminal where 'vercel dev' is running
      console.error("Google API Error:", JSON.stringify(data, null, 2));
      
      // Pass the error back to the frontend with the status code Google provided
      return res.status(response.status).json(data);
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error("Proxy execution error:", error);
    return res.status(500).json({ error: 'Failed to establish link with the Source.' });
  }
}