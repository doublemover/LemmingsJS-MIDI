import { expect } from 'chai';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
import { MAX_ROUTE_PROBES, MAX_LOCAL_ROUTE_DISTANCE } from '../js/app/procgen/ProcgenHazardPlanner.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
const scene = (masks, count = 8, options = {}) => {
  const height = options.height || 96, floor = height - 24, collision = new Map();
  const terrain = { chunkWidth: 128, configure() {}, reset() { collision.clear(); }, describe: () => ({ objects: [] }),
    getChunk(seed, chunk) {
      const key = seed + ':' + chunk; if (collision.has(key)) return collision.get(key);
      const solid = new Uint32Array(128 * height / 32), steel = new Uint32Array(solid.length);
      for (let y = 0; y < height; y++) for (let x = 0; x < 128; x++) {
        const wx = chunk * 128 + x, at = y * 128 + x;
        if (y >= floor && !(options.gap && wx >= 48 && wx < 64) || options.rear !== false && wx === 12 && y >= floor - 16 || wx === 104 && y >= floor - 16 || options.steel && wx === 20 && y === floor - 1 || options.ceiling && wx >= 24 && wx <= 54 && y === floor - 11) solid[at >>> 5] |= 1 << (at & 31);
        if (wx === 104 && y >= floor - 16 || options.steel && wx === 20 && y === floor - 1) steel[at >>> 5] |= 1 << (at & 31);
      }
      const result = { solid, steel, topProfile: new Uint8Array(128), gapWidth: 0, barrierWidth: 0 }; collision.set(key, result); return result;
    } };
  const world = new ProcgenLaneWorld({ masks, terrain, laneHeight: height, cohorts: true, maxActors: 32, assists: false,
    populationPolicy: { scoutsEvery: 0 }, workerLimits: { builders: 1, bashers: 0, diggers: 0 } });
  world.cohorts = false; world.admissionPaused = true; world.generatedThrough.fill(256);
  const blocker = world._spawn(0, false); Object.assign(blocker, { x: 50, y: floor, scout: false }); blocker.setAction(world.actions[State.BLOCKING]); world.step();
  const crew = Array.from({ length: count }, () => {
    const actor = world._spawn(0, false); Object.assign(actor, { x: options.start || 20, y: floor, scout: false, lookRight: true }); actor.setAction(world.actions[State.WALKING]); return actor;
  });
  return { world, crew, blocker, floor };
};
const replay = (masks, count, height) => {
  const { world, crew, blocker, floor } = scene(masks, count, { height }), events = [], arrivals = new Set();
  world.soundEvents.onEvent.on(event => events.push(event));
  const before = { x: blocker.x, y: blocker.y, state: blocker.state, triggers: world.triggerManager.byOwner.get(blocker) }, result = world.hazardPlanner.bypasses.prove(crew[0]);
  expect(result.proposal).to.include({ kind: 'builders', reason: 'supported-blocker-bypass' }); expect(result.probes).to.be.at.most(MAX_ROUTE_PROBES); expect(result.actionSteps).to.be.at.most(MAX_ROUTE_PROBES);
  expect(result.proposal.routeEvidence).to.include({ blockerId: blocker.id, naturalFall: true, landingY: floor, independentQualification: false });
  expect([blocker.x, blocker.y, blocker.state]).to.deep.equal([before.x, before.y, before.state]); expect(world.triggerManager.byOwner.get(blocker)).to.equal(before.triggers);
  expect(world.stats.builds).to.equal(0); expect(world.editChunks.size).to.equal(0); expect(events).to.have.length(0);
  world.assists = true; let sawFall = false;
  for (let tick = 0; tick < 600 && arrivals.size < count; tick++) {
    world.step(); sawFall ||= crew[0].action === world.actions[State.FALLING];
    for (const actor of crew) if (actor.x >= 58 && actor.action === world.actions[State.WALKING] && !actor.failureReason) arrivals.add(actor.id);
  }
  expect(arrivals.size, JSON.stringify({ tick: world.tickIndex, builds: world.stats.builds, crew: crew.map(a => [a.x,a.y,a.action.actionName,a.failureReason,a.lookRight]) })).to.equal(count); expect(world.stats.failures).to.equal(0); expect(world.stats.builds).to.equal(1); expect(world.stats.bashes + world.stats.digs + world.stats.mines).to.equal(0);
  expect(sawFall).to.equal(true); expect(world.getLanePolicySignals(0).successes).to.equal(1);
  expect(world.getLanePolicySignals(0).ordinaryCrossings).to.be.greaterThan(0); expect(world.getLanePolicySignals(0).learned.builders).to.be.at.least(2); expect(crew.every(actor => !actor.canClimb && !actor.hasParachute)).to.equal(true);
  expect(events.some(event => event.type === 'blocker-turn' && event.blockerId === blocker.id)).to.equal(true);
  expect(blocker.action).to.equal(world.actions[State.BLOCKING]); expect([blocker.x, blocker.y]).to.deep.equal([50, floor]);
  const receipt = { tick: world.tickIndex, builds: world.stats.builds, pixels: [...world.editChunks.values()].reduce((count, chunk) => { for (const pixel of chunk) if (pixel > 1) count++; return count; }, 0), actors: crew.map(actor => [actor.x, actor.y, actor.lookRight]), events: events.map(event => [event.type, event.tick, event.lemmingId]) };
  world.dispose(); expect(world.triggerManager.byOwner.size).to.equal(0); return receipt;
};
describe('real arriving-builder directional blocker bypass', function() {
  this.timeout(30000); let masks; before(async () => { masks = await loadProcgenMasks(); });
  for (const count of [8, 16]) it('builds, naturally drops forward and passes all ' + count + ' ordinary followers on fresh replay', () => { expect(replay(masks, count, 96)).to.deep.equal(replay(masks, count, 96)); });
  it('preserves the same actual action/contact geometry in a taller 144px stripe', () => { replay(masks, 8, 144); });
  it('rejects a close approach, open return, low ceiling, protected brick, unsupported landing and exhausted budget', () => {
    for (const options of [{ start: 28 }, { rear: false }, { ceiling: true }, { steel: true }, { gap: true }]) {
      const { world, crew } = scene(masks, 1, options); expect(world.hazardPlanner.bypasses.prove(crew[0]).proposal, JSON.stringify(options)).to.equal(null); expect(world.editChunks.size).to.equal(0); world.dispose();
    }
    const { world, crew } = scene(masks, 1); expect(world.hazardPlanner.bypasses.prove(crew[0], 1)).to.include({ proposal: null, failure: 'budget' });
    world.workerLimits.builders = 0; expect(world.hazardPlanner.bypasses.prove(crew[0]).proposal).to.equal(null); world.dispose();
    expect(MAX_LOCAL_ROUTE_DISTANCE).to.equal(40); expect(MAX_ROUTE_PROBES).to.equal(1024);
  });
  it('rejects actual enabled hazard envelopes, partial reveal and existing construction footprints without contact side effects', () => {
    const { world, crew } = scene(masks, 1), original = world.hazards.nearby;
    world.hazards.nearby = (_lane, _x, _options, out) => { out.length = 0; out.push({ x1: 47, x2: 51, y1: 61, y2: 73 }); return out; };
    expect(world.hazardPlanner.bypasses.prove(crew[0]).proposal).to.equal(null); expect(world.hazards.stats.contacts).to.equal(0); world.hazards.nearby = original;
    world.terrainGrowth = { stateFor: () => ({ complete: false }), dispose() {} }; expect(world.hazardPlanner.bypasses.prove(crew[0]).proposal).to.equal(null); world.terrainGrowth = null;
    world.accessTasks[0] = [{ owner: crew[0], action: crew[0].action, footprint: { x1: 24, x2: 30, y1: 60, y2: 73 } }];
    expect(world.hazardPlanner.bypasses.prove(crew[0])).to.include({ proposal: null, failure: 'construction' }); world.dispose();
  });
});
