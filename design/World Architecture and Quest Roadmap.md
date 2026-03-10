Terra Agnostum: World Architecture & Quest Roadmap
==================================================

This document outlines the structural evolution of Terra Agnostum, transitioning from a single-room vertical slice into a multi-planar, shared multiplayer universe.

Core Cosmological Concepts
--------------------------

1.  **The Private Safezone (The Apartment):** Every player gets their own instanced apartmentMap. This is a PvP-free zone. It contains their Tandem Terminal, their storage, and their bed (healing).
    
2.  **The Nexus Portal (Schrödinger's Closet):** The Hacked Schumann Generator acts as a personal stargate. Initially, it only reaches the unstable **Astral Plane**. By finding _Resonant Codes_ in the shared world, players can upgrade the generator to tune into the **Faen** or **Technate**.
    
3.  **The Shared Reality (Public Maps):** Once a player steps out the "Front Door" (using their first Resonant Key), they enter the shared public map (Mundane). Here, they can encounter other players, explore public hubs (like Max's "Whistle Stop" Cafe), and engage in PvE or PvP combat.
    
4.  **Architect Planes:** High-level/powerful players can eventually forge and host their own persistent planes of reality, accessible via specific portal codes.
    

Phase 1: The Great Map Split (Immediate Next Baby Steps)
--------------------------------------------------------

_Goal: Separate the player's private apartment from the public shared world._

Currently, the entire apartmentMap syncs to a public Firebase document (apartment\_graph\_live). We must split this.

*   **Step 1.A (Local Data):** Separate mapData.js into two objects: privateApartment (Lore rooms, closet, bedroom) and publicWorld (Hallway, The Coast, Max's Cafe).
    
*   **Step 1.B (Firebase Routing):** Update main.js so that when a player is in a private room, changes save to users/{uid}/state/private\_map. When they step into the Hallway, changes save to public/data/maps/shared\_world.
    
*   **Step 1.C (The Transition):** The Front Door becomes the literal threshold between the instanced database and the public database.
    

Phase 2: Stratum Identity & The AI GM
-------------------------------------

_Goal: Ensure the AI clearly differentiates the "flavor" of each reality._

*   **Step 2.A (GM Prompt Injection):** Update gmEngine.js to inject strict stylistic rules based on localPlayer.stratum.
    
    *   _MUNDANE:_ Gritty cyberpunk, rainy, concrete, neon.
        
    *   _ASTRAL:_ Glitchy, non-euclidean, abstract, memories, static.
        
    *   _FAEN:_ Ethereal, magical, infinite, organic, ancient.
        
    *   _TECHNATE:_ Sterile, transhuman, white plasteel, silent, corporate.
        
*   **Step 2.B (Visual Prompts):** Ensure the apiService.js prepends these aesthetic keywords to image generation so a Faen room looks distinctly different from a Technate room.
    

Phase 3: Cross-Plane Quests & Generator Upgrades
------------------------------------------------

_Goal: Build environmental puzzles in the shared world that upgrade the player's private tools._

*   **The Prototype Quest (Max's Cafe):**
    
    1.  Player travels to the shared "Whistle Stop" (Max's Cafe).
        
    2.  Player uses narrative commands to sneak/talk their way into Max's Forge.
        
    3.  Player types: _"I put the Carmina Burana record on the player."_
        
    4.  The AI GM recognizes this specific puzzle solution and uses "trigger\_teleport" to dump them into a secret shared Faen map.
        
    5.  Player defeats a Faen entity and the GM uses "give\_item" to grant a **"Faen Resonance Code"**.
        
*   **The Upgrade:** Back in their private apartment, the player types _"install Faen code into generator"_. The local code unlocks a new option: _"Tune generator to Faen"_.
    

Phase 4: Multiplayer Interaction & Housing
------------------------------------------

_Goal: Bring players together._

*   **Step 4.A (Shared Presence):** In public nodes, the UI displays other active avatars in the "LOCAL ENTITIES" sidebar.
    
*   **Step 4.B (Safezones vs Combat Zones):** Implement a flag on rooms (e.g., pvpEnabled: false for Max's Cafe, true for the Cyber-Slums).
    
*   **Step 4.C (Apartment Invites):** Allow players to generate a temporary "Aethal Code" they can give to a friend. The friend types _"enter code XXXX"_ at their own front door, routing them into the host's private Firebase map instance.