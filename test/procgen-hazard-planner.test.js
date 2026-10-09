import { expect } from 'chai';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { ProcgenHazardPlanner, MAX_ROUTE_PROBES, ROUTE_LANES_PER_TICK } from '../js/app/procgen/ProcgenHazardPlanner.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
import { TriggerTypes as Types } from '../js/level/TriggerTypes.js';
import { loadProcgenMasks, loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';

const terrainFor = (ground, objects = []) => {
  const collision = new Map(), descriptor = chunk => ({ objects: objects.filter(object => Math.floor(object.x / 128) === chunk), gapWidth: 0, barrierWidth: 0 });
  return { recipe: { id: 'local-geometry-fixture' }, chunkWidth: 128, objects: objects.map(object => object.piece), collision,
    configure() {}, reset() { collision.clear(); }, describe: (seed, chunk) => descriptor(chunk), solidSample: (seed, chunk, x, y) => ground(chunk * 128 + x, y),
    getChunk(seed, chunk) {
      const key = seed + ':' + chunk;
      if (!collision.has(key)) {
        const solid = new Uint32Array(384), steel = new Uint32Array(384), topProfile = new Int16Array(128); topProfile.fill(-1);
        for (let x = 0; x < 128; x++) for (let y = 0; y < 96; y++) if (ground(chunk * 128 + x, y)) { const at = y * 128 + x; solid[at >>> 5] |= 1 << (at & 31); if (topProfile[x] < 0) topProfile[x] = y; }
        collision.set(key, { ...descriptor(chunk), solid, steel, topProfile });
      }
      return collision.get(key);
    }, surface(seed, x) { return this.getChunk(seed, Math.floor(x / 128)).topProfile[x % 128]; }
  };
};
const at = (world, x, y = 72, lane = 0) => {
  const actor = world.actors[lane]; Object.assign(actor, { x, y, laneIndex: lane, lookRight: true }); actor.setAction(world.actions[State.WALKING]); return actor;
};

describe('bounded procgen physical route proposals', function() {
  let masks, trap;
  before(async () => { masks = await loadProcgenMasks(); trap = (await loadProcgenTerrain('lemmings', 0)).objects.find(piece => piece.id === 6); });
  const make = (ground = (x, y) => y >= 72, objects = [], options = {}) => new ProcgenLaneWorld({ masks, terrain: terrainFor(ground, objects), assists: false, ...options });

  it('chooses a viable short staircase to a continuing ledge and executes the unchanged twelve-brick lifecycle', () => {
    const world = make((x, y) => y >= (x >= 80 ? 64 : 72)), actor = at(world, 64), planner = new ProcgenHazardPlanner(world);
    const proposal = planner.plan(actor);
    expect(proposal).to.include({ kind: 'builders', reason: 'short-stair-to-ledge', materialCost: 12, estimatedTicks: 192, continuationY: 64 });
    expect(proposal.footprint).to.deep.equal({ x1: 64, x2: 92, y1: 60, y2: 73 });
    expect(world.assignWorker(actor, proposal.kind, proposal.targetX)).to.equal(true);
    for (let tick = 0; tick < 230; tick++) world.step();
    expect(actor.x).to.be.greaterThan(90); expect(actor.y).to.equal(64); expect(actor.failureReason).to.equal(null);
    expect(world.stats.builds).to.equal(1); expect(world.stats.bashes).to.equal(0); expect(world.stats.removedPixels).to.equal(0);
    planner.dispose(); world.dispose();
  });
  it('rejects a low ceiling, and prefers a supported real tunnel when a high finite cliff is beyond builder reach', () => {
    const ceiling = make((x, y) => y >= (x >= 80 ? 64 : 72) || x >= 66 && x < 115 && y >= 54 && y <= 58);
    expect(new ProcgenHazardPlanner(ceiling).plan(at(ceiling, 64))).to.equal(null); ceiling.dispose();
    const world = make((x, y) => y >= 72 || x >= 76 && x < 90 && y >= 44), actor = at(world, 68), planner = new ProcgenHazardPlanner(world);
    expect(planner.plan(actor)).to.include({ kind: 'bashers', reason: 'supported-local-tunnel', materialCost: 0 });
    expect(world.assignWorker(actor, 'bashers')).to.equal(true); for (let tick = 0; tick < 180; tick++) world.step();
    expect(actor.x).to.be.greaterThan(94); expect(actor.failureReason).to.equal(null); expect(world.stats.removedPixels).to.be.greaterThan(0);
    world.dispose();
  });
  it('does not always build: a flat passage stays walking and a low-ceiling finite tunnel uses bashing', () => {
    const flat = make(); expect(new ProcgenHazardPlanner(flat).plan(at(flat, 64))).to.equal(null); flat.dispose();
    const world = make((x, y) => y >= 72 || x >= 60 && x < 115 && y >= 54 && y <= 58 || x >= 76 && x < 84 && y >= 58 && y < 72);
    expect(new ProcgenHazardPlanner(world).plan(at(world, 68))).to.include({ kind: 'bashers' }); world.dispose();
  });
  it('steps over an actual nearby sourced trap, without triggering its owner or granting permanent abilities', () => {
    const object = { piece: trap, x: 60, y: 72 - trap.image.height, supportY: 72, role: 'trap', animation: 'idle' };
    const world = make((x, y) => y >= 72, [object]), actor = at(world, 54), planner = new ProcgenHazardPlanner(world);
    const proposal = planner.plan(actor); expect(proposal).to.include({ kind: 'builders', reason: 'supported-hazard-bypass' });
    expect(world.hazards.peek(0, 0, 0).trigger.type).to.equal(Types.TRAP); expect(world.hazards.stats.contacts).to.equal(0);
    world.assignWorker(actor, proposal.kind, proposal.targetX); for (let tick = 0; tick < 230; tick++) world.step();
    expect(actor.x).to.be.greaterThan(80); expect(actor.failureReason).to.equal(null); expect(world.hazards.stats.contacts).to.equal(0);
    expect(actor.canClimb).to.equal(false); expect(actor.hasParachute).to.equal(false); world.dispose();
  });
  it('rejects an overhead hazard, a hazardous tunnel exit, steel excavation, and unrevealed continuation', () => {
    const object = { piece: trap, x: 60, y: 72 - trap.image.height, supportY: 72, role: 'trap' };
    const world = make((x, y) => y >= 72 || x >= 76 && x < 90 && y >= 44, [object]), actor = at(world, 68), planner = new ProcgenHazardPlanner(world);
    expect(planner.plan(actor)).to.equal(null); world.dispose();
    const steel = make((x, y) => y >= 72 || x >= 76 && x < 90 && y >= 44); steel.hasSteelAt = (x, y) => x >= 76 && x < 90 && y < 72;
    steel.hasSteelUnderMask = () => true; expect(new ProcgenHazardPlanner(steel).plan(at(steel, 68))).to.equal(null); steel.dispose();
    const hidden = make((x, y) => y >= (x >= 80 ? 64 : 72)); hidden.generatedThrough[0] = 88;
    expect(new ProcgenHazardPlanner(hidden).plan(at(hidden, 64))).to.equal(null); hidden.dispose();
  });
  it('keeps normal wall bounce and later walking after a hazardous tunnel rejection in the source World hook', () => {
    const object = { piece: trap, x: 92, y: 72 - trap.image.height, supportY: 72, role: 'trap' };
    const world = make((x, y) => y >= 72 || x >= 76 && x < 90 && y >= 44, [object], { assists: true }), actor = at(world, 75);
    world.step(); expect(actor.action).to.equal(world.actions[State.WALKING]); expect(actor.lookRight).to.equal(false); expect(actor.x).to.equal(75);
    expect(world.stats.bashes).to.equal(0); expect(world.stats.builds).to.equal(0);
    world.step(); expect(actor.x).to.equal(74); expect(actor.lookRight).to.equal(false); world.dispose();
  });
  it('covers a small locally observed gap using actual supported continuation', () => {
    const world = make((x, y) => !(x >= 76 && x < 84) && y >= 72), planner = new ProcgenHazardPlanner(world);
    expect(planner.plan(at(world, 64))).to.include({ kind: 'builders', reason: 'supported-local-gap' });
    expect(world.editChunks.size).to.equal(0); world.dispose();
  });
  it('uses global physical stripe geometry when the real builder footprint crosses a stripe', () => {
    const world = make(() => false, [], { laneCount: 2 });
    world.setGroundAt(64, 102); for (let x = 88; x < 100; x++) for (let y = 90; y < 95; y++) world.setGroundAt(x, y);
    const actor = at(world, 64, 102, 1); world.tickIndex = 1;
    expect(new ProcgenHazardPlanner(world).plan(actor)).to.include({ kind: 'builders', continuationY: 90 }); world.dispose();
  });
  it('dig-through a revealed thin roof naturally lands and replans a real tunnel for an ordinary crew', () => {
    const ground = (x, y) => y >= 84 || y >= 72 && y <= 74 || x >= 80 && x < 90 && y >= 44;
    const world = make(ground, [], { assists: true, populationPolicy: { scoutsEvery: 1000000, scoutDelayTicks: 1000000 } });
    world.hasSteelAt = (x, y) => x >= 80 && x < 90 && y < 75;
    const assignments = [], assign = world.assignWorker.bind(world);
    world.assignWorker = (actor, kind, ...args) => { const accepted = assign(actor, kind, ...args); if (accepted) assignments.push({ kind, id: actor.id, x: actor.x, y: actor.y, tick: world.tickIndex }); return accepted; };
    const actor = at(world, 64), proposal = world.hazardPlanner.plan(actor);
    expect(proposal).to.include({ kind: 'diggers', reason: 'known-safe-descent', continuationY: 84 });
    expect(proposal.footprint).to.deep.equal({ x1: 60, x2: 69, y1: 70, y2: 85 });
    expect(world.assignWorker(actor, proposal.kind, proposal.targetX, proposal.footprint)).to.equal(true);
    for (let index = 1; index < 8; index++) { const follower = world._spawn(0, false); Object.assign(follower, { x: 12 + index % 4, y: 72 }); follower.setAction(world.actions[State.WALKING]); }
    const observed = new Set(); let digCompleted = false, landed = false, subsequentBash = false;
    for (let tick = 0; tick < 350; tick++) {
      world.step(); observed.add(actor.action?.actionName);
      if (actor.action === world.actions[State.FALLING]) digCompleted = true;
      if (digCompleted && actor.action === world.actions[State.WALKING] && actor.y === 84) landed = true;
      if (landed && actor.action === world.actions[State.BASHING]) subsequentBash = true;
    }
    expect([...observed]).to.include.members(['digging', 'falling', 'walk', 'bashing']); expect(digCompleted).to.equal(true); expect(landed).to.equal(true); expect(subsequentBash).to.equal(true);
    expect(world.stats.digs).to.equal(1);
    expect(assignments.filter(a => a.kind === 'diggers')).to.deep.equal([{ kind: 'diggers', id: 0, x: 64, y: 72, tick: 0 }]);
    expect(assignments.filter(a => a.kind === 'bashers').length).to.equal(world.stats.bashes); expect(world.stats.bashes).to.be.greaterThan(0); expect(world.stats.removedPixels).to.be.greaterThan(0);
    expect(world.spawnedTotal).to.equal(8); expect(world.activeCount).to.equal(8); expect(world.stats.failures).to.equal(0);
    expect(world.actors.every(a => a.x > 94 && !a.failureReason && !a.canClimb && !a.hasParachute)).to.equal(true); world.dispose();
  });
  it('rejects unknown downward excavation, steel, a hazardous landing and unavailable digger budget', () => {
    const ground = (x, y) => y >= 84 || x < 76 && y >= 72 && y <= 74 || x >= 80 && x < 90 && y >= 66;
    for (const mode of ['steel', 'hazard', 'budget', 'hidden']) {
      const world = make(ground), actor = at(world, 64);
      if (mode === 'steel') world.hasSteelAt = (x, y) => x === 64 && y === 73 || x === 65 && y === 72;
      if (mode === 'hazard') world.hazards.nearby = (_lane, _x, _options, out) => { out.length = 0; out.push({ x1: 60, x2: 68, y1: 77, y2: 85 }); return out; };
      if (mode === 'budget') world.setWorkerLimits({ diggers: 0 });
      if (mode === 'hidden') world.generatedThrough[0] = 70;
      expect(world.hazardPlanner.plan(actor), mode).to.equal(null); expect(world.stats.removedPixels).to.equal(0); world.dispose();
    }
    const solid = make((x, y) => y >= 72 || x >= 80 && y >= 50); expect(solid.hazardPlanner.plan(at(solid, 64))).to.equal(null); solid.dispose();
  });
  it('mines a revealed diagonal descent with the shared masks, naturally lands and replans without permanent abilities', () => {
    const ground = (x, y) => y >= 84 || y >= 72 && y <= 74 || x >= 80 && x < 90 && y >= 44;
    const world = make(ground, [], { assists: true, populationPolicy: { scoutsEvery: 1000000, scoutDelayTicks: 1000000 } });
    world.hasSteelAt = (x, y) => x === 64 && y === 73 || x >= 80 && x < 90 && y < 75;
    const actor = at(world, 64), assignments = [], assign = world.assignWorker.bind(world);
    world.assignWorker = (owner, kind, ...args) => { const accepted = assign(owner, kind, ...args); if (accepted) assignments.push({ kind, id: owner.id, x: owner.x, y: owner.y, tick: world.tickIndex }); return accepted; };
    const proposal = world.hazardPlanner.plan(actor);
    expect(proposal).to.include({ kind: 'miners', reason: 'known-safe-mine-descent', continuationY: 84, materialCost: 0 });
    expect(proposal.footprint).to.deep.equal({ x1: 63, x2: 77, y1: 60, y2: 85 });
    expect(world.assignWorker(actor, proposal.kind, proposal.targetX, proposal.footprint)).to.equal(true);
    const observed = new Set(); let mineCompleted = false, landed = false, subsequentBash = false;
    for (let tick = 0; tick < 350; tick++) {
      world.step(); observed.add(actor.action?.actionName);
      if (actor.action === world.actions[State.FALLING]) mineCompleted = true;
      if (mineCompleted && actor.action === world.actions[State.WALKING] && actor.y === 84) landed = true;
      if (landed && actor.action === world.actions[State.BASHING]) subsequentBash = true;
    }
    expect([...observed]).to.include.members(['mining', 'falling', 'walk', 'bashing']);
    expect(mineCompleted).to.equal(true); expect(landed).to.equal(true); expect(subsequentBash).to.equal(true);
    expect(assignments.filter(a => a.kind === 'miners')).to.deep.equal([{ kind: 'miners', id: 0, x: 64, y: 72, tick: 0 }]);
    expect(world.stats.mines).to.equal(1); expect(world.stats.digs).to.equal(0); expect(world.stats.bashes).to.be.greaterThan(0); expect(world.stats.removedPixels).to.be.greaterThan(0);
    expect(world.hasGroundAt(64, 73)).to.equal(true); expect(actor.x).to.be.greaterThan(94); expect(actor.failureReason).to.equal(null);
    expect(world.spawnedTotal).to.equal(1); expect(world.activeCount).to.equal(1); expect(world.stats.failures).to.equal(0);
    expect(actor.canClimb).to.equal(false); expect(actor.hasParachute).to.equal(false); world.dispose();
  });
  it('rejects protected mining masks, unknown termination, hazardous landing, hidden geometry and the shared disabled budget', () => {
    const ground = (x, y) => y >= 84 || y >= 72 && y <= 74 || x >= 80 && x < 90 && y >= 44;
    for (const mode of ['steel', 'hazard', 'budget', 'hidden', 'solid']) {
      const world = make(mode === 'solid' ? (x, y) => y >= 72 || x >= 80 && x < 90 && y >= 44 : ground), actor = at(world, 64);
      world.hasSteelAt = (x, y) => x === 64 && y === 73 || x >= 80 && x < 90 && y < 75 || mode === 'steel' && x === 65 && y === 72;
      if (mode === 'hazard') world.hazards.nearby = (_lane, _x, _options, out) => { out.length = 0; out.push({ x1: 68, x2: 75, y1: 77, y2: 85 }); return out; };
      if (mode === 'budget') world.setWorkerLimits({ diggers: 0 });
      if (mode === 'hidden') world.generatedThrough[0] = 70;
      expect(world.hazardPlanner.plan(actor), mode).to.equal(null); expect(world.stats.removedPixels).to.equal(0); world.dispose();
    }
  });
  it('bounds shared work, caches same-tick proposals, rotates lanes and clears reset/dispose references', () => {
    const world = make((x, y) => y >= (x >= 80 ? 64 : 72), [], { laneCount: 64 }), planner = new ProcgenHazardPlanner(world);
    world.actors.forEach((actor, lane) => at(world, 64, lane * 96 + 72, lane));
    let proposed = 0;
    for (const actor of world.actors) if (planner.plan(actor)) proposed++;
    expect(proposed).to.equal(ROUTE_LANES_PER_TICK); expect(planner.stats.plans).to.equal(ROUTE_LANES_PER_TICK);
    expect(planner.stats.probes).to.be.at.most(MAX_ROUTE_PROBES * ROUTE_LANES_PER_TICK);
    const first = planner.plan(world.actors[0]); expect(planner.plan(world.actors[0])).to.equal(first);
    world.tickIndex++; expect(planner.plan(world.actors[1])).to.exist; planner.reset(); expect(planner.cache.every(value => !value)).to.equal(true);
    planner.dispose(); expect(planner.world).to.equal(null); world.dispose();
  });
});
