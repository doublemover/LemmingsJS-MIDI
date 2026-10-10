import { expect } from 'chai';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { MAX_LOCAL_ROUTE_DISTANCE, MAX_ROUTE_PROBES, ROUTE_LANES_PER_TICK } from '../js/app/procgen/ProcgenHazardPlanner.js';
import { MAX_TUNNEL_PROBES } from '../js/app/procgen/ProcgenSupportedTunnel.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
import { loadProcgenMasks, loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';

const terrainFor = ({ rear = true, wallEnd = 128, gap = false, steel = false, objects = [] } = {}) => {
  const collision = new Map();
  return { recipe: { id: 'finite-supported-tunnel-fixture' }, chunkWidth: 256, objects: objects.map(object => object.piece), collision, configure() {}, reset() { collision.clear(); },
    describe: (_seed, chunk) => ({ objects: objects.filter(object => Math.floor(object.x / 256) === chunk) }),
    solidSample(seed, chunk, x, y) { const data = this.getChunk(seed, chunk), at = y * 256 + x; return !!(data.solid[at >>> 5] & (1 << (at & 31))); },
    getChunk(seed, chunk) {
      const key = `${seed}:${chunk}`;
      if (!collision.has(key)) {
        const solid = new Uint32Array(768), metal = new Uint32Array(768);
        for (let y = 0; y < 96; y++) for (let x = 0; x < 256; x++) {
          const wx = chunk * 256 + x, inWall = wx >= 64 && wx < wallEnd && y >= 48, at = y * 256 + x;
          if ((y >= 72 || inWall || wx === 243 && y >= 48 || rear && wx === 12 && y >= 48) && !(gap && wx === 94 && y >= 72)) solid[at >>> 5] |= 1 << (at & 31);
          if (steel && wx === 95 && y === 67 || wx === 243 && y >= 48) metal[at >>> 5] |= 1 << (at & 31);
        }
        collision.set(key, { solid, steel: metal, topProfile: new Uint8Array(256), barrierWidth: 0, gapWidth: 0 });
      }
      return collision.get(key);
    }
  };
};
const crewFor = (masks, count = 8, options = {}, worldOptions = {}) => {
  const world = new ProcgenLaneWorld({ masks, terrain: terrainFor(options), cohorts: true, maxActors: Math.max(16, count),
    workerLimits: { bashers: 1, builders: 0, diggers: 0 }, populationPolicy: { scoutsEvery: 1000000, scoutDelayTicks: 1000000 }, ...worldOptions });
  world.cohorts = false; world.admissionPaused = true; world.generatedThrough.fill(512);
  const crew = Array.from({ length: count }, (_, index) => {
    const actor = world._spawn(0, false), x = index ? 48 - index : 63;
    Object.assign(actor, { x, y: 72, furthestX: x, lookRight: true, scout: false }); actor.setAction(world.actions[State.WALKING]); return actor;
  });
  return { world, crew };
};
const replay = (masks, count) => {
  const { world, crew } = crewFor(masks, count), leader = crew[0], events = [], arrivals = new Set();
  world.soundEvents.onEvent.on(event => events.push(event));
  const proposal = world.hazardPlanner.plan(leader), before = { ...world.stats };
  expect(proposal).to.include({ kind: 'bashers', reason: 'observed-contained-tunnel', estimatedTicks: 197 });
  expect(proposal.footprint.x2 - proposal.startX).to.be.greaterThan(MAX_LOCAL_ROUTE_DISTANCE);
  expect(proposal.routeEvidence).to.include({ rearWallX: 12, naturalWalkingTick: 197, wholeCrewContainment: 'observed-wall', independentQualification: false });
  expect(before.removedPixels).to.equal(0); expect(before.bashes).to.equal(0); expect(events).to.have.length(0);
  let walkingTick = null;
  while (world.tickIndex < 600 && arrivals.size < count) {
    world.step();
    if (walkingTick == null && world.stats.bashes && leader.action === world.actions[State.WALKING]) walkingTick = world.tickIndex;
    for (const actor of crew) if (actor.x >= 148 && !actor.failureReason && actor.action === world.actions[State.WALKING]) arrivals.add(actor.id);
  }
  expect(walkingTick).to.equal(197); expect(arrivals.size).to.equal(count);
  expect(world.activeCount).to.equal(count); expect(world.spawnedTotal).to.equal(count); expect(world.stats.failures).to.equal(0);
  expect(world.stats.bashes).to.equal(1); expect(world.stats.builds + world.stats.digs + world.stats.mines).to.equal(0);
  expect(world.stats.blockers).to.equal(0); expect(world.hazards.stats.contacts).to.equal(0); expect(world.stats.removedPixels).to.be.greaterThan(0);
  expect(world.hasSteelAt(243, 67)).to.equal(true); expect(world.hasGroundAt(243, 67)).to.equal(true);
  expect(crew.every(actor => actor.x > 12 && actor.x < 243)).to.equal(true);
  expect(events.filter(event => event.type === 'lemming-bash').length).to.be.greaterThan(0);
  expect(crew.every(actor => !actor.canClimb && !actor.hasParachute && !actor.failureReason && actor.action === world.actions[State.WALKING])).to.equal(true);
  const receipt = { tick: world.tickIndex, walkingTick, removedPixels: world.stats.removedPixels,
    actors: crew.map(actor => [actor.id, actor.x, actor.y, actor.lookRight, actor.frameIndex]), events: events.map(event => [event.tick, event.type, event.lemmingId, event.x, event.y]) };
  world.dispose(); return receipt;
};

describe('bounded observed long tunnels with ordinary whole crews', function() {
  this.timeout(30000); let masks, trap;
  before(async () => { masks = await loadProcgenMasks(); trap = (await loadProcgenTerrain('lemmings', 0)).objects.find(piece => piece.id === 6); });
  for (const count of [8, 16]) it(`naturally completes one real 64px bash and all ${count} ordinary actors traverse, identically on fresh replay`, () => {
    expect(replay(masks, count)).to.deep.equal(replay(masks, count));
  });
  it('honors an actual rear wall instead of creating a permanent blocker before the shared bounce', () => {
    const { world, crew } = crewFor(masks, 1), actor = crew[0]; Object.assign(actor, { x: 13, lookRight: false });
    world.step(); expect(actor.action).to.equal(world.actions[State.WALKING]); expect(actor.x).to.equal(13); expect(actor.lookRight).to.equal(true);
    expect(world.stats.blockers).to.equal(0); world.dispose();
  });
  it('reuses the rear corridor across distant work and invalidates real local edge edits and supported hazard geometry', () => {
    const { world, crew } = crewFor(masks, 1, {}, { laneCount: 2 }), actor = crew[0]; actor.x = 20;
    expect(world._rearEdgeWall(actor)).to.equal(true); const cached = world._edgeWallCache[0], queries = world.stats.groundQueries;
    world.setGroundAt(600, 150); world.setGroundAt(95, 66);
    expect(world._rearEdgeWall(actor)).to.equal(true); expect(world._edgeWallCache[0]).to.equal(cached); expect(world.stats.groundQueries).to.equal(queries);
    world.clearGroundAt(12, 65); expect(world._rearEdgeWall(actor)).to.equal(false);
    expect(world.stats.groundQueries).to.be.greaterThan(queries); world.dispose();
    const object = { piece: trap, x: 8, y: 72 - trap.image.height, supportY: 72, role: 'trap', animation: 'idle' };
    const hazard = crewFor(masks, 1, { objects: [object] }); hazard.crew[0].x = 20;
    expect(hazard.world._rearEdgeWall(hazard.crew[0])).to.equal(false); expect(hazard.world.hazards.stats.contacts).to.equal(0); hazard.world.dispose();
  });
  it('preserves lane-local hazard observations and authoritative edits across retention', () => {
    const { world, crew } = crewFor(masks, 1, {}, { laneCount: 2 }), actor = crew[0]; actor.x = 20;
    world.hazards.nearby = (lane, _x, _options, out) => {
      out.length = 0; if (lane === 0) out.push({ x1: 15, x2: 18, y1: 66, y2: 73 }); return out;
    };
    expect(world._rearEdgeWall(actor)).to.equal(false);
    expect(world._rearEdgeWall({ laneIndex: 1, x: 20, y: 168 })).to.equal(true);
    world.setGroundAt(12, 65); actor.x = 200; world._pruneEdits(); actor.x = 20;
    expect(world.hasGroundAt(12, 65)).to.equal(true); expect(world._rearEdgeWall(actor)).to.equal(false); world.dispose();
  });
  it('rejects partial materialization even when a raw descriptor contains final solid art', () => {
    const { world, crew } = crewFor(masks, 1); let partial = true;
    world.terrainGrowth = { stateFor: () => partial ? { complete: false } : null, dispose() {} };
    expect(world.hazardPlanner.plan(crew[0])).to.equal(null);
    partial = false; world.frontierRevision++; world.tickIndex++; world.terrainTileRevisions.set(0, ++world.terrainRevision);
    expect(world.hazardPlanner.plan(crew[0])).to.include({ reason: 'observed-contained-tunnel' }); world.dispose();
  });
  it('rejects absent physical containment, an unsafe foot hole, protected masks, hidden geometry and disabled resources', () => {
    for (const mode of ['rear', 'gap', 'steel', 'arrows', 'hidden', 'budget']) {
      const { world, crew } = crewFor(masks, 8, { rear: mode !== 'rear', gap: mode === 'gap', steel: mode === 'steel' });
      if (mode === 'arrows') world.hasArrowUnderMask = (_mask, x) => x >= 90;
      if (mode === 'hidden') world.generatedThrough.fill(100);
      if (mode === 'budget') world.setWorkerLimits({ bashers: 0 });
      expect(world.hazardPlanner.plan(crew[0]), mode).to.equal(null);
      expect(world.stats.removedPixels).to.equal(0); expect(world.stats.bashes).to.equal(0); world.dispose();
    }
  });
  it('rejects a real sourced enabled trap in the predicted exit without touching its owner or terrain', () => {
    const object = { piece: trap, x: 115, y: 72 - trap.image.height, supportY: 72, role: 'trap', animation: 'idle' };
    const { world, crew } = crewFor(masks, 8, { objects: [object] });
    expect(world.hazardPlanner.plan(crew[0])).to.equal(null);
    const owner = world.hazards.peek(0, 0, 0); expect(owner.enabled).to.equal(true); expect(owner.activated).to.equal(false);
    expect(world.hazards.stats.contacts).to.equal(0); expect(world.stats.removedPixels).to.equal(0); world.dispose();
  });
  it('keeps a cold proof cached through other lanes and distant edits, without extra source queries', () => {
    const { world, crew } = crewFor(masks, 1, {}, { laneCount: 2 }), proof = world.hazardPlanner.tunnels;
    const first = proof.prove(crew[0], MAX_ROUTE_PROBES), queries = world.stats.groundQueries; expect(first.proposal).to.exist;
    world.setGroundAt(600, 150); world.setGroundAt(700, 65);
    const again = proof.prove(crew[0], MAX_ROUTE_PROBES);
    expect(again.proposal).to.equal(first.proposal); expect(again.probes).to.equal(0); expect(world.stats.groundQueries).to.equal(queries);
    world.setGroundAt(95, 70); expect(proof.prove(crew[0], MAX_ROUTE_PROBES).probes).to.be.greaterThan(0); world.dispose();
  });
  it('preserves all active physical claims on cached proposals and admits independent work only within caps', () => {
    const { world, crew } = crewFor(masks, 8, {}, { workerLimits: { bashers: 2, builders: 1, diggers: 1 } }), leader = crew[0];
    const proposal = world.hazardPlanner.plan(leader); expect(proposal).to.exist;
    expect(proposal.footprint.x1).to.equal(12); expect(proposal.footprint.x2).to.be.at.least(proposal.routeEvidence.observedThrough);
    const builder = crew[1]; Object.assign(builder, { x: 120, y: 72 });
    expect(world.assignWorker(builder, 'builders', 144, { x1: 120, x2: 148, y1: 60, y2: 73 })).to.equal(true);
    expect(world.hazardPlanner.plan(leader)).to.equal(null);
    builder.setAction(world.actions[State.WALKING]); world.tickIndex++;
    expect(world.hazardPlanner.plan(leader)).to.exist;
    expect(world.assignWorker(leader, proposal.kind, proposal.targetX, proposal.footprint)).to.equal(true);
    expect(world.hazardPlanner.plan(crew[0])).to.equal(null);
    expect(world.assignWorker(crew[2], 'bashers', 64, proposal.footprint)).to.equal(false);
    crew[4].x = 32;
    expect(world.assignWorker(crew[4], 'diggers', 32, { x1: 28, x2: 37, y1: 62, y2: 80 })).to.equal(false);
    crew[2].x = 200;
    expect(world.assignWorker(crew[2], 'bashers', 200, { x1: 180, x2: 220, y1: 62, y2: 73 })).to.equal(true);
    crew[3].x = 300;
    expect(world.assignWorker(crew[3], 'bashers', 300, { x1: 280, x2: 320, y1: 62, y2: 73 })).to.equal(false); world.dispose();
  });
  it('keeps local40, the shared1024 observations and eight lane slots; a larger unproved wall is rejected', () => {
    expect(MAX_LOCAL_ROUTE_DISTANCE).to.equal(40); expect(MAX_TUNNEL_PROBES).to.equal(MAX_ROUTE_PROBES);
    const wide = crewFor(masks, 8, { wallEnd: 160 }); expect(wide.world.hazardPlanner.plan(wide.crew[0])).to.equal(null);
    expect(wide.world.hazardPlanner.stats.probes).to.be.at.most(MAX_ROUTE_PROBES); expect(wide.world.stats.removedPixels).to.equal(0); wide.world.dispose();
    const { world } = crewFor(masks, 0, {}, { laneCount: 64 });
    for (let lane = 0; lane < 64; lane++) {
      const actor = world._spawn(lane, false); Object.assign(actor, { x: 63, y: lane * 96 + 72 }); actor.setAction(world.actions[State.WALKING]);
    }
    let proposals = 0; for (const actor of world.actors) if (world.hazardPlanner.plan(actor)) proposals++;
    expect(proposals).to.equal(ROUTE_LANES_PER_TICK); expect(world.hazardPlanner.stats.plans).to.equal(ROUTE_LANES_PER_TICK);
    expect(world.hazardPlanner.stats.probes).to.be.at.most(MAX_ROUTE_PROBES * ROUTE_LANES_PER_TICK);
    const proof = world.hazardPlanner.tunnels; expect(proof.cache.some(entry => entry?.proposal)).to.equal(true);
    world._restart([]); expect(proof.cache.every(entry => entry == null)).to.equal(true);
    world.dispose(); expect(proof.world).to.equal(null); expect(proof.bash.masks).to.equal(null);
  });
});
