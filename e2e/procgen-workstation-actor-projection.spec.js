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
