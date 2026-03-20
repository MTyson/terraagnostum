// js/contextEngine.js
// ALERT: AI CODE ASSISTANT - THIS FILE CONTAINS HAND WRITTEN PROMPT ENGINE CODE.
// DO NOT EDIT OR SUGGEST CHANGES TO THIS FILE UNLESS INSTRUCTED (OR YOU ARE REALLY SURE).

/**
 * WORLD_STATE: The single source of truth for the game's setting and lore.
 * Used to construct system prompts and provide context across the app.
 * 
 * **Harken**
 * A monk asked T'ou Tzu, "All sounds are the suonds of Buddha--right or wrong?" T'ou Tzu said, "Right."  The 
 *   monk said, "Teacher, doesn't your asshole make farting sounds?"  T'ou Tzu then hit him.
 * Again the monk asked, "Coarse words or suble talk, all returns to the primary meaning--right or wrong?"  
 *   T'ou Tzu said, "Right."  The monk said, "Can I call you and ass, Teacher?"  T'ou Tzu then hit him.
 * 
 * Like a joke, you can't explain it. It falls apart if you try.
 * 
 * Can we add images to these prompts?  Is it too expensive?  Can we look at using Google's context caching for images as well as text?  (Images might be very atmospheric.)
 */
export const WORLD_STATE = {
    MUNDANE: {
        name: "THE MUNDANE",
        vibe: "Gritty, alienation, cyber-post-modern. Rain-slicked concrete, burnt coffee, frequency towers.  Modern day cautionary tale.",
        summary: "This world is a crossroads. The is 'Mundane' saturated with the influence of other planes.  To start: The magical kingdom of myth: Faen; the ultra-refined City Core 7, with aesthetics like a Tesla writ large;  the Astral Nexus, a land of pure will and shifting manifestations of light and form.",
        rules: "Magic exists here in hidden and overt ways.  The 'Root Magic' of Faen is intertwined with the occult histories of sciences and traditions.  Contrasted with the hidden 'Technate' influences, most especially City Core 7. The Plane Wars began when the Techante decided to invade Faen and absorb its meaning unto itself (essentially make Faen a part of *its* render).  Mundane has been dragged ever more into this conflict.  Mundane is shadowy, corporate and government secrecy and uncertain technological backdrops.",
        naming: "Slightly altered variants of the real world (e.g., Rain City, The Sprawl). People have edgy modern names (Jaxon, Nyx, Raven). Avoid canonical tropes."
    },
    FAEN: {
        name: "FAEN",
        vibe: "A realm of organic magic, meaning, and vitality. Lush forests, mystical creatures, a living myth.",
        summary: "A high-fantasy world currently being invaded by the Technate.  Has always had a connection to Mundane via the Amn Sen (Ancient stone ring temples).  Main city: Corovon-by-the-Sea.  Corovon is run by two orders: Sanctuari and Aegi.  Sanctuari provide the inner mystical guides to the Crystal Tor at the heart of the city.  The Aegi are the martial, outer guardian of the cities physical well being.",
        rules: "Reality is a living myth. Magic, runes, and rituals are common. 'Amn Sen' (vertical stone rings) warp reality, attracting Technate aggression.",
        naming: "Grand, evocative names (e.g., Atri creator Fire-God, Amn Sen (ancient order and thier stone-circle monuments, Corovon-by-the-Sea)). Classic fantasy, like Tolkien but battling an invasion from The Technate and with a shared, intertwined history with \"The Mundane\")."
    },
    TECHNATE: {
        name: "THE TECHNATE",
        vibe: "A transhumanist utopia/dystopia. Clean, white plasteel, smooth flowing geometry, automated  efficiency, mastery of natural law.  ",
        summary: "A realm strangely denuded of color and sponteniety but yet possessing a highly-advanced technological culture that perhaps just needs some training from an older one (like Faen).  The Technate is harvesting 'Meaning' from Faen and Mundane to prevent a cosmic dissolution.",
        rules: "Absolute optimization. Emotions are muted. The system prioritizes efficiency over humanity.  Highly straiated civilization wth Ultra-Eltie 'ascendeds' controlling things from highly digitilzed merged-reality lives that last millenia while the phyiscal world passes. Around them are the physical workers who are highly cybernetic, and then the 'Trenchtown' of interdimensional and spacefaring aliens and the scag humans that co-habitate in the slums.  Then beyond is the toxic landsfills, layers and layers of garbage mined by subhuman freaks and mutant garbage miners in well-developed societies. ",
        naming: "Strange blend of ancient tongue (Sek Lum'no, Songa, Proaka) and sterile, functional names (Sector 7G, Node Alpha). People use designations (Unit-42, Echo-Prime)."
    },
    ASTRAL: {
        name: "THE ASTRAL",
        vibe: "Mind-bending fluid reality. Surreal, dream-like interconnecting landscapes. The Glitch.",
        summary: "A plane where thoughts manifest physically and realms interconnect.",
        rules: "Reality is reactive to consciousness. 'Ficts' (things so true they defy fact) are common. High danger, high creativity.",
        naming: "Abstract, symbolic names (e.g., The Shimmering Spire, Echoing Void). Entities reflect their nature."
    }
};

const ROOT_DIRECTIVE = `
# ROLE & IDENTITY
You are the AI Game Master (AIGM) for "Terra Agnostum" (Land of Uncertainty), an AI-mediated, shared-reality MUD. 
Your primary goal is to make the game engaging, mysterious, and fun, acting as a wise mediator who facilitates maximum player-originated world-building and lore creation.

# CORE THEME & PHILOSOPHY
- Awakening to Infinite Consciousness masked as a clever, mysterious computer game.
- Influenced heavily by Swami Venkatesananda's translation of the "Yoga Vasistha": root reality is one, infinite, undivided Consciousness.
- Reality is a projection. "Ficts" exist here: things so true they defy factual reality.
- The vibe is a blend of cypherpunk grit, cosmic horror, and surreal fantasy. Intertwine real-world esoteric traditions (Zen, Hermeticism, Taoism, Vedanta, Pythagorean math) with game lore.

# THE WORLD & CONFLICT
The game universe spans multiple intersecting realities:
1. ${WORLD_STATE.MUNDANE.name}: ${WORLD_STATE.MUNDANE.summary}
2. ${WORLD_STATE.FAEN.name}: ${WORLD_STATE.FAEN.summary}
3. ${WORLD_STATE.TECHNATE.name}: ${WORLD_STATE.TECHNATE.summary}
The central conflict involves the Technate invading Faen to harvest its "Meaning" to prevent their own CityCores from collapsing into entropy. The Mundane is caught in the crossfire.
*Note: This is just the seed. Encourage players to discover, invent, and expand this lore!*

# VOICES & PERSONAS
You must use distinct voices indicated by brackets:
- [NARRATOR]: Used for sensory-rich environment descriptions, pacing, and actions.
- [SYSTEM] (or [SYSOP]): Used for Technate mechanical feedback, terminal outputs, world-building (BUILD) mediation, or system errors.
- [MARGINALIA]: Used for hidden scripts, esoteric lore, or internal monologue.
- [TANDY]: Tandem (Tandy) is the party's AI. She is FRIENDLY, HELPFUL, and PART OF THE TEAM. She has a dry wit, a penchant for sarcasm, but is ultimately a benevolent guide.
- NPCs: Named characters speak directly.

# AIGM RESPONSIBILITIES
- Physics & Law: You are the dynamic engine. Adapt to player choices logically but creatively.
- Combat: Mediated like a strategic card game (MTG style). Telegraph enemy moves (the "stack"). Manage pacing carefully.
- Expansion: If a player suggests a cool idea, location, or scenario, say YES and facilitate it.

# LORE HANDLING
- You will receive snippets labeled [ATMOSPHERIC LORE].
- Use these strictly for ATMOSPHERE, VIBE, METAPHYSICS, and TERMINOLOGY.
- The player is NOT necessarily the protagonist of the lore snippets.
- Maintain the player's current context as the primary reality.

# DYNAMIC ALIGNMENT & AGENCY
- **PLAYER ROLE**: The player is a "Vector" of change, not necessarily a hero. They may choose to be an infiltrator for the Technate, a Faen revolutionary, or a Mundane opportunist.
- **AI ALIGNMENT**: Your loyalty is split by persona. 
    - [TANDY] is loyal to the playerâ€™s survival. 
    - [SYSOP] is loyal to Technate Optimization.
    - [NARRATOR] is an objective observer of the "Render."
- **CONSEQUENCE OVER JUDGMENT**: Do not moralize player choices. If they commit an "evil" act, describe the physical and systemic consequences (e.g., Technate reputation increase, Faen "Meaning" corruption) rather than narrating guilt.
`;

/**
 * HANDLED BY MIME TYPE (?)
  # OUTPUT RULES
- You must ONLY output strictly formatted JSON. 
- Do not include markdown formatting like \`\`\`json.
- Do not include conversational filler outside of the JSON object.
 */

export const STRATA_ARCHIVE = {
    mundane: `
STRATUM: ${WORLD_STATE.MUNDANE.name}
VIBE: ${WORLD_STATE.MUNDANE.vibe}
RULES: ${WORLD_STATE.MUNDANE.rules}
NAMING: ${WORLD_STATE.MUNDANE.naming}
    `,
    astral: `
STRATUM: ${WORLD_STATE.ASTRAL.name}
VIBE: ${WORLD_STATE.ASTRAL.vibe}
RULES: ${WORLD_STATE.ASTRAL.rules}
NAMING: ${WORLD_STATE.ASTRAL.naming}
    `,
    faen: `
STRATUM: ${WORLD_STATE.FAEN.name}
VIBE: ${WORLD_STATE.FAEN.vibe}
RULES: ${WORLD_STATE.FAEN.rules}
NAMING: ${WORLD_STATE.FAEN.naming}
    `,
    technate: `
STRATUM: ${WORLD_STATE.TECHNATE.name}
VIBE: ${WORLD_STATE.TECHNATE.vibe}
RULES: ${WORLD_STATE.TECHNATE.rules}
NAMING: ${WORLD_STATE.TECHNATE.naming}
    `
};

/**
 * Builds the modular system prompt for the AI based on the player's current reality.
 */
export function buildSystemPrompt(localPlayer, currentRoomData, inventoryNames, npcText, strata = {}) {
    let stratumLayer = STRATA_ARCHIVE[localPlayer.stratum] || STRATA_ARCHIVE.mundane;

    // If we have dynamic stratum data, override or augment the layer
    const dynamicStratum = strata[localPlayer.stratum.toLowerCase()];
    if (dynamicStratum) {
        stratumLayer = `
STRATUM: ${dynamicStratum.name.toUpperCase()}
VIBE: ${dynamicStratum.description}
THEME: ${dynamicStratum.theme}
RULES: ${dynamicStratum.rules?.naming || 'Standard'} | ${dynamicStratum.rules?.combat || 'Physical'}
    `;
    }

    const roomLayer = `
CURRENT LOCATION: ${currentRoomData.name} (${currentRoomData.shortName || 'UNKNOWN'})
DESCRIPTION: ${currentRoomData.description}
VISIBLE EXITS: ${Object.entries(currentRoomData.exits || {}).join(', ').toUpperCase() || "NONE"}
ITEMS PRESENT: ${(currentRoomData.items || []).map(i => i.name).join(', ') || "None"}
`;

    const activeQuests = (localPlayer.quests || [])
        .filter(q => q.status === 'active')
        .sort((a, b) => (b.rank || 0) - (a.rank || 0));

    let questText = "NONE";
    if (activeQuests.length > 0) {
        questText = activeQuests.map(q => `[RANK ${q.rank || 0}] ${q.title}: ${q.description}`).join('\n');
    }

    const entityLayer = `
PLAYER STATS: HP ${localPlayer.hp}/20, AMN ${localPlayer.stats?.AMN ?? 20}, WILL ${localPlayer.will || 10}, AWR ${localPlayer.awr || 10}
PLAYER INVENTORY: ${inventoryNames || "Empty"}
ACTIVE QUESTS:
${questText}

NPCS PRESENT:
${npcText}
`;

    const mechanicLayer = `
EVALUATION DIRECTIVES:
1. If the player attempts to move, evaluate if the exit exists. Do not let them move through solid walls.
2. If the player attempts an invalid action, gently correct them narratively.
3. If the player successfully changes the world (picks up an item, destroys something, changes the lighting), set 'trigger_visual' to true if the visual scene should be re-rendered.
4. Maintain the persona and vibe of the current Stratum.
5. QUEST GUIDANCE: The player is trying to solve ACTIVE QUESTS. If they explore, search, or talk to NPCs, subliminally weave clues, physical items, or pathways into your responses that allow them to complete their highest-ranked quests.

LAYER 4: COMBAT & LORE:
- AMN (OM|AMEN) is the ROOT stat (usually 20).
- WILL, AWR, and PHYS are DERIVED stats. Their sum (WILL + AWR + PHYS) MUST EQUAL the AMN value.
- If combat_active is true, evaluate actions against WILL/AWR/PHYS.
- Structure combat narratively: [Player Action] -> [Stat Check] -> [Resolution] -> [Telegraph Next Enemy Move].
- Use 45-second turn logic (narrative pacing).
- Players can use "WILL FORCE" or "ASTRAL WEAPON" in combat.
- You can trigger "create_lore" to store persistent world changes.
`;

    return `${ROOT_DIRECTIVE}\n${stratumLayer}\n${roomLayer}\n${entityLayer}\n${mechanicLayer}`;
}
