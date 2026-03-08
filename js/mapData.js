/* 
export const ARCHIVE_NODES = ['lore1', 'lore2', 'kitchen', 'spare_room', 'bedroom', 'closet', 'character_room', 'hallway', 'outside'];
export const isArchiveRoom = (roomId) => ARCHIVE_NODES.includes(roomId);

export const apartmentMap = {
    "lore1": {
        name: "Lore Room (West)",
        shortName: "LORE1",
        description: "The western half of the main living area. A large, flickering computer console dominates the space against the west wall. The console hums with a strange energy, and the air feels thick with forgotten secrets. A closet door to the north is scrawled on with black marker 'Schrödinger's Closet'.",
        visualPrompt: "A cypherpunk apartment living room, a massive glowing green computer console, dim lighting, retro-futuristic furniture.  A closet door to the north is scrawled on with black marker 'Schrödinger's Closet'.  There is a hint of esoteric quantum light spilling out of the edges of the closet.",
        exits: { east: "lore2", north: "closet", south: "bedroom" },
        pinnedView: null,
        items: [],
        marginalia: [],
        npcs: []
    },
    "lore2": {
        name: "Lore Room (East)",
        shortName: "LORE2",
        description: "The eastern half of the main living area, acting as a central nexus connecting the apartment.",
        visualPrompt: "A cyberpunk apartment living room, dim lighting, worn retro-futuristic couch, cables running along the floor.",
        exits: { west: "lore1", north: "kitchen", east: "character_room", south: "hallway" },
        pinnedView: null,
        items: [],
        marginalia: [],
        npcs: []
    },
    "closet": {
        name: "Schrödinger's Closet",
        shortName: "CLOSET",
        description: "The inside of a typical apartment closet. The door is covered in cryptic occult and scientific diagrams and notes scrawled in different color marker. It is empty except for a strange device, a Hacked Schumman Resonance Generator, arcing with potential energy.  The device has dials and knobs for tuning different realities.",
        visualPrompt: "The inside of a typical apartment closet. The door is covered in cryptic occult and scientific diagrams and notes scrawled in different color marker. It is empty except for a strange device, a Hacked Schumman Resonance Generator, arcing with potential energy.  The device has dials and knobs for tuning different realities.",
        exits: { south: "lore1" },
        pinnedView: null,
        items: [],
        marginalia: [],
        npcs: []
    },
    "kitchen": {
        name: "Small Kitchen",
        shortName: "KITCHEN",
        description: "A cramped kitchenette north of the living area with a dusty window looking out into an endless, foggy void.",
        visualPrompt: "A grimy cyberpunk kitchenette, a window showing a dark foggy void, neon light filtering through the blinds.",
        exits: { south: "lore2" },
        pinnedView: null,
        items: [],
        marginalia: [],
        npcs: []
    },
    "character_room": {
        name: "Character Room",
        shortName: "CHARS",
        description: "A room full of character sheets. There are an endless variety of them. The creators of this world have obsessively logged an enormous range of living beings. They cover the table and walls in piles and layers. It is an RPG bonanza of color and stats and drawings. You can create characters here. Use CREATE AVATAR to make your main character.",
        visualPrompt: "A room overflowing with sketches, RPG character sheets, and anatomical drawings pinned to walls, cinematic lighting, cluttered desk.",
        exits: { "west": "lore2" },
        pinnedView: null, items: [], marginalia: [], npcs: []
    },
    "bedroom": {
        name: "Bedroom & Bathroom",
        shortName: "BEDROOM",
        description: "A simple sleeping quarters south of the console with an attached, sterile bathroom.",
        visualPrompt: "A sparse cyberpunk bedroom, messy bed, a cold blue light spilling from an attached sterile bathroom.",
        exits: { north: "lore1" },
        pinnedView: null,
        items: [],
        marginalia: [],
        npcs: []
    },
    "hallway": {
        name: "Hallway",
        shortName: "HALLWAY",
        description: "A narrow corridor extending south. At the far southern end is the front door leading 'outside'.",
        visualPrompt: "A narrow, dimly lit apartment hallway. At the end is a heavy metal door, standing slightly open.",
        exits: { north: "lore2", south: "outside" },
        pinnedView: null,
        items: [],
        marginalia: [],
        npcs: []
    },
    "outside": {
        name: "The Unrendered Edge",
        shortName: "VOID",
        description: "The entire area ahead looks like it's made of cardboard, construction paper, and crayon. The Technate's render engine hasn't processed this sector yet.",
        visualPrompt: "A glitching transition where a realistic cyberpunk city abruptly turns into a crude child's crayon drawing on cardboard.",
        exits: { north: "hallway" },
        pinnedView: null,
        items: [],
        marginalia: [],
        npcs: []
    }
};
*/

export const ARCHIVE_NODES = ['lore1', 'lore2', 'kitchen', 'spare_room', 'bedroom', 'closet', 'character_room', 'hallway'];
export const isArchiveRoom = (roomId) => ARCHIVE_NODES.includes(roomId);

export const blueprintApartment = {
    "lore1": {
        name: "Lore Room (West)",
        shortName: "LORE1",
        description: "The western half of the main living area. A large, flickering computer console dominates the space against the west wall. The console hums with a strange energy, and the air feels thick with forgotten secrets.",
        visualPrompt: "A cypherpunk apartment living room, a massive glowing green computer console, dim lighting, retro-futuristic furniture.  A closet door to the north is scrawled on with black marker 'Schrödinger's Closet'.  There is a hint of esoteric quantum light spilling out of the edges of the closet.A cyberpunk apartment living room, a massive glowing green computer console, dim lighting, retro-futuristic furniture. A hint of esoteric quantum light spilling out of the edges of the closet.",
        exits: { east: "lore2", north: "closet", south: "bedroom" },
        metadata: { stratum: "mundane", isEditable: false }
    },
    "lore2": {
        name: "Lore Room (East)",
        shortName: "LORE2",
        description: "The eastern half of the main living area, acting as a central nexus connecting the apartment.",
        visualPrompt: "A cyberpunk apartment living room, dim lighting, worn retro-futuristic couch, cables running along the floor.",
        exits: { west: "lore1", north: "kitchen", east: "character_room", south: "hallway" },
        metadata: { stratum: "mundane", isEditable: false }
    },
    "bedroom": {
        name: "Bedroom & Bathroom",
        shortName: "BEDROOM",
        description: "A simple sleeping quarters south of the console with an attached, sterile bathroom.",
        visualPrompt: "A sparse cyberpunk bedroom, messy bed, a cold blue light spilling from an attached sterile bathroom.",
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
        exits: { south: "lore2" },
        metadata: { stratum: "mundane", isEditable: false }
    },
    "character_room": {
        name: "Character Room",
        shortName: "CHARS",
        description: "A spare room full of character sheets and biological logs. You can create avatars here.",
        visualPrompt: "A spare room overflowing with sketches, RPG character sheets, and anatomical drawings pinned to walls, cinematic lighting.  An RPG bonanza of data and lore related to characters and races and beings.",
        exits: { west: "lore2" },
        metadata: { stratum: "mundane", isEditable: false }
    },
    "hallway": {
        name: "Hallway",
        shortName: "HALLWAY",
        description: "A narrow corridor extending south. At the far southern end is the front door leading 'outside'.",
        visualPrompt: "A narrow, dimly lit apartment hallway. At the end is a heavy metal door.",
        exits: { 
            north: "lore2", 
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
