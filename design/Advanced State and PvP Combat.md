Terra Agnostum: Advanced State & Conflict Architecture

As Terra Agnostum evolves into a shared, persistent MUD, the architecture must graduate from a strictly client-driven model to a hybrid authoritative model. This document outlines the roadmap for handling living NPCs and secure, fair Player vs. Player (PvP) combat within our Serverless (Vercel) + State Sync (Firestore) + AI (Gemini) stack.

Phase 1: The Living World (NPC Autonomy)

Currently, NPCs are static strings inside a room's npcs array. To make the world feel alive, they need to move and act independently, even when players aren't watching. Because we lack a persistent game loop (server), we will simulate one using Vercel Cron.

Step 1.A: Entity Decoupling

Remove NPCs from the static room.npcs arrays in mapData.js.

Create a new Firestore collection: public/data/entities.

Each NPC document tracks its own state: { id, name, archetype, currentRoomId, hp, behaviorProfile: "wanderer" }.

Step 1.B: The Vercel "Heartbeat" (Cron)

Configure vercel.json with a cron job that pings a new API endpoint (/api/tick) every 5 minutes.

This serverless function queries all NPCs in public/data/entities with a mobile behavior profile.

It calculates random adjacent movement or pathfinding, executing a batch write to update their currentRoomId.

Result: The world shifts continuously. When a player logs in, NPCs are in new locations.

Step 1.C: Local Micro-Evaluation (Lazy Processing)

When a player enters a room, syncEngine.js queries public/data/entities for any NPCs where currentRoomId == player.currentRoom.

The gmEngine.js system prompt is injected with these entities, allowing Tandy (the AI GM) to animate their immediate reactions to the player entering.

Phase 2: The Double-Blind Arbiter (PvP Combat)

To prevent client-side "god-moding" (where a hacked client tells the database it instantly killed another player), combat must be resolved by an authoritative backend.

Step 2.A: Combat Instancing

When Player A types "Attack Player B", the AI GM recognizes the PvP intent and triggers a new action: "trigger_pvp": "Player B UID".

syncEngine.js writes to a new Firestore collection: public/data/combat_instances/{instanceId}.

This document flags both players as combat: true and locks them in the same instance.

Step 2.B: Intent Locking

Both players see a specialized combat UI prompt: "State your action."

Player A submits: "I unleash a burst of Aethal fire." -> Writes to the combat instance document as playerA_intent.

Player B submits: "I phase my somatic form out of reality." -> Writes as playerB_intent.

Neither player sees the other's intent until both are submitted.

Step 2.C: Authoritative Resolution via Webhook

Once the combat instance detects both intents are logged, it triggers a Vercel Serverless Function (/api/resolve-combat).

This function acts as the "Arbiter GM". It securely queries Gemini:

Prompt: "Player A (WILL: 15) attempts [Intent A]. Player B (WILL: 12) attempts [Intent B]. Based on Terra Agnostum lore, resolve this clash. Who takes damage?"

The backend writes the resulting narrative and damage directly to both players' state documents. syncEngine.js updates their UI instantly.

Phase 3: The Void State (Handling Disconnects & AFK)

A major risk in the Double-Blind Arbiter system is Player B disconnecting, going AFK, or rage-quitting before submitting their intent, thereby holding Player A hostage in an indefinite combat lock.

Step 3.A: Timestamped Encounters

When a combat turn begins, the combat_instances/{instanceId} document records a turn_started_at timestamp.

Step 3.B: The "Forced Resolution" Ping

The client UI runs a local 45-second countdown timer during combat.

If 45 seconds pass and the opponent hasn't submitted an intent, Player A's client reveals a "Force Resolve" button.

Clicking this pings the /api/resolve-combat Vercel function with a timeout flag.

Step 3.C: AI Takeover (The Glitch State)

The Vercel backend checks the turn_started_at timestamp. If > 45 seconds have passed, it penalizes the disconnected player.

Instead of waiting for Player B's intent, the Arbiter tells Gemini: "Player B's connection to the render has glitched (AFK). They are helpless. Player A attempts [Intent A]. Resolve the massive damage."

Alternative: The AI takes control of Player B, injecting an intent like "Player B's form flickers defensively as they attempt to hold their connection to the stratum."

The combat resolves, damage is dealt, and the combat lock is released, freeing Player A to continue their journey.