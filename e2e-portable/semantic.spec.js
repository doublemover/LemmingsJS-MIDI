import { expect, test } from './fixtures.js';

test('the same physical recipe produces identical checkpoints and complete causal batches across engines', async ({ page, nativeBrowser: browser }, testInfo) => {
  test.setTimeout(120000);
  await page.goto('/procgen.html?e2e=1&recipe=1&seed=42&lanes=8');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.workstationEnabled);
  const result = await page.evaluate(async () => {
    const { captureProcgenCheckpoint } = await import('/js/app/procgen/workstation/ProcgenCheckpoint.js');
    const { hashProcgenPhysicsCheckpoint } = await import('/js/app/procgen/workstation/ProcgenCheckpointProvenance.js');
    const { hashJournalData } = await import('/js/app/procgen/workstation/CausalJournalCanonical.js');
    const { detectRuntimeCapabilities } = await import('/js/core/capabilityMatrix.js');
    const studio = window.__PROCGEN_STUDIO__;
    studio.transport.pause(); window.__PROCGEN_LANES__.pause();
    if (!await studio.handlers.replay()) throw new Error('The deterministic recipe could not be rebuilt.');
    studio.transport.pause(); const lanes = window.__PROCGEN_LANES__; lanes.pause();
    const world = lanes.world, initialTick = world.tickIndex, beforeListeners = world.soundEvents.onBatch.handlers.size;
    const initialHash = await hashProcgenPhysicsCheckpoint(captureProcgenCheckpoint(world));
    const batches = [], kinds = {}, receive = batch => {
      const { snapshot, ...causal } = batch; batches.push(causal);
      for (const fact of causal.facts) { const kind = fact.kind || fact.type; kinds[kind] = (kinds[kind] || 0) + 1; }
    };
    world.soundEvents.onBatch.on(receive);
    try { lanes.step(64); } finally { world.soundEvents.onBatch.off(receive); }
    const checkpoint = captureProcgenCheckpoint(world), physicsHash = await hashProcgenPhysicsCheckpoint(checkpoint);
    const causalHash = await hashJournalData(batches, { maxBytes: 16 * 1048576, maxNodes: 1000000 });
    const tick = world.tickIndex; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { schema: 'lemmings-engine-semantics/v1', recipe: { seed: 42, lanes: 8, ticks: 64 }, initialTick, initialHash, physicsHash, causalHash,
      finalTick: world.tickIndex, stablePaused: world.tickIndex === tick && !studio.transport.getState().playing, batches: batches.length,
      facts: batches.reduce((sum, batch) => sum + batch.facts.length, 0), complete: batches.every(batch => batch.completeness.status === 'complete' && batch.completeness.dropped === 0),
      kinds, activeActors: world.activeCount, observerListeners: { before: beforeListeners, after: world.soundEvents.onBatch.handlers.size },
      outputEnabled: studio.getPlaybackState().enabled, renderer: { path: 'canvas2d_main_thread', state: lanes.renderer.getDisplayState().state, hardwareAcceleration: 'unqualified' },
      assets: checkpoint.assets, capabilities: detectRuntimeCapabilities({ windowRef: window, navigatorRef: navigator, webMidi: window.WebMidi }),
      audioContextAvailable: typeof (window.AudioContext || window.webkitAudioContext) === 'function', viewport: { width: window.innerWidth, height: window.innerHeight },
      qualification: 'Muted deterministic physics and causal facts; no rendered PCM, physical GPU/MIDI, acoustics or bound archived execution claim.' };
  });
  await testInfo.attach('native-engine-semantics.json', { body: JSON.stringify({ project: testInfo.project.name, browser: browser.version(),
    configuredRenderer: testInfo.project.use.launchOptions?.firefoxUserPrefs ? 'software-webrender-requested' : 'browser-default-unqualified', source: result }, null, 2), contentType: 'application/json' });
  expect(result.initialTick).toBe(0); expect(result.finalTick).toBe(64); expect(result.batches).toBe(64);
  expect(result.facts).toBeGreaterThan(0); expect(result.activeActors).toBeGreaterThan(0); expect(result.complete).toBe(true);
  expect(result.stablePaused).toBe(true); expect(result.outputEnabled).toBe(false); expect(result.renderer.state).toBe('ready');
  expect(result.observerListeners.after).toBe(result.observerListeners.before);
});
