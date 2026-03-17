// js/stratumData.js

export const DEFAULT_STRATA = {
    mundane: {
        id: 'mundane',
        name: 'The Mundane',
        description: 'Caught in the middle between The Technate and Faen. A relatable, 21st-century Earth foundation with subtle "glitches" in reality.',
        theme: 'glitchy-urban',
        color: '#2a5a2a', // Dim Green
        visualStyle: 'gritty 1980s cyberpunk, claustrophobic dystopian sci-fi, dark and dirty, decaying, exposed wiring, CRT glow, heavy VHS tracking noise, indoors, enclosed architecture',
        flavor: 'recognizably "off"',
        rules: {
            naming: 'relatable 21st-century foundation, glitched versions of reality',
            combat: 'physical focus'
        }
    },
    astral: {
        id: 'astral',
        name: 'The Astral Plane',
        description: 'A shifting expanse of raw potential and fragmented memory. Space is fluid and glowing.',
        theme: 'surreal-ethereal',
        color: '#d8b4fe', // Astral Purple
        visualStyle: 'abstract fractal, non-euclidean geometry, shimmering neon purple and gold static, glowing, fluid geometry, dream-like landscapes, shifting colors',
        flavor: 'raw potential',
        rules: {
            naming: 'mystic blends, Sanskrit or Arabic roots, corporate system designations',
            combat: 'Battle of Wills'
        }
    },
    faen: {
        id: 'faen',
        name: 'Faen',
        description: 'A realm of ancient high-fantasy, deep lore and nature. Melodic sounds and shadows overlap with reality.',
        theme: 'high-fantasy',
        color: '#5a2a5a', // Deep Purple/Magenta
        visualStyle: 'dark surrealism, ethereal watercolor, fluid glitch-art, twisted nature, high-fantasy aesthetic, plants, shadows, melodic elements',
        flavor: 'ancient and melodic',
        rules: {
            naming: 'Archaic Drift, Vowel Shifting, Nature-Burden nicknames',
            combat: 'magical focus'
        }
    },
    citycore7: {
        id: 'citycore7',
        name: 'CityCore7',
        description: 'A dystopian sci-fi realm of absolute optimization. Clinical transhumanism and cypherpunk grit.',
        theme: 'clinical-cypherpunk',
        color: '#2a2a5a', // Clinical Blue
        visualStyle: 'clinical brutalism, sterile white-on-cyan, severe geometric architecture, dystopian corporation, high contrast, oppressive',
        flavor: 'optimized and clinical',
        rules: {
            naming: 'Compression, Phonetic Flattening, Data-Tagging',
            combat: 'technological focus'
        }
    }
};
