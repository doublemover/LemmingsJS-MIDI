import { expect, test } from '@playwright/test';
import { installWebMidiStub } from './helpers/webmidiStub.js';

async function ready(page) {
  await page.goto('/procgen.html?e2e=1&seed=42');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain, { timeout: 60000 });
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
