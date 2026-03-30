# Terra Agnostum: Ego vs. Legacy Progression (Refined)

> *"The first 20 AMN buys you a life. The next 20 AMN asks you what that life is worth."*
> — The Amn Sen Chronicles

---

## 1. The Core Mechanical Hook: The 20 AMN Dividend

Progression is a constant negotiation between personal power and world-building influence.

### The Resonance Event (Level-Up)
Whenever a Vessel crosses an Amn Threshold (Level Up), the system generates **20 AMN**.

### The Schumann Choice (Terminal Interface)
The player must choose how to distribute this new "Meaning" via a terminal interface:

1.  **Extract to Account (Legacy)**: The 20 AMN is moved to the global Player Account.
    *   **Use Case**: Creating rooms, persistent NPCs, forging items, or funding new characters.
    *   **Philosophy**: Sacrifice personal growth to become an Architect.
2.  **Infuse Vessel (Ego)**: The 20 AMN is consumed for a permanent character upgrade.
    *   **Option A: Level Up**: Unlock a new Ability Chip slot and fully restore CONSC.
    *   **Option B: Root Stat Bump**: Increase one Core Stat (PHYS, WILL, or AWR) by +1.
    *   **Philosophy**: Sacrifice the world's expansion to become a "God in the Render."

---

## 2. Character Over-Clocking & Render Weight

Total AMN invested in a vessel determines its "Render Weight" and stability within the Stratum.

| AMN Total | State | Effects |
| :--- | :--- | :--- |
| **≤ 20** | **Stable** | Standard physics, normal DC modifiers, expected enemy behavior. |
| **21–25** | **Heavy** | **Beacon Effect**: Increased frequency of Elite Units and Shadow Avatars. <br> **Glitch Injections**: Tandy adds side effects to successful actions. |
| **> 25** | **Unstable** | **Stratum Bleed**: Reality frays (surreal descriptions, hostile environment). <br> **Fragile Ego**: Double damage to CONSC. |

### AI "Glitch" Mechanics (Tandy Guidelines)
When a character is **Heavy** or **Unstable**, the AIGM should inject narrative disruptions:
*   **Hardware Surges**: A successful hack causes a physical explosion or local blackout.
*   **Echo Actions**: A character's movement leaves "after-images" that distract or draw fire.
*   **Sensory Distortion**: The player sees objects from other Strata (e.g., a Faen tree in a Technate hallway).
*   **Logical Gaps**: Doors that were locked are suddenly gone, or a floor becomes liquid for a second.

---

## 3. Stat Population & Sub-Stat Distribution

Root stats (PHYS, WILL, AWR) distribute points into sub-stats.

### 50/50 Baseline (v2 Alignment)
Points are split evenly between sub-stats.

| Root Stat | Sub-Stat A (50%) | Sub-Stat B (50%) |
| :--- | :--- | :--- |
| **PHYS** | Strength | Agility |
| **WILL** | Conviction | Anchor |
| **AWR** | Perception | Insight |

### Handling Odd Numbers (The Preference Toggle)
If a stat is odd (e.g., WILL 7), the distribution uses a **Primary Bias** toggle in the Character HUD:
*   **Bias A**: (7 / 2) -> 4 / 3
*   **Bias B**: (7 / 2) -> 3 / 4
*   *Edge Case*: At exactly 20 AMN, if a player has 7/7/6 split, sub-stats follow the bias.

---

## 4. Technical Refinement & Edge Cases

*   **Exactly 20 AMN**: This is the "Goldilocks Zone." The character is at peak stability before the "Heavy" penalties begin. It is the recommended state for standard exploration.
*   **The "Progenitor" Loop**: Players can use a high-level character to "mine" AMN through quests, then extract it to build an entire player-owned sector.
*   **Stat Cap**: While AMN can go high, individual Root Stats are soft-capped by the risk of "Unstable" status.

---

## 5. Checklist of File Modifications

### `js/stateManager.js`
- [ ] Rename `WILL.stability` -> `WILL.Anchor`
- [ ] Rename `WILL.projection` -> `WILL.Conviction`
- [ ] Rename `AWR.focus` -> `AWR.Insight`
- [ ] Rename `AWR.perception` -> `AWR.Perception` (ensure casing consistency)
- [ ] Ensure `PHYS.strength` and `PHYS.agility` match canonical names.

### `js/wizardSystem.js`
- [ ] Implement `calculateSubStats(rootValue, bias)` helper.
- [ ] Update `avatar` wizard step 3 to use the 50/50 distribution with a default bias.

### `js/gmEngine.js`
- [ ] Update `buildSystemPrompt` to include "Render Weight" logic.
- [ ] Inject instructions for Tandy to apply "Glitch Mechanics" based on AMN total.

### `js/ui.js` or `js/terminalSystem.js`
- [ ] Create the **Schumann Choice** interface (triggered on level-up).
- [ ] Add the **Primary Bias** toggle to the Character HUD.
