/**
 * Vercel Serverless Function
 * Path: /api/read.js
 * Purpose: The Akashic Fetcher. Reads canon text from the private submodule.
 */
import fs from 'fs';
import path from 'path';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { targetText } = req.body; 
    
    // Default to Psychotasy I
    let relativePath = 'lore/vault/lore/Psychotasy_I.md';
    
    // Route to other manifestations if requested
    if (targetText === 'interregnum') {
      relativePath = 'lore/vault/lore/Interregnum.md';
    } else if (targetText === 'coast') {
      relativePath = 'lore/vault/lore/The_Coast.md';
    }

    // Resolve the absolute path in the server environment
    const filePath = path.join(process.cwd(), relativePath);

    // Read the Markdown file
    const fileContent = fs.readFileSync(filePath, 'utf8');

    // Return the text to the game client
    return res.status(200).json({ 
      success: true, 
      text: fileContent,
      source: targetText
    });

  } catch (error) {
    console.error("Akashic Fetch Error:", error);
    return res.status(500).json({ 
      error: 'Failed to retrieve the text. The artifact may be missing or unrendered.',
      details: error.message
    });
  }
}
