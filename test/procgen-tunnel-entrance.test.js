import { expect } from 'chai';
import { Lemming } from '../js/lemmings/Lemming.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { MAX_ROUTE_PROBES, ROUTE_LANES_PER_TICK } from '../js/app/procgen/ProcgenHazardPlanner.js';
import { loadProcgenMasks, loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';

// Controlled supported approach to the exact public Crystal shoulder. Actors
// take every WALK/JUMP step themselves; this is not an unaided public replay.
describe('retained actual procgen tunnel entrance admission', function() {
  this.timeout(20000); let masks;
  before(async () => { masks = await loadProcgenMasks(); });
  const make = async (count = 8) => {
    const world = new ProcgenLaneWorld({ terrain: await loadProcgenTerrain('lemmings', 4), masks, seed: 4274680063, laneHeight: 144, laneCount: 16,
      populationPolicy: { scoutsEvery: 0 } });
    world.admissionPaused = true; const lane = 9, top = lane * 144;
    world.actors = world.actors.filter(actor => actor.laneIndex === lane);
    for (const x of [1380, 1470]) world.terrainGrowth.ensureLocal(lane, x, { through: world.generatedThrough, frontiers: world.frontiers, prepare: world._prepareGrowthChunk, reveal: world._revealGrowth });
    const crew = [world.actors[0], ...Array.from({ length: count }, () => world._spawn(lane, false))], guard = crew[count];
    for (const actor of crew) {
      Object.assign(actor, { x: actor === guard ? 1402 : 1409, y: top + 109, canClimb: false, hasParachute: false, scout: false, lookRight: true });
      actor.setAction(world.actions[State.WALKING]);
    }
    return { world, lane, top, crew, guard, leader: crew[0] };
  };
  const approved = async () => {
    const fixture = await make(), { world, lane, leader } = fixture;
    while (world.tickIndex < 13 && !world.tunnelRoutes.scenes[lane]?.entrance?.approval) world.step();
    const scene = world.tunnelRoutes.scenes[lane];
    expect(scene?.entrance?.approval).to.be.an('object'); expect(scene.entrance.actor).to.equal(leader);
    expect(scene).to.include({ phase: 'guarded', startX: 1422, startY: fixture.top + 101 });
    expect(leader.x).to.be.lessThan(1422); expect(world.stats.bashes).to.equal(0); return { ...fixture, guard: scene.guard, scene };
  };
  for (const count of [8, 16]) it(`admits the exact non-service WALK entrance and passes ${count} ordinary recipients`, async () => {
    const { world, lane, top, crew, leader } = await make(count), arrivals = new Set(); let assignment = null, maxWork = 0, maxLanes = 0, approval = null;
    const assign = world.assignWorker.bind(world), prove = world.hazardPlanner.guardedTunnels.prove.bind(world.hazardPlanner.guardedTunnels);
    world.assignWorker = (actor, ...args) => {
      const value = assign(actor, ...args);
      if (value && actor === leader) assignment = { tick: world.tickIndex, x: actor.x, y: actor.y - top, proofCount: world.hazardPlanner.guardedTunnels.stats.proofs };
      return value;
    };
    world.hazardPlanner.guardedTunnels.prove = (...args) => { expect(lane % 2).to.equal(world.tickIndex % 2); return prove(...args); };
    while (world.tickIndex < 390) {
      world.step(); const scene = world.tunnelRoutes.scenes[lane];
      if (scene?.entrance?.approval) approval = { tick: world.tickIndex, proofCount: world.hazardPlanner.guardedTunnels.stats.proofs };
      maxWork = Math.max(maxWork, world.hazardPlanner.admission.lanes[lane].probes);
      maxLanes = Math.max(maxLanes, world.hazardPlanner.admission.lanes.filter(record => record.tick === world.tickIndex).length);
      for (const actor of crew.slice(0, count)) if (actor.action === world.actions[State.WALKING] && actor.x >= 1495) arrivals.add(actor.id);
      if (world.tunnelRoutes.stats.released && !scene) break;
    }
    expect(approval).to.be.an('object'); expect(assignment).to.include({ tick: 14, x: 1422, y: 101, proofCount: approval.proofCount });
    expect(assignment.tick % 2).not.to.equal(lane % 2); expect(arrivals.size).to.equal(count);
    expect(world.stats).to.include({ bashes: 2, blockers: 1, builds: 0, digs: 0, mines: 0, failures: 0, removedPixels: 624, laneTransfers: 0 });
    expect(world.tunnelRoutes.snapshot()).to.include({ connected: 1, released: 1, failed: 0, active: 0 });
    expect(crew.every(actor => !actor.canClimb && !actor.hasParachute && !actor.failureReason)).to.equal(true);
    expect(world.hazards.stats.contacts).to.equal(0); expect(world.triggerManager.byOwner.size).to.equal(0);
    expect(maxWork).to.be.at.most(MAX_ROUTE_PROBES); expect(maxLanes).to.be.at.most(ROUTE_LANES_PER_TICK);
    expect(world.hazardPlanner.guardedTunnels.stats.maxActions).to.be.at.most(384); world.dispose();
  });
  it('identifies only a genuine pre-trigger terrain turn without live sound or actor/pixel mutation', async () => {
    const { world, leader, top } = await make(); const events = []; world.soundEvents.onEvent.on(event => events.push(event));
    const before = [leader.x, leader.y, leader.action, leader.state, world.terrainRevision, world.stats.removedPixels];
    const result = world.hazardPlanner.walking.prove(leader, (x,y) => world.hasGroundAt(x,y), [], 1024);
    expect(result).to.include({ safe: false, failure: 'turn' }); expect(result.terrainTurn).to.include({ x: 1422, y: top + 101, generation: world.generation });
    expect(result.terrainTurn.tiles.length).to.be.within(1,8);
    expect([leader.x, leader.y, leader.action, leader.state, world.terrainRevision, world.stats.removedPixels]).to.deep.equal(before); expect(events).to.have.length(0);
    Object.assign(leader, { x: 1301, y: top + 112 });
    const safe = world.hazardPlanner.walking.prove(leader, (x,y) => world.hasGroundAt(x,y), [], 1024);
    expect(safe.safe).to.equal(true); expect(safe.terrainTurn).to.equal(null); world.dispose();
  });
  it('clears future terrain admission on blocker contact, hazard, construction, hidden cells, budget and revision failures', async () => {
    for (const mode of ['blocker', 'hazard', 'construction', 'hidden', 'budget', 'revision']) {
      const { world, leader, guard, top } = await make(), hazards = [];
      if (mode === 'blocker') { Object.assign(guard, { x: 1420, y: top + 109 }); guard.setAction(world.actions[State.BLOCKING]); guard.process(world); world._syncTriggerOwner(guard); }
      if (mode === 'hazard') hazards.push({ x1:1415, x2:1416, y1:top + 99, y2:top + 110 });
      if (mode === 'construction') world.accessTasks[9] = [{ owner: { action: world.actions[State.BUILDING] }, action: world.actions[State.BUILDING], footprint: { x1: 1410, x2: 1417, y1: top + 100, y2: top + 111 } }];
      if (mode === 'hidden') world.generatedThrough[9] = 1415;
      const ground = (x,y) => { if (mode === 'revision') world.terrainRevision++; return world.hasGroundAt(x,y); };
      const result = world.hazardPlanner.walking.prove(leader, ground, hazards, mode === 'budget' ? 2 : 1024);
      expect(result.safe, mode).to.equal(false); expect(result.terrainTurn, mode).not.to.exist; expect(world.stats.bashes).to.equal(0); world.dispose();
    }
  });
  it('refuses stale identity, local tiles, triggers, hazards, protected masks and new promises at actual arrival', async () => {
    for (const mode of ['id', 'birth', 'clone', 'disabled', 'ability', 'revision', 'generation', 'trigger', 'guard-identity', 'contact-limit', 'hazard', 'hazard-limit', 'construction', 'steel', 'arrows', 'claim', 'capacity', 'deadline']) {
      const { world, leader, guard, top, lane, scene } = await approved();
      while (world.tickIndex < 13) world.step();
      expect([leader.x, leader.y, leader.action]).to.deep.equal([1422, top + 101, world.actions[State.WALKING]]);
      const proofCount = world.hazardPlanner.guardedTunnels.stats.proofs;
      if (mode === 'id') leader.id += 10000;
      if (mode === 'birth') leader.spawnTick++;
      if (mode === 'disabled') leader.disabled = true;
      if (mode === 'ability') leader.canClimb = true;
      if (mode === 'clone') { const clone = new Lemming(leader.x, leader.y, leader.id, world.runtime); Object.assign(clone, { laneIndex:lane, spawnTick:leader.spawnTick }); clone.setAction(world.actions[State.WALKING]); world.actors[world.actors.indexOf(leader)] = clone; }
      if (mode === 'revision') world.setGroundAt(1430, top + 20);
      if (mode === 'generation') world.generation++;
      if (mode === 'trigger') world.triggerManager.byOwner.get(guard)[0].x1++;
      if (mode === 'contact-limit') world.triggerManager.byLane[lane].push(...Array(63).fill(world.triggerManager.byOwner.get(guard)[0]));
      if (mode === 'guard-identity') for (const trigger of world.triggerManager.byOwner.get(guard)) trigger.owner = Object.assign(Object.create(guard), { id: guard.id });
      if (mode === 'hazard') world.hazards.nearby = (_lane,_x,_options,out) => { out.length=0; out.push({lane,chunk:11,objectIndex:1,type:6,x1:1450,x2:1454,y1:top+90,y2:top+102}); return out; };
      if (mode === 'hazard-limit') world.hazards.nearby = (_lane, _x, _options, out) => { out.length = 0; for (let i = 0; i < 8; i++) out.push({ lane, type: 6, x1: 1500 + i, x2: 1501 + i, y1: top + 90, y2: top + 91 }); return out; };
      if (mode === 'construction') {
        const owner = world.actors.find(actor => actor !== leader && actor !== guard);
        Object.assign(owner, { x: 1450, y: top + 101 }); world.setWorkerLimits({ builders: 1, bashers: 4, diggers: 0 });
        expect(world.assignWorker(owner, 'builders', 1474, { x1: 1450, x2: 1478, y1: top + 89, y2: top + 102 })).to.equal(true);
      }
      if (mode === 'steel') world.hasSteelUnderMask = () => true;
      if (mode === 'arrows') world.hasArrowUnderMask = () => true;
      if (mode === 'claim') world.lanePolicy.projects.begin(guard,'miners',{footprint:{x1:1486,x2:1497,y1:top+75,y2:top+90}});
      if (mode === 'capacity') for (let index=0; index<4; index++) world.lanePolicy.projects.begin(guard,'miners',{footprint:{x1:1600+index*20,x2:1601+index*20,y1:top+90,y2:top+100}});
      if (mode === 'deadline') scene.startTick = world.tickIndex - 1000;
      world.step(); expect(world.stats.bashes, mode).to.equal(0); expect(world.stats.removedPixels, mode).to.equal(0);
      expect(world.hazardPlanner.guardedTunnels.stats.proofs, mode).to.equal(proofCount); world.dispose();
    }
  });
  it('does not consume another physical lane\'s retained approval and retires its stale pending identity', async () => {
    const { world, leader, lane, scene } = await approved();
    leader.y -= world.laneHeight; world._synchronizeLane(leader);
    expect(leader.laneIndex).to.equal(lane-1); const before=[leader.x,leader.y,leader.action,world.stats.removedPixels];
    expect(world.tunnelRoutes.assist(leader)).to.equal(false);
    expect([leader.x,leader.y,leader.action,world.stats.removedPixels]).to.deep.equal(before);
    world.tunnelRoutes.finish(lane); expect(scene.entrance?.approval ?? null).to.equal(null); expect(scene.worker).to.equal(null); world.dispose();
  });
  it('checks future initial masks and local approach revisions before request and before a separate real guard activates', async () => {
    for (const mode of ['request-claim', 'activation-claim', 'approach-edit', 'mismatched-pose']) {
      const { world, lane, top, leader, guard } = await make(1);
      const walking = world.hazardPlanner.walking.prove(leader,(x,y)=>world.hasGroundAt(x,y),[],1024), approach=walking.terrainTurn;
      const future=Object.assign(Object.create(leader),{x:approach.x,y:approach.y});
      const evidence=world.hazardPlanner.guardedTunnels.prove(future,1024).guardCandidate;
      expect(evidence).to.be.an('object');
      const current=world._workerClaimBounds(leader,world.actions[State.BASHING]), initial=world._workerClaimBounds(future,world.actions[State.BASHING]);
      expect(initial.x2).to.be.greaterThan(current.x2);
      const promised={x1:initial.x2-1,x2:initial.x2,y1:initial.y1,y2:initial.y1+1};
      // Deliberately misleading caller bounds still cannot omit real future masks.
      evidence.observedBounds={x1:1490,x2:1491,y1:top+130,y2:top+131};
      const addPromise=()=>world.lanePolicy.projects.begin(guard,'miners',{footprint:promised});
      if(mode==='request-claim') addPromise();
      if(mode==='mismatched-pose') approach.x--;
      const requested=world.tunnelRoutes.request(leader,evidence,approach);
      if(mode==='request-claim'||mode==='mismatched-pose') expect(requested,mode).to.equal(false);
      else {
        expect(requested).to.equal(true);
        if(mode==='activation-claim') addPromise();
        if(mode==='approach-edit') world.setGroundAt(1410,top+20);
        Object.assign(guard,{x:1408,y:top+109}); world.tickIndex=1;
        expect(world.tunnelRoutes.assist(guard),mode).to.equal(false);
      }
      expect(world.tunnelRoutes.scenes[lane],mode).to.equal(null); expect(guard.action).to.equal(world.actions[State.WALKING]);
      expect(world.stats.bashes+world.stats.blockers+world.stats.removedPixels).to.equal(0); expect(world._manualNukeLanes[lane]).to.equal(0); world.dispose();
    }
  });
  it('preserves approval across unrelated lane edits and clears retained references on reset', async () => {
    const { world, leader, top, scene } = await approved(); const retained = scene.entrance;
    while (world.tickIndex < 13) world.step(); world.setGroundAt(80,20); world.step();
    expect([leader.x, leader.y, leader.action]).to.deep.equal([1422,top+101,world.actions[State.BASHING]]);
    world.tunnelRoutes.reset(); expect(world.tunnelRoutes.scenes.every(value => value === null)).to.equal(true);
    expect(leader._tunnelScene ?? null).to.equal(null); expect(retained.approval).to.equal(null); world.dispose();
  });
});
