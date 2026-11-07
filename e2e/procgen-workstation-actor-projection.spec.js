import { expect, test } from '@playwright/test';

test('completed projection reuses native actor pixels and camera/CCTV facts without a live actor rescan', { tag: '@boundary' }, async ({ page, browser }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/procgen.html?e2e=1&seed=42&lanes=8');
  await page.waitForFunction(() => window.__PROCGEN_LANES__?.renderer?.getDisplayState().state === 'ready' && window.__PROCGEN_STUDIO__);
  const receipt = await page.evaluate(() => {
    const api = window.__PROCGEN_LANES__, studio = window.__PROCGEN_STUDIO__, renderer = api.renderer, world = api.world;
    studio.transport.pause(); api.pause(); renderer.follow = false;
    for (let tick = 0; tick < 128 && !world.actors.some(actor => !actor.removed && actor.action); tick++) api.step();
    renderer.render();
    const state = () => JSON.stringify({ generation: world.generation, tick: world.tickIndex, sequence: world.soundEvents._causalSequence,
      actors: world.actors.map(actor => [actor.id, actor.x, actor.y, actor.laneIndex, actor.frameIndex, actor.removed]),
      document: studio.getDocumentState(), playback: studio.getPlaybackState() });
    const pixels = () => renderer.canvas.getContext('2d').getImageData(0, 0, renderer.canvas.width, renderer.canvas.height).data;
    const before = state(), originalPixels = pixels(), index = renderer.actorVisibility, stats = index.getStats();
    const iterator = Object.getOwnPropertyDescriptor(world.actors, Symbol.iterator); let iterations = 0;
    Object.defineProperty(world.actors, Symbol.iterator, { configurable: true, value() { iterations++; throw new Error('Camera/render consumer rescanned live actors'); } });
    let rendered, samePixels, leaderIds, cctvActors, visits;
    try {
      rendered = renderer.render(); const nextPixels = pixels(); samePixels = originalPixels.every((value, offset) => value === nextPixels[offset]);
      leaderIds = Array.from({ length: 8 }, (_, lane) => index.physicalLeader(lane, lane + 1)?.id ?? null);
      renderer.cctv.setEnabled(true); renderer.camera.setZoom(0); renderer.cctv.lastStateKey = ''; renderer.cctv.lastUpdateMs = -Infinity; renderer.render();
      cctvActors = renderer.cctv.actorScans; visits = index.getStats();
    } finally {
      if (iterator) Object.defineProperty(world.actors, Symbol.iterator, iterator); else delete world.actors[Symbol.iterator];
    }
    return { rendered, samePixels, iterations, leaderIds, cctvActors, before, after: state(), stats, visits,
      display: renderer.getDisplayState(), viewport: [globalThis.innerWidth, globalThis.innerHeight], output: studio.getPlaybackState().enabled };
  });
  expect(receipt.viewport[0]).toBeGreaterThanOrEqual(1920); expect(receipt.viewport[1]).toBeGreaterThanOrEqual(1080);
  expect(receipt.rendered).toBe(true); expect(receipt.samePixels).toBe(true); expect(receipt.iterations).toBe(0);
  expect(receipt.leaderIds.some(id => id !== null)).toBe(true); expect(receipt.cctvActors).toBeGreaterThan(0);
  expect(receipt.visits.actorScans).toBe(receipt.stats.actorScans); expect(receipt.visits.drawScans).toBe(0);
  expect(receipt.visits.projection.allocations).toBe(receipt.stats.projection.allocations);
  expect(receipt.display.state).toBe('ready'); expect(receipt.after).toBe(receipt.before); expect(receipt.output).toBe(false);
  await testInfo.attach('actor-projection-receipt.json', { body: JSON.stringify({ browser: browser.version(), ...receipt }, null, 2), contentType: 'application/json' });
});

test('actual lane observations read completed contacts without generating terrain or restoring edits', { tag: '@boundary' }, async ({ page }, testInfo) => {
  await page.goto('/procgen.html?e2e=1&seed=42&lanes=8');
  await page.waitForFunction(() => window.__PROCGEN_LANES__?.world?.terrain && window.__PROCGEN_STUDIO__);
  const receipt = await page.evaluate(async () => {
    const api = window.__PROCGEN_LANES__, world = api.world; window.__PROCGEN_STUDIO__.transport.pause(); api.pause();
    const { createProcgenLaneObserver } = await import('/js/app/procgen/workstation/ProcgenLaneObservation.js');
    for (let tick = 0; tick < 128 && !world.actors.some(actor => !actor.removed && !actor.failureReason && actor.action); tick++) api.step();
    const observe = createProcgenLaneObserver(world), methods = [], terrain = world.terrain, sources = terrain.themes?.map(theme => theme.terrain) || [terrain];
    const evidence = () => ({ tick: world.tickIndex, generation: world.generation, sequence: world.soundEvents._causalSequence,
      actors: world.actors.map(actor => [actor.id, actor.x, actor.y, actor.laneIndex, actor.frameIndex]),
      edits: world.editChunks.snapshot(), generatedThrough: Array.from(world.generatedThrough), groundQueries: world.stats.groundQueries,
      sources: sources.map(source => ({ stats: { ...source.stats }, descriptors: [...(source.descriptions?.keys() || [])] })) });
    const before = evidence();
    for (const [owner, keys] of [[world, ['hasGroundAt', 'hasSteelAt', '_editsAt', '_terrainChunk']], [terrain, ['getChunk', 'describe']], ...sources.map(source => [source, ['getChunk', 'describe', 'growthPlan']])]) {
      for (const key of keys) { const own = Object.getOwnPropertyDescriptor(owner, key); methods.push([owner, key, own]); Object.defineProperty(owner, key, { configurable: true, value() { throw new Error('Contact observation materialized ' + key); } }); }
    }
    let observations, stats;
    try { observations = Array.from({ length: world.laneCount }, (_, lane) => observe(lane)); stats = observe.getStats(); }
    finally { for (const [owner, key, descriptor] of methods.reverse()) { if (descriptor) Object.defineProperty(owner, key, descriptor); else delete owner[key]; } }
    return { before, after: evidence(), observations, stats, output: window.__PROCGEN_STUDIO__.getPlaybackState().enabled };
  });
  await testInfo.attach('readonly-contact-receipt.json', { body: JSON.stringify(receipt, null, 2), contentType: 'application/json' });
  expect(receipt.after).toEqual(receipt.before); expect(receipt.stats.contactQueries).toBeGreaterThan(0);
  expect(receipt.observations.some(value => value.action)).toBe(true); expect(receipt.output).toBe(false);
});
