import { expect } from 'chai';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { loadProcgenMasks, loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';

const flat = world => { world.baseGroundAt = (_x, y) => y % 96 >= 80 ? 1 : 0; return world; };
describe('real procgen population and delayed scouts', function() {
  let masks, terrain;
  before(async () => { masks = await loadProcgenMasks(); terrain = await loadProcgenTerrain('lemmings', 3); });
  it('uses the slower high-lane baseline, bounded easing, deterministic spread and reset', () => {
    const run = () => {
      const world = flat(new ProcgenLaneWorld({ masks, laneCount: 65, cohorts: true, assists: false, spawnSpreadTicks: 12 }));
      const events = []; world.soundEvents.onEvent.on(event => { if (event.type === 'lemming-spawn') events.push([event.tick, event.laneIndex]); });
      expect(world.population.baseInterval).to.equal(81);
      for (let tick = 0; tick < 500; tick++) world.step();
      expect(events.slice(0, 65).at(-1)[0]).to.equal(12); expect(events[65][0]).to.equal(82);
      expect(world.population.intervalTicks).to.be.greaterThan(81).and.at.most(324);
      const result = { events, policy: world.population.snapshot(), alive: world.activeCount };
      world.setPendingTerrainWork(0, 4); world._restart([]);
      expect(world.activeCount).to.equal(0); expect(world.population.intervalTicks).to.equal(81);
      expect(world.pendingTerrainWork[0]).to.equal(0); expect(world.terrainActivityTicks[0]).to.equal(-Infinity);
      expect(world.getLaneMusicSignals(0).peakAlive).to.equal(0);
      world.step(); expect(world.activeCount).to.be.greaterThan(0); world.dispose(); return result;
    };
    expect(run()).to.deep.equal(run());
  });
  it('preserves an explicit release interval and admits replacements using cached live population', () => {
    const world = flat(new ProcgenLaneWorld({ masks, laneCount: 2, cohorts: true, assists: false, maxActors: 2,
      spawnSpreadTicks: 12, stallPolicy: { releaseIntervalTicks: 5 } }));
    world.step(); world.step(); world.step(); expect(world.activeCount).to.equal(2);
    for (const actor of world.actors) actor.failureReason = 'fixture';
    world.step(); expect(world.activeCount).to.equal(0); expect(world.actors).to.have.length(2);
    for (let tick = 0; tick < 5; tick++) world.step();
    expect(world.activeCount).to.equal(2); expect(world.actors).to.have.length(4);
    expect(world.population.intervalTicks).to.equal(5); expect(world.population.adaptive).to.equal(false);
    expect(world.getDebugState().alive).to.equal(2); world.dispose();
  });
  it('counts surviving actors and actual actions in the existing pass, and exposes stable O(1) lane signals', () => {
    const world = flat(new ProcgenLaneWorld({ masks, laneCount: 1 }));
    const gone = world._spawn(0), failed = world._spawn(0); gone.remove(); failed.failureReason = 'fixture';
    const live = world.actors[0]; live.hasParachute = true; live.state = 18;
    world.step();
    const lane = world.getLaneMusicSignals(0);
    expect(lane).to.equal(world.getLaneMusicSignals(0)); expect(lane.alive).to.equal(1);
    expect(lane.peakAlive).to.equal(3); expect(lane.spawned).to.equal(3); expect(lane.lowestSurvivingActorId).to.equal(live.id);
    expect(lane.floatingCount).to.equal(1); expect(lane.buildingCount).to.equal(0); expect(lane.bashingCount).to.equal(0);
    expect(world.activeCount).to.equal(1); expect(world.getLaneMusicSignals(99)).to.equal(null); world.dispose();
  });
  it('keeps every actor ordinary at spawn, then assigns climbing only to sparse delayed scouts at a real wall', () => {
    const world = new ProcgenLaneWorld({ masks, terrain, populationPolicy: { scoutsEvery: 4, scoutDelayTicks: 12 } });
    for (let spawn = 1; spawn < 8; spawn++) world._spawn(0);
    world.hasGroundAt = (x, y) => y >= 72 || x >= 65 && x < 90 && y >= 50;
    world.getColumnStepHeight = (x, y, height) => { for (let i = 0; i < height; i++) if (!world.hasGroundAt(x, y + height - 1 - i)) return i; return height; };
    world.hasSteelAt = () => false; world.challengeAt = () => ({ barrierWidth: 0, gapWidth: 0 });
    expect(world.actors.filter(actor => actor.scout)).to.have.length(2);
    for (const actor of world.actors) {
      expect(actor.canClimb).to.equal(false); expect(actor.hasParachute).to.equal(false);
      Object.assign(actor, { x: 64, y: 72 }); actor.setAction(world.actions[State.WALKING]);
    }
    world.tickIndex = 11; for (const actor of world.actors) world._assist(actor);
    expect(world.actors.some(actor => actor.canClimb)).to.equal(false);
    world.step();
    expect(world.actors.filter(actor => actor.canClimb)).to.have.length(2);
    expect(world.actors.filter(actor => actor.action === world.actions[State.CLIMBING])).to.have.length(2);
    expect(world.actors.every(actor => !actor.hasParachute)).to.equal(true); world.dispose();
  });
  it('records changed terrain work only, and clears bounded pending work on reset', () => {
    const world = flat(new ProcgenLaneWorld({ masks }));
    world.setGroundAt(30, 60); const revision = world.terrainRevision;
    world.tickIndex = 20; world.setGroundAt(30, 60);
    expect(world.terrainRevision).to.equal(revision); expect(world.terrainActivityTicks[0]).to.equal(0);
    world.setGroundAt(31, 60); world.setPendingTerrainWork(0, 100000); world.step();
    expect(world.getLaneMusicSignals(0).lastTerrainActivityTick).to.equal(20);
    expect(world.pendingTerrainWork[0]).to.equal(65535); world._restart([]);
    expect(world.pendingTerrainWork[0]).to.equal(0); expect(world.terrainActivityTicks[0]).to.equal(-Infinity); world.dispose();
  });
  it('uses the real floating system for an eligible falling scout and preserves manually assigned abilities', () => {
    const world = flat(new ProcgenLaneWorld({ masks, assists: true, populationPolicy: { scoutsEvery: 1, scoutDelayTicks: 12 } }));
    const scout = world.actors[0]; Object.assign(scout, { x: 20, y: 10, state: 18 });
    world.tickIndex = 11; world._assist(scout); expect(scout.hasParachute).to.equal(false);
    world.step(); expect(scout.action).to.equal(world.actions[State.FLOATING]); expect(scout.hasParachute).to.equal(true);
    for (let tick = 0; tick < 50; tick++) world.step();
    expect(scout.failureReason).to.equal(null); expect(scout.y).to.equal(80);
    const manual = flat(new ProcgenLaneWorld({ masks, assists: false })), actor = manual.actors[0];
    Object.assign(actor, { hasParachute: true, canClimb: true, state: 18 }); manual.step();
    expect(actor.action).to.equal(manual.actions[State.FLOATING]); expect(actor.canClimb).to.equal(true);
    expect(actor.hasParachute).to.equal(true); world.dispose(); manual.dispose();
  });
});

const enclosedTunnel = () => {
  const collision = new Map();
  return { chunkWidth: 128, collision, surface: () => 72, configure() {}, registerLanes() {}, reset() { collision.clear(); },
    getChunk(seed, index) {
      const key = seed + ':' + index; if (collision.has(key)) return collision.get(key);
      const solid = new Uint32Array(128 * 96 / 32), steel = new Uint32Array(solid.length);
      for (let y = 0; y < 96; y++) for (let x = 0; x < 128; x++) {
        const wx = index * 128 + x;
        if (y >= 72 || wx >= 65 && wx < 90 && y >= 50 || wx >= 36 && wx < 90 && y >= 44 && y < 50) {
          const bit = y * 128 + x; solid[bit >>> 5] |= 1 << (bit & 31);
        }
      }
      const chunk = { solid, steel, topProfile: new Uint8Array(128), gapWidth: 0, barrierWidth: 0 };
      collision.set(key, chunk); return chunk;
    }
  };
};
describe('real assisted tunnel oscillation and pile recovery', () => {
  it('detects the remaining AI retry loop without hoisting through a ceiling, then explodes each actor once and resets', async () => {
    const world = new ProcgenLaneWorld({ masks: await loadProcgenMasks(), terrain: enclosedTunnel(), cohorts: true, maxActors: 8,
      populationPolicy: { scoutsEvery: 1, scoutDelayTicks: 0 }, stallPolicy: { ...pilePolicySettings, releaseIntervalTicks: 10 } });
    const spawn = world._spawn.bind(world);
    world._spawn = (...args) => { const actor = spawn(...args); Object.assign(actor, { x: 64, y: 72, furthestX: 64 }); actor.setAction(world.actions[State.WALKING]); return actor; };
    const events = []; world.soundEvents.onEvent.on(event => events.push(event));
    let climbEntries = 0, previousAction = null, hoisted = false, sawGrowingPile = false;
    for (let tick = 0; tick < 400 && world.generation === 1; tick++) {
      world.step(); const actor = world.actors[0];
      if (actor?.action === world.actions[State.CLIMBING] && previousAction !== actor.action) climbEntries++;
      if (actor?.action === world.actions[State.HOISTING]) hoisted = true;
      previousAction = actor?.action; sawGrowingPile ||= world.stall.lanes[0].pileGrowing;
    }
    expect(hoisted).to.equal(false); expect(climbEntries).to.be.greaterThan(1); expect(sawGrowingPile).to.equal(true);
    expect(world.generation).to.equal(2); expect(world.activeCount).to.equal(0);
    const ohno = events.filter(event => event.type === 'lemming-ohno'), blasts = events.filter(event => event.type === 'lemming-explode');
    expect(ohno).to.have.length(8); expect(new Set(ohno.map(event => event.lemmingId)).size).to.equal(8); expect(blasts).to.have.length(8);
    expect(world.stall.lanes[0].pileStartTick).to.equal(null); world.step(); expect(world.generation).to.equal(2); world.dispose();
  });
});
const pilePolicySettings = { secondsWithoutProgress: 1000, ticksPerSecond: 10, baseSpawnAllowance: 7, initialTicksPerPixel: 1,
  transitSafetyFactor: 1, pileMinimumNonProgressSeconds: 1, pileSecondsWithoutProgress: 3 };
