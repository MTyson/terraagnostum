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
        description: "The western half of the main living area. A large, flickering computer console dominates the space against the west wall. The console hums with a strange energy, and the air is thick with forgotten secrets and intertwined histories.  A closet door to the north is scrawled on with black marker 'Schrödinger's Closet', glowing with potent energy.",
        visualPrompt: "A gritty, glitchy cyberpunk apartment living room, a massive glowing green computer console, dim lighting, retro-futuristic furniture.  A closet door (closed) to the north is scrawled on with black marker 'Schrödinger's Closet', with a mysterious purple-blue light glowing and pulsing out of the edges of the closed door.  Piles of reference books, documents and exoteric history and occult works are everywhere, evidence of an obsessive project ot catalog a vast, interdimensional Lore.",
        exits: { east: "maproom", north: "closet", south: "bedroom" },
        metadata: { stratum: "mundane", isEditable: false }
    },
    "maproom": {
        name: "Map Room",
        shortName: "MAP",
        description: "The eastern half of the main living area, acting as a central nexus connecting the apartment.  It has a big, central table covered in copious maps, reference books and interdimensional diagrams tracking the connections of planes and strata.",
        visualPrompt: "A cyberpunk apartment living room, dim lighting, worn retro-futuristic couch, cables running along the floor.  The eastern half of the main living area, acting as a central nexus connecting the apartment.  It has a big, central table covered in copious maps, reference books and interdimensional diagrams tracking the connections of planes and strata. The walls are plastered with esoteric charts and maps, and a large, complex map of the Faen hangs prominently on the wall, with esoteric connections to Astral and Mundane.",
        exits: { west: "lore1", north: "kitchen", east: "character_room", south: "hallway" },
        metadata: { stratum: "mundane", isEditable: false }
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
        visualPrompt: "Inside a typical apartment closet, walls covered in marker-scrawled diagrams, a strange arcing device in the center.",
        exits: { south: "lore1" },
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
        metadata: { stratum: "mundane", isEditable: false }
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
                lockMsg: "[SYSTEM]: The heavy metal door is sealed by a Technate biometric lock. A [Resonant Key] is required." 
            } 
        },
        metadata: { stratum: "mundane", isEditable: false }
    },
    "outside": {
        name: "The Unrendered Edge",
        shortName: "VOID",
        description: "The entire area ahead looks like it's made of cardboard... The Technate hasn't processed this sector yet.",
        visualPrompt: "A glitching transition where a realistic cyberpunk city abruptly turns into a crude child's crayon drawing.",
        exits: { north: "hallway" },
        metadata: { stratum: "mundane", isEditable: false }
    }
};
