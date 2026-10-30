import { expect, test } from '@playwright/test';

test('native source-art clip cache retains distant entries and matches uncached local-edit pixels', { tag: '@boundary' }, async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/procgen.html?e2e=1&seed=42&lanes=8');
  await page.waitForFunction(() => window.__PROCGEN_LANES__?.renderer?.getDisplayState().state === 'ready' && window.__PROCGEN_STUDIO__);
  const receipt = await page.evaluate(() => {
    const api = window.__PROCGEN_LANES__, renderer = api.renderer, world = api.world, terrain = world.terrain;
    api.pause(); window.__PROCGEN_STUDIO__.transport.pause(); renderer.follow = false;
    const describe = terrain.describe, descriptors = new Map(); world.generatedThrough.fill(4096);
    world.terrainGrowth.states.clear(); for (let lane = 0; lane < world.laneCount; lane++) world.terrainGrowth.completed[lane] = [[0, 4096]];
    terrain.describe = function(seed, chunk) {
      const original = describe.call(this, seed, chunk), source = terrain.forSeed(seed), piece = source.objects.find(value => value.image.width <= 64 && value.image.height <= 64 && value.image.frames.length > 1) || source.objects[0];
      if (!piece || chunk < 4 || chunk > 6) return original;
      const key = `${seed}:${chunk}`; if (!descriptors.has(key)) descriptors.set(key, { ...original, objects: [...original.objects, { piece, x: chunk * this.chunkWidth + 16,
        y: Math.max(0, world.laneHeight - piece.image.height), phase: chunk, animation: 'loop', role: 'terrain-overlay', clipToTerrain: true, supportY: null }] });
      return descriptors.get(key);
    };
    const pixels = () => renderer.canvas.getContext('2d').getImageData(0, 0, renderer.canvas.width, renderer.canvas.height).data;
    const state = () => JSON.stringify({ tick: world.tickIndex, generation: world.generation, sequence: world.soundEvents._causalSequence, terrain: world.terrainRevision,
      actors: world.actors.map(actor => [actor.id, actor.x, actor.y, actor.laneIndex, actor.frameIndex]), output: window.__PROCGEN_STUDIO__.getPlaybackState() });
    try {
      renderer.cameraX = 512; renderer.lastPlacementKey = renderer.lastObjectKey = ''; renderer.objectTileCache.clear(); renderer.render();
      const before = renderer.objectTileCache.getStats(), entries = new Map(renderer.objectTileCache.tiles);
      world.setGroundAt(8192, 80); renderer.render(); const distant = renderer.objectTileCache.getStats();
      const sameEntries = [...entries].every(([key, value]) => renderer.objectTileCache.tiles.get(key) === value);
      const target = [...renderer.objectTileCache.tiles.values()].flatMap(entry => entry.placements).find(placement => placement.clip?.some(Boolean));
      if (!target) throw new Error('The source-art fixture requires a real visible clip cell.');
      const cell = target.clip.findIndex(Boolean), x = target.x + cell % target.image.width, y = target.y + Math.floor(cell / target.image.width);
      world._setPixel(x, y, world.groundColorAt(x, y) ? 0 : 3); renderer.render(); const cachedPixels = pixels(), local = renderer.objectTileCache.getStats(), physical = state();
      renderer.objectTileCache.clear(); renderer.lastPlacementKey = renderer.lastObjectKey = ''; renderer.render(); const uncachedPixels = pixels();
      return { before, distant, local, after: renderer.objectTileCache.getStats(), sameEntries,
        samePixels: cachedPixels.every((value, index) => value === uncachedPixels[index]), samePhysical: state() === physical,
        display: renderer.getDisplayState(), viewport: [globalThis.innerWidth, globalThis.innerHeight], output: window.__PROCGEN_STUDIO__.getPlaybackState().enabled,
        qualification: 'Controlled fully revealed geometry and extra clipped placements use actual installed animated source art; native canvas pixels and unchanged physical/output state, not browser frame-time or GPU qualification.' };
    } finally { terrain.describe = describe; }
  });
  await testInfo.attach('object-cache-receipt.json', { body: JSON.stringify(receipt, null, 2), contentType: 'application/json' });
  expect(receipt.before.clipBytes).toBeGreaterThan(0); expect(receipt.sameEntries).toBe(true);
  expect(receipt.distant.clipPixelsSampled).toBe(receipt.before.clipPixelsSampled);
  expect(receipt.local.placementRebuilds).toBeGreaterThan(receipt.distant.placementRebuilds);
  expect(receipt.local.placementRebuilds - receipt.distant.placementRebuilds).toBeLessThanOrEqual(3);
  expect(receipt.samePixels).toBe(true); expect(receipt.samePhysical).toBe(true); expect(receipt.display.state).toBe('ready'); expect(receipt.output).toBe(false);
  expect(receipt.after.peakClipBytes).toBeLessThanOrEqual(receipt.after.maxClipBytes);
});

test('native placement caches match a fresh repaint after an actual checkpoint restore', { tag: '@boundary' }, async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/procgen.html?e2e=1&seed=42&lanes=8');
  await page.waitForFunction(() => window.__PROCGEN_LANES__?.renderer?.getDisplayState().state === 'ready' && window.__PROCGEN_STUDIO__);
  const receipt = await page.evaluate(async () => {
    const api = window.__PROCGEN_LANES__, world = api.world, renderer = api.renderer; window.__PROCGEN_STUDIO__.transport.pause(); api.pause(); renderer.follow = false;
    const { captureProcgenCheckpoint, restoreProcgenCheckpoint } = await import('/js/app/procgen/workstation/ProcgenCheckpoint.js');
    const { hashProcgenPhysicsCheckpoint } = await import('/js/app/procgen/workstation/ProcgenCheckpointProvenance.js');
    api.step(24); const saved = captureProcgenCheckpoint(world), tick = world.tickIndex; renderer.render(); api.step(16); renderer.render(); restoreProcgenCheckpoint(world, saved);
    const physical = await hashProcgenPhysicsCheckpoint(captureProcgenCheckpoint(world)); renderer.render();
    const pixels = renderer.canvas.getContext('2d').getImageData(0, 0, renderer.canvas.width, renderer.canvas.height).data;
    renderer.objectTileCache.clear(); renderer.lastPlacementKey = renderer.lastObjectKey = ''; renderer.render();
    const fresh = renderer.canvas.getContext('2d').getImageData(0, 0, renderer.canvas.width, renderer.canvas.height).data;
    return { tick, restoredTick: world.tickIndex, samePixels: pixels.every((value, index) => value === fresh[index]),
      physicalBeforePaint: physical, physicalAfterPaint: await hashProcgenPhysicsCheckpoint(captureProcgenCheckpoint(world)),
      cache: renderer.objectTileCache.getStats(), display: renderer.getDisplayState(), output: window.__PROCGEN_STUDIO__.getPlaybackState().enabled };
  });
  await testInfo.attach('restored-object-cache-receipt.json', { body: JSON.stringify(receipt, null, 2), contentType: 'application/json' });
  expect(receipt.restoredTick).toBe(receipt.tick); expect(receipt.samePixels).toBe(true); expect(receipt.physicalAfterPaint).toBe(receipt.physicalBeforePaint);
  expect(receipt.cache.peakClipBytes).toBeLessThanOrEqual(receipt.cache.maxClipBytes); expect(receipt.display.state).toBe('ready'); expect(receipt.output).toBe(false);
});
