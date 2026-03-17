import test from 'node:test';
import assert from 'node:assert/strict';

// Dynamically import to ensure we can load the ESM module even if package.json isnt "type: module"
const stateManagerPath = '../js/stateManager.js';

test('stateManager.js Test Suite', async (t) => {
    // We import dynamically so we get a fresh module instance or at least bypass CJS/ESM strictness if needed
    // However, since stateManager has module-level state (`let state = {...}`), 
    // importing it once means all tests share the same state object.
    const { 
        getState, getUserTier, updatePlayer, 
        subscribe, updateMapNode, setActiveAvatar, setUser, 
        setState // using setState to forcefully reset between tests
    } = await import(stateManagerPath);

    // --- Helper to easily reset state between subtests ---
    const resetState = () => {
        setState('localPlayer', { 
            hp: 20, currentRoom: "void", stratum: "mundane",
            inventory: [], closetDoorClosed: false, isArchitect: false,
            explorerMode: false,
            combat: { active: false, opponent: null }, activeAvatarId: null
        });
        setState('localAreaCache', {});
        setState('activeAvatar', null);
        setState('user', null);
    };

    await t.test('getUserTier(): Tier Logic', async (t) => {
        resetState();

        await t.test('Returns VOID if no active avatar is set', () => {
            const tier = getUserTier();
            assert.equal(tier, 'VOID', 'Should be VOID when activeAvatar is null');
        });

        await t.test('Returns ARCHITECT if user is the hardcoded admin email', () => {
            setActiveAvatar({ id: 'avatar_123' });
            setUser({ email: 'matthewcarltyson@gmail.com' });
            
            const tier = getUserTier();
            assert.equal(tier, 'ARCHITECT', 'Should grant Architect to admin email');
        });

        await t.test('Returns ARCHITECT if localPlayer.isArchitect is true', () => {
            setActiveAvatar({ id: 'avatar_123' });
            setUser({ email: 'normal.user@example.com' });
            updatePlayer({ isArchitect: true });

            const tier = getUserTier();
            assert.equal(tier, 'ARCHITECT', 'Should grant Architect if isArchitect boolean is true');
        });

        await t.test('Returns GUEST if user.isAnonymous is true', () => {
            resetState();
            setActiveAvatar({ id: 'avatar_123' });
            setUser({ isAnonymous: true });

            const tier = getUserTier();
            assert.equal(tier, 'GUEST', 'Anonymous users should be GUEST tier');
        });

        await t.test('Returns RESONANT for standard authenticated users', () => {
            resetState();
            setActiveAvatar({ id: 'avatar_123' });
            setUser({ email: 'normal.user@example.com', isAnonymous: false });

            const tier = getUserTier();
            assert.equal(tier, 'RESONANT', 'Standard authenticated user should be RESONANT');
        });
    });

    await t.test('Notification Loop (Pub/Sub)', async (t) => {
        resetState();

        await t.test('subscribe() executes immediately with initial state', () => {
            let callCount = 0;
            let receivedState = null;

            const unsub = subscribe((state) => {
                callCount++;
                receivedState = state;
            });

            assert.equal(callCount, 1, 'Listener should be called once immediately on subscribe');
            assert.ok(receivedState, 'State should be passed to listener');
            assert.equal(receivedState.localPlayer.hp, 20, 'Should receive current state values');

            unsub();
        });

        await t.test('updatePlayer() triggers the notification loop', () => {
            let callCount = 0;

            const unsub = subscribe(() => {
                callCount++;
            });

            // callCount is now 1 due to initialization
            updatePlayer({ hp: 15 });

            assert.equal(callCount, 2, 'Listener should be called again after updatePlayer');
            assert.equal(getState().localPlayer.hp, 15, 'State should reflect update');

            unsub();
        });

        await t.test('unsubscribe() prevents future notifications', () => {
            let callCount = 0;

            const unsub = subscribe(() => {
                callCount++;
            });

            assert.equal(callCount, 1, 'Initial call');
            
            unsub(); // Remove the listener
            
            updatePlayer({ explorerMode: true });

            assert.equal(callCount, 1, 'Listener should NOT be called after unsubscribing');
        });
    });

    await t.test('State Immutability & Merging', async (t) => {
        resetState();

        await t.test('updatePlayer() merges properties without dropping existing ones', () => {
            const beforeState = getState().localPlayer;
            assert.equal(beforeState.stratum, 'mundane');
            assert.equal(beforeState.hp, 20);

            // Send partial update
            updatePlayer({ hp: 10, newBuff: true });

            const afterState = getState().localPlayer;
            assert.equal(afterState.hp, 10, 'Target property should be updated');
            assert.equal(afterState.newBuff, true, 'New properties should be appended');
            assert.equal(afterState.stratum, 'mundane', 'Unrelated properties should remain intact');
            assert.ok(Array.isArray(afterState.inventory), 'Nested objects/arrays should survive (shallow merge for localPlayer root properties)');
        });

        await t.test('updateMapNode() deeply creates/merges localAreaCache nodes', () => {
            resetState();

            // Scenario 1: New node
            updateMapNode('room_1', { name: "Spawn Point", description: "A dark void" });
            
            let cache = getState().localAreaCache;
            assert.ok(cache['room_1'], 'Should inject a new node into cache');
            assert.equal(cache['room_1'].name, "Spawn Point");

            // Scenario 2: Update existing node without destroying other props
            updateMapNode('room_1', { description: "Lit by a candle" });
            
            cache = getState().localAreaCache;
            assert.equal(cache['room_1'].name, "Spawn Point", 'Original name property should carry over');
            assert.equal(cache['room_1'].description, "Lit by a candle", 'Description property should be overwritten');
        });
    });

});
