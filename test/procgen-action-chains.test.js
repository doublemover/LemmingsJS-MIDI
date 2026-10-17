import { expect } from 'chai';
import { chainWorld } from './support/procgen-chain-fixtures.js';
import { loadProcgenMasks, loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';

const begin = (world, actor, chain) => {
  world.maxActors = world.actors.length;
  const first = chain.stages[0], proposal = { kind: first.kind, targetX: first.x + (first.kind === 'builders' ? 24 : 8), footprint: chain.footprint, chain };
  expect(world.assignWorker(actor, proposal.kind, proposal.targetX, proposal.footprint)).to.equal(true);
  world.lanePolicy.begin(actor, proposal); world.assists = true;
  return world.lanePolicy.projects.lanes[0].projects.find(project => project.id === actor._crewChainId);
};
const follower = (world, x) => {
  const actor = world._spawn(0, false); Object.assign(actor, { x, y: 72, scout: false }); actor.setAction(world.actions[State.WALKING]); return actor;
};

describe('bounded actual-action crew chains', function() {
  this.timeout(20000); let masks;
  before(async () => { masks = await loadProcgenMasks(); });
  for (const [mode, kinds] of [['repeat', ['builders', 'builders']], ['buildbash', ['builders', 'bashers']], ['bashbuild', ['bashers', 'builders']], ['minebuild', ['miners', 'builders']],
    ['triple', ['builders', 'bashers', 'builders']], ['quad', ['builders', 'bashers', 'builders', 'bashers']]]) {
    it(`rehearses and executes ${mode} with shared masks, legal guard release and two actual follower crossings`, () => {
      const { world, actor } = chainWorld(masks, mode); world.admissionPaused = true;
      try {
        const crew = [actor, follower(world, 45), follower(world, 40)], events = [];
        for (const member of crew) world.lanePolicy.projects.observe(member);
        world.soundEvents.onEvent.on(event => { if (event.type === 'procgen-route-complete') events.push(event); });
        const revision = world.terrainRevision, pose = [actor.x, actor.y, actor.action];
        const chain = world.hazardPlanner.chains.prove(actor, [], 1024, { firstKind: mode === 'minebuild' ? 'miners' : undefined });
        expect(chain.safe, chain.failure).to.equal(true); expect(chain.work).to.be.at.most(1024); expect(chain.stages.map(stage => stage.kind)).to.deep.equal(kinds);
        expect(world.terrainRevision).to.equal(revision); expect([actor.x, actor.y, actor.action]).to.deep.equal(pose);
        const project = begin(world, actor, chain);
        expect(JSON.parse(JSON.stringify(project.chain))).to.deep.equal(project.chain);
        let leaderArrivedBeforeCrew = false;
        while (world.tickIndex < 750 && !['complete', 'failed'].includes(project.phase)) {
          world.step();
          expect(world.hazardPlanner.admission.lanes[0].probes).to.be.at.most(1024);
          if (project.phase === 'connected' && project.ordinaryCrossings === 0) { leaderArrivedBeforeCrew = true; expect(events).to.have.length(0); }
        }
        expect(leaderArrivedBeforeCrew).to.equal(true); expect(project.phase, project.failure).to.equal('complete');
        expect(project.ordinaryCrossings).to.equal(2); expect(events).to.have.length(1); expect(events[0]).to.include({ admittedCrew: 3, lostWorkers: 0, recoveredBlockers: 2 });
        expect(events[0].chainStages).to.deep.equal(kinds);
        for (const member of crew) {
          expect(member.failureReason).to.equal(null); expect(member.terminalReason).to.not.exist;
          expect(member.action).to.equal(world.actions[State.WALKING]); expect(member.canClimb || member.hasParachute).to.equal(false);
        }
      } finally { world.dispose(); }
    });
  }
  it('discovers imminent two- and four-stage routes in the normal planner without a supplied action script', () => {
    for (const mode of ['repeat', 'quad', 'minebuild', 'bashbuild', 'buildbash']) {
      const { world, actor } = chainWorld(masks, mode); world.admissionPaused = true;
      try {
        world.assists = true; world.step();
        expect(actor.action).to.equal(world.actions[mode === 'minebuild' ? State.MINING : mode === 'bashbuild' ? State.BASHING : State.BUILDING]);
        expect(world.lanePolicy.projects.lanes[0].projects[0].chain.stages).to.have.length(mode === 'quad' ? 4 : 2);
        expect(world.hazardPlanner.admission.lanes[0].probes).to.be.at.most(1024);
      } finally { world.dispose(); }
    }
  });
  it('waits physically at a sixteen-lane off-service entrance and revalidates before continuing the crew', () => {
    const { world, actor } = chainWorld(masks, 'quad', { laneCount: 16 });
    try {
      const crew = [actor, follower(world, 45), follower(world, 40)];
      for (const member of crew) world.lanePolicy.projects.observe(member);
      const project = begin(world, actor, world.hazardPlanner.chains.prove(actor));
      let waiting = null, resumed = false;
      while (world.tickIndex < 800 && !['complete', 'failed'].includes(project.phase)) {
        world.step();
        for (const service of world.hazardPlanner.admission.lanes) expect(service.probes).to.be.at.most(1024);
        expect(world.hazardPlanner.admission.lanes.filter(service => service.tick === world.tickIndex && service.consumed).length).to.be.at.most(8);
        if (project.chain.waitingService) {
          expect(world.tickIndex % 2).to.equal(1);
          expect(actor.action).to.equal(world.actions[State.BLOCKING]);
          expect(project.chain.pending).to.equal(true);
          const stage = project.chain.stages[project.chain.index];
          expect([actor.x, actor.y]).to.deep.equal([stage.x, stage.y]);
          waiting = { x: actor.x, y: actor.y, index: project.chain.index };
        } else if (waiting && project.chain.index === waiting.index && actor.action !== world.actions[State.WALKING]) {
          resumed = true; expect(world.tickIndex % 2).to.equal(0);
          expect(world.triggerManager.byOwner.has(actor)).to.equal(false); waiting = null;
        }
      }
      expect(resumed).to.equal(true); expect(project.phase, project.failure).to.equal('complete');
      expect(project.ordinaryCrossings).to.equal(2);
      for (const member of crew) expect(member.failureReason).to.equal(null);
    } finally { world.dispose(); }
  });
  it('observes immediate contacts on non-service ticks without spending broad search work', () => {
    const { world, actor } = chainWorld(masks, 'bashbuild', { laneCount: 16 });
    try {
      world.tickIndex = 1;
      const proofs = world.hazardPlanner.chains.stats.proofs;
      expect(world.hazardPlanner.plan(actor)).to.equal(null);
      expect(actor._procgenContact).to.include({ tick: 1, wall: true, gap: false });
      expect(actor._procgenContact.reads).to.be.at.most(11);
      expect(world.hazardPlanner.chains.stats.proofs).to.equal(proofs);
      expect(world.hazardPlanner.admission.lanes[0].probes).to.equal(0);
    } finally { world.dispose(); }
  });
  it('releases a failed chain follower using an empty real bash after the project is retired', () => {
    const { world, actor } = chainWorld(masks);
    try {
      const member = follower(world, 45);
      for (const item of [actor, member]) world.lanePolicy.projects.observe(item);
      const project = begin(world, actor, world.hazardPlanner.chains.prove(actor));
      world.step(); expect(member.action).to.equal(world.actions[State.BLOCKING]);
      world.lanePolicy.projects.fail(0, project.id, 'changed-route');
      const removed = world.stats.removedPixels;
      world.step();
      expect(member.action).to.equal(world.actions[State.BASHING]); expect(member._crewChainHoldId).to.equal(null);
      for (let tick = 0; tick < 16 && member.action !== world.actions[State.WALKING]; tick++) world.step();
      expect(member.action).to.equal(world.actions[State.WALKING]); expect(world.stats.removedPixels).to.equal(removed);
    } finally { world.dispose(); }
  });
  it('rejects a changed sixteen-lane waiting entrance when its charged service becomes available', () => {
    const { world, actor } = chainWorld(masks, 'quad', { laneCount: 16 });
    try {
      const project = begin(world, actor, world.hazardPlanner.chains.prove(actor));
      while (world.tickIndex < 400 && !project.chain.waitingService) world.step();
      expect(project.chain.waitingService).to.equal(true);
      const pose = [actor.x, actor.y];
      world.hasSteelAt = (x, y) => x === 90 && y === 58; world.setGroundAt(90, 58);
      world.step();
      expect(project.phase).to.equal('failed'); expect(project.failure).to.equal('steel');
      expect([actor.x, actor.y]).to.deep.equal(pose); expect(world.stats.bashes).to.equal(0);
      expect(world.hazardPlanner.admission.lanes[0].probes).to.be.at.most(1024);
    } finally { world.dispose(); }
  });
  it('rejects steel, low ceilings, hazard exits, unrevealed geometry and exhausted work without live edits', () => {
    for (const mode of ['steel', 'ceiling', 'hazard', 'hidden', 'budget']) {
      const { world, actor } = chainWorld(masks, mode === 'steel' ? 'bashbuild' : 'repeat', { steel: mode === 'steel', ceiling: mode === 'ceiling' });
      try {
        if (mode === 'hidden') world.generatedThrough[0] = 90;
        const revision = world.terrainRevision;
        const proof = world.hazardPlanner.chains.prove(actor, mode === 'hazard' ? [{ x1: 112, x2: 130, y1: 68, y2: 80 }] : [], mode === 'budget' ? 12 : 1024);
        expect(proof.safe, mode).to.equal(false); expect(proof.work).to.be.at.most(mode === 'budget' ? 12 : 1024);
        expect(world.terrainRevision).to.equal(revision); expect(world.stats.builds + world.stats.bashes + world.stats.mines).to.equal(0);
      } finally { world.dispose(); }
    }
  });
  it('reserves the whole chain and revalidates changed terrain before a later assignment', () => {
    const { world, actor } = chainWorld(masks); world.admissionPaused = true;
    try {
      const project = begin(world, actor, world.hazardPlanner.chains.prove(actor));
      const other = follower(world, 100);
      expect(world.assignWorker(other, 'miners', 100)).to.equal(false); other.removed = true;
      while (world.tickIndex < 195) world.step();
      world.setGroundAt(90, 58); world.hasSteelAt = (x, y) => x === 90 && y === 58;
      while (world.tickIndex < 230 && project.phase === 'working') world.step();
      expect(project.phase).to.equal('failed'); expect(world.stats.builds).to.equal(1);
      expect(world.getLanePolicySignals(0).crewProjects.completed).to.equal(0);
    } finally { world.dispose(); }
  });
  it('reassigns a lost owner only when an admitted ordinary worker physically reaches its launch', () => {
    const { world, actor } = chainWorld(masks); world.admissionPaused = true;
    try {
      const replacement = follower(world, 45);
      for (const member of [actor, replacement]) world.lanePolicy.projects.observe(member);
      const project = begin(world, actor, world.hazardPlanner.chains.prove(actor));
      world.step(); actor.removed = true;
      while (world.tickIndex < 600 && project.phase === 'working') world.step();
      expect(project.phase, project.failure).to.equal('connected'); expect(project.ownerId).to.equal(replacement.id);
      expect(project.chain.lostOwners).to.deep.equal([actor.id]); expect(project.ordinaryCrossings).to.equal(0);
      expect(replacement.failureReason).to.equal(null); expect(world.lanePolicy.projects.signals(0).completed).to.equal(0);
    } finally { world.dispose(); }
  });
  it('keeps safe walking passive and fixed-seed naturally spawned cohorts within the existing service bounds', async () => {
    const flat = chainWorld(masks, 'flat');
    expect(flat.world.hazardPlanner.plan(flat.actor)).to.equal(null); flat.world.dispose();
    for (const seed of [1322764708, 2706439495]) {
      const world = new ProcgenLaneWorld({ terrain: await loadProcgenTerrain('lemmings', 4), masks, seed, laneHeight: 144, cohorts: true, workstation: true, maxActors: 32, populationPolicy: { scoutsEvery: 0 } });
      try {
        for (let tick = 0; tick < 512; tick++) {
          world.step();
          for (const service of world.hazardPlanner.admission.lanes) expect(service.probes).to.be.at.most(1024);
          for (const state of world.lanePolicy.projects.lanes) expect(state.projects.length).to.be.at.most(4);
        }
        expect(world.nextActorId).to.be.greaterThan(1);
      } finally { world.dispose(); }
    }
  });
});
