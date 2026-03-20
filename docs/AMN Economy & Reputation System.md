# AMN Economy & Reputation System

> *"In the eternal space (dimension) of infinite consciousness, in the infinite play of the infinite, there are infininte minds and infinte worlds in them."*
> — Yoga Vasistha

---

## 1. AMN as Universal Currency

**AMN** (OM|AMEN) is the singular resource that fuels everything in Terra Agnostum. It represents the player's total bandwidth of expressed consciousness within the simulation. It is spent to:

- **Create and power characters** (20 AMN per vessel)
- **Build rooms and regions** (AMN cost per node)
- **Forge items and lore fragments** (AMN cost per creation)
- **Spawn persistent NPCs** (AMN cost per entity)
- **Create and seed quests** (AMN cost per objective chain)

**Core Principle:** Every act of creation draws from the same pool. This forces meaningful choices — a player with 40 AMN can run two characters, OR one character and a small homestead. Consciousness is finite; how you project it defines who you are.

---

## 2. Tier Progression

| Tier | Source | AMN | Char Slots | World Powers | Earn Cap/Session |
|------|--------|-----|------------|--------------|-----------------|
| **GUEST** | Anonymous | 20 | 1 | None | +2 |
| **RESONANT** | Free registration | 40 | 2 | Room description edits | +5 |
| **ARCHITECT T1** | Paid subscription | 60 | 3 | Room building, item creation, lore | +8 |
| **ARCHITECT T2** | Paid subscription | 100 | 5 | Quest creation, NPC spawning, Stratum editing | +12 |

> *Lore justification: Higher tiers represent deeper resonance with the Amn Sen network. The stones recognize your signal's fidelity and allocate more bandwidth.*

---

## 3. Earning AMN (Play-to-Expand)

AMN is not only purchased — it's **earned through meaningful contribution**. The AIGM evaluates quality and impact, not volume.

### Earning Actions

| Action | AMN Reward | AIGM Evaluation |
|--------|-----------|-----------------|
| Complete a quest | +1-3 (by rank) | Was it creative or formulaic? |
| Create lore others interact with | +1 per interaction | Quality of writing, resonance with world |
| Deploy an NPC others engage | +1 per engagement | Depth of personality, usefulness |
| Build a room that gets visited | +1 per unique visitor | Atmosphere, connectivity, purpose |
| Discover a Fict | +2 | Genuine discovery vs. brute-force searching |
| Defeat a boss / survive Stratum event | +1-2 | Tactical creativity, narrative engagement |
| Help another player (AIGM-detected) | +1 | Prosocial behavior is the highest signal |
| Earn a Badge (see §5) | +1-5 (by rarity) | One-time bonus per Badge |

### Guardrails

- **Soft cap** per session (see tier table) prevents inflation
- **AIGM quality filter** — farming or low-effort repetition earns nothing
- **Negative AMN?** No. But exploitative behavior can trigger AIGM narrative consequences (Technate audit, Shadow corruption, Amn Sen rejection)

---

## 4. Renowned Deeds

Renowned Deeds are **unique, permanent narrative achievements** attached to a character's identity. They are not generic achievements — they are **AI-authored, bespoke descriptions** of exceptional actions the player performed.

### How They Work

1. The AIGM monitors player actions for moments of genuine significance
2. When a threshold is crossed, the AIGM authors a Deed and attaches it to the character
3. Deeds are **visible to other players** who inspect the character or interact with them as an NPC

### Example Deeds

| Deed | How Earned |
|------|-----------|
| *"Shattered the Mirror Without Flinching"* | Defeated their Shadow Avatar in a single combat round |
| *"Architect of the Verdant Corridor"* | Built a connected region of 5+ rooms that 10+ players visited |
| *"The One Who Listened"* | Helped 5+ other players solve quests without taking credit |
| *"Walked Between Without Breaking"* | Successfully traversed 3 Strata in a single session without taking damage |
| *"Named a Fict That Stuck"* | Created a lore fragment that the AIGM began referencing autonomously |

### Properties

- **Unrepeatable** — each Deed can only be earned once
- **Narrative, not mechanical** — they don't grant stat bonuses (AMN is the reward)
- **Persistent across vessel retirement** — if a character becomes an NPC, their Deeds travel with them
- **AIGM-authored** — the AI writes the Deed title and description contextually, never from a template list. Every Deed is unique prose.

---

## 5. Badges

Badges are **categorical recognition markers** — broader than Deeds, more structured, and visible in the player's profile HUD. Think of them as the system's formal acknowledgement of a player's playstyle.

### Badge Categories

| Badge | Criteria | Rarity |
|-------|----------|--------|
| 🔨 **BUILDER** | Created 3+ rooms that persisted | Common |
| ⚔️ **DUELIST** | Won 5+ Battles of Will | Common |
| 📜 **LOREKEEPER** | Authored 5+ lore fragments | Common |
| 🌀 **STRATUM WALKER** | Visited all known Strata | Uncommon |
| 👁️ **SEER** | Discovered 3+ Ficts | Uncommon |
| 🤝 **COMPASS** | AIGM detected 10+ prosocial actions | Rare |
| 🏛️ **REGION LORD** | Built and maintained a 10+ room connected region | Rare |
| 💀 **SHADOW EATER** | Defeated Shadow Avatar with 1 HP remaining | Epic |
| ∞ **ROOT SIGNAL** | Earned 50+ AMN through play alone (no purchases) | Legendary |

### Properties

- **Progressive** — some Badges have tiered levels (Bronze → Silver → Gold)
- **AMN bonus** on first acquisition (+1 Common, +2 Uncommon, +3 Rare, +5 Epic/Legendary)
- **Displayed in character profile** and visible to other players
- **Persist on vessel retirement** and transfer to the player account, not the character

---

## 6. Vessel Retirement & NPC Legacy

The pinnacle of the character lifecycle: a player can **retire a fully developed character**, transforming them into a **persistent, AI-driven NPC** that inhabits the world permanently.

### The Retirement Flow

1. **Eligibility:** Character must have at least 3 Renowned Deeds and 2 Badges
2. **Player initiates:** `LEAVE VESSEL` command (already exists) with a new `--LEGACY` flag
3. **AIGM conducts an Exit Interview:** The AI asks the player to describe the character's autonomous personality, goals, and behavioral tendencies in their own words
4. **Character becomes an NPC:** Their stats, inventory, Deeds, Badges, and personality description are frozen into a persistent NPC entity
5. **Region Inheritance:** If the character was the primary builder of a region, that region becomes the NPC's **domain**. They patrol it, interact with visitors, and evolve their behavior based on AIGM simulation

### What the NPC Retains

| Attribute | Retained? |
|-----------|-----------|
| Name, portrait, visual prompt | ✅ |
| Stats (AMN/PHYS/WILL/AWR + sub-stats) | ✅ |
| Inventory | ✅ |
| Renowned Deeds | ✅ (visible on inspection) |
| Badges | ✅ (displayed) |
| Personality (player-authored + AIGM-refined) | ✅ |
| Quest associations | ✅ (can become quest-givers) |

### What the Player Gets

- **AMN refund:** 50% of the character's AMN cost is returned to the player's pool
- **Legacy Badge:** `🏛️ PROGENITOR` — awarded for creating a lasting world citizen
- **Ongoing AMN trickle:** +1 AMN per session that other players interact with their retired NPC

### The Vision

A veteran player could, over months, build up a powerful character, construct an entire region of interconnected rooms, populate it with lore and items, and then retire their character as the **steward** of that region. New players would encounter a rich, AI-driven NPC with genuine history, real Deeds, player-authored personality, and a living domain — never knowing it was once a player character unless they inspect it.

> *"The greatest act of consciousness is to create something that outlives you."*

---

## 7. AIGM Reputation Evaluation

The AIGM is the **sole arbiter** of reputation rewards. It evaluates:

- **Creativity** — Did the player do something unexpected or novel?
- **Quality** — Is the contribution well-crafted (lore, rooms, items)?
- **Impact** — Did other players benefit from or interact with the contribution?
- **Prosocial behavior** — Did the player help others, cooperate, teach?
- **Narrative coherence** — Does the contribution fit the world's tone and lore?

The AIGM explicitly does **not** reward:
- Repetitive grinding
- Exploitative farming patterns
- Low-effort bulk creation
- PvP griefing or antisocial behavior

> *Design Note: The AIGM's judgment is intentionally opaque. Players should feel that the world itself recognizes them, not that they are gaming a points system. The magic is in not knowing exactly when or why the reward comes.*
