import { expect } from 'chai';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { ProcgenHazardPlanner, MAX_ROUTE_PROBES, MAX_LOCAL_ROUTE_DISTANCE, ROUTE_LANES_PER_TICK } from '../js/app/procgen/ProcgenHazardPlanner.js';
import { WALK_CONTINUATION_DISTANCE, WALK_CONTINUATION_STEPS } from '../js/app/procgen/ProcgenWalkContinuation.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
import { loadProcgenMasks, loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';

const terrainFor = ({ landing = 112, objects = [], steelFloor = false } = {}) => {
  const collision = new Map(), height = 144;
  const solidAt = (x, y) => (x === 12 || x === 510) && y >= 80 ||
    (x >= 509 && x <= 514 || x >= 8 && x <= 13) && y >= 75 && y <= 79 || y >= (x >= 270 ? landing : 120);
  const descriptor = chunk => ({ objects: objects.filter(object => Math.floor(object.x / 128) === chunk) });
  return { recipe: { id: 'finite-completed-unsupported-stair' }, chunkWidth: 128, objects: objects.map(object => object.piece), collision,
    configure() {}, reset() { collision.clear(); }, describe: (_seed, chunk) => descriptor(chunk),
    solidSample: (_seed, chunk, x, y) => solidAt(chunk * 128 + x, y), sample: (_seed, x, y) => solidAt(x, y) ? 0xffa07050 : 0,
    getChunk(seed, chunk) {
      const key = `${seed}:${chunk}`;
      if (!collision.has(key)) {
        const solid = new Uint32Array(128 * height / 32), steel = new Uint32Array(solid.length), topProfile = new Int16Array(128); topProfile.fill(-1);
        for (let y = 0; y < height; y++) for (let x = 0; x < 128; x++) if (solidAt(chunk * 128 + x, y)) {
          const at = y * 128 + x; solid[at >>> 5] |= 1 << (at & 31);
          if (chunk * 128 + x === 510 || steelFloor && chunk * 128 + x >= 270) steel[at >>> 5] |= 1 << (at & 31);
          if (topProfile[x] < 0) topProfile[x] = y;
        }
        collision.set(key, { solid, steel, topProfile, ...descriptor(chunk) });
      }
      return collision.get(key);
    }, surface(seed, x) { return this.getChunk(seed, Math.floor(x / 128)).topProfile[x % 128]; }
  };
};
const make = (masks, options = {}) => {
  const world = new ProcgenLaneWorld({ masks, terrain: terrainFor(options), laneHeight: 144, assists: false, populationPolicy: { scoutsEvery: 0 } });
  world.generatedThrough.fill(1024); return world;
};
const completedStair = world => {
  const owner = world.actors[0];
  while (owner.x < 254 && world.tickIndex < 300) world.step();
  expect([owner.x, owner.y]).to.deep.equal([254, 120]);
  expect(world.assignWorker(owner, 'builders', 278)).to.equal(true);
  world.lanePolicy.begin(owner, { kind: 'builders' });
  const start = world.tickIndex;
  while (owner.action === world.actions[State.BUILDING] && world.tickIndex < 600) world.step();
  expect(world.tickIndex - start).to.equal(192); expect(owner.action).to.equal(world.actions[State.SHRUG]);
  expect([owner.x, owner.y]).to.deep.equal([278, 108]); return owner;
};
const proof = (world, actor, maxWork = MAX_ROUTE_PROBES, hazards = []) => {
  const planner = world.hazardPlanner; planner.probes = 0; planner.exhausted = false; planner.unrevealed = false;
  return planner.walking.prove(actor, (x, y) => planner._ground(x, y), hazards, maxWork);
};
const replay = (masks, count) => {
  const world = make(masks), owner = completedStair(world), bricks = [];
  for (let x = 254; x <= 281; x++) for (let y = 108; y <= 119; y++) if (world.hasGroundAt(x, y)) bricks.push([x, y, world.groundPixelAt(x, y)]);
  for (let index = 1; index < count; index++) world._spawn(0, false);
  expect(world.workerLimits.diggers).to.be.greaterThan(0); expect(world.workerLimits.bashers).to.be.greaterThan(0);
  world.assists = true; let ownerFell = false, ownerLanded = false; const arrivals = new Set(), states = [];
  while (world.tickIndex < 1200 && arrivals.size < count) {
    world.step();
    if (owner.action === world.actions[State.FALLING]) ownerFell = true;
    if (ownerFell && owner.action === world.actions[State.WALKING] && owner.y === 112) ownerLanded = true;
    for (const actor of world.actors) {
      expect(actor.x).to.be.within(9, 510); expect(actor.failureReason ?? actor.terminalReason ?? null).to.equal(null);
      if (actor.x > 350 && actor.action === world.actions[State.WALKING]) arrivals.add(actor.id);
    }
    states.push([world.tickIndex, owner.x, owner.y, owner.action.actionName]);
    expect(world.hazardPlanner.admission.lanes[0].probes).to.be.at.most(MAX_ROUTE_PROBES);
  }
  expect(ownerFell && ownerLanded).to.equal(true); expect(arrivals.size).to.equal(count);
  expect(world.activeCount).to.equal(count); expect(world.spawnedTotal).to.equal(count); expect(world.stats.builds).to.equal(1);
  expect(world.stats.mines + world.stats.digs + world.stats.bashes + world.stats.removedPixels + world.stats.failures).to.equal(0);
  expect(world.actors.every(actor => !actor.canClimb && !actor.hasParachute)).to.equal(true); expect(world.hazards.stats.contacts).to.equal(0);
  expect(world.hasSteelAt(510, 112)).to.equal(true);
  for (const [x, y, color] of bricks) { expect(world.hasGroundAt(x, y)).to.equal(true); expect(world.groundPixelAt(x, y)).to.equal(color); }
  const receipt = { tick: world.tickIndex, arrivals: [...arrivals], states, stats: { builds: world.stats.builds, excavation: world.stats.mines + world.stats.digs + world.stats.bashes, removed: world.stats.removedPixels },
    actors: world.actors.map(actor => [actor.id, actor.x, actor.y, actor.action.actionName]), proofSteps: world.hazardPlanner.walking.stats.actionSteps };
  world.dispose(); return receipt;
};

describe('completed unsupported procgen stair continuation', function() {
  this.timeout(10000); let masks, trap;
  before(async () => { masks = await loadProcgenMasks(); trap = (await loadProcgenTerrain('lemmings', 0)).objects.find(piece => piece.id === 6); });
  for (const count of [8, 16]) it(`freshly preserves every ordinary actor in an excavation-enabled ${count}-crew traversal`, () => {
    const receipt = replay(masks, count); expect(replay(masks, count)).to.deep.equal(receipt);
  });
  it('replaces the exact tick430 endpoint excavation with a passive real fall, without live audio or mutations during proof', () => {
    const world = make(masks), owner = completedStair(world);
    const events = []; world.soundEvents.onEvent.on(event => events.push(event));
    const before = [owner.x, owner.y, owner.action, owner.state, world.terrainRevision, world.stats.removedPixels, world.triggerManager.byOwner.size];
    const result = proof(world, owner); expect(result).to.include({ safe: true, fell: true, x: 302, y: 112 });
    expect(result.actionSteps).to.be.at.most(WALK_CONTINUATION_STEPS); expect(world.hazardPlanner.probes).to.be.at.most(MAX_ROUTE_PROBES);
    expect([owner.x, owner.y, owner.action, owner.state, world.terrainRevision, world.stats.removedPixels, world.triggerManager.byOwner.size]).to.deep.equal(before);
    expect(events).to.have.length(0); world.assists = true;
    while (world.tickIndex < 440) world.step();
    expect(world.stats.mines).to.equal(0); expect(world.stats.removedPixels).to.equal(0); expect(owner.y).to.equal(112); world.dispose();
  });
  it('qualifies completed construction with both start and end tiles, and invalidates only an observed local revision', () => {
    const world = make(masks), owner = completedStair(world), record = world.getLanePolicySignals(0).knowledge.find(entry => entry.kind === 'connected-route');
    expect(record).to.include({ type: 'builders', startX: 254, startY: 120, x: 278, y: 108 });
    expect(record.tiles.map(([key]) => key)).to.include.members([1, 2]); expect(record.tiles.length).to.be.at.most(4);
    expect('actor' in record || 'task' in record).to.equal(false); expect(world.lanePolicy.connectedConstruction(owner)).to.equal(true);
    world.setGroundAt(900, 20); expect(world.lanePolicy.connectedConstruction(owner)).to.equal(true);
    world.setGroundAt(250, 20); expect(world.lanePolicy.connectedConstruction(owner)).to.equal(false); world.dispose();
  });
  it('does not suppress a viable proactive bare-ledge builder or an existing supported gap bridge', () => {
    const world = make(masks), actor = world.actors[0]; Object.assign(actor, { x: 246, y: 120 }); actor.setAction(world.actions[State.WALKING]);
    expect(world.hazardPlanner.plan(actor)).to.include({ kind: 'builders', reason: 'short-stair-to-ledge' }); world.dispose();
    const gap = make(masks); for (let x = 70; x < 78; x++) for (let y = 120; y < 144; y++) gap.clearGroundAt(x, y);
    const walker = gap.actors[0]; Object.assign(walker, { x: 58, y: 120 }); walker.setAction(gap.actions[State.WALKING]);
    expect(gap.hazardPlanner.plan(walker)).to.include({ kind: 'builders', reason: 'supported-local-gap' }); gap.dispose();
  });
  it('rejects unsafe deep falls, hidden/partial support, and insufficient shared work without manufacturing continuation', () => {
    for (const mode of ['unsafe', 'hidden', 'partial', 'budget']) {
      const world = make(masks, { landing: mode === 'unsafe' ? 200 : 112 }), actor = world.actors[0]; Object.assign(actor, { x: 278, y: 108 }); actor.setAction(world.actions[State.WALKING]);
      if (mode === 'hidden') world.generatedThrough[0] = 288;
      if (mode === 'partial') world.terrainGrowth = { stateFor: () => ({ complete: false }), dispose() {} };
      const result = proof(world, actor, mode === 'budget' ? 2 : MAX_ROUTE_PROBES);
      expect(result.safe, mode).to.equal(false); expect(result.failure, mode).to.equal(mode === 'unsafe' ? 'bounds' : mode === 'budget' ? 'budget' : 'unrevealed');
      expect(world.stats.removedPixels).to.equal(0);
      if (mode === 'unsafe') {
        world.assists = true;
        while (!actor.failureReason && world.tickIndex < 40) world.step();
        expect(actor.failureReason).to.exist; expect(world.stats.failures).to.equal(1);
        expect(world.stats.mines + world.stats.digs + world.stats.builds + world.stats.bashes).to.equal(0);
      }
      world.dispose();
    }
  });
  it('rejects a real enabled trap on the natural landing and an actor-owned directional blocker', () => {
    const object = { piece: trap, x: 278, y: 112 - trap.image.height, supportY: 112, role: 'trap', animation: 'idle' };
    const hazard = make(masks, { objects: [object] }), actor = hazard.actors[0]; Object.assign(actor, { x: 278, y: 108 }); actor.setAction(hazard.actions[State.WALKING]);
    const observed = hazard.hazards.nearby(0, actor.x, { ahead: 40, behind: 4 }, []); expect(observed).to.have.length(1);
    expect(proof(hazard, actor, MAX_ROUTE_PROBES, observed)).to.include({ safe: false, failure: 'hazard' }); expect(hazard.hazards.stats.contacts).to.equal(0); hazard.dispose();
    const world = make(masks), walker = world.actors[0], blocker = world._spawn(0, false);
    Object.assign(walker, { x: 278, y: 112 }); walker.setAction(world.actions[State.WALKING]);
    Object.assign(blocker, { x: 290, y: 112 }); blocker.setAction(world.actions[State.BLOCKING]); blocker.process(world);
    expect(world.triggerManager.byOwner.get(blocker)).to.have.length(2);
    const before = [walker.x, walker.y, walker.lookRight, blocker.x, blocker.y, world.triggerManager.byOwner.size];
    expect(proof(world, walker)).to.include({ safe: false, failure: 'turn' });
    expect([walker.x, walker.y, walker.lookRight, blocker.x, blocker.y, world.triggerManager.byOwner.size]).to.deep.equal(before); world.dispose();
  });
  it('preserves protected steel/arrow support and rejects an active overlapping construction owner or changed observation', () => {
    const world = make(masks, { steelFloor: true }), actor = world.actors[0]; Object.assign(actor, { x: 278, y: 108 }); actor.setAction(world.actions[State.WALKING]);
    world.isArrowAt = () => true; expect(proof(world, actor)).to.include({ safe: true }); expect(world.hasSteelAt(302, 112)).to.equal(true); expect(world.stats.removedPixels).to.equal(0);
    const builder = world._spawn(0, false); Object.assign(builder, { x: 300, y: 112 }); builder.setAction(world.actions[State.WALKING]);
    expect(world.assignWorker(builder, 'builders', 324)).to.equal(true); expect(proof(world, actor)).to.include({ safe: false, failure: 'construction' });
    builder.setAction(world.actions[State.WALKING]); const read = world.hasGroundAt.bind(world); let changed = false;
    world.hasGroundAt = (x, y) => { if (!changed) { changed = true; world.terrainRevision++; } return read(x, y); };
    expect(proof(world, actor)).to.include({ safe: false, failure: 'changed-terrain' }); world.dispose();
    expect(MAX_LOCAL_ROUTE_DISTANCE).to.equal(40); expect(MAX_ROUTE_PROBES).to.equal(1024); expect(ROUTE_LANES_PER_TICK).to.equal(8); expect(WALK_CONTINUATION_DISTANCE).to.equal(24);
  });
});
