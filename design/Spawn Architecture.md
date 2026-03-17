TERRA AGNOSTUM: SPAWN ARCHITECTURE (v1.2)

Code Name: The Anchor Node & The Resonant Path

The introductory experience must be flawless. New players need a safe, private space to learn the commands, create their character, and learn the combat system before being thrust into the chaotic, multiplayer universe.

We utilize Deterministic Instancing (Option 3) to generate a permanent, private apartment for every user the moment they connect, doubling as their tutorial sandbox and future player housing.

THE CORE ARCHITECTURE: DETERMINISTIC INSTANCING

The Concept: Players spawn into a private instance of the apartment map tied directly to their Firebase UID. This prevents new players from seeing each other's items or avatars during the initial tutorial flow.

The UID Node: The room ID follows the pattern `instance_{uid}_{blueprintKey}` (e.g., `instance_abc123_bedroom`).

Implementation Details:
1.  **On-Demand Seeding**: Upon first connection, the engine checks for the existence of the player's private bedroom. If missing, it clones the entire `blueprintApartment` into the global `rooms` collection, prefixing all room IDs and their internal exits with `instance_{uid}_`.
2.  **Relative Routing**: The `intentRouter` detects when a player is in an instanced room. When resolving an exit like "north: kitchen", it automatically maps it to `instance_{uid}_kitchen`.
3.  **Global Threshold**: Specific exits (like the Hallway door) are flagged to point to global room IDs (e.g., `corovon_street_01`), transitioning the player from their private instance to the shared multiplayer world.

**Future-Proofing for Social & Admin Access**:
*   **Authorized Access**: Every instanced room includes a `metadata.authorizedUids` array. In the future, a player can use a command like `GRANT ACCESS {uid}` to allow a friend into their private node.
*   **Architect Override**: The `metadata.owner` field and the `isArchitect` player flag allow developers to bypass security rules for debugging or moderation. Architect-level commands like `TELEPORT instance_{uid}_bedroom` are natively supported by the deterministic ID pattern.

Developer Oversight (Tier 0): Users with the isArchitect flag bypass this security rule. A developer can use a command like > TELEPORT apartment_{uid} to visit a user's private node, inspect their localized items, and debug issues.

Account Linking: When an anonymous player registers their email, Firebase upgrades their anonymous UID to a permanent one. Their apartment_{uid} and everything in it persists seamlessly.

THE "RESONANT PATH" TUTORIAL FLOW

This 6-step flow acts as a vertical slice of Terra Agnostum, teaching the player every core system before unlocking the multiplayer world.

Step 1: The Anonymous Arrival (Basic UI)

Status: Anonymous UID. No Character State.

Location: apartment_{uid} (Mundane Stratum).

Narrative: The player wakes up in a sterile, locked Technate apartment. The main door is sealed by a "Resonance Lock."

Goal: Teach the player to use LOOK and EXAMINE.

Step 2: The Forge (Character Creation)

Trigger: The player examines the "Foggy Mirror" in the bathroom.

Action: This triggers the Forge UI/Wizard. The player generates their Vessel (allocates PHYS, AWR, WILL, and generates their portrait).

Narrative: As they finalize the character, Tandy (the AIGM) informs them their form is "unstable" and must be anchored.

Step 3: The Resonator (Stratum Shifting)

Trigger: The player examines the "Dark Closet." Inside, they find a strange, humming device: The Resonator.

Action: The player types USE RESONATOR.

Mechanic: The backend intercepts this. It changes the player's currentRoom from apartment_{uid} to astral_trial_{uid}, and shifts the active Stratum to Astral.

Step 4: The Trial (Combat & Death)

Location: astral_trial_{uid} (A dark, shifting void).

Encounter: The player faces the "Shadow Avatar."

Mechanic: The Combat Overlay engages. The player learns to "Weave" intents against the Avatar.

Outcome A (Victory): The player reduces the Avatar's CONSC to 0. They receive the Resonant Key (added to inventory or state flags).

Outcome B (Defeat): If the player's WILL drops to 0, they "die" in the Astral. Because Astral death just resets you, they wake up back in apartment_{uid} with full stats and must try the Resonator again.

Step 5: The Exit (Entering the World)

Trigger: The victorious player is teleported back to apartment_{uid} holding the Resonant Key.

Action: The player approaches the main sealed door and types UNLOCK DOOR or OPEN DOOR.

Mechanic: The engine checks for the Resonant Key. If true, the door opens and the key is consumed (dissolving into the lock so it doesn't clutter inventory).

Step 6: The Anchor (Registration)

Trigger: The door unlocks, revealing the blinding light of the global render. Tandy interrupts before they can step through.

Action: Tandy prompts: "To cross the threshold into the persistent render, your signature must be permanently anchored." The player clicks a UI prompt to register their email/password.

Reward: They are upgraded to Tier 3 (The Resonant), their local data syncs securely to the cloud, their currentRoom is updated to the global starting hub (e.g., corovon_street_01), and they enter the live multiplayer universe.