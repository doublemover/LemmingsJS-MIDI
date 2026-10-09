import { expect } from 'chai';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { ProcgenGuardedTunnel, GUARDED_TUNNEL_STEPS } from '../js/app/procgen/ProcgenGuardedTunnel.js';
import { TUNNEL_GUARD_TICKS } from '../js/app/procgen/ProcgenTunnelCrewRoutes.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
import { loadProcgenMasks, loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';

// Controlled arrival at unchanged naturally generated Crystal art, not an
// unpositioned public-run claim. The guard is a separate actual service actor.
describe('actual sourced shoulder with temporary crew containment', function() {
  this.timeout(30000); let masks;
  before(async () => { masks = await loadProcgenMasks(); });
  const fixture = async (count = 0, laneCount = 1) => {
    const world = new ProcgenLaneWorld({ terrain: await loadProcgenTerrain('lemmings', 4), masks, seed: 1322764708, laneHeight: 144, laneCount,
      workerLimits: { builders: 0, diggers: 0, bashers: 4 }, populationPolicy: { scoutsEvery: 0 } });
    world.admissionPaused = true;
    for (const x of [1380, 1470]) world.terrainGrowth.ensureLocal(0, x, { through: world.generatedThrough, frontiers: world.frontiers, prepare: world._prepareGrowthChunk, reveal: world._revealGrowth });
    const crew = [world.actors[0], ...Array.from({ length: count }, () => world._spawn(0, false))];
    crew.forEach((actor, index) => {
      Object.assign(actor, { x: index === count && count ? 1408 : 1422 - index % 6, y: index === count && count ? 109 : 101,
        canClimb: false, hasParachute: false, scout: false, lookRight: true }); actor.setAction(world.actions[State.WALKING]);
    });
    return { world, crew, leader: crew[0], guard: count ? crew[count] : null };
  };
  it('observes real return, mask completion and an ordinary exit without live mutation or sound', async () => {
    const { world, leader } = await fixture(), proof = new ProcgenGuardedTunnel(world), events = [];
    world.soundEvents.onEvent.on(event => events.push(event));
    const before = [leader.x, leader.y, leader.action, leader.state, world.stats.removedPixels, world.terrainRevision, world.triggerManager.byOwner.size];
    const result = proof.prove(leader, 1024);
    expect(result.failure).to.equal(null); expect(result.proposal).to.equal(null);
    expect(result.guardCandidate).to.include({ guardX: 1408, guardY: 109, exitX: 1495, exitY: 99, terminationTick: 213, naturalWalkingTick: 213, exitTicks: 221, independentQualification: false });
    expect(result.probes).to.equal(834); expect(result.actionSteps).to.equal(311); expect(result.actionSteps).to.be.at.most(GUARDED_TUNNEL_STEPS);
    expect([leader.x, leader.y, leader.action, leader.state, world.stats.removedPixels, world.terrainRevision, world.triggerManager.byOwner.size]).to.deep.equal(before);
    expect(events).to.have.length(0); proof.dispose(); world.dispose();
  });
  for (const count of [8, 16]) it(`physically passes ${count} ordinary recipients and recovers its separate real guard`, async () => {
    const { world, crew, guard } = await fixture(count), arrivals = new Set(), scenes = [];
    while (world.tickIndex < 350) {
      world.step(); const scene = world.tunnelRoutes.scenes[0];
      if (scene) scenes.push(scene.phase);
      for (const actor of crew.slice(0, count)) if (actor.x >= 1495 && actor.action === world.actions[State.WALKING] && !actor.failureReason) arrivals.add(actor.id);
      if (world.tunnelRoutes.stats.released && !scene) break;
    }
    expect(arrivals.size).to.equal(count); expect(world.tickIndex).to.equal(347);
    expect(scenes).to.include.members(['pending', 'guarded', 'working', 'connected', 'released']);
    expect(world.tunnelRoutes.snapshot()).to.include({ guards: 1, connected: 1, released: 1, failed: 0, active: 0 });
    expect(world.stats).to.include({ bashes: 2, builds: 0, digs: 0, mines: 0, failures: 0, removedPixels: 624, laneTransfers: 0 });
    expect(world.hazards.stats.contacts).to.equal(0); expect(world.hasGroundAt(1409, 110)).to.equal(true);
    expect(guard.action).to.equal(world.actions[State.WALKING]); expect(guard._tunnelScene).to.equal(null); expect(guard.assistConstructionTask).to.equal(null);
    expect(world.triggerManager.byOwner.size).to.equal(0); expect(crew.every(actor => !actor.canClimb && !actor.hasParachute && !actor.failureReason)).to.equal(true);
    expect(world.hazardPlanner.guardedTunnels.stats.maxWork).to.be.at.most(1024); expect(world.hazardPlanner.guardedTunnels.stats.maxActions).to.be.at.most(GUARDED_TUNNEL_STEPS);
    world.dispose();
  });
  it('rejects unseen columns, protected cuts, actual hazard envelopes, claimed work and insufficient observations', async () => {
    for (const mode of ['hidden', 'steel', 'arrows', 'hazard', 'claim', 'budget', 'revision']) {
      const { world, leader } = await fixture(), proof = new ProcgenGuardedTunnel(world);
      if (mode === 'hidden') { world.terrainGrowth.stateFor = () => ({ complete: false }); world.terrainGrowth.columnReady = () => false; }
      if (mode === 'steel') world.hasSteelAt = (x, y) => x >= 1440 && y < 101;
      if (mode === 'arrows') world.hasArrowUnderMask = () => true;
      if (mode === 'hazard') world.hazards.nearby = (_lane, _x, _options, out) => { out.length = 0; out.push({ x1: 1450, x2: 1452, y1: 90, y2: 102 }); return out; };
      if (mode === 'claim') world.accessTasks[0] = [{ owner: { action: world.actions[State.BUILDING] }, action: world.actions[State.BUILDING], footprint: { x1: 1450, x2: 1455, y1: 90, y2: 102 } }];
      if (mode === 'revision') { const read = world.hasGroundAt.bind(world); let once = true; world.hasGroundAt = (x, y) => { if (once) { once = false; world.terrainRevision++; } return read(x, y); }; }
      const result = proof.prove(leader, mode === 'budget' ? 10 : 1024);
      expect(result.guardCandidate, mode).to.equal(null); expect(result.proposal, mode).to.equal(null); expect(result.failure, mode).to.be.a('string');
      expect(result.probes, mode).to.be.at.most(mode === 'budget' ? 10 : 1024); expect(world.stats.removedPixels).to.equal(0);
      proof.dispose(); world.dispose();
    }
  });
  it('does not admit an unmanaged guard when project capacity is unavailable', async () => {
    const { world, leader } = await fixture(), evidence = world.hazardPlanner.guardedTunnels.prove(leader, 1024).guardCandidate;
    world.lanePolicy.projects.canBegin = () => false;
    expect(world.tunnelRoutes.request(leader, evidence)).to.equal(false); expect(world.tunnelRoutes.stats.requested).to.equal(0);
    expect(world.tunnelRoutes.scenes[0]).to.equal(null); expect(world.stats.bashes + world.stats.blockers).to.equal(0); world.dispose();
  });
  it('retires a failed relevant edit once through the lane-local queue and clears real guard ownership', async () => {
    const { world, crew, guard } = await fixture(8, 2), other = world.actors.find(actor => actor.laneIndex === 1);
    while (world.tickIndex < 40 && world.tunnelRoutes.scenes[0]?.phase !== 'working') world.step();
    expect(world.tunnelRoutes.scenes[0]?.phase).to.equal('working');
    world.clearGroundAt(1440, 101); world.step(); world.step();
    expect(world.tunnelRoutes.stats.failed).to.equal(1); expect(world.tunnelRoutes.stats.lastFailure.reason).to.equal('changed-route');
    expect(world.tunnelRoutes.scenes[0]).to.equal(null); expect(guard._tunnelScene).to.equal(null); expect(guard.assistConstructionTask).to.equal(null);
    expect(world.triggerManager.byOwner.has(guard)).to.equal(false); expect(other.failureReason || null).to.equal(null); expect(other.terminalReason || null).to.equal(null);
    expect(crew.some(actor => actor.action === world.actions[State.OHNO])).to.equal(true); world.dispose();
  });
  it('requires current ordinary WALK beyond the exit after a real crossing, while allowing later elevations outside the scene', async () => {
    const { world } = await fixture(8);
    while (world.tickIndex < 230 && world.tunnelRoutes.scenes[0]?.phase !== 'connected') world.step();
    const scene = world.tunnelRoutes.scenes[0], live = world.lanePolicy.projects.lanes[0].live;
    expect(scene.phase).to.equal('connected');
    // Controlled completed-tick observation negatives, distinct from the live
    // 8/16 shared-action traversal above. No actor or trigger is moved here.
    for (const id of scene.releaseMembers) {
      scene.crossed.add(id); const record = live.get(id);
      Object.assign(record, { x: scene.exitX + 40, y: scene.exitY - 35, ordinary: true, walking: true, tick: world.tickIndex });
    }
    const record = live.get(scene.releaseMembers[0]);
    record.x = scene.exitX - 1; world.tunnelRoutes.finish(0); expect(scene.releaseReady).to.equal(false);
    record.x = scene.exitX + 1; record.walking = false; world.tunnelRoutes.finish(0); expect(scene.releaseReady).to.equal(false);
    record.walking = true; record.ordinary = false; world.tunnelRoutes.finish(0); expect(scene.releaseReady).to.equal(false);
    record.ordinary = true; world.tunnelRoutes.finish(0); expect(scene.releaseReady).to.equal(true); world.dispose();
  });
  it('rejects changed live blocker rectangles, position and action without silently replacing the owner', async () => {
    for (const mode of ['rectangle', 'position', 'action']) {
      const { world, guard } = await fixture(8);
      while (world.tickIndex < 10 && !world.tunnelRoutes.scenes[0]?.guard) world.step();
      if (mode === 'rectangle') world.triggerManager.byOwner.get(guard)[1].x1++;
      if (mode === 'position') guard.x++;
      if (mode === 'action') guard.setAction(world.actions[State.WALKING]);
      world.tunnelRoutes.finish(0); world.tunnelRoutes.finish(0);
      expect(world.tunnelRoutes.stats.failed, mode).to.equal(1); expect(world.tunnelRoutes.stats.lastFailure.reason).to.equal('changed-guard');
      expect(world.tunnelRoutes.scenes[0]).to.equal(null); expect(guard._tunnelScene).to.equal(null); world.dispose();
    }
  });
  it('bounds a held guard lifetime and clears reset/disposal state without a replacement turn', async () => {
    const { world, guard } = await fixture(8);
    while (world.tickIndex < 10 && !world.tunnelRoutes.scenes[0]?.guard) world.step();
    const scene = world.tunnelRoutes.scenes[0]; expect(scene.guard).to.equal(guard);
    scene.startTick = world.tickIndex - TUNNEL_GUARD_TICKS - 1; world.tunnelRoutes.finish(0); world.tunnelRoutes.finish(0);
    expect(world.tunnelRoutes.stats.failed).to.equal(1); expect(guard._tunnelScene).to.equal(null); expect(world.tunnelRoutes.scenes[0]).to.equal(null);
    world._restart([]); expect(world.triggerManager.byOwner.size).to.equal(0); expect(world.tunnelRoutes.scenes.every(value => value === null)).to.equal(true); world.dispose();
  });
});