/* 
export const blueprintApartment = {
    "lore1": {
        name: "Lore Room (West)",
        shortName: "LORE1",
        description: "The western half of the main living area. A large, flickering computer console dominates the space against the west wall. The console hums with a strange energy, and the air feels thick with forgotten secrets. A closet door to the north is scrawled on with black marker 'Schrödinger's Closet'.",
        visualPrompt: "A cypherpunk apartment living room, a massive glowing green computer console, dim lighting, retro-futuristic furniture.  A closet door to the north is scrawled on with black marker 'Schrödinger's Closet'.  There is a hint of esoteric quantum light spilling out of the edges of the closet.",
        exits: { east: "maproom", north: "closet", south: "bedroom" },
        pinnedView: null,
        items: [],
        marginalia: [],
        npcs: []
    },
    ...
};
*/

export const blueprintApartment = {
    "lore1": {
        name: "Lore Room",
        shortName: "LORE1",
        description: "The western half of the main living area. A large, flickering computer console dominates the space against the west wall. The console hums with a strange energy, and the air is thick with forgotten secrets and intertwined histories.  Everything not covered by the character room and map room is here: races, planes, factions, geographies, it is endless. A closet door to the north is scrawled on with black marker 'Schrödinger's Closet', glowing with potent energy.",
        visualPrompt: "A gritty, glitchy cyberpunk apartment living room, a massive glowing green computer console, dim lighting, retro-futuristic furniture.  A closet door (closed) to the north is scrawled on with black marker 'Schrödinger's Closet', and a mysterious, astral purple-blue light is glowing out of the edges of the closed door.  Piles of reference books, documents and exoteric history and occult works are everywhere, evidence of an obsessive project ot catalog a vast, interdimensional Lore.  Everything not covered by the character room and map room is here: races, planes, factions, geographies, it is endless.",
        exits: { east: "maproom", north: "closet", south: "bedroom" },
        metadata: { stratum: "mundane", isEditable: false },
        npcs: [
            {
                id: "mira_silt",
                name: "Mira Silt",
                archetype: "Amn Sen Archivist",
                description: "A slight woman surrounded by tottering stacks of annotated manuscripts. Her fingers are perpetually ink-stained, and she wears small round spectacles that seem to always be slightly askew. She looks up at you with the unsettling calm of someone who has catalogued stranger things than you.",
                personality: "Speaks in oblique references and half-finished thoughts, as if most conversation happens elsewhere. She is not unfriendly — just operating at a different frequency. She knows the location of every Amn Sen stone ring in the Mundane, including one buried beneath Rain City that the Technate desperately wants destroyed.",
                visual_prompt: "A slight scholarly woman surrounded by towering piles of manuscripts and occult charts. Ink-stained fingers, slightly crooked round spectacles, calm intelligent eyes. Sits cross-legged on a cluttered floor, a massive codex open in her lap.",
                stats: { AMN: 20, WILL: 9, AWR: 11, PHYS: 5 },
                inventory: [],
                image: "assets/mira_silt.png"
            }
        ]
    },
    "maproom": {
        name: "Map Room",
        shortName: "MAP",
        description: "The eastern half of the main living area, acting as a central nexus connecting the apartment.  It has a big, central table covered in copious maps, reference books and interdimensional diagrams tracking the connections of planes and strata.",
        visualPrompt: "A cyberpunk apartment living room, dim lighting, worn retro-futuristic couch, cables running along the floor.  The eastern half of the main living area, acting as a central nexus connecting the apartment.  It has a big, central table covered in copious maps, reference books and interdimensional diagrams tracking the connections of planes and strata. The walls are plastered with esoteric charts and maps, and a large, complex map of the Faen hangs prominently on the wall, with esoteric connections to Astral and Mundane.",
        exits: { west: "lore1", north: "kitchen", east: "character_room", south: "hallway" },
        metadata: { stratum: "mundane", isEditable: false },
        npcs: [
            {
                id: "kael_voss",
                name: "Kael Voss",
                archetype: "Technate Defector",
                description: "A compact man in his late 40s. The left half of his face is cybernetic — a matte-grey titanium jawline with a glowing amber ocular implant that never blinks. He's bent over the maps on the table, occasionally muttering corrections under his breath with the confidence of someone who has walked those corridors.",
                personality: "Gruff, paranoid, but not unkind. Has a soldier's directness and a defector's guilt. He won't volunteer information — but he'll trade it. Knows CityCore entry protocols, Technate patrol rhythms, and the location of at least two surveillance dead zones in Rain City. His price is always information, never credits.",
                visual_prompt: "A weathered middle-aged man, the left half of his face replaced by matte titanium cybernetics with a glowing amber optical implant. Military posture, worn tactical jacket with no insignia. Bent over a map-covered table, tense but controlled.",
                stats: { AMN: 18, WILL: 7, AWR: 8, PHYS: 8 },
                inventory: [],
                image: "assets/kael_voss.png"
            }
        ]
    },
    "bedroom": {
        name: "Bedroom & Bathroom",
        shortName: "BEDROOM",
        description: "A simple sleeping quarters south of the console with an attached, sterile bathroom. It is at once alien and familiar.  You have been here before, you are sure of it.  But when?",
        visualPrompt: "A sparse cyberpunk bedroom, messy bed, a cold blue light spilling from an attached sterile bathroom.  It is at once alien and familiar.  You have been here before, you are sure of it.  But when?  ",
        exits: { north: "lore1" },
        metadata: { stratum: "mundane", isEditable: false }
    },
    "closet": {
        name: "Schrödinger's Closet",
        shortName: "CLOSET",
        description: "A typical apartment closet. The door is covered in cryptic occult and scientific diagrams. Inside is a Hacked Schumann Resonance Generator, arcing with potential energy.",
        visualPrompt: "Glitchy cyberpunk vibe.  Inside a typical apartment closet, walls covered in marker-scrawled diagrams, a strange device in the center called the Hacked Schumann Resonance Generator is arcing with potential energy.",
        exits: { south: "lore1" },
        items: [
            { 
                id: "Schumann_Generator", 
                name: "Hacked Schumann Resonance Generator", 
                description: "A jury-rigged device of brass, vacuum tubes, and exposed circuitry. It emits a low-frequency hum that seems to vibrate your very soul.",
                scenery: true 
            }
        ],
        metadata: { stratum: "mundane", isEditable: false }
    },
    "kitchen": {
        name: "Small Kitchen",
        shortName: "KITCHEN",
        description: "A cramped kitchenette north of the living area with a dusty window looking out into an endless, foggy void.",
        visualPrompt: "A grimy cyberpunk kitchenette, a window showing a dark foggy void, neon light filtering through the blinds.",
        exits: { south: "maproom" },
        metadata: { stratum: "mundane", isEditable: false }
    },
    "character_room": {
        name: "Character Room",
        shortName: "CHARS",
        description: "A room full of character sheets. There are an endless variety of them. The creators of this world have obsessively logged an enormous range of living beings. They cover the table and walls in piles and layers. It is an RPG bonanza of color and stats and drawings. You can create characters here. Use CREATE AVATAR to make your main character.",
        visualPrompt: "A room overflowing with sketches, RPG character sheets, and anatomical drawings pinned to walls, cinematic lighting, cluttered desk piled with reference books and lore.  Walls covered in anatomical drawings, character portraits, extensive RPG data, figures and info.",
        exits: { west: "maproom" },
        metadata: { stratum: "mundane", isEditable: false },
        specialEvents: [{ type: "console_msg", content: "[Tandy] You can create character's in this space.", when: "always_upon_entry" }]
    },
    "hallway": {
        name: "Hallway",
        shortName: "HALLWAY",
        description: "A narrow corridor extending south. At the far southern end is the front door leading 'outside'.",
        visualPrompt: "A narrow, dimly lit apartment hallway. At the end is a heavy metal door.",
        exits: { 
            north: "maproom", 
            south: { 
                target: "outside", 
                itemReq: "Resonant Key", 
                reqAuth: true,
                lockMsg: "[SYSTEM]: You need to anchor your vessel. /login or /register." 
            } 
        },
        metadata: { stratum: "mundane", isEditable: false }
    }
};

export const blueprintGlobal = {
    "outside": {
        name: "The Unrendered Edge",
        shortName: "VOID",
        description: "The entire area ahead looks like it's made of cardboard... The Technate hasn't processed this sector yet.",
        visualPrompt: "A glitching transition where a realistic cyberpunk city abruptly turns into a crude child's crayon drawing.",
        exits: { north: "hallway" },
        metadata: { stratum: "mundane", isEditable: false }
    }
};
