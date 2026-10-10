import { expect } from 'chai';
import FakeTimers from '@sinonjs/fake-timers';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { ProcgenLaneRenderer } from '../js/app/procgen/ProcgenLaneRenderer.js';
import { createProcgenLaneRuntime } from '../js/app/procgen/ProcgenLaneRuntime.js';
import { loadProcgenMasks, loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';
import { SoundEffectIds } from '../js/game/SoundEvents.js';
import { MidiEventRouter } from '../js/midi/MidiEventRouter.js';
import { createMidiProjectFromMidiConfig, projectToMidiConfig } from '../js/midi/project/MidiProject.js';
import { applyGameEventMidiPreset } from '../js/midi/project/GameEventMidiPresets.js';

const canvasFixture = (width = 1280, height = 720) => {
  const context = { globalAlpha: 1, createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData() {}, drawImage() {}, fillRect() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} };
  const ownerDocument = { createElement: () => ({ width: 300, height: 150, getContext: () => context }) };
  return { width, height, ownerDocument, getContext: () => context, addEventListener() {}, removeEventListener() {} };
};
const actorState = world => world.actors.map(a => [a.id, a.x, a.y, a.frameIndex, a.state, a.lookRight, a.canClimb, a.action?.actionName, a.failureReason]);
const eventConfig = () => {
  const config = projectToMidiConfig(applyGameEventMidiPreset(createMidiProjectFromMidiConfig({ enabled: true, sfx: {}, triggers: {} }), 'game-major'));
  config.enabled = true; return config;
};
const outputFixture = counts => ({ channels: Object.fromEntries(Array.from({ length: 16 }, (_, i) => [i + 1, {
  sendNoteOn() { counts.ons++; }, sendNoteOff() { counts.offs++; }, sendControlChange() {}, sendPitchBend() {}, sendPitchBendRange() {}, sendAllNotesOff() {}, sendProgramChange() {}
}])) });

describe('frontier procgen optimization contracts', function() {
  this.timeout(30000);
  let masks;
  before(async () => { masks = await loadProcgenMasks(); });
  it('composes independent changing phases from supported source geometry and bounded assemblies', async () => {
    const terrain = await loadProcgenTerrain(), signatures = new Set(), phases = new Set();
    let low = 96, high = 0, canonicalDecoration = 0, pixelMaskMismatches = 0;
    for (const seed of [1, 42, 12345]) for (let index = 0; index < 32; index++) {
      const chunk = terrain.getChunk(seed, index, true);
      signatures.add(`${chunk.code}:${chunk.placements.map(p => p.piece.id).join(',')}`); phases.add(chunk.phase);
      for (const y of chunk.topProfile) if (y >= 0) { low = Math.min(low, y); high = Math.max(high, y); }
      for (const placement of chunk.placements) if (placement.canonicalGroup?.role === 'decoration') {
        canonicalDecoration++; expect(placement.decor).to.equal(false);
      }
      for (let at = 0; at < chunk.pixels.length; at++) {
        if (!!chunk.pixels[at] !== !!(chunk.solid[at >>> 5] & (1 << (at & 31)))) pixelMaskMismatches++;
      }
      expect(chunk.objects.every(object => !object.interactive)).to.equal(true);
    }
    expect(signatures.size).to.equal(96); expect(phases.size).to.equal(8);
    expect(high - low).to.be.at.least(40); expect(canonicalDecoration).to.be.greaterThan(0); expect(pixelMaskMismatches).to.equal(0);
    expect(terrain.selectedTerrainIds.size).to.be.greaterThan(0);
    expect([...terrain.selectedTerrainIds].every(id => terrain.eligibleTerrainIds.has(id))).to.equal(true);
    expect([...terrain.selectedObjectIds].every(id => terrain.eligibleObjectIds.has(id))).to.equal(true);
    expect(terrain.getDebugState().terrainCatalogAvailable).to.equal(terrain.pieces.length);
  });
  it('samples exact far-zoom source colors without rasterizing an entire source chunk', async () => {
    const terrain = await loadProcgenTerrain();
    for (const seed of [1, 42, 12345]) for (let cx = 0; cx < 16; cx++) {
      const chunk = terrain.getChunk(seed, cx, true), descriptor = terrain.describe(seed, cx);
      for (let y = 0; y < 96; y += 3) for (let x = 0; x < 128; x += 3) {
        expect(terrain.rasterSample(seed, cx, x, y, descriptor)).to.equal(chunk.pixels[y * 128 + x]);
      }
    }
  });
  it('reconstructs exactly the same seed chunk after bounded-cache eviction', async () => {
    const terrain = await loadProcgenTerrain(); terrain.collisionLimit = 3; terrain.rasterLimit = 2;
    const first = terrain.getChunk(42, 7, true), pixels = first.pixels.slice(), solid = first.solid.slice();
    for (let index = 8; index < 40; index++) terrain.getChunk(42, index, true);
    expect(terrain.collision.size).to.equal(3); expect(terrain.rasters.size).to.equal(2);
    const again = terrain.getChunk(42, 7, true);
    expect(again.pixels).to.deep.equal(pixels); expect(again.solid).to.deep.equal(solid);
  });
  it('keeps real action state and edits identical with optimized versus scalar collision queries', async () => {
    for (const seed of [1, 42, 12345]) {
      const terrain = await loadProcgenTerrain();
      const fast = new ProcgenLaneWorld({ masks, terrain, laneCount: 8, seed });
      const reference = new ProcgenLaneWorld({ masks, terrain, laneCount: 8, seed });
      reference.getColumnStepHeight = function(x, y, h) { for (let i = 0; i < h; i++) if (!this.hasGroundAt(x, y + h - i - 1)) return i; return h; };
      reference.getColumnGapDepth = function(x, y, h) { for (let i = 0; i < h; i++) if (this.hasGroundAt(x, y + i)) return i + 1; return h + 1; };
      for (let i = 0; i < 3000; i++) { fast.step(); reference.step(); }
      expect(actorState(fast)).to.deep.equal(actorState(reference));
      expect([...fast.editChunks]).to.deep.equal([...reference.editChunks]);
      expect(Array.from(fast.generatedThrough, (x, lane) => x - fast.frontiers[lane]).every(margin => margin >= fast.terrainGrowth.safetyLead && margin <= fast.terrainGrowth.targetLead + terrain.chunkWidth)).to.equal(true);
      fast.dispose(); reference.dispose();
    }
  });
  it('protects steel from clearing masks without making decoration collide', async () => {
    const terrain = await loadProcgenTerrain(), world = new ProcgenLaneWorld({ masks, terrain });
    const piece = terrain.pieces.find(piece => piece.isSteel), descriptor = terrain.describe(world.laneSeeds[0], 0);
    expect(piece).to.exist;
    descriptor.placements.push({ piece, x: 64, y: 32, decor: false });
    terrain.collision.clear(); terrain._lastKey = null; terrain._lastChunk = null;
    const chunk = terrain.getChunk(world.laneSeeds[0], 0, true);
    const index = Array.from({ length: chunk.pixels.length }, (_, i) => i).find(i => chunk.steel[i >>> 5] & (1 << (i & 31)));
    const point = { x: index % 128, y: Math.floor(index / 128) };
    const mask = { width: 1, height: 1, offsetX: 0, offsetY: 0, at: () => false };
    expect(world.hasSteelUnderMask(mask, point.x, point.y)).to.equal(true);
    expect(world.clearGroundWithMaskCount(mask, point.x, point.y)).to.equal(0);
    expect(world.hasGroundAt(point.x, point.y)).to.equal(true);
  });
  it('emits one classic fell-off event at the actual global bottom', () => {
    const world = new ProcgenLaneWorld({ masks, assists: false }), actor = world.actors[0], events = [];
    world.soundEvents.onEvent.on(event => events.push(event)); world.baseGroundAt = () => 0; actor.y = 95;
    for (let i = 0; i < 6; i++) world.step();
    expect(actor.failureReason).to.equal('out-of-world');
    expect(events.filter(event => event.type === 'lemming-fell-off')).to.have.length(1);
    world.dispose();
  });
  it('does not compose collision chunks when a far-zoom object animation frame changes', async () => {
    const terrain = await loadProcgenTerrain(), world = new ProcgenLaneWorld({ masks, terrain, laneCount: 1024 });
    world.generatedThrough.fill(4096); world.frontiers.fill(4000);
    const renderer = new ProcgenLaneRenderer({ canvas: canvasFixture(), world, assets: { groundPieces: terrain.pieces }, windowRef: { devicePixelRatio: 1, performance } });
    renderer.follow = false; renderer.scale = 1 / 256; renderer.render();
    const generated = terrain.stats.generated, rasterized = terrain.stats.rasterized, placements = renderer.objectPlacements;
    world.tickIndex += 4; renderer.render();
    expect(terrain.stats.generated).to.equal(generated); expect(terrain.stats.rasterized).to.equal(rasterized);
    expect(renderer.objectPlacements).to.equal(placements);
    expect(renderer.objectPlacements.length).to.be.at.most(1280 * 720);
    renderer.dispose(); world.dispose();
  });
  it('skips unprepared source descriptors while retaining shared edits and later completed geometry', async () => {
    const terrain = await loadProcgenTerrain(), world = new ProcgenLaneWorld({ masks, terrain }), describe = terrain.describe;
    world.terrainGrowth.completed[0] = [];
    terrain.describe = () => { throw new Error('Unprepared source geometry must stay cold'); };
    const renderer = new ProcgenLaneRenderer({ canvas: canvasFixture(120, 96), world, assets: { groundPieces: terrain.pieces }, windowRef: { devicePixelRatio: 1, performance } });
    renderer.follow = false; renderer.scale = 1;
    try {
      renderer.render(); expect(renderer.pixels.every(color => color === 0xff0e0807)).to.equal(true); expect(renderer.objectPlacements).to.have.length(0);
      world.setGroundAt(40, 80); renderer.render(); expect(renderer.pixels[80 * 120 + 40]).to.equal(0xff86cbea);
      terrain.describe = describe; world.terrainGrowth.completed[0] = [[0, world.generatedThrough[0]]]; world.terrainRevision++; world.frontierRevision++;
      renderer.render(); expect(renderer.pixels[80 * 120 + 39]).not.to.equal(0xff0e0807); expect(renderer.pixels[80 * 120 + 40]).to.equal(0xff86cbea);
    } finally { terrain.describe = describe; renderer.dispose(); world.dispose(); }
  });
  it('invalidates erased analytic fallback pixels with a stationary camera', () => {
    const world = new ProcgenLaneWorld({ masks });
    const renderer = new ProcgenLaneRenderer({ canvas: canvasFixture(), world, assets: { groundPieces: [] }, windowRef: { devicePixelRatio: 1, performance } });
    renderer.follow = false; renderer.render();
    const index = 80 * renderer.buffer.width + 40;
    expect(renderer.pixels[index]).not.to.equal(0xff0e0807);
    world._setPixel(40, 80, 0); renderer.render();
    expect(renderer.pixels[index]).to.equal(0xff0e0807);
    renderer.dispose(); world.dispose();
  });
  it('caches static terrain, invalidates edits and never allocates a far-zoom world raster', async () => {
    const terrain = await loadProcgenTerrain(), world = new ProcgenLaneWorld({ masks, terrain, laneCount: 1024 });
    const renderer = new ProcgenLaneRenderer({ canvas: canvasFixture(), world, assets: { groundPieces: terrain.pieces }, windowRef: { devicePixelRatio: 1, performance } });
    renderer.follow = false; renderer.render(); const rasterized = terrain.stats.rasterized;
    for (let i = 0; i < 20; i++) renderer.render();
    expect(renderer.terrainRebuilds).to.equal(1); expect(renderer.terrainCacheHits).to.equal(20);
    expect(terrain.stats.rasterized).to.equal(rasterized);
    world.setGroundAt(10, 10); renderer.render(); expect(renderer.terrainRebuilds).to.equal(2);
    const dirtyPixels = renderer.pixels.slice(); renderer._terrainPixels(renderer.buffer.width, renderer.buffer.height, true);
    expect(renderer.pixels).to.deep.equal(dirtyPixels);
    const rebuilds = renderer.terrainRebuilds;
    world.setGroundAt(10, 90000); renderer.render(); expect(renderer.terrainRebuilds).to.equal(rebuilds);
    for (const scale of [1, 0.5, 0.125, 1 / 256]) {
      renderer.scale = scale; renderer.render();
      expect(renderer.image.data.length).to.be.at.most(1280 * 720 * 4);
      expect(renderer.buffer.width).to.be.at.most(1280); expect(renderer.buffer.height).to.be.at.most(720);
    }
    const preparedKeys = [...terrain.collision.keys()];
    expect([...terrain.collision.values()].every(chunk => chunk.origin + terrain.chunkWidth <= Math.max(...world.generatedThrough))).to.equal(true);
    renderer.cameraX = 1000000; renderer.render();
    expect([...terrain.collision.keys()]).to.deep.equal(preparedKeys);
    renderer.dispose(); world.dispose();
  });
});

describe('procgen wall-clock MIDI continuity', function() {
  this.timeout(30000);
  it('dispatches notes through speed changes, long pauses and manual time rebases without future drift', async () => {
    const masks = await loadProcgenMasks(), terrain = await loadProcgenTerrain();
    const clock = FakeTimers.install({ now: 0, toFake: ['setTimeout', 'clearTimeout'] });
    const world = new ProcgenLaneWorld({ masks, terrain, laneCount: 1, seed: 42, cohorts: true, speed: 3 });
    const router = new MidiEventRouter(eventConfig()), counts = { ons: 0, offs: 0 }, samples = [];
    router._nowMs = () => clock.now; router.scheduler._nowMs = () => clock.now;
    router.setOutput(outputFixture(counts)); router.attach(world.soundEvents, { game: world });
    try {
      for (const speed of [3, 1, 12, 0.5, 3]) {
        world.timer.speedFactor = speed; const before = counts.ons;
        for (let i = 0; i < 400; i++) { clock.tick(60 / speed); world.step(clock.now); }
        samples.push(counts.ons - before);
        expect(world.timer.tps).to.be.closeTo(1000 * speed / 60, 0.000001);
        expect([...router.scheduler._pendingNoteOns.values()].every(note => note.timeMs - clock.now < 1000)).to.equal(true);
        router.resetClock({ preserveGamePhrases: true }); clock.tick(60000);
      }
      expect(samples.every(count => count > 0)).to.equal(true);
      for (let i = 0; i < 400; i++) world.step(clock.now);
      expect([...router.scheduler._pendingNoteOns.values()].every(note => note.timeMs - clock.now < 1000)).to.equal(true);
    } finally { router.dispose(); world.dispose(); clock.uninstall(); }
  });
  it('does not remap events that the unchanged per-tick admission limit will reject', () => {
    const router = new MidiEventRouter(eventConfig()), counts = { ons: 0, offs: 0 };
    router.setOutput(outputFixture(counts)); let mapped = 0;
    const map = router.mapping.mapEvent.bind(router.mapping);
    router.mapping.mapEvent = (...args) => { mapped++; return map(...args); };
    for (let i = 0; i < 1000; i++) router._onEvent({ tick: 1, timeMs: 0, frameMs: 20, speedFactor: 3, type: 'lemming-spawn', sfxId: SoundEffectIds.SPAWN, lemmingId: i });
    expect(mapped).to.be.at.most(32); router.dispose();
  });
  it('budgets CPU time instead of imposing the former 32-tick high-speed ceiling', async () => {
    const masks = await loadProcgenMasks(), terrain = await loadProcgenTerrain(), callbacks = []; let workClock = 0;
    const windowRef = { document: { hidden: false, addEventListener() {}, removeEventListener() {} },
      performance: { now: () => (workClock += 0.01) }, devicePixelRatio: 1,
      requestAnimationFrame: callback => (callbacks.push(callback), callbacks.length), cancelAnimationFrame() {} };
    const runtime = createProcgenLaneRuntime({ canvas: canvasFixture(), masks, terrain, assets: { groundPieces: terrain.pieces }, laneCount: 1, seed: 42, speed: 10000, windowRef });
    runtime.world.step = time => { runtime.world.tickIndex++; runtime.world.eventTimeMs = time; };
    callbacks.shift()(1000); callbacks.shift()(1016);
    expect(runtime.world.tickIndex).to.be.greaterThan(32).and.lessThan(900);
    expect(runtime.world.eventTimeMs).to.equal(1016); runtime.stop();
  });
  it('supplies RAF wall timestamps and preserves pending game phrases when pausing', async () => {
    const masks = await loadProcgenMasks(), terrain = await loadProcgenTerrain(), callbacks = [];
    const document = { hidden: false, addEventListener() {}, removeEventListener() {} };
    const windowRef = { document, performance: { now: () => 5000 }, devicePixelRatio: 1, requestAnimationFrame: callback => (callbacks.push(callback), callbacks.length), cancelAnimationFrame() {} };
    const runtime = createProcgenLaneRuntime({ canvas: canvasFixture(), masks, terrain, assets: { groundPieces: terrain.pieces }, laneCount: 1, seed: 42, windowRef });
    const resets = [], router = { attach() {}, detach() {}, resetClock: options => resets.push(options), scheduler: { allNotesOff() {} } };
    runtime.view.setMidiPreviewRouter(router);
    callbacks.shift()(1000); callbacks.shift()(1060);
    expect(runtime.world.tickIndex).to.equal(3); expect(runtime.world.eventTimeMs).to.equal(1060);
    runtime.pause(); expect(resets).to.deep.equal([{ preserveGamePhrases: true }]);
    runtime.step(10); expect(runtime.world.eventTimeMs).to.equal(5000);
    runtime.resume(); runtime.stop();
  });
});
