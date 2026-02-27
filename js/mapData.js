export const apartmentMap = {
    "lore1": {
        name: "Lore Room (West)",
        shortName: "LORE1",
        description: "The western half of the main living area. A large, flickering computer console dominates the space against the west wall.",
        visualPrompt: "A cyberpunk apartment living room, a massive glowing green computer console, dim lighting, retro-futuristic furniture.",
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
        description: "A heavily reinforced closet door north of the main console. It hums with quantum uncertainty.",
        visualPrompt: "A heavy steel vault door in a mundane apartment hallway, glowing with strange quantum energy around the edges.",
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
        exits: { "east": "hallway_archive" },
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