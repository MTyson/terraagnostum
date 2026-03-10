TERRA AGNOSTUM: THE BATTLE OF WILLS (v0.2)

I. THE THEATER OF CONFLICT (THE INTERFACE)

When combat initiates, the Combat Overlay takes over the central viewport (CLI & Log). The design is mobile-first, using an MTG-inspired "Active Card" layout to keep information dense but readable.

1. Visual Stack (Mobile-First)

The Header: Round-timer (45s) and the current "Chief Mechanic" (AIGM) status.

The Opponent Card (Top): Portrait, current CONSC/PHYS, and "Active Intent" (a cryptic hint of what they are about to do).

The Resolution Log (Center): A scrolling, high-contrast narrative area where the AIGM describes the results of the "Weave."

The Player Card (Bottom): Your portrait, stats (WILL, AWR, PHYS), and a hand of "Ability Chips" (based on your Vessel's traits/items).

II. THE TRI-STAT MECHANICS

Combat is not just about health; it is about the structural integrity of your projection.

Stat

Combat Function

Loss Condition

WILL

The battery for reality-warping. Used to "Force a Weave" or resist psychic erasure.

0 = DISCONTINUED. Vessel is moved to the "Archive of the Failed" in the Character Room.

AWR

Determines Initiative. High AWR allows you to see the Opponent's "Active Intent" card before you act.

Used as a defensive modifier against "Glitches" and stealth.

PHYS

Resistance to kinetic damage (weapons, impacts).

0 = DEAD. Immediate respawn at Bedroom. Lose 1 WILL.

CONSC

Consciousness stability.

0 = OUT. Character is unconscious. Vulnerable to PHYS damage.

III. THE COMBAT LOOP: "WEAVE & RESOLVE"

Combat moves in 45-second increments.

THE WEAVE (Input Phase): The player types a narrative description of their action (e.g., "I attempt to stabilize the floor and trip the Shadow Avatar with a burst of static").

THE FREE MOVE: During this phase, users can use commands like STAT or LOOK without consuming their turn.

THE RESOLUTION: The Chief Mechanic AIGM evaluates the description against the stats:

Success: Action manifests. Damage dealt to Opponent's CONSC or PHYS.

Glitch: A failure. The player takes somatic feedback damage.

THE TAKEOVER: If the timer hits 0 or the user is disconnected, the Chief Mechanic executes a "Basic Logic" move based on the character's highest stat (e.g., a PHYS-heavy character will perform a kinetic strike).

IV. OUTCOME STATES & PERSISTENCE

1. The "OUT" State (CONSC = 0)

The vessel collapses. The player is locked from input for a duration determined by AIGM Tandy.

The body remains in the room. If an enemy attacks a player who is "OUT," damage goes directly to PHYS.

Recovery: If left alone, CONSC repairs at a rate of 1 per minute.

2. The "DEAD" State (PHYS = 0)

The vessel's physical shell is destroyed.

Penalty: 1 WILL is permanently deducted from the character's anchor.

Respawn: The player materializes in their Apartment Bedroom.

3. The "DISCONTINUED" State (WILL <= 0)

The character's signature is too weak to hold a form in any stratum.

The Vessel is listed as "INACTIVE" in the Forge. It can no longer be deployed.

V. WEAKNESSES & DESIGN SOLUTIONS

Weakness: Narrative Subjectivity. (How does the AI know if I win?)

Solution: We implement a hidden "Success DC" (Difficulty Class) for every turn. The AI uses the player's description to determine which stat to test (WILL for magic, PHYS for brawn) and rolls against the DC.

Weakness: The "Run Away" Problem.

Solution: Movement is locked during combat. To leave, a player must use the ESCAPE command. This triggers an AWR vs. AWR check. If successful, they move to an adjacent room. If they fail, they are "STUNNED" for one turn.

Weakness: Ghosting / AFK Players.

Solution: The "Chief Mechanic" takeover is non-negotiable. This prevents combat from stalling in a multiplayer environment.


-- HUMAN WRITTEN STUFF:
Combat should open a pane that takes over the main commands (the CLI and log) area.  It should have a card-based MTG style layout where the combatants each display their cards.

We can display stats and abilities, etc.  The main thing right now is to be mobile first so the combat interface doesn't get too noisy.

If a character drops to 0 CONSC they are 'OUT' for time dtermined by AIGM Tandy.  If there body is unharmed, they recover CONSC to 1 and it slowly repairs

If a character's PHYS drops to 0 (including if while 'OUT') then they are DEAD and they will respawn at their apartment bedroom, losing 1 WILL.

WILL is also lost in the astral combat with the Shadow Avatar.

WILL Does not replenish over time, only by specific in-game mechanics.  (TBD.)

If WILL drops to 0 (or below) that character is DISCONTINUED and listed at that user's CHARACTER ROOM.

Combat locks movement (but we may support ESCAPE!).  

If a user logs out or is discconnected, the CHIEF MECHANIC AIGM takes over their roll.

During combat, each user gets to describe their actions in 45 second increments.  If a player doesnt' respond, the CHIEF MECHANIC AIGM takes their turn.

Users can perform some movements for free during dombat turns like checking stats and the like at the AIGM Tandy's discretion.