import { expect } from 'chai';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { ProcgenSupportedDescent, MAX_DESCENT_PROBES, MAX_DESCENT_DISTANCE } from '../js/app/procgen/ProcgenSupportedDescent.js';
import { MAX_LOCAL_ROUTE_DISTANCE, MAX_ROUTE_PROBES, ROUTE_LANES_PER_TICK } from '../js/app/procgen/ProcgenHazardPlanner.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
import { loadProcgenMasks, loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';

const terrainFor = ({ rear = true, forward = true, roof = 8, top = 72, floor = top + 32, steel = false, hole = false, objects = [] } = {}) => {
  const collision = new Map(), stripes = new Map();
  return { recipe: { id: 'physical-two-stripe-descent' }, chunkWidth: 128, objects: objects.map(object => object.piece), collision,
    configure() {}, registerLanes(seeds) { seeds.forEach((seed, lane) => stripes.set(seed, lane)); }, reset() { collision.clear(); },
    describe: (seed, chunk) => ({ objects: objects.filter(object => object.lane === stripes.get(seed) && Math.floor(object.x / 128) === chunk) }),
    solidSample(seed, chunk, x, y) { const data = this.getChunk(seed, chunk), at = y * 128 + x; return !!(data.solid[at >>> 5] & (1 << (at & 31))); },
    getChunk(seed, chunk) {
      const key = seed + ':' + chunk;
      if (!collision.has(key)) {
        const solid = new Uint32Array(384), metal = new Uint32Array(384), topProfile = new Int16Array(128); topProfile.fill(-1);
        for (let y = 0; y < 96; y++) for (let x = 0; x < 128; x++) {
          const wx = chunk * 128 + x, gy = (stripes.get(seed) || 0) * 96 + y, at = y * 128 + x;
          const ground = gy >= floor || gy >= top && gy < top + roof || wx >= 80 && wx < 90 && gy >= top - 28 && gy < floor - 5 ||
            rear && wx === 24 && gy >= top - 28 || forward && wx === 104 && gy >= floor - 14;
          if (ground && !(hole && wx === 62 && gy >= floor)) { solid[at >>> 5] |= 1 << (at & 31); if (topProfile[x] < 0) topProfile[x] = y; }
          if (forward && wx === 104 && gy >= floor - 14 || steel && wx === 64 && gy === top + 1) metal[at >>> 5] |= 1 << (at & 31);
        }
        collision.set(key, { solid, steel: metal, topProfile, gapWidth: 0, barrierWidth: 0 });
      }
      return collision.get(key);
    },
    surface(seed, x) { return this.getChunk(seed, Math.floor(x / 128)).topProfile[x % 128]; }
  };
};
const crewFor = (masks, count = 8, terrainOptions = {}, worldOptions = {}) => {
  const world = new ProcgenLaneWorld({ masks, terrain: terrainFor(terrainOptions), laneCount: 2, cohorts: true, maxActors: 16,
    workerLimits: { builders: 0, bashers: 0, diggers: 1 }, populationPolicy: { scoutsEvery: 1000000, scoutDelayTicks: 1000000 }, ...worldOptions });
  world.cohorts = false; world.generatedThrough.fill(256);
  const crew = Array.from({ length: count }, (_, i) => {
    const actor = world._spawn(0, false), x = i ? 64 - i * 2 : 64;
    Object.assign(actor, { x, y: terrainOptions.top ?? 72, furthestX: x, scout: false }); actor.setAction(world.actions[State.WALKING]); return actor;
  });
  return { world, crew, helper: new ProcgenSupportedDescent(world) };
};

const replay = (masks, count, kind) => {
  const { world, crew, helper } = crewFor(masks, count, { steel: kind === 'miners' }), leader = crew[0], events = [], arrivals = new Set(), trace = [];
  world.soundEvents.onEvent.on(event => events.push(event));
  const proposal = world.hazardPlanner.plan(leader);
  expect(proposal, JSON.stringify(world.hazardPlanner.descents.cache[0])).to.include({ kind, reason: 'observed-contained-descent', continuationY: 104 });
  expect(world.hazardPlanner.probes).to.be.at.most(1024); expect(world.stats.removedPixels).to.equal(0); expect(events).to.have.length(0);
  let fallingTick = null, walkingTick = null;
  while (world.tickIndex < 600 && arrivals.size < count) {
    world.step();
    if (fallingTick == null && leader.action === world.actions[State.FALLING]) fallingTick = world.tickIndex;
    if (fallingTick != null && walkingTick == null && leader.action === world.actions[State.WALKING]) walkingTick = world.tickIndex;
    for (const actor of crew) {
      expect(actor.x).to.be.within(25, 103); expect(actor.y).to.be.within(72, 104); expect(actor.failureReason).to.equal(null);
      if (actor.x >= 90 && actor.y === 104 && actor.action === world.actions[State.WALKING]) arrivals.add(actor.id);
    }
    trace.push(crew.map(actor => [actor.x, actor.y, actor.action.actionName, actor.frameIndex, actor.lookRight]));
  }
  expect(arrivals.size).to.equal(count); expect(world.activeCount).to.equal(count); expect(world.spawnedTotal).to.equal(count);
  expect(fallingTick).to.equal(proposal.routeEvidence.naturalFallingTick); expect(walkingTick).to.equal(proposal.routeEvidence.naturalWalkingTick);
  expect(world.stats.digs).to.equal(kind === 'diggers' ? 1 : 0); expect(world.stats.mines).to.equal(kind === 'miners' ? 1 : 0);
  expect(world.stats.builds + world.stats.bashes + world.stats.blockers + world.stats.failures).to.equal(0);
  expect(world.stats.removedPixels).to.equal(kind === 'diggers' ? 72 : 132); expect(world.hazards.stats.contacts).to.equal(0);
  expect(crew.every(actor => !actor.canClimb && !actor.hasParachute && !actor.scout)).to.equal(true);
  expect(world.generation).to.equal(1); expect(world.stats.laneTransfers).to.equal(count);
  for (let lane = 0; lane < 2; lane++) expect(world._accessTaskRecords(lane).every(task => !task.owner)).to.equal(true);
  const result = { trace, events: events.map(event => [event.type, event.tick, event.lemmingId, event.x, event.y, event.removed]), ticks: world.tickIndex };
  helper.dispose(); world.dispose(); return result;
};
describe('bounded actual shared-action deeper crew descents', function() {
  let masks;
  before(async () => { masks = await loadProcgenMasks(); });
  it('rejects absent physical containment, a broken follower landing, unknown termination and deeper unobserved falls', () => {
    for (const options of [{ rear: false }, { forward: false }, { hole: true }, { roof: 40 }, { floor: 105 }]) {
      const { world, crew, helper } = crewFor(masks, 8, options);
      expect(helper.prove(crew[0], MAX_DESCENT_PROBES).proposal, JSON.stringify(options)).to.equal(null);
      expect(world.stats.removedPixels).to.equal(0); helper.dispose(); world.dispose();
    }
  });
  it('protects the actual complete dig row and both real mining masks, including directional exclusions', () => {
    for (const kind of ['diggers', 'miners']) for (const guard of ['steel', 'arrows']) {
      const { world, crew, helper } = crewFor(masks);
      if (guard === 'steel') world.hasSteelAt = (x, y) => kind === 'diggers' ? x === 68 && y === 73 : y >= 60 && y <= 79;
      else { world.isArrowAt = () => true; world.hasArrowUnderMask = () => true; }
      const result = helper.prove(crew[0], MAX_DESCENT_PROBES, kind);
      expect(result.proposal, kind + ':' + guard).to.equal(null); expect(world.stats.removedPixels).to.equal(0);
      helper.dispose(); world.dispose();
    }
  });
  it('observes a genuine enabled normal-pack trap on the lower stripe without activating its shared owner', async () => {
    const trap = (await loadProcgenTerrain('lemmings', 0)).objects.find(piece => piece.id === 6);
    const object = { lane: 1, piece: trap, x: 36, y: 3, supportY: 24, role: 'trap', animation: 'idle' };
    const { world, crew, helper } = crewFor(masks, 8, { top: 88, objects: [object] }), before = [];
    world.soundEvents.onEvent.on(event => before.push(event));
    const result = helper.prove(crew[0], MAX_DESCENT_PROBES);
    expect(result.proposal).to.equal(null); expect(result.failure).to.equal('hazard');
    const owner = world.hazards.peek(1, 0, 0);
    expect(owner).not.to.equal(null); expect(owner.enabled).to.equal(true); expect(owner.activated).to.equal(false);
    expect(owner.trigger).to.include({ x1: 44, x2: 48, y1: 115, y2: 123 });
    expect(world.hazards.stats.contacts).to.equal(0); expect(before).to.have.length(0); expect(world.stats.removedPixels).to.equal(0);
    helper.dispose(); world.dispose();
  });
  it('checks every vertical fall step across stripes even when a thin enabled envelope misses both grounded endpoints', () => {
    const { world, crew, helper } = crewFor(masks), queried = new Set();
    world.hazards.nearby = (lane, x, options, out) => {
      queried.add(lane); out.length = 0;
      if (lane === 1) out.push({ lane, x1: 60, x2: 68, y1: 97, y2: 99, enabled: true, cooling: true });
      return out;
    };
    const result = helper.prove(crew[0], MAX_DESCENT_PROBES);
    expect(result.proposal).to.equal(null); expect(result.failure).to.equal('hazard'); expect([...queried]).to.deep.equal([0, 1]);
    expect(world.hazards.stats.contacts).to.equal(0); helper.dispose(); world.dispose();
  });
  it('rejects partial source growth and hidden physical-stripe landing geometry before assigning a worker', () => {
    for (const mode of ['partial', 'hidden']) {
      const { world, crew, helper } = crewFor(masks);
      if (mode === 'partial') world.terrainGrowth = { stateFor: lane => lane === 1 ? { complete: false, active: new Uint8Array() } : null, dispose() {} };
      else world.generatedThrough[1] = 60;
      const result = helper.prove(crew[0], MAX_DESCENT_PROBES);
      expect(result.proposal).to.equal(null); expect(result.failure).to.equal('unrevealed'); expect(world.stats.removedPixels).to.equal(0);
      helper.dispose(); world.dispose();
    }
  });
  it('does not retry mining after an exhausted observation budget or an out-of-neighborhood source read', () => {
    const { world, crew, helper } = crewFor(masks);
    const result = helper.prove(crew[0], 200);
    expect(result.proposal).to.equal(null); expect(result.failure).to.equal('budget'); expect(result.probes).to.equal(200);
    expect(helper.prove(crew[0], 100)).to.include({ proposal: null, probes: 0, failure: 'budget' });
    expect(helper.prove(crew[0], MAX_DESCENT_PROBES).proposal).to.include({ kind: 'diggers' });
    const shifted = crew[0]; shifted.x = 63;
    const bounded = helper.prove(shifted, MAX_DESCENT_PROBES, 'miners');
    expect(bounded.proposal).to.equal(null); expect(bounded.failure).to.equal('bounds');
    helper.dispose(); world.dispose();
  });
  it('protects live claims on initial and cached proposals while retaining a released geometry decision', () => {
    const { world, crew, helper } = crewFor(masks, 8, {}, { workerLimits: { builders: 1, bashers: 1, diggers: 1 } });
    const worker = crew[0], other = crew[1], proposal = helper.prove(worker, MAX_DESCENT_PROBES).proposal;
    expect(proposal).not.to.equal(null); Object.assign(other, { x: 90, y: 104, laneIndex: 1 });
    expect(world.assignWorker(other, 'builders', 96, { x1: 90, x2: 100, y1: 92, y2: 105 })).to.equal(true);
    expect(helper.prove(worker, MAX_DESCENT_PROBES).proposal).to.equal(null);
    helper.reset(); expect(helper.prove(worker, MAX_DESCENT_PROBES).proposal).to.equal(null);
    other.setAction(world.actions[State.WALKING]);
    expect(helper.prove(worker, MAX_DESCENT_PROBES).proposal).not.to.equal(null);
    expect(world.assignWorker(worker, 'diggers', worker.x, proposal.footprint)).to.equal(true);
    expect(world.assignWorker(crew[2], 'miners')).to.equal(false); world.setWorkerLimits({ diggers: 0 });
    expect(helper.prove(crew[2], MAX_DESCENT_PROBES).proposal).to.equal(null);
    helper.dispose(); world.dispose();
  });
  it('keeps the shared forty-pixel, 1024-query and eight-lane limits and clears bounded cached state on lifecycle changes', () => {
    expect(MAX_DESCENT_DISTANCE).to.equal(MAX_LOCAL_ROUTE_DISTANCE); expect(MAX_DESCENT_PROBES).to.equal(MAX_ROUTE_PROBES);
    const { world, crew, helper } = crewFor(masks, 8, {}, { laneCount: 64 });
    const actors = Array.from({ length: 64 }, (_, lane) => {
      const actor = lane ? world._spawn(lane, false) : crew[0];
      Object.assign(actor, { x: 64, y: lane * 96 + 72 }); actor.setAction(world.actions[State.WALKING]); return actor;
    });
    for (const actor of actors) world.hazardPlanner.plan(actor);
    expect(world.hazardPlanner.stats.plans).to.equal(ROUTE_LANES_PER_TICK);
    expect(world.hazardPlanner.stats.probes).to.be.at.most(MAX_ROUTE_PROBES * ROUTE_LANES_PER_TICK);
    expect(world.hazardPlanner.descents.stats.actionSteps).to.be.at.most(MAX_ROUTE_PROBES * ROUTE_LANES_PER_TICK);
    const before = helper.prove(crew[0], MAX_DESCENT_PROBES); expect(before.proposal).not.to.equal(null);
    expect(helper.prove(crew[0], 1)).to.include({ proposal: before.proposal, probes: 0, actionSteps: 0 });
    helper.reset(); expect(helper.cache.every(record => !record)).to.equal(true);
    world._restart([]); expect(world.hazardPlanner.descents.cache.every(record => !record)).to.equal(true);
    helper.dispose(); expect(helper.world).to.equal(null); expect(helper.actions[State.MINING].masks).to.equal(null);
    world.dispose(); expect(world.hazardPlanner.descents.world).to.equal(null);
  });
  it('preserves explicit abilities and active action ownership rather than simulating a different worker', () => {
    const { world, crew, helper } = crewFor(masks), actor = crew[0];
    for (const flag of ['canClimb', 'hasParachute', 'removed', 'disabled']) {
      actor[flag] = true; expect(helper.prove(actor, MAX_DESCENT_PROBES).proposal).to.equal(null); actor[flag] = false;
    }
    expect(helper.prove(actor, MAX_DESCENT_PROBES, 'builders').proposal).to.equal(null);
    actor.lookRight = false; expect(helper.prove(actor, MAX_DESCENT_PROBES).proposal).to.equal(null); actor.lookRight = true;
    actor.setAction(world.actions[State.DIGGING]); expect(helper.prove(actor, MAX_DESCENT_PROBES).proposal).to.equal(null);
    expect(world.stats.removedPixels).to.equal(0); helper.dispose(); world.dispose();
  });
  for (const count of [8, 16]) for (const kind of ['diggers', 'miners']) it('replays all ' + count + ' ordinary actors through natural ' + kind + '/FALL/WALK with fresh determinism', () => {
    expect(replay(masks, count, kind)).to.deep.equal(replay(masks, count, kind));
  });
  for (const kind of ['diggers', 'miners']) it('proves a genuine naturally completed 32px ' + kind + ' descent with contained ordinary entry columns', () => {
    const { world, crew, helper } = crewFor(masks), events = [];
    world.soundEvents.onEvent.on(event => events.push(event));
    const result = helper.prove(crew[0], MAX_DESCENT_PROBES, kind);
    expect(result.proposal, JSON.stringify({ result, cache: helper.cache[0] })).not.to.equal(null);
    expect(result.proposal).to.include({ kind, continuationY: 104, reason: 'observed-contained-descent' });
    expect(result.proposal.routeEvidence).to.include({ drop: 32, rearWallX: 24, upperWallX: 80, lowerRearWallX: 24, lowerWallX: 104, independentQualification: false });
    expect(result.probes).to.be.at.most(MAX_DESCENT_PROBES); expect(result.actionSteps).to.be.at.most(MAX_DESCENT_PROBES); expect(world.stats.removedPixels).to.equal(0); expect(events).to.have.length(0);
    helper.dispose(); world.dispose();
  });
});