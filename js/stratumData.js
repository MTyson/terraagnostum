// js/stratumData.js

export const DEFAULT_STRATA = {
    mundane: {
        id: 'mundane',
        name: 'The Mundane',
        description: 'Caught in the middle between The Technate and Faen. A relatable, 21st-century Earth foundation with subtle "glitches" in reality.',
        theme: 'glitchy-urban',
        color: '#2a5a2a', // Dim Green
        visualStyle: 'modern, slightly distorted, typos on legal documents, relatable global names',
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
        visualStyle: 'glowing, fluid geometry, dream-like landscapes, shifting colors',
        flavor: 'raw potential',
        rules: {
            naming: 'mystic blends, Sanskrit or Arabic roots, corporate system designations',
            combat: 'Battle of Wills'
        }
    },
    faen: {
        id: 'faen',
        name: 'Faen',
        description: 'A realm of ancient high-fantasy and nature-burdened magic. Melodic sounds and shadows overlap with reality.',
        theme: 'high-fantasy-decay',
        color: '#5a2a5a', // Deep Purple/Magenta
        visualStyle: 'archaic drift, vowel shifts, plants, shadows, melodic elements, high-fantasy aesthetic',
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
        visualStyle: 'compression, phonetic flattening, data-tagging, gritty street monikers, hardware-slang',
        flavor: 'optimized and clinical',
        rules: {
            naming: 'Compression, Phonetic Flattening, Data-Tagging',
            combat: 'technological focus'
        }
    }
};
