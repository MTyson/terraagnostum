/**
 * Vercel Serverless Function
 * Path: /api/generate.js
 * Purpose: The AI Game Master (Tandy) brain. 
 * Augmented with core_bible.md (Anchor) and dynamic RAG from the Lore Vault.
 * Optimized for gemini-2.5-flash-lite on v1beta.
 */
import fs from 'fs';
import path from 'path';

// --- THE ANCHOR ENGINE (ALWAYS INCLUDED) ---
function fetchAnchorLore() {
    try {
        const anchorPath = path.join(process.cwd(), 'lore/vault/lore/core_bible.md');
        if (fs.existsSync(anchorPath)) {
            const anchorText = fs.readFileSync(anchorPath, 'utf8');
            return `\n\n[CORE UNIVERSE BIBLE - ALWAYS ADHERE TO THESE RULES]:\n"${anchorText}"\n`;
        }
    } catch (e) {
        console.error("Anchor Fetch Error:", e);
    }
    return "";
}

// --- THE ZERO-DB RAG ENGINE (DYNAMICALLY INCLUDED) ---
function fetchRelevantLore(userCommand) {
    if (!userCommand) return "";
    try {
        const paths = [
            path.join(process.cwd(), 'lore/vault/lore/Psychotasy_I.md'),
            path.join(process.cwd(), 'lore/vault/lore/Interregnum.md'),
            path.join(process.cwd(), 'lore/vault/lore/The_Coast.md')
        ];

        let combinedText = "";
        paths.forEach(p => {
            if (fs.existsSync(p)) combinedText += fs.readFileSync(p, 'utf8') + "\n\n";
        });

        if (!combinedText) return "";

        const chunks = combinedText.split('\n\n').filter(chunk => chunk.length > 50);
        const searchTerms = userCommand.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3);
        
        if (searchTerms.length === 0) return "";

        let bestChunks = [];
        for (const chunk of chunks) {
            let score = 0;
            const chunkLower = chunk.toLowerCase();
            for (const term of searchTerms) {
                if (chunkLower.includes(term)) score++;
            }
            if (chunkLower.includes('technate') && userCommand.toLowerCase().includes('technate')) score += 3;
            if (chunkLower.includes('faen') && userCommand.toLowerCase().includes('faen')) score += 3;
            
            if (score > 0) bestChunks.push({ score, text: chunk });
        }

        bestChunks.sort((a, b) => b.score - a.score);
        const topLore = bestChunks.slice(0, 2).map(c => c.text).join('\n\n');

        return topLore ? `\n\n[SITUATIONAL CANON CONTEXT]:\n"${topLore}"\n` : "";
    } catch (e) {
        console.error("RAG Error:", e);
        return "";
    }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY; 
  if (!apiKey) {
    return res.status(500).json({ error: 'Technate Secret Key (GEMINI_API_KEY) missing.' });
  }

  try {
    const body = req.body;

    // 1. EXTRACT DATA FOR LORE INJECTION
    const userMessage = body.contents?.[body.contents.length - 1]?.parts?.[0]?.text || "";
    let systemPrompt = body.systemInstruction?.parts?.[0]?.text || "";

    // 2. FETCH LORE
    const anchorLore = fetchAnchorLore();
    const dynamicLore = fetchRelevantLore(userMessage);

    // 3. AUGMENT SYSTEM PROMPT
    const augmentedSystemPrompt = systemPrompt + anchorLore + dynamicLore;

    // 4. REBUILD PAYLOAD
    const geminiPayload = {
        ...body,
        systemInstruction: {
            parts: [{ text: augmentedSystemPrompt }]
        }
    };

    // 5. CALL THE SOURCE
    const model = "gemini-2.5-flash-lite";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiPayload) 
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("LOG: Source API Error:", JSON.stringify(data, null, 2));
      return res.status(response.status).json(data);
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error("LOG: Proxy execution error:", error);
    return res.status(500).json({ 
        error: 'Failed to establish link with the Source.',
        candidates: [{ content: { parts: [{ text: "{\"speaker\":\"SYSTEM\",\"narrative\":\"Link Fragmented. Error: " + error.message + "\"}" }] } }]
    });
  }
}
