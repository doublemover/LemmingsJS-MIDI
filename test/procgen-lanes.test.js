import { expect } from 'chai';
import { loadProcgenMasks, runLaneBenchmark } from '../scripts/bench-procgen-lanes.js';
import { ProcgenLaneWorld, normalizeLaneCount, LANE_HEIGHT } from '../js/app/procgen/ProcgenLaneWorld.js';
import { SolidLayer } from '../js/render/SolidLayer.js';

describe('shared procgen lanes', function () {
  let masks;
  before(async () => { masks = await loadProcgenMasks(); });
  it('normalizes the exact 1–1024 integer range', () => {
    expect([undefined, 0, -8, '3', 1.8, 1024, 5000, 'oops'].map(normalizeLaneCount)).to.deep.equal([1, 1, 1, 3, 1, 1024, 1024, 1]);
  });
  it('bounds and reuses deterministic terrain challenges without per-pixel allocation', () => {
    const world = new ProcgenLaneWorld({ masks, laneCount: 2, seed: 42 });
    const first = world.challengeAt(0, 100);
    expect(world.challengeAt(0, 101)).to.equal(first);
    for (let x = 0; x < 1000; x++) world.challengeAt(x % 2, x * 256);
    expect(world.challengeCache.size).to.equal(world.challengeCacheLimit);
    expect(world.challengeAt(0, 100)).to.deep.equal(first);
    world.dispose(); expect(world.challengeCache.size).to.equal(0);
  });
  it('matches the dense game mask column semantics', () => {
    const world = new ProcgenLaneWorld({ masks, laneCount: 2, seed: 42 });
    const dense = new SolidLayer(256, world.height);
    for (let y = 0; y < world.height; y++) for (let x = 0; x < 256; x++) dense.mask[y * 256 + x] = +world.hasGroundAt(x, y);
    for (let y = 0; y < world.height; y += 3) for (let x = 0; x < 256; x += 3) {
      expect(world.getColumnStepHeight(x, y, 8)).to.equal(dense.getColumnStepHeight(x, y, 8));
      expect(world.getColumnGapDepth(x, y, 3)).to.equal(dense.getColumnGapDepth(x, y, 3));
    }
  });
  it('spawns exactly one real actor per lane at the same simulation tick', () => {
    const world = new ProcgenLaneWorld({ masks, laneCount: 1024, seed: 42 });
    const events = [];
    world.soundEvents.onEvent.on(event => events.push(event));
    world.step();
    expect(world.actors.length).to.equal(1024);
    expect(world.actors.map(actor => actor.appearanceIndex)).to.deep.equal(Array.from({ length: 1024 }, (_, i) => i));
    expect(new Set(events.map(event => event.tick))).to.deep.equal(new Set([1]));
    expect(events.filter(event => event.type === 'lemming-spawn')).to.have.length(1024);
    expect(events[1023].presentationPhase).to.be.lessThan(1);
  });
  it('replays deterministic real action transitions and terrain edits', () => {
    const run = () => {
      const world = new ProcgenLaneWorld({ masks, laneCount: 32, seed: 42 });
      for (let i = 0; i < 3000; i++) world.step();
      return { state: world.getDebugState(), actors: world.actors.map(a => [a.x, a.y, a.action.actionName, a.frameIndex]),
        edits: [...world.editChunks].map(([key, mask]) => [key, [...mask]]) };
    };
    expect(run()).to.deep.equal(run());
  });
  it('keeps every route valid without reading its neighbours for fixed seeds', () => {
    for (const seed of [1, 42, 2026]) {
      const together = new ProcgenLaneWorld({ masks, laneCount: 8, seed });
      const isolated = new ProcgenLaneWorld({ masks, laneCount: 8, seed });
      const query = isolated.hasGroundAt.bind(isolated);
      let activeLane = 0;
      isolated.hasGroundAt = (x, y) => Math.floor(y / LANE_HEIGHT) === activeLane && query(x, y);
      for (const actor of isolated.actors) {
        const process = actor.process.bind(actor);
        actor.process = level => { activeLane = actor.laneIndex; return process(level); };
      }
      const assist = isolated._assist.bind(isolated);
      isolated._assist = actor => { activeLane = actor.laneIndex; assist(actor); };
      for (let i = 0; i < 4000; i++) { together.step(); isolated.step(); }
      expect(together.actors.map(a => [a.x, a.y, a.failureReason])).to.deep.equal(isolated.actors.map(a => [a.x, a.y, a.failureReason]));
      expect(together.getDebugState().survival).to.equal(1);
      expect(together.getDebugState().stalled).to.equal(0);
    }
  });
  it('runs 1024 real actors with bounded sparse edits and no render dependency', function () {
    this.timeout(15000);
    const result = runLaneBenchmark({ masks, lanes: 1024, ticks: 3000, seed: 42 });
    expect(result.rendered).to.equal(false);
    expect(result.alive).to.equal(1024);
    expect(result.stalled).to.equal(0);
    expect(result.distance.min).to.be.greaterThan(1400);
    expect(result.terrainMemoryMB).to.be.lessThan(24);
    expect(result.builds).to.be.greaterThan(0);
    expect(result.bashes).to.be.greaterThan(0);
  });
  it('reports the unassisted failure baseline instead of hiding it', () => {
    const result = runLaneBenchmark({ masks, lanes: 8, ticks: 3000, seed: 42, assists: false });
    expect(result.survival).to.equal(0);
    expect(result.failures).to.equal(8);
    expect(result.failureReasons).not.to.deep.equal({});
  });
});
