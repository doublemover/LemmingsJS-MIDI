import { expect, test } from '@playwright/test';
import { installWebMidiStub } from './helpers/webmidiStub.js';

for (const scenario of [
  { name: 'game-unlinked', speedMode: 'game', linked: false },
  { name: 'bpm-linked-clamped', speedMode: 'bpm', linked: true, blur: true },
  { name: 'game-linked', speedMode: 'game', linked: true },
  { name: 'bpm-unlinked', speedMode: 'bpm', linked: false, blur: true },
  { name: 'paused', speedMode: 'game', linked: false, paused: true }
]) test('native speed key keeps the recorded physical clock under ' + scenario.name + ' @boundary @physical-clock-input', { tag: ['@boundary', '@workstation-transport'] }, async ({ page }, testInfo) => {
  test.setTimeout(90000); await page.goto('/procgen.html?e2e=1&recipe=1&seed=42&lanes=1&speed=4'); await page.bringToFront();
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.workstationEnabled);
  const before = await page.evaluate(async scenario => {
    const studio = window.__PROCGEN_STUDIO__, api = window.__PROCGEN_LANES__; studio.transport.pause(); api.pause();
    studio.handlers.transport({ gameSpeed: 4, bpm: 180, speedMode: scenario.speedMode, linked: scenario.linked });
    const armed = await studio.handlers.startCausalTake({ takeName: 'Native clock ' + scenario.name }); if (!armed) throw new Error('Take admission failed');
    if (!scenario.paused) { studio.play(); api.resume(); } else { studio.transport.pause(); api.pause(); }
    document.activeElement?.blur(); return { tick: api.world.tickIndex, takeId: armed.takeId };
  }, scenario);
  await page.keyboard.down('Equal');
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.transport.getState().gameSpeed)).toBe(5);
  const captured = await page.evaluate(() => ({ state: window.__PROCGEN_STUDIO__.transport.getState(), timer: window.__PROCGEN_LANES__.world.timer.speedFactor, tick: window.__PROCGEN_LANES__.world.tickIndex }));
  expect(captured.timer).toBe(captured.state.effectiveSpeed);
  if (scenario.paused) { await page.locator('#procgenStep').click(); await expect.poll(() => page.evaluate(() => window.__PROCGEN_LANES__.world.tickIndex)).toBe(before.tick + 1); }
  else await expect.poll(() => page.evaluate(() => window.__PROCGEN_LANES__.world.tickIndex)).toBeGreaterThanOrEqual(before.tick + 3);
  if (scenario.blur) await page.evaluate(() => window.dispatchEvent(new Event('blur'))); else await page.keyboard.up('Equal');
  const result = await page.evaluate(async ({ before, scenario, captured }) => {
    const studio = window.__PROCGEN_STUDIO__, api = window.__PROCGEN_LANES__; studio.transport.pause(); api.pause(); const stopped = await studio.handlers.stopCausalTake();
    const root = new URL('./', location.href), { createProcgenSessionStorage } = await import(new URL('js/app/procgen/workstation/ProcgenSessionStorage.js', root)), { createProcgenCausalJournal } = await import(new URL('js/app/procgen/workstation/ProcgenCausalJournal.js', root)), { getProcgenResourceBudgetState } = await import(new URL('js/app/procgenBoot.js', root));
    const storage = createProcgenSessionStorage();
    try {
      const journal = createProcgenCausalJournal({ storage }), manifest = await journal.openTake(before.takeId), records = (await journal.query({ takeId: before.takeId })).records;
      const input = records.find(record => record.kind === 'input-observation' && record.payload.kind === 'transport-state' && record.payload.speedFactor === (scenario.paused ? captured.state.nominalSpeed : captured.state.effectiveSpeed));
      const batch = records.find(record => record.kind === 'physical-batch' && record.tick > (input?.tick ?? before.tick));
      const liveWorld = api.world; await studio.handlers.selectCausalTake(before.takeId); const budgetBeforeReplay = getProcgenResourceBudgetState(), replay = await studio.handlers.compareCausalTake();
      return { scenario: scenario.name, nativeKeydown: true, interruption: scenario.blur ? 'controlled-window-blur' : 'native-keyup', requestedGameSpeed: captured.state.gameSpeed, nominalSpeed: captured.state.nominalSpeed, effectiveSpeed: captured.state.effectiveSpeed, timer: captured.timer, complete: stopped.complete,
        input: input && { sequence: input.sequence, tick: input.tick, payload: input.payload }, batch: batch && { sequence: batch.sequence, tick: batch.tick, tickDurationMs: batch.payload.tickDurationMs }, finalTimer: api.world.timer.speedFactor,
        replay: replay?.receipt || null, liveWorldUnchanged: api.world === liveWorld, budgetBeforeReplay, budgetAfterReplay: getProcgenResourceBudgetState(), checkpointReferences: [manifest.initialCheckpoint, ...manifest.checkpoints].map(({ bytes, nodes, sequence }) => ({ bytes, nodes, sequence })) };
    } finally { storage.close(); }
  }, { before, scenario, captured });
  await page.keyboard.up('Equal'); await testInfo.attach('physical-clock-input.json', { body: JSON.stringify(result), contentType: 'application/json' });
  expect(result.complete).toBe(true); expect(result.finalTimer).toBe(0); expect(result.batch).toBeTruthy();
  expect(result.replay?.compatibilityMatch, JSON.stringify(result.replay)).toBe(true); expect(result.liveWorldUnchanged).toBe(true);
  expect(result.input.sequence).toBeLessThan(result.batch.sequence); expect(result.input.tick).toBeLessThan(result.batch.tick); expect(result.batch.tickDurationMs).toBeCloseTo(60 / (scenario.paused ? result.nominalSpeed : result.effectiveSpeed), 8);
});

async function ready(page) {
  await page.goto('/procgen.html?e2e=1&seed=42');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain, null, { timeout: 60000 });
  await page.evaluate(() => window.__PROCGEN_STUDIO__.transport.pause());
}

test('sustained synth gate and queued phrase survive a paused checkpoint without duplicate resumed voices', { tag: ['@boundary', '@workstation-transport'] }, async ({ page }) => {
  test.setTimeout(90000); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await ready(page); await page.locator('#procgenListen').click();
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.getPlaybackState().enabled)).toBe(true);
  await page.evaluate(() => {
    const studio = window.__PROCGEN_STUDIO__, project = studio.getProject();
    for (const [index, lane] of project.procgen.lanes.entries()) studio.dispatch({ type: 'procgen/lane', laneId: lane.id, patch: { mode: 'pattern', patternPurpose: 'Exercise a sustained complementary phrase across a physical checkpoint', mute: index > 0 } });
    studio.dispatch({ type: 'procgen/pattern', laneId: 'lane-1', slot: 0, patch: { length: 16, steps: Array.from({ length: 16 }, (_, index) => ({ enabled: index === 0, note: 60, duration: 8 })) } });
    studio.transport.seek(0); studio.handlers.record(true); studio.play();
    studio.dispatch({ type: 'procgen/launch', laneId: 'lane-1', slot: 1 });
  });
  const held = await page.waitForFunction(() => {
    const studio = window.__PROCGEN_STUDIO__;
    if (studio.getPlaybackState().activeNotes !== 1 || studio.engine.snapshot().active.length !== 1) return false;
    studio.transport.pause(); window.heldSession = studio.capture('Held');
    return { active: window.heldSession.patterns.active.length, beat: window.heldSession.transport.beat, queued: window.heldSession.project.procgen.lanes[0].queuedSlot };
  }, null, { timeout: 15000 }); const saved = await held.jsonValue(); await held.dispose();
  expect(saved.active).toBe(1); expect(saved.queued).toBe(1);
  expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.getPlaybackState().activeNotes)).toBe(0);
  await page.evaluate(async () => window.__PROCGEN_STUDIO__.loadSession(window.heldSession));
  expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.transport.getState().playing)).toBe(false);
  await page.evaluate(() => window.__PROCGEN_STUDIO__.play());
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.getPlaybackState().activeNotes)).toBe(1);
  await page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.transport({ bpm: 180, baseBpm: 180 }));
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.getPlaybackState().activeNotes)).toBe(1);
  await page.evaluate(() => window.__PROCGEN_STUDIO__.ports.panic());
  expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.getPlaybackState())).toMatchObject({ activeNotes: 0, pendingNotes: 0 });
  expect(errors).toEqual([]);
});

test('external clock input locks transport, follows SPP, stops on loss and stays stopped after reconnect', { tag: ['@boundary', '@workstation-clock-fallback'] }, async ({ page }) => {
  await installWebMidiStub(page); await ready(page);
  const measured = await page.evaluate(async () => {
    const studio = window.__PROCGEN_STUDIO__; await studio.handlers.connect(); studio.handlers.input('pw-input-1'); studio.handlers.clockOutput('pw-output-1'); studio.handlers.transport({ clockSource: 'external', linked: false, gameSpeed: 0.05 });
    // Start and deliver the clock in one browser task. A test-runner round trip
    // between Continue and the first pulse can itself exceed the stall deadline.
    window.__WEBMIDI_STUB__.sendInput([0xf2, 5, 1]); window.__WEBMIDI_STUB__.sendInput([0xfb]);
    const timestamps = [];
    for (let pulse = 0; pulse < 12; pulse++) { timestamps.push(performance.now()); window.__WEBMIDI_STUB__.sendInput([0xf8]); await new Promise(resolve => setTimeout(resolve, pulse % 2 ? 22 : 20)); }
    return { state: window.__PROCGEN_STUDIO__.transport.getState(), bpm: 60000 / ((timestamps.at(-1) - timestamps[0]) / 11 * 24) };
  });
  const locked = measured.state;
  expect(locked.clockStatus).toBe('locked'); expect(locked.beat).toBeCloseTo(33.25 + 11 / 24, 6); expect(locked.bpm).toBeCloseTo(measured.bpm, 0);
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.transport.getState().playing), { timeout: 3000 }).toBe(false);
  await page.evaluate(() => { window.__WEBMIDI_STUB__.sendInput([0xf8]); window.__WEBMIDI_STUB__.disconnectInput(); window.__WEBMIDI_STUB__.reconnectInput(); });
  expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.transport.getState().playing)).toBe(false);
  expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.ports.getState().inputId)).toBe('pw-input-1');
});

test('recovery preserves a paused exact snapshot while New resets composition and clock defaults', async ({ page }) => {
  test.setTimeout(90000); await ready(page);
  await page.evaluate(async () => {
    const studio = window.__PROCGEN_STUDIO__;
    studio.dispatch({ type: 'procgen/global', patch: { scale: { root: 9, name: 'Minor', degrees: [0, 2, 3, 5, 7, 8, 10] } } });
    studio.handlers.transport({ bpm: 175, baseBpm: 175, linked: false, gameSpeed: 4 });
    await studio.recover(); window.recoveryProject = studio.getProject();
    await studio.handlers.new();
  });
  const fresh = await page.evaluate(() => ({ state: window.__PROCGEN_STUDIO__.transport.getState(), root: window.__PROCGEN_STUDIO__.getProject().global.scale.root }));
  expect(fresh.state).toMatchObject({ bpm: 120, gameSpeed: 3, linked: false, speedMode: 'game' }); expect(fresh.root).not.toBe(9);
  const restored = await page.evaluate(async () => {
    const { createProcgenSessionStorage } = await import('/js/app/procgen/workstation/ProcgenSessionStorage.js'); const storage = createProcgenSessionStorage();
    const session = await storage.loadRecovery({ requireVerified: true }); await window.__PROCGEN_STUDIO__.loadSession(session); await storage.close();
    return { state: window.__PROCGEN_STUDIO__.transport.getState(), root: window.__PROCGEN_STUDIO__.getProject().global.scale.root };
  });
  expect(restored.state).toMatchObject({ bpm: 175, gameSpeed: 4, linked: false, playing: false }); expect(restored.root).toBe(9);
});
