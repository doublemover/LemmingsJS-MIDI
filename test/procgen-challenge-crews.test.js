import { expect } from 'chai';
import { loadProcgenMasks, loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';

const cross = async (masks, pack, ground, seed, chunk, count) => {
  const terrain = await loadProcgenTerrain(pack, ground), world = new ProcgenLaneWorld({ terrain, masks, seed, assists: true, populationPolicy: { scoutsEvery: 0 } });
  try {
    const origin = chunk * 128, descriptor = terrain.describe(world.laneSeeds[0], chunk), challenge = descriptor.challenge;
    for (const x of [origin + 24, origin + 110]) world.terrainGrowth.ensureLocal(0, x, { through: world.generatedThrough, frontiers: world.frontiers, prepare: world._prepareGrowthChunk, reveal: world._revealGrowth });
    for (let index = 0; index < count; index++) {
      const actor = index ? world._spawn(0, false) : world.actors[0];
      Object.assign(actor, { x: origin + 40 - index, y: challenge.floor, furthestX: origin + 40 - index, canClimb: false, hasParachute: false, scout: false });
      actor.setAction(world.actions[State.WALKING]); expect(world.hasGroundAt(actor.x, actor.y)).to.equal(true);
    }
    const arrivals = new Map(), assignments = [], assign = world.assignWorker.bind(world); let maxWork = 0;
    world.assignWorker = (actor, kind, ...rest) => {
      const accepted = assign(actor, kind, ...rest);
      if (accepted) assignments.push([world.tickIndex, actor.id, actor.x, actor.y, kind]); return accepted;
    };
    while (world.tickIndex < 700 && arrivals.size < count) {
      world.step(); maxWork = Math.max(maxWork, world.hazardPlanner.admission.lanes[0].probes);
      for (const actor of world.actors) if (!arrivals.has(actor.id) && actor.x >= origin + 104 && actor.action === world.actions[State.WALKING] && world.hasGroundAt(actor.x, actor.y) && !actor.failureReason && !actor.terminalReason) arrivals.set(actor.id, world.tickIndex);
    }
    expect(arrivals.size, `${pack}/${ground}/${seed}/${chunk}/${count}`).to.equal(count);
    expect(world.activeCount).to.equal(count); expect(world.spawnedTotal).to.equal(count); expect(world.stats.failures).to.equal(0);
    expect(world.hazards.stats.contacts).to.equal(0); expect(maxWork).to.be.at.most(1024);
    expect(world.actors.every(actor => !actor.canClimb && !actor.hasParachute && !actor.assistConstructionTask && !actor.failureReason && !actor.terminalReason)).to.equal(true);
    return { kind: challenge.kind, tick: world.tickIndex, arrivals: [...arrivals], assignments,
      actors: world.actors.map(actor => [actor.id, actor.x, actor.y, actor.lookRight, actor.action.actionName]),
      skills: { builds: world.stats.builds, bashes: world.stats.bashes, digs: world.stats.digs, mines: world.stats.mines }, maxWork };
  } finally { world.dispose(); }
};

describe('generated challenges preserve the whole ordinary crew', function() {
  this.timeout(15000); let masks;
  before(async () => { masks = await loadProcgenMasks(); });
  for (const [pack, ground] of [['lemmings', 0], ['lemmings', 1], ['lemmings_ohNo', 2]]) for (const count of [8, 16]) {
    it(`crosses all four forms with ${count} members in ${pack}/${ground}`, async () => {
      for (const [seed, chunk, kind] of [[3, 3, 'ledge'], [1, 3, 'tunnel'], [1, 5, 'gap'], [5, 3, 'terraces']]) {
        const result = await cross(masks, pack, ground, seed, chunk, count); expect(result.kind).to.equal(kind);
        expect(result.skills.digs + result.skills.mines).to.equal(0);
        if (kind === 'ledge') expect(result.skills).to.include({ builds: 1, bashes: 0 });
        if (kind === 'gap') expect(result.skills).to.include({ builds: 1 });
        if (kind === 'terraces') expect(result.skills).to.deep.equal({ builds: 0, bashes: 0, digs: 0, mines: 0 });
      }
    });
  }
  it('replays the entire dense gap cohort identically, including recovery and original identities', async () => {
    expect(await cross(masks, 'lemmings', 0, 2, 5, 16)).to.deep.equal(await cross(masks, 'lemmings', 0, 2, 5, 16));
  });
  it('preserves sixteen members through six additional seed/chunk combinations', async () => {
    for (const seed of [19, 42]) for (const chunk of [3, 5, 7]) await cross(masks, 'lemmings', 0, seed, chunk, 16);
  });
  it('crosses spaced deep encounters with the complete original sixteen-member controlled crew', async () => {
    for (const [seed, chunk, kind] of [[2, 17, 'terraces'], [1, 17, 'ledge'], [2, 25, 'tunnel'], [14, 25, 'gap']]) {
      const result = await cross(masks, 'lemmings', 0, seed, chunk, 16); expect(result.kind).to.equal(kind);
      if (kind === 'terraces') expect(result.skills).to.deep.equal({ builds: 0, bashes: 0, digs: 0, mines: 0 });
      if (kind === 'ledge') expect(result.skills.builds + result.skills.bashes).to.be.greaterThan(0);
      if (kind === 'gap') expect(result.skills.builds).to.be.greaterThan(0);
      if (kind === 'tunnel') expect(result.skills.bashes).to.be.greaterThan(0);
    }
  });
  for (const [pack, ground, seed] of [['lemmings', 1, 2], ['lemmings_ohNo', 2, 3]]) it(`admits the real sixteen-birth ${pack}/${ground}/${seed} crew through its first challenge`, async () => {
    const terrain = await loadProcgenTerrain(pack, ground), world = new ProcgenLaneWorld({ terrain, masks, seed, populationPolicy: { scoutsEvery: 0 } });
    try {
      const arrived = new Set(), assignments = [], assign = world.assignWorker.bind(world); let maxWork = 0;
      world.assignWorker = (actor, kind, ...rest) => { const accepted = assign(actor, kind, ...rest); if (accepted) assignments.push([world.tickIndex, actor.id, actor.x, kind]); return accepted; };
      while (world.tickIndex < 900 && arrived.size < 16) {
        if (world.tickIndex > 0 && world.tickIndex % 6 === 0 && world.spawnedTotal < 16) world._spawn(0, false);
        world.step(); maxWork = Math.max(maxWork, world.hazardPlanner.admission.lanes[0].probes);
        for (const actor of world.actors) if (actor.x >= 488 && actor.action === world.actions[State.WALKING] && !actor.failureReason && !actor.terminalReason) arrived.add(actor.id);
      }
      expect(arrived.size).to.equal(16); expect(world.spawnedTotal).to.equal(16); expect(world.activeCount).to.equal(16);
      expect(world.stats.failures).to.equal(0); expect(world.hazards.stats.contacts).to.equal(0); expect(maxWork).to.be.at.most(1024);
      if (pack === 'lemmings_ohNo') expect(assignments.find(([, , x, kind]) => x >= 320 && kind === 'bashers')?.[1]).to.equal(0);
    } finally { world.dispose(); }
  });
});
