import { registerPhysicalGraphAdmission } from '../js/app/procgen/PhysicalGraphAdmission.js';
import { expect } from 'chai';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { digestPlan } from '../js/app/procgen/TerrainAuthoringAdapter.js';
import { captureProcgenCheckpoint, restoreProcgenCheckpoint } from '../js/app/procgen/workstation/ProcgenCheckpoint.js';
import { createProcgenRecoveryJournal, replayProcgenRecoveryJournal } from '../js/app/procgen/workstation/ProcgenRecoveryJournal.js';
import { createCausalMusicEngine } from '../js/app/procgen/workstation/CausalMusicEngine.js';
const graph = revision => ({ version: 1, revision, instruments: [], pickups: [{ id: 'gate', geometry: { kind: 'segment', points: [{ x: 120, y: 0 }, { x: 120, y: 32 }] } }] });
const command = (world, id = 'author:1') => ({ id, transactionId: id, kind: 'physical-authoring', origin: 'manual', target: { generation: world.generation }, parameters: { authoring: {
  version: 1, operation: 'terrain-and-graph', transactionId: id, expectedRevision: world.physicalAuthoring.revision, expectedJunctionRevision: world.physicalJunctions.revision, expectedGraphDigest: digestPlan(world.physicalAuthoring.graph), graph: graph(world.physicalAuthoring.graph.revision + 1), instances: [], junctions: [],
  terrain: { operation: 'addSolid', transactionId: id, generation: world.generation, spans: [{ x1: 100, x2: 108, y: 10 }] }
} } });
describe('one-boundary physical authoring publication', () => {
  let masks; before(async () => { masks = await loadProcgenMasks(); });
  const ready = () => { const world = new ProcgenLaneWorld({ masks, assists: false }); world.configurePhysicalAuthoring({ version: 1, revision: 1, instruments: [] }); world.soundEvents.onBatch.on(() => {}); return world; };
  it('publishes geometry and the effective musical graph before the same completed batch', () => {
    const world = ready(), seen = [], engine = createCausalMusicEngine({ getGraph: () => world.physicalAuthoring.graph });
    world.soundEvents.onBatch.on(batch => { seen.push({ solid: world.hasGroundAt(100, 10), revision: world.physicalAuthoring.graph.revision, intents: engine.processBatch(batch), facts: batch.facts }); });
    world.enqueueIntervention(command(world)); expect(world.hasGroundAt(100, 10)).to.equal(false); expect(world.physicalAuthoring.graph.revision).to.equal(1); world.step();
    expect(seen[0].solid).to.equal(true); expect(seen[0].revision).to.equal(2); expect(seen[0].intents).to.have.length(0); expect(seen[0].facts.filter(fact => fact.kind === 'CommandApplied')).to.have.length(1); expect(world.physicalAuthoring.lastApplied.transactionId).to.equal('author:1'); world.dispose();
  });
  it('rejects all owners when occupancy changes, a mapping changes, or a junction definition wins first', () => {
    for (const change of ['occupancy', 'mapping', 'junction']) { const world = ready(); world.enqueueIntervention(command(world));
      if (change === 'occupancy') { world.actors[0].x = 104; world.actors[0].y = 20; }
      if (change === 'mapping') world.configurePhysicalAuthoring({ version: 1, revision: 3, instruments: [] });
      if (change === 'junction') world.physicalJunctions.revision++;
      world.step(); expect(world.hasGroundAt(100, 10)).to.equal(false); expect(world.physicalAuthoring.revision).to.equal(0); expect(world.interventionState.receipts.at(-1).status).not.to.equal('accepted'); world.dispose(); }
  });
  it('captures pending atomic commands and independently replays authoring configuration plus application', async () => {
    const a = ready(), base = captureProcgenCheckpoint(a), journal = createProcgenRecoveryJournal(a, base), b = ready(); restoreProcgenCheckpoint(b, JSON.parse(JSON.stringify(base)));
    a.configurePhysicalAuthoring({ version: 1, revision: 2, instruments: [] }); a.enqueueIntervention(command(a)); a.step();
    await replayProcgenRecoveryJournal(b, JSON.parse(JSON.stringify(journal.snapshot()))); expect(captureProcgenCheckpoint(b)).to.deep.equal(captureProcgenCheckpoint(a));
    journal.dispose(); a.dispose(); b.dispose();
  });
  it('rejects interpreter resource pressure before either graph or terrain publication', () => {
    const world = ready(), old = world.physicalAuthoring.graph, release = registerPhysicalGraphAdmission(world, () => { throw new Error('observer capacity'); });
    world.enqueueIntervention(command(world)); world.step();
    expect(world.physicalAuthoring.graph).to.equal(old); expect(world.hasGroundAt(100, 10)).to.equal(false);
    expect(world.interventionState.receipts.at(-1).status).to.equal('rejected'); release(); world.dispose();
  });
  it('lets a canceled immediate configuration return staged observer capacity', () => {
    const world = ready(), calls = [], release = registerPhysicalGraphAdmission(world, () => ({ commit: () => calls.push('commit'), cancel: () => calls.push('cancel') }));
    const proposal = world.preparePhysicalAuthoring(graph(2)); proposal.admit(); proposal.cancel();
    expect(calls).to.deep.equal(['cancel']); expect(world.physicalAuthoring.graph.revision).to.equal(1);
    expect(() => proposal.commit()).to.throw('changed'); release(); world.dispose();
  });
  it('cancels an admitted placement without exposing its candidate graph or collision', () => {
    const world = ready(), before = world.physicalAuthoring; world.enqueueIntervention(command(world)); world.cancelIntervention('author:1'); world.step();
    expect(world.physicalAuthoring).to.equal(before); expect(world.hasGroundAt(100, 10)).to.equal(false); world.dispose();
  });
});
