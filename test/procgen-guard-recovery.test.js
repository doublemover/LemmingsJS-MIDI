import { expect } from 'chai';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { GUARD_RECOVERY_STEPS } from '../js/app/procgen/ProcgenGuardRecovery.js';
import { TUNNEL_GUARD_TICKS } from '../js/app/procgen/ProcgenTunnelCrewRoutes.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
import { loadProcgenMasks, loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';

// Controlled same-source service pose, not an unaided public arrival claim.
describe('current physical recovery of an unstarted stale tunnel guard', function() {
  this.timeout(30000); let masks;
  before(async () => { masks = await loadProcgenMasks(); });
  const fixture = async (laneCount = 1, stale = true) => {
    const world = new ProcgenLaneWorld({ terrain: await loadProcgenTerrain('lemmings', 4), masks, seed: 1322764708, laneHeight: 144,
      laneCount, workerLimits: { builders: 0, diggers: 0, bashers: 4 }, populationPolicy: { scoutsEvery: 0 } });
    world.admissionPaused = true; world.cohorts = false; world.hazardPlanner.plan = () => null;
    for (const x of stale ? [1760, 1820, 1870] : [1380, 1470]) world.terrainGrowth.ensureLocal(0, x, { through: world.generatedThrough, frontiers: world.frontiers, prepare: world._prepareGrowthChunk, reveal: world._revealGrowth });
    const guard = world.actors[0]; Object.assign(guard, { x: stale ? 1798 : 1407, y: stale ? 96 : 109, scout: false, canClimb: false, hasParachute: false, lookRight: true });
    guard.setAction(world.actions[State.BLOCKING]); expect(guard.process(world)).to.equal(State.NO_STATE_TYPE); world._syncTriggerOwner(guard);
    const scene = { lane: 0, generation: world.generation, startTick: world.tickIndex, startX: stale ? 1813 : 1422, startY: stale ? 90 : 101, phase: 'guarded', guard, guardX: guard.x, guardY: guard.y,
      worker: null, task: null, port: stale ? { guardX: 1799, guardY: 96, exitX: 1881, exitY: 87 } : { guardX: 1408, guardY: 109, exitX: 1495, exitY: 99 },
      bounds: stale ? { x1: 1797, x2: 1882, y1: 74, y2: 123 } : { x1: 1406, x2: 1496, y1: 85, y2: 134 } };
    scene.triggerKey = world.triggerManager.byOwner.get(guard).map(t => `${t.type}:${t.x1}:${t.x2}:${t.y1}:${t.y2}`).join(',');
    guard._tunnelScene = scene; world.tunnelRoutes.scenes[0] = scene;
    const other = world._spawn(0); other.x = 36; other.y = world.surfaceAt(0, 36); other.setAction(world.actions[State.WALKING]);
    expect(world.tunnelRoutes.guard({ laneIndex: 0, x: scene.startX, y: scene.startY })).to.equal(guard);
    const edit = { x: 1860, y: 80, ownerId: other.id };
    if (stale) { world._processingActorId = other.id; world.setGroundAt(edit.x, edit.y); world._processingActorId = null; }
    if (stale) {
      expect(scene.failure).to.equal('changed-route');
      expect(world.tunnelRoutes.guard({ laneIndex: 0, x: scene.startX, y: scene.startY })).to.equal(null);
      const staleTask = {}; world.tunnelRoutes.begin({ laneIndex: 0 }, { routeEvidence: { rearBlockerId: guard.id } }, staleTask);
      expect(scene.phase).to.equal('guarded'); expect(staleTask.tunnelScene).to.equal(undefined);
    }
    const events = []; world.soundEvents.onEvent.on(e => events.push(e));
    return { world, guard, scene, other, edit, events };
  };
  it('retires the actual unstarted shoulder guard within its original deadline through empty BASH and supported WALK', async () => {
    const { world, guard, scene, other, events } = await fixture(1, false);
    try {
      world.tickIndex = TUNNEL_GUARD_TICKS - GUARD_RECOVERY_STEPS - 1;
      world.tunnelRoutes.finish(0); expect(scene.retirement).to.equal(undefined); expect(world.stats.bashes).to.equal(0);
      world.tickIndex++; const deadline = scene.startTick + TUNNEL_GUARD_TICKS;
      const before = [guard.x, guard.y, guard.action, world.terrainRevision, world.stats.removedPixels];
      const proof = world.tunnelRoutes.recovery.prove(scene, 1024);
      expect(proof).to.include({ safe: true, actionSteps: 13, bashTick: 5, x: 1415, y: 109, lookRight: true });
      expect([guard.x, guard.y, guard.action, world.terrainRevision, world.stats.removedPixels]).to.deep.equal(before); expect(events).to.have.length(0);
      world.tunnelRoutes.finish(0); expect(scene.retirement).to.equal('unstarted-deadline'); expect(scene.phase).to.equal('recovering');
      expect(world.tunnelRoutes.guard({ laneIndex: 0, x: scene.startX, y: scene.startY })).to.equal(null);
      while (world.tunnelRoutes.scenes[0] && world.tickIndex < deadline + 1) world.step();
      expect(world.tickIndex).to.equal(TUNNEL_GUARD_TICKS - GUARD_RECOVERY_STEPS + proof.actionSteps);
      expect(world.tunnelRoutes.snapshot()).to.include({ recoveryStarted: 1, recovered: 1, failed: 0, connected: 0, active: 0 });
      expect(scene.startTick).to.equal(0); expect(guard).to.include({ x: 1415, y: 109, failureReason: null }); expect(guard.action).to.equal(world.actions[State.WALKING]);
      expect(guard._tunnelScene).to.equal(null); expect(world.triggerManager.byOwner.has(guard)).to.equal(false);
      expect(world.stats).to.include({ bashes: 1, removedPixels: 0, failures: 0 }); expect(other.failureReason).to.equal(null);
      expect(world.hazards.stats.contacts).to.equal(0); expect(world._manualNukeLanes[0]).to.equal(0);
      expect(world.lanePolicy.projects.signals(0)).to.include({ active: 0, completed: 0 });
      expect(world.hazardPlanner.admission.lanes[0].probes).to.be.at.most(1024); expect(events.some(e => e.type === 'procgen-route-complete')).to.equal(false);
    } finally { world.dispose(); }
  });
  it('admits an exact-deadline physical exit and refuses a proof arriving one tick late before assigning any action', async () => {
    for (const remaining of [13, 12]) {
      const { world, guard, scene, events } = await fixture(1, false);
      try {
        world.tickIndex = TUNNEL_GUARD_TICKS - remaining; world.tunnelRoutes.finish(0);
        if (remaining === 13) {
          expect(scene.phase).to.equal('recovering');
          while (world.tunnelRoutes.scenes[0] && world.tickIndex <= TUNNEL_GUARD_TICKS) world.step();
          expect(world.tickIndex).to.equal(TUNNEL_GUARD_TICKS); expect(world.tunnelRoutes.stats.recovered).to.equal(1); expect(world._manualNukeLanes[0]).to.equal(0);
        } else {
          expect(scene.failure).to.equal('recovery-deadline'); expect(world.tunnelRoutes.scenes[0]).to.equal(null);
          expect(guard.action).to.equal(world.actions[State.BLOCKING]); expect(world.stats.bashes).to.equal(0); expect(world._manualNukeLanes[0]).to.equal(1);
        }
        expect(scene.startTick).to.equal(0); expect(events.some(e => e.type === 'procgen-route-complete')).to.equal(false);
      } finally { world.dispose(); }
    }
  });
  it('fences retiring proposals during parity, busy-ledger and resource waits without extending lifetime', async () => {
    for (const mode of ['parity', 'busy', 'cap']) {
      const { world, guard, scene } = await fixture(16, false);
      try {
        world.tickIndex = TUNNEL_GUARD_TICKS - GUARD_RECOVERY_STEPS + (mode === 'parity' ? 1 : 0);
        if (mode === 'busy') world.hazardPlanner.admission.begin(0).consumed = true;
        if (mode === 'cap') world.setWorkerLimits({ bashers: 0 });
        world.tunnelRoutes.finish(0); expect(scene.retirement).to.equal('unstarted-deadline'); expect(scene.phase).to.equal('guarded');
        expect(world.stats.bashes).to.equal(0); expect(guard.action).to.equal(world.actions[State.BLOCKING]);
        expect(world.tunnelRoutes.guard({ laneIndex: 0, x: scene.startX, y: scene.startY })).to.equal(null);
        const task = {}; world.tunnelRoutes.begin({ laneIndex: 0 }, { routeEvidence: { rearBlockerId: guard.id } }, task);
        expect(scene.worker).to.equal(null); expect(task.tunnelScene).to.equal(undefined);
        if (mode === 'parity') { world.tickIndex++; world.tunnelRoutes.finish(0); expect(scene.phase).to.equal('recovering'); }
        else {
          world.tickIndex = TUNNEL_GUARD_TICKS + 1; world.tunnelRoutes.finish(0);
          expect(world._manualNukeLanes[0]).to.equal(1); expect(world.tunnelRoutes.scenes[0]).to.equal(null);
        }
        expect(scene.startTick).to.equal(0);
      } finally { world.dispose(); }
    }
  });
  it('keeps real working or connected promises on their existing deadline rather than recovering their service guard', async () => {
    for (const phase of ['working', 'connected']) {
      const { world, scene, other, guard } = await fixture(1, false);
      try {
        other.x = scene.startX; other.y = scene.startY; world.lanePolicy.projects.observe(other);
        const task = { footprint: { ...scene.bounds }, targetX: scene.port.exitX };
        const id = world.lanePolicy.projects.begin(other, 'bashers', task);
        expect(id).to.be.a('string'); const project = world.lanePolicy.projects.lanes[0].projects.find(p => p.id === id);
        Object.assign(scene, { worker: other, task, project, phase, releaseMembers: [other.id], crossed: new Set() });
        if (phase === 'connected') { project.phase = 'connected'; project.goalX = scene.port.exitX; project.goalY = scene.port.exitY; }
        world.tickIndex = TUNNEL_GUARD_TICKS - GUARD_RECOVERY_STEPS; world.tunnelRoutes.finish(0);
        expect(scene.retirement).to.equal(undefined); expect(scene.phase).to.equal(phase); expect(project.members.has(other.id)).to.equal(true);
        expect(world.stats.bashes).to.equal(0); expect(guard.action).to.equal(world.actions[State.BLOCKING]);
        world.tickIndex = TUNNEL_GUARD_TICKS + 1; world.tunnelRoutes.finish(0);
        expect(world._manualNukeLanes[0]).to.equal(1); expect(world.tunnelRoutes.scenes[0]).to.equal(null); expect(world.stats.bashes).to.equal(0);
      } finally { world.dispose(); }
    }
  });
  it('reproves current same-source pixels after an attributed foreign edit, then physically recovers without excavation, reward, cue or live proof effects', async () => {
    const { world, guard, scene, edit, events } = await fixture();
    try {
      const far = { owner: { action: world.actions[State.MINING] }, action: world.actions[State.MINING], footprint: { x1: 1743, x2: 1760, y1: 63, y2: 83 } };
      (world.accessTasks[0] ||= []).push(far);
      const before = [guard.x, guard.y, guard.action, guard.state, world.terrainRevision, world.stats.removedPixels, world.triggerManager.byOwner.size];
      const result = world.tunnelRoutes.recovery.prove(scene, 1024);
      expect(result.failure).to.equal(null); expect(result.safe).to.equal(true); expect(result.bashTick).to.equal(5);
      expect(result).to.include({ actionSteps: 13, x: 1806, y: 96, lookRight: true }); expect(result.actionSteps).to.be.at.most(GUARD_RECOVERY_STEPS); expect(result.probes).to.be.at.most(1024);
      expect([guard.x, guard.y, guard.action, guard.state, world.terrainRevision, world.stats.removedPixels, world.triggerManager.byOwner.size]).to.deep.equal(before);
      expect(events).to.have.length(0); expect(world.hasGroundAt(edit.x, edit.y)).to.equal(true);
      expect(result.bounds.x1).to.be.greaterThan(far.footprint.x2);
      world.accessTasks[0].push({ owner: { action: world.actions[State.MINING] }, action: world.actions[State.MINING], footprint: { x1: 1800, x2: 1803, y1: 88, y2: 97 } });
      expect(world.tunnelRoutes.recovery.prove(scene, 1024).failure).to.equal('construction'); world.accessTasks[0].pop();
      world.tunnelRoutes.finish(0);
      expect(scene.phase).to.equal('recovering'); expect(guard.action).to.equal(world.actions[State.BASHING]); expect(world.triggerManager.byOwner.has(guard)).to.equal(false);
      expect(world.tunnelRoutes.guard(guard)).to.equal(null); expect(scene.startTick).to.equal(0); expect(world.hazardPlanner.admission.lanes[0].probes).to.equal(result.probes);
      world.setGroundAt(edit.x + 1, edit.y); // Unrelated edit in the same source tile.
      world.tunnelRoutes.finish(0); expect(scene.failure).to.equal(null);
      while (world.tickIndex <= GUARD_RECOVERY_STEPS && world.tunnelRoutes.scenes[0]) world.step();
      expect(world.tunnelRoutes.snapshot()).to.include({ recoveryStarted: 1, recovered: 1, failed: 0, active: 0 });
      expect(guard).to.include({ x: result.x, y: result.y, lookRight: result.lookRight, failureReason: null }); expect(guard.action).to.equal(world.actions[State.WALKING]);
      expect(guard._tunnelScene).to.equal(null); expect(world.stats).to.include({ bashes: 1, removedPixels: 0, failures: 0 });
      expect(world._manualNukeLanes[0]).to.equal(0); expect(world.hazards.stats.contacts).to.equal(0);
      expect(world.lanePolicy.projects.signals(0)).to.include({ active: 0, completed: 0 });
      expect(events.some(e => e.type === 'procgen-route-complete')).to.equal(false);
    } finally { world.dispose(); }
  });
  it('keeps unsafe, occupied/protected, unseen, changed owner, other contacts and active promised routes on their explicit failure path', async () => {
    for (const mode of ['support', 'occupied', 'steel', 'arrows', 'unseen', 'hazard', 'other-blocker', 'identity', 'direction', 'ability', 'active-project']) {
      const { world, guard, scene, other, events } = await fixture();
      try {
        if (mode === 'support') world.clearGroundAt(guard.x, guard.y);
        if (mode === 'occupied' || mode === 'steel') {
          const mask = world.actions[State.BASHING].masks.get('right').GetMask(0); let pixel = null;
          for (let y = 0; y < mask.height && !pixel; y++) for (let x = 0; x < mask.width && !pixel; x++) if (!mask.at(x, y)) pixel = [guard.x + mask.offsetX + x, guard.y + mask.offsetY + y];
          world.setGroundAt(...pixel); if (mode === 'steel') world.hasSteelAt = (x, y) => x === pixel[0] && y === pixel[1];
        }
        if (mode === 'arrows') world.hasArrowUnderMask = () => true;
        if (mode === 'unseen') { world.terrainGrowth.stateFor = () => ({}); world.terrainGrowth.columnReady = () => false; }
        if (mode === 'hazard') world.hazards.nearby = (_lane, _x, _options, out) => { out.length = 0; out.push({ x1: guard.x + 2, x2: guard.x + 4, y1: 84, y2: 98 }); return out; };
        if (mode === 'other-blocker') {
          other.x = guard.x + 6; other.y = guard.y; other.setAction(world.actions[State.BLOCKING]); other.process(world); world._syncTriggerOwner(other);
          const left = world._spawn(0); left.x = guard.x - 6; left.y = guard.y; left.setAction(world.actions[State.BLOCKING]); left.process(world); world._syncTriggerOwner(left);
        }
        if (mode === 'identity') world.triggerManager.byOwner.get(guard)[0].x1++;
        if (mode === 'direction') guard.lookRight = false;
        if (mode === 'ability') guard.canClimb = true;
        if (mode === 'active-project') scene.project = { members: new Map([[guard.id, {}]]) };
        const result = world.tunnelRoutes.recovery.prove(scene, 1024); expect(result.safe, mode).to.equal(false);
        // Unrevealed columns explicitly defer while the original deadline stays
        // fixed; every physical negative retains the original failure cascade.
        world.tunnelRoutes.finish(0);
        if (mode === 'unseen') expect(world.tunnelRoutes.scenes[0]).to.equal(scene);
        else { expect(world._manualNukeLanes[0], mode).to.equal(1); expect(world.tunnelRoutes.scenes[0], mode).to.equal(null); }
        expect(world.stats.bashes, mode).to.equal(0); expect(events.some(e => e.type === 'procgen-route-complete')).to.equal(false);
      } finally { world.dispose(); }
    }
  });
  it('defers only live unchanged ownership to its eight-lane service slot, rejecting loss/disable/turn/removal/transfer before busy-ledger waits', async () => {
    const served = await fixture(16);
    try {
      served.world.tickIndex = 1; served.world.tunnelRoutes.finish(0);
      expect(served.scene.phase).to.equal('guarded'); expect(served.world.stats.bashes).to.equal(0);
      expect(served.world.hazardPlanner.admission.lanes[0].tick).to.equal(-1);
      served.world.tickIndex = 2; served.world.tunnelRoutes.finish(0);
      expect(served.scene.phase).to.equal('recovering'); expect(served.world.hazardPlanner.admission.lanes[0].probes).to.be.at.most(1024);
      served.world._restart([]); expect(served.world.tunnelRoutes.scenes.every(scene => scene === null)).to.equal(true); expect(served.world.triggerManager.byOwner.size).to.equal(0);
    } finally { served.world.dispose(); expect(served.world.tunnelRoutes.recovery.world).to.equal(null); }
    for (const mode of ['loss', 'removed', 'disabled', 'turn', 'lane']) {
      const { world, guard, scene } = await fixture(16);
      try {
        world.tickIndex = 1; world.hazardPlanner.admission.begin(0).consumed = true;
        if (mode === 'loss') guard.failureReason = 'unsafe-fall';
        if (mode === 'removed') guard.removed = true;
        if (mode === 'disabled') guard.disabled = true;
        if (mode === 'turn') guard.lookRight = false;
        if (mode === 'lane') guard.laneIndex = 1;
        world.tunnelRoutes.finish(0);
        expect(world.tunnelRoutes.scenes[0], mode).to.equal(null); expect(world._manualNukeLanes[0], mode).to.equal(1); expect(world.stats.bashes).to.equal(0);
        expect(scene.phase).to.equal('guarded');
      } finally { world.dispose(); }
    }
  });
  it('shares existing work and resource service without a new deadline, and rejects fresh changes during real recovery', async () => {
    for (const mode of ['budget', 'cap', 'fresh-edit', 'generation']) {
      const { world, guard, scene, events } = await fixture();
      try {
        if (mode === 'budget') world.hazardPlanner.admission.begin(0).probes = 1023;
        if (mode === 'cap') world.setWorkerLimits({ bashers: 0 });
        world.tunnelRoutes.finish(0);
        if (mode === 'budget') {
          expect(world.tunnelRoutes.scenes[0]).to.equal(scene); expect(guard.action).to.equal(world.actions[State.BLOCKING]);
          expect(world.hazardPlanner.admission.lanes[0].probes).to.equal(1024);
          world.tickIndex = scene.startTick + TUNNEL_GUARD_TICKS + 1; world.tunnelRoutes.finish(0);
        }
        if (mode === 'fresh-edit' || mode === 'generation') {
          expect(scene.phase).to.equal('recovering');
          if (mode === 'fresh-edit') world.clearGroundAt(guard.x + 1, guard.y); else world.generation++;
          world.tunnelRoutes.finish(0);
        }
        expect(world._manualNukeLanes[0], mode).to.equal(1); expect(world.tunnelRoutes.scenes[0], mode).to.equal(null);
        expect(events.some(e => e.type === 'procgen-route-complete')).to.equal(false);
      } finally { world.dispose(); }
    }
  });
});
