/**
 * Vercel Serverless Function
 * Path: /api/generate.js
 * Purpose: The AI Game Master (Tandy) brain, now augmented with the Akashic Record (RAG).
 */
import fs from 'fs';
import path from 'path';

// --- THE ZERO-DB RAG ENGINE ---
// This reads the vault, chunks it, and finds the most relevant canonical lore.
function fetchRelevantLore(userCommand) {
    if (!userCommand) return "";

    try {
        // Resolve the paths to your private vault documents
        const psychotasyPath = path.join(process.cwd(), 'lore/vault/lore/Psychotasy_I.md');
        const interregnumPath = path.join(process.cwd(), 'lore/vault/lore/Interregnum.md');
        const coastPath = path.join(process.cwd(), 'lore/vault/lore/The_Coast.md');

        let combinedText = "";

        // Safely attempt to read the files (if they exist)
        if (fs.existsSync(psychotasyPath)) combinedText += fs.readFileSync(psychotasyPath, 'utf8') + "\n\n";
        if (fs.existsSync(interregnumPath)) combinedText += fs.readFileSync(interregnumPath, 'utf8') + "\n\n";
        if (fs.existsSync(coastPath)) combinedText += fs.readFileSync(coastPath, 'utf8') + "\n\n";

        if (!combinedText) return "";

        // Chunk the text by double line breaks (paragraphs)
        const chunks = combinedText.split('\n\n').filter(chunk => chunk.length > 50); 
        
        // Extract meaningful words from the user's command to use as search terms
        const searchTerms = userCommand.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3);
        
        if (searchTerms.length === 0) return "";

        let bestChunks = [];

        // Score each chunk based on keyword overlap
        for (const chunk of chunks) {
            let score = 0;
            const chunkLower = chunk.toLowerCase();
            
            for (const term of searchTerms) {
                if (chunkLower.includes(term)) score++;
            }

            // Heavily weight core universe concepts to ensure they trigger strongly
            if (chunkLower.includes('technate') && userCommand.toLowerCase().includes('technate')) score += 3;
            if (chunkLower.includes('faen') && userCommand.toLowerCase().includes('faen')) score += 3;
            if (chunkLower.includes('sek lum') && userCommand.toLowerCase().includes('sek')) score += 3;
            if (chunkLower.includes('archive') && userCommand.toLowerCase().includes('archive')) score += 2;

            if (score > 0) {
                bestChunks.push({ score, text: chunk });
            }
        }

        // Sort by highest score and grab the top 2 most relevant paragraphs
        bestChunks.sort((a, b) => b.score - a.score);
        const topLore = bestChunks.slice(0, 2).map(c => c.text).join('\n\n');

        // Return the formatted injection string for the AI
        return topLore ? `\n\n[CRITICAL CANONICAL CONTEXT TO INCORPORATE]:\n"${topLore}"\n(Do not quote this directly, but use its facts, tone, and specific details to shape your narrative response.)` : "";

    } catch (e) {
        console.error("RAG Chunking Error:", e);
        return ""; // Fail gracefully so the game doesn't crash if files are missing
    }
}


// --- MAIN HANDLER ---
export default async function handler(req, res) {
    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { systemPrompt, userMessage } = req.body;

        if (!systemPrompt || !userMessage) {
             return res.status(400).json({ error: 'Missing prompt data' });
        }

        // 1. DYNAMIC RAG INJECTION
        // We fetch the lore based on what the user typed in `userMessage`
        const dynamicLoreContext = fetchRelevantLore(userMessage);

        // 2. AUGMENT THE SYSTEM PROMPT
        // We combine your base Tandy instructions with the newly fetched lore
        const augmentedSystemPrompt = systemPrompt + dynamicLoreContext;

        // 3. CALL THE LLM API
        // (Assuming you are using OpenAI here, adjust the fetch URL/Headers if you are using Gemini or Anthropic)
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` // Make sure this matches your environment variable
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini', // or your preferred model
                messages: [
                    { role: 'system', content: augmentedSystemPrompt },
                    { role: 'user', content: userMessage }
                ],
                max_tokens: 300,
                temperature: 0.7
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error?.message || 'LLM API Error');
        }

        const data = await response.json();
        const gmReply = data.choices[0].message.content;

        // Return the response back to index.html
        return res.status(200).json({ text: gmReply });

    } catch (error) {
        console.error("Generate API Error:", error);
        return res.status(500).json({ error: 'Failed to generate response.', details: error.message });
    }
}
