/**
 * expand-rain-city.mjs
 * 
 * Reads the existing Rain City map from Firestore, prints a topology report,
 * then calls Gemini to generate new rooms for any dangling exits, and writes
 * them back to Firestore as proper game-ready map nodes.
 * 
 * Usage:
 *   node scripts/expand-rain-city.mjs --key YOUR_GEMINI_KEY
 *   node scripts/expand-rain-city.mjs --key YOUR_KEY --dry-run   (read-only, no writes)
 *   node scripts/expand-rain-city.mjs --key YOUR_KEY --rooms 5   (generate N rooms, default 3)
 * 
 * Get your Gemini key from: https://aistudio.google.com/app/apikey
 * (Same key that's in your Vercel project env vars as GEMINI_API_KEY)
 */

import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

// --- Load .env.local ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env.local');
const envContent = readFileSync(envPath, 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    env[key] = val.replace(/\\n/g, '\n');
}

const require = createRequire(import.meta.url);
const admin = require('firebase-admin');

// --- Args ---
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ROOMS_IDX = args.findIndex(a => a === '--rooms');
const ROOM_COUNT = ROOMS_IDX !== -1 ? parseInt(args[ROOMS_IDX + 1] || '3', 10) : 3;
const KEY_IDX = args.findIndex(a => a === '--key');
const CLI_KEY = KEY_IDX !== -1 ? args[KEY_IDX + 1] : null;
const APP_ID = 'terra-agnostum-shared';
const GEMINI_MODEL = 'gemini-2.0-flash';

// --- Lore Context (mirrors contextEngine.js) ---
const LORE = `
WORLD: Terra Agnostum
STRATUM: THE MUNDANE — Rain City

VIBE: Gritty post-modern cyberpunk. Rain-soaked concrete, neon signs bleeding into puddles,
frequency towers humming above, corporate arcology shadows overhead. Think Blade Runner
meets William Gibson with occult overtones. People are weary and sharp.

CONFLICT: The Technate (a transhumanist dystopia from another plane) is quietly infiltrating
Rain City. Frequency antennas are Technate surveillance. Some citizens are unwittingly
becoming cybernetic agents. The Faen (a magical realm) has hidden artifacts — Amn Sen stone
rings — buried in the city that the Technate wants destroyed.

GAME CONVENTIONS:
- Room IDs use snake_case, prefixed: rain_city_[name]
- Exits are cardinal directions: north, south, east, west (string room IDs)
- visualPrompt: A vivid image generation prompt in the style of the world
- items: Interesting but not mandatory. Use scenery:true for non-takeable objects.
- npcs: Optional. Only seed if narratively essential. Include id, name, description.
- metadata: Always include { stratum: "mundane", isEditable: true }

EXISTING ROOM IDs (do not duplicate or re-create these):
{{EXISTING_IDS}}

DANGLING EXITS (these need new rooms):
{{DANGLING_EXITS}}

TASK: Generate {{COUNT}} new rooms to fill dangling exits and organically expand the map.
Each room should:
1. Feel like a distinct location in Rain City (not generic "street" or "alley")
2. Have a strong visual identity and at least one interesting detail or item
3. Connect coherently to the room it branches from
4. Have at least one exit back + optionally 1-2 onward exits to other EXISTING rooms or new ones
5. Subtly reference the Technate/Faen conflict without being heavy-handed

OUTPUT: Return a single valid JSON array of room objects. No markdown, no commentary.
Each object: { id, name, shortName, description, visualPrompt, exits, items, npcs, metadata }
`;

// --- Gemini Call (REST API — no SDK needed) ---
async function callGemini(prompt, apiKey) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
    const payload = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.9,
        }
    };
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Gemini HTTP ${res.status}: ${err.slice(0, 300)}`);
    }
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini returned no text. Full response: ' + JSON.stringify(data).slice(0, 500));
    try {
        return JSON.parse(text);
    } catch {
        const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (match) return JSON.parse(match[1]);
        throw new Error(`Could not parse Gemini JSON response:\n${text.slice(0, 500)}`);
    }
}

// --- Main ---
async function main() {
    const apiKey = CLI_KEY || env['GEMINI_API_KEY'] || env['VITE_GEMINI_API_KEY'];
    const projectId = env['FIREBASE_PROJECT_ID'];
    const clientEmail = env['FIREBASE_CLIENT_EMAIL'];
    const privateKey = env['FIREBASE_PRIVATE_KEY'];

    if (!projectId || !clientEmail || !privateKey) {
        console.error('[ERROR] Missing Firebase credentials in .env.local');
        process.exit(1);
    }
    if (!DRY_RUN && !apiKey) {
        console.error('[ERROR] Gemini API key required for room generation.');
        console.error('        Pass it via: --key YOUR_KEY');
        console.error('        Or add GEMINI_API_KEY=... to .env.local');
        console.error('        Get a key at: https://aistudio.google.com/app/apikey');
        console.error('        Use --dry-run to just read the map topology without a key.');
        process.exit(1);
    }

    // Init Firebase Admin
    admin.initializeApp({
        credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
    });
    const db = admin.firestore();
    const roomsRef = db.collection('artifacts').doc(APP_ID).collection('rooms');

    // --- Step 1: Read all rooms from Firestore ---
    console.log('\n[SYNC] Reading Firestore rooms...');
    const snapshot = await roomsRef.get();
    const allRooms = {};
    snapshot.forEach(doc => { allRooms[doc.id] = doc.data(); });
    console.log(`[SYNC] Found ${Object.keys(allRooms).length} total rooms.`);

    // --- Step 2: Filter to Rain City / global mundane rooms ---
    // We exclude:
    //   - instance_ rooms (player apartments)
    //   - known apartment blueprint IDs that exist globally
    const APARTMENT_IDS = new Set(['lore1', 'maproom', 'bedroom', 'closet', 'kitchen', 'character_room', 'hallway']);
    
    const rainCityRooms = Object.entries(allRooms).filter(([id, room]) => {
        if (id.startsWith('instance_')) return false;
        if (APARTMENT_IDS.has(id)) return false;
        // Include if stratum is mundane or not set (default is mundane)
        const stratum = room.metadata?.stratum || room.stratum || 'mundane';
        return stratum === 'mundane';
    });
    console.log(`\n[MAP] Global mundane rooms found: ${rainCityRooms.length}`);

    const JSON_OUT = args.includes('--json');

    // --- Step 3: Print topology ---
    console.log('\n=== RAIN CITY TOPOLOGY ===');
    const danglingExits = [];

    for (const [id, room] of rainCityRooms) {
        const roomName = room.name || room.shortName || id;
        const exits = room.exits || {};
        const exitSummary = Object.entries(exits).map(([dir, target]) => {
            const targetId = typeof target === 'string' ? target : target?.target;
            const exists = !!allRooms[targetId];
            const flag = exists ? '✓' : '✗ MISSING';
            if (!exists && targetId) {
                danglingExits.push({ fromId: id, fromName: roomName, direction: dir, toId: targetId });
            }
            return `  ${dir.toUpperCase()} → ${targetId} ${flag}`;
        });
        console.log(`\n  [${id}] "${roomName}"`);
        console.log(`  Desc: ${(room.description || '(no description)').slice(0, 100)}`);
        if (exitSummary.length) {
            exitSummary.forEach(e => console.log(e));
        } else {
            console.log('  (no exits)');
        }
    }

    console.log(`\n=== DANGLING EXITS: ${danglingExits.length} ===`);
    danglingExits.forEach(e => {
        console.log(`  ${e.fromId} [${e.direction}] → ${e.toId} (MISSING)`);
    });

    // Optionally dump full JSON
    if (JSON_OUT) {
        const { writeFileSync } = await import('fs');
        const outPath = path.join(__dirname, '..', 'scripts', 'rain-city-rooms.json');
        writeFileSync(outPath, JSON.stringify(Object.fromEntries(rainCityRooms), null, 2));
        console.log(`\n[JSON] Full room data written to scripts/rain-city-rooms.json`);
    }

    if (DRY_RUN) {
        console.log('\n[DRY RUN] Topology read complete. No Gemini call or writes will be performed.');
        console.log('[TIP] Remove --dry-run and pass --key YOUR_GEMINI_KEY to generate and patch rooms.');
        process.exit(0);
    }

    // --- Step 4a: Identify ghost records (no name, no description) ---
    const ghostIds = Object.entries(allRooms)
        .filter(([id, room]) => {
            if (id.startsWith('instance_')) return false;
            if (APARTMENT_IDS.has(id)) return false;
            return !room.name && !room.description;
        })
        .map(([id]) => id);

    if (ghostIds.length > 0) {
        console.log(`\n[CLEANUP] Found ${ghostIds.length} ghost record(s) to delete: ${ghostIds.join(', ')}`);
    }

    // --- Step 4b: Identify placeholder rooms (BUILD stubs) ---
    const PLACEHOLDER_MARKER = 'newly woven pocket of reality';
    const placeholderRooms = rainCityRooms.filter(([id, room]) =>
        room.description && room.description.includes(PLACEHOLDER_MARKER)
    );
    console.log(`\n[PATCH] Found ${placeholderRooms.length} placeholder room(s) to flesh out.`);

    // --- Step 4c: Build Gemini prompt context ---
    const existingRoomContext = rainCityRooms
        .filter(([, r]) => r.description && !r.description.includes(PLACEHOLDER_MARKER))
        .map(([id, r]) => `ID: ${id} | Name: ${r.name} | Desc: ${(r.description || '').slice(0, 80)} | Exits: ${JSON.stringify(r.exits || {})}`)
        .join('\n');

    const existingIds = Object.keys(allRooms).filter(id => !ghostIds.includes(id)).join(', ');

    // --- Step 5a: Patch placeholders ---
    let patchedRooms = [];
    if (placeholderRooms.length > 0) {
        const patchPrompt = `${LORE.replace('{{EXISTING_IDS}}', existingIds).replace('{{COUNT}}', String(placeholderRooms.length))}

SPECIAL INSTRUCTION - PATCH MODE:
Instead of creating new rooms, you are ENRICHING existing placeholder rooms.
Do NOT change their IDs or exits. Only update name, shortName, description, and visualPrompt.
Make each room feel like a distinct, lived-in location in Rain City.

ROOMS TO PATCH (return array with same IDs, improved content):
${placeholderRooms.map(([id, r]) => `
  ID: ${id}
  Current name: "${r.name}"
  Connected to: ${JSON.stringify(r.exits || {})}
  Neighbors: ${Object.values(r.exits || {}).map(tid => {
    const t = allRooms[typeof tid === 'string' ? tid : tid?.target];
    return t ? `"${t.name}"` : 'unknown';
  }).join(', ')}
`).join('\n')}

EXISTING RAIN CITY CONTEXT:
${existingRoomContext}

OUTPUT: JSON array. Each object must have: id (unchanged), name, shortName, description, visualPrompt.
Do NOT include exits, items, or npcs — those are preserved as-is.`;

        console.log(`\n[GEMINI] Patching ${placeholderRooms.length} placeholder room(s)...`);
        try {
            patchedRooms = await callGemini(patchPrompt, apiKey);
            if (!Array.isArray(patchedRooms)) {
                patchedRooms = patchedRooms.rooms || patchedRooms.data || Object.values(patchedRooms);
            }
            console.log(`  Generated patches for: ${patchedRooms.map(r => r.id).join(', ')}`);
        } catch (err) {
            console.warn('[GEMINI] Patch generation failed, skipping:', err.message);
        }
    }

    // --- Step 5b: Generate new rooms ---
    const danglingText = danglingExits.length > 0
        ? danglingExits.map(e => `- Room "${e.fromName}" (${e.fromId}) has a ${e.direction} exit pointing to "${e.toId}" which does not exist yet`).join('\n')
        : '- No specific dangling exits. Add rooms that organically extend the map from the edges.';

    const newRoomPrompt = LORE
        .replace('{{EXISTING_IDS}}', existingIds)
        .replace('{{DANGLING_EXITS}}', danglingText + '\n\nEXISTING RAIN CITY CONTEXT:\n' + existingRoomContext)
        .replace('{{COUNT}}', String(ROOM_COUNT));

    console.log(`\n[GEMINI] Generating ${ROOM_COUNT} new room(s)...`);
    let newRooms = [];
    try {
        newRooms = await callGemini(newRoomPrompt, apiKey);
        if (!Array.isArray(newRooms)) {
            newRooms = newRooms.rooms || newRooms.data || Object.values(newRooms);
        }
    } catch (err) {
        console.error('[GEMINI] New room generation failed:', err.message);
        process.exit(1);
    }

    // --- Step 6: Print preview ---
    console.log(`\n=== PREVIEW ===`);
    if (ghostIds.length) console.log(`  Will DELETE ${ghostIds.length} ghost(s): ${ghostIds.join(', ')}`);
    if (patchedRooms.length) {
        console.log(`  Will PATCH ${patchedRooms.length} placeholder(s):`);
        patchedRooms.forEach(r => console.log(`    ✎ ${r.id} → "${r.name}": ${(r.description || '').slice(0, 80)}`));
    }
    console.log(`  Will CREATE ${newRooms.length} new room(s):`);
    newRooms.forEach(r => {
        console.log(`\n    ID: ${r.id} | Name: "${r.name}"`);
        console.log(`    Desc: ${(r.description || '').slice(0, 100)}`);
        console.log(`    Exits: ${JSON.stringify(r.exits || {})} | Items: ${(r.items || []).map(i => i.name).join(', ') || 'none'}`);
    });

    // --- Step 7: Commit to Firestore ---
    console.log('\n[FIRESTORE] Committing changes...');
    const batch = db.batch();

    // Delete ghosts
    for (const ghostId of ghostIds) {
        batch.delete(roomsRef.doc(ghostId));
        console.log(`  ✗ Queued DELETE: ${ghostId}`);
    }

    // Patch placeholders (merge: true to preserve exits/items/npcs/storedImageUrl)
    for (const patch of patchedRooms) {
        if (!patch.id) continue;
        const patchRef = roomsRef.doc(patch.id);
        batch.set(patchRef, {
            name: patch.name,
            shortName: patch.shortName || patch.name.toUpperCase().slice(0, 7),
            description: patch.description,
            visualPrompt: patch.visualPrompt || patch.visual_prompt || '',
        }, { merge: true });
        console.log(`  ✎ Queued PATCH: ${patch.id} ("${patch.name}")`);
    }

    // Create new rooms
    for (const room of newRooms) {
        if (!room.id || !room.name) {
            console.warn('[WARN] Skipping room with missing id or name.');
            continue;
        }
        if (allRooms[room.id]) {
            console.warn(`[WARN] ${room.id} already exists. Skipping.`);
            continue;
        }
        const roomRef = roomsRef.doc(room.id);
        batch.set(roomRef, {
            id: room.id,
            name: room.name,
            shortName: room.shortName || room.name.toUpperCase().slice(0, 7),
            description: room.description || '',
            visualPrompt: room.visualPrompt || room.visual_prompt || '',
            exits: room.exits || {},
            items: room.items || [],
            npcs: (room.npcs || []).map(n => ({ ...n, inventory: n.inventory || [] })),
            metadata: { stratum: 'mundane', isEditable: true, generatedBy: 'expand-rain-city', generatedAt: new Date().toISOString() }
        });
        console.log(`  ✓ Queued CREATE: ${room.id} ("${room.name}")`);
    }

    await batch.commit();
    console.log(`\n[DONE] ${newRooms.length} rooms committed to Firestore.`);
    console.log('[TIP] Refresh the game client to see the new rooms via the live Firestore listener.');
    process.exit(0);
}

main().catch(err => {
    console.error('[FATAL]', err);
    process.exit(1);
});
