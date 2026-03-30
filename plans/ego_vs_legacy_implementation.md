# Technical Specification: Ego vs. Legacy Progression Implementation

## 1. State Manager Updates (`js/stateManager.js`)

**Target**: Update `stats` schema to reflect V2 canonical sub-stats and AMN-based "Render Weight".

### New `stats` Object Structure:
```javascript
stats: {
    AMN: 20, // Total invested
    PHYS: { total: 6, Strength: 3, Agility: 3 },
    WILL: { total: 7, Conviction: 4, Anchor: 3 },
    AWR: { total: 7, Perception: 4, Insight: 3 },
    bias: { PHYS: 'A', WILL: 'A', AWR: 'A' } // 'A' or 'B' for 50/50 odd handling
}
```

### Utility Function: `updateSubStats(pool, newValue)`
```javascript
function updateSubStats(pool, newValue) {
    const bias = state.localPlayer.stats.bias[pool];
    const base = Math.floor(newValue / 2);
    const extra = newValue % 2;
    
    if (pool === 'PHYS') {
        state.localPlayer.stats.PHYS.Strength = base + (bias === 'A' ? extra : 0);
        state.localPlayer.stats.PHYS.Agility = base + (bias === 'B' ? extra : 0);
    }
    // ... repeat for WILL and AWR
}
```

---

## 2. Wizard System Updates (`js/wizardSystem.js`)

**Target**: Automated sub-stat distribution during character creation.

- Update the default `stats` object in the `avatar` wizard (Step 3) to use the new keys.
- Call the 50/50 distribution logic when assigning root stats.

---

## 3. GM Engine: Render Weight Logic (`js/gmEngine.js`)

**Target**: Inject context-aware instructions for "Heavy" and "Unstable" states.

### Implementation:
In `handleGMIntent`, before building the `userPrompt`, calculate the current AMN total and determine the state.

```javascript
const amn = activeAvatar.stats.AMN;
let weightContext = "";
if (amn > 25) {
    weightContext = "[RENDER WEIGHT: UNSTABLE] Reality is fraying. Inject surreal descriptions and logical gaps. Damage to the player's CONSC is doubled.";
} else if (amn > 20) {
    weightContext = "[RENDER WEIGHT: HEAVY] The player's signature is dense. Increase enemy awareness and inject narrative glitches into their successes.";
}
// Add weightContext to the systemPrompt or userPrompt
```

---

## 4. Schumann Choice Terminal Interface (`js/terminalSystem.js` or `js/ui.js`)

**Target**: A specialized wizard/dialog for level-up decisions.

- **Trigger**: When the player's XP crosses a threshold (to be defined in `stateManager`).
- **Options**:
    - `EXTRACT`: `playerAccount.AMN += 20`
    - `INFUSE`: `activeAvatar.stats.AMN += 20` -> Open secondary menu:
        - `LEVEL UP`: Unlock chip slot, heal.
        - `BUMP STAT`: Choose PHYS/WILL/AWR to +1.

---

## 5. UI Updates (`js/ui.js`)

- Update the Character HUD to show the new sub-stat names.
- Add a toggle button next to each pool to switch the "Primary Bias" (A/B).
