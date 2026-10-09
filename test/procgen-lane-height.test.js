import { expect } from 'chai';
import assert from 'node:assert/strict';
import { ProcgenLaneWorld, DEFAULT_LANE_HEIGHT, normalizeLaneHeight } from '../js/app/procgen/ProcgenLaneWorld.js';
import { ProcgenSoundEventBus } from '../js/app/procgen/ProcgenSoundEventBus.js';
import { ProcgenStallPolicy } from '../js/app/procgen/ProcgenStallPolicy.js';
import { ProcgenPackTerrain } from '../js/app/procgen/ProcgenPackTerrain.js';
import { ProcgenSolverAdapter } from '../js/solver/ProcgenSolverAdapter.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
import { loadProcgenMasks, loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';

describe('procgen configurable physical stripe height', function() {
  this.timeout(30000);
  let masks;
  before(async () => { masks = await loadProcgenMasks(); });
  it('keeps legacy fixtures at 96 and normalizes the public 144px default without stretching art', () => {
    expect(DEFAULT_LANE_HEIGHT).to.equal(144);
    expect([normalizeLaneHeight(40), normalizeLaneHeight(144.9), normalizeLaneHeight(999), normalizeLaneHeight(NaN)]).to.deep.equal([96, 144, 256, 96]);
    const legacy = new ProcgenLaneWorld({ masks, laneCount: 2 }), taller = new ProcgenLaneWorld({ masks, laneCount: 2, laneHeight: 144 });
    expect([legacy.laneHeight, legacy.height]).to.deep.equal([96, 192]);
    expect([taller.laneHeight, taller.height]).to.deep.equal([144, 288]);
    expect(taller.actors.map(actor => actor.y)).to.deep.equal([90, 234]);
    legacy.dispose(); taller.dispose();
  });
  it('translates identical source pixels to allocate actual sky headroom and matching whole-piece growth channels through all 144 rows', async () => {
    const terrain = await loadProcgenTerrain('lemmings', 0), seed = 42;
    const original = terrain.getChunk(seed, 0, true).pixels.slice(), art = terrain.pieces.map(p => [p.id, p.width, p.height]);
    terrain.configure(2, 16, { laneHeight: 144 });
    expect(terrain.getChunk(seed, 0, true).pixels.subarray(128 * 48, 128 * 144)).to.deep.equal(original);
    expect(terrain.pieces.map(p => [p.id, p.width, p.height])).to.deep.equal(art);
    expect(terrain.surface(seed, 36)).to.equal(120);
    expect(terrain.solidSample(seed, 0, 36, 119)).to.equal(false);
    const chunk = 3, descriptor = terrain.describe(seed, chunk), plan = terrain.growthPlan(seed, chunk), final = terrain.getChunk(seed, chunk, true);
    expect(plan.jobs.length).to.be.at.most(32);
    expect(plan.jobs.filter(job => job.kind === 'foundation').every(job => job.y2 === 144)).to.equal(true);
    for (let y = 0; y < 144; y++) for (let x = 0; x < 128; x++) {
      const index = y * 128 + x, bit = 1 << (index & 31);
      assert.equal(terrain.solidSample(seed, chunk, x, y, descriptor), !!(final.solid[index >>> 5] & bit));
      assert.equal(terrain.steelSample(seed, chunk, x, y, descriptor), !!(final.steel[index >>> 5] & bit));
      assert.equal(terrain.rasterSample(seed, chunk, x, y, descriptor), final.pixels[index]);
    }
    const active = new Uint8Array(plan.jobs.length), state = { plan, active, complete: false };
    assert.equal(terrain.solidSample(seed, chunk, 0, 143, descriptor, state), false);
    active[plan.foundationByColumn[0]] = 1;
    assert.equal(terrain.solidSample(seed, chunk, 0, 143, descriptor, state), true);
    assert.notEqual(terrain.rasterSample(seed, chunk, 0, 143, descriptor, state), 0);
    const pack = new ProcgenPackTerrain([{ terrain, styleName: 'dirt' }]); pack.configure(2, 16, { laneHeight: 192 });
    expect(pack.height).to.equal(192); expect(terrain.height).to.equal(192); terrain.reset();
  });
  it('constructs three naturally completed real stairs in the translated source sky without scaling or cancelling actions', async () => {
    const terrain = await loadProcgenTerrain('lemmings', 0), world = new ProcgenLaneWorld({ masks, terrain, laneHeight: 144, assists: false }), actor = world.actors[0];
    Object.assign(actor, { x: 36, y: 120, scout: false }); actor.setAction(world.actions[State.WALKING]);
    for (let course = 0; course < 3; course++) {
      expect(world.assignWorker(actor, 'builders', actor.x + 24)).to.equal(true);
      for (let tick = 0; tick < 220 && actor.action !== world.actions[State.WALKING]; tick++) world.step();
      expect(actor.action).to.equal(world.actions[State.WALKING]); expect(actor.lookRight).to.equal(true); world.step();
    }
    expect(world.stats.builds).to.equal(3); expect(world.stats.failures).to.equal(0); expect(actor.y).to.be.lessThan(90);
    expect(actor.y - 9).to.be.greaterThan(0); expect(world.editChunks.size).to.be.greaterThan(0); world.dispose();
  });
  it('crosses the physical 144 boundary naturally and maps sound, actor cache and editable pixels to the destination', () => {
    const world = new ProcgenLaneWorld({ masks, laneCount: 2, laneHeight: 144, assists: false }), actor = world.actors[0], events = [];
    actor.y = 142; world.hasGroundAt = (_x, y) => y >= 158 && y <= 170;
    world.soundEvents.onEvent.on(event => events.push(event));
    for (let tick = 0; tick < 8; tick++) world.step();
    expect(actor.laneIndex).to.equal(1); expect(actor.spawnLaneIndex).to.equal(0);
    expect(actor.action).to.equal(world.actions[State.WALKING]); expect(actor.failureReason).to.equal(null);
    expect(events.find(event => event.type === 'lemming-land').laneIndex).to.equal(1);
    expect(world.getLaneMusicActorPosition(actor.id, 1)).to.include({ y: actor.y, tick: world.tickIndex });
    world.setGroundAt(42, 143); world.setGroundAt(42, 144);
    expect([...world.editChunks.values()].every(chunk => chunk.length === 32 * 144)).to.equal(true);
    world._setPixel(42, 143, 0); expect(world.editChunks.get(world._editKey(42, 143))[143 * 32 + 10]).to.equal(1);
    expect(world.editChunks.get(world._editKey(42, 144))[10]).to.be.greaterThan(1);
    world.dispose();
  });
  it('keeps an actual source trap owner and trigger envelope in the taller second stripe', async () => {
    const terrain = await loadProcgenTerrain('lemmings', 0); terrain.objects = [terrain.objects.find(piece => piece.id === 6)];
    terrain.compiledAssemblies = []; terrain.supportsFineGrowth = false;
    const world = new ProcgenLaneWorld({ masks, terrain, laneCount: 2, laneHeight: 144, seed: 42, assists: false });
    let object, chunk;
    for (let at = 2; at < 48 && !object; at++) {
      world.generatedThrough[1] = (at + 1) * 128;
      const descriptor = terrain.describe(world.laneSeeds[1], at), candidate = descriptor.objects[0];
      if (candidate && world.hazards.placementReady(1, at, candidate, descriptor)) { object = candidate; chunk = at; }
    }
    expect(object).to.exist;
    const actor = world.actors[1], image = object.piece.image;
    Object.assign(actor, { x: object.x + image.trigger_left - 1, y: 144 + object.supportY, lookRight: true });
    actor.setAction(world.actions[State.WALKING]); world.step();
    expect(actor.action).to.equal(world.actions[State.SPLATTING]);
    const entry = world.hazards.peek(1, chunk, 0);
    expect(entry.owner.y).to.equal(144 + object.y); expect(entry.trigger.y1).to.equal(144 + object.y + image.trigger_top);
    expect(entry.trigger.disabledUntilTick).to.equal(world.tickIndex + image.frameCount); world.dispose();
  });
  it('bins upper and lower stripe piles separately and preserves a genuine unsafe fall', () => {
    const policy = new ProcgenStallPolicy(2, { pileMinimumNonProgressSeconds: 0 }, [], { laneHeight: 144 });
    const actors = Array.from({ length: 8 }, (_, id) => ({ id, laneIndex: id < 4 ? 0 : 1, x: 36, y: id < 4 ? 142 : 286, lastProgressTick: 0 }));
    policy.update(actors, 1);
    expect(policy.lanes.map(lane => lane.pileCount)).to.deep.equal([4, 4]);
    expect(policy.lanes.map(lane => lane.pileMaxY)).to.deep.equal([144, 144]);
    expect(policy._pileCounts.length).to.equal(2 * 16 * 6);
    const world = new ProcgenLaneWorld({ masks, laneHeight: 144, laneCount: 2, assists: false }), actor = world.actors[0];
    actor.y = 142; actor.state = 60; world.hasGroundAt = (_x, y) => y >= 145;
    world.step(); world.step(); expect(actor.failureReason).to.equal('unsafe-fall'); world.dispose();
  });
  it('uses the exact destination stripe for absent lane metadata and the solver physical snapshot', () => {
    const bus = new ProcgenSoundEventBus(null, 2, 144), events = []; bus.onEvent.on(event => events.push(event));
    bus.emit({ type: 'probe', y: 143 }); bus.emit({ type: 'probe', y: 144 }); bus.emit({ type: 'probe', y: 200, laneIndex: 0 });
    expect(events.map(event => event.laneIndex)).to.deep.equal([0, 1, 0]);
    const adapter = new ProcgenSolverAdapter({ createWorld: () => new ProcgenLaneWorld({ masks, laneHeight: 144, laneCount: 2, assists: false }),
      bounds: { x: 8, y: 0, width: 128, height: 288 }, goal: { x: 64, y: 0, width: 32, height: 288 } });
    expect(adapter.snapshot().source.laneHeight).to.equal(144); adapter.dispose();
  });
  it('queues a lane nuke through real OHNO and explosion, with bounded trigger cleanup and reset/dispose lifetimes', () => {
    const world = new ProcgenLaneWorld({ masks, laneHeight: 144, laneCount: 2, assists: false }), actor = world.actors[0], events = [];
    actor.y = 120; actor.setAction(world.actions[State.BLOCKING]); world.step();
    expect(world.triggerManager.snapshot().owners).to.equal(1);
    world.soundEvents.onEvent.on(event => events.push(event));
    expect(world.nukeLane(-1)).to.equal(false); expect(world.nukeLane(0)).to.equal(true); expect(world.nukeLane(0)).to.equal(true);
    expect(actor.action).to.equal(world.actions[State.BLOCKING]);
    world.step(); expect(actor.action).to.equal(world.actions[State.OHNO]); expect(world.triggerManager.snapshot().owners).to.equal(0);
    expect(world.actors[1].action).to.not.equal(world.actions[State.OHNO]);
    for (let tick = 0; tick < 80; tick++) world.step();
    expect(actor.failureReason).to.equal('cascade-complete');
    expect(events.filter(event => event.type === 'lemming-ohno' && event.lemmingId === actor.id)).to.have.length(1);
    expect(world.nukeAll()).to.equal(2); world._restart([]); expect([...world._manualNukeLanes]).to.deep.equal([0, 0]);
    expect(world.laneHeight).to.equal(144); expect(world.stall.laneHeight).to.equal(144); world.nukeAll(); world.dispose();
    expect([...world._manualNukeLanes]).to.deep.equal([0, 0]);
  });
});
