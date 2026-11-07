import { expect } from 'chai';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { planTerrainCommand, applyTerrainPlan, readTerrainCell } from '../js/app/procgen/TerrainAuthoringAdapter.js';
import { terrainScoreAt, createTerrainScoreState, commitTerrainScore } from '../js/app/procgen/TerrainScoreLayer.js';
import { captureProcgenCheckpoint, restoreProcgenCheckpoint } from '../js/app/procgen/workstation/ProcgenCheckpoint.js';

const stroke = (world, overrides = {}) => ({ operation: 'addSolid', generation: world.generation, transactionId: 'brush:1',
  spans: [{ x1: 62, x2: 68, y: 10 }], materialId: 'authored:clay', tag: 'clay', ...overrides });
const queued = (world, terrain, id = terrain.transactionId) => ({ id, kind: 'terrain-edit', origin: 'manual', transactionId: terrain.transactionId,
  target: { generation: world.generation }, parameters: { terrain } });

describe('atomic terrain authoring and bounded physical provenance', () => {
  let masks; before(async () => { masks = await loadProcgenMasks(); });
  const ready = () => new ProcgenLaneWorld({ masks, assists: false });
  it('does not let fractional or nonfinite low-level writes invent revisions', () => {
    const world = ready(), before = world.terrainRevision, chunks = world.editChunks.size;
    for (const x of [62.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) expect(world.setGroundAt(x, 10)).to.equal(false);
    expect(world.terrainRevision).to.equal(before); expect(world.editChunks.size).to.equal(chunks); world.dispose();
  });
  it('previews without warming caches, merges spans, and commits one two-chunk transaction', () => {
    const world = ready(), before = captureProcgenCheckpoint(world), batches = [];
    const plan = planTerrainCommand(stroke(world, { spans: [{ x1: 62, x2: 65, y: 10 }, { x1: 64, x2: 68, y: 10 }] }), world);
    expect(plan.status).to.equal('prepared'); expect(plan.counts.solidAdded).to.equal(6); expect(plan.patchCount).to.equal(2);
    expect(captureProcgenCheckpoint(world)).to.deep.equal(before);
    world.soundEvents.onBatch.on(value => batches.push(value));
    const proposal = world.prepareIntervention(queued(world, plan.command)); expect(proposal.outcome.status).to.equal('queued'); proposal.commit();
    expect(world.hasGroundAt(62, 10)).to.equal(false); world.step();
    for (let x = 62; x < 68; x++) expect(world.hasGroundAt(x, 10)).to.equal(true);
    const applied = batches[0].facts.find(value => value.kind === 'CommandApplied');
    expect(applied.terrain.counts.solidAdded).to.equal(6); expect(applied.terrain.edit.spans).to.have.length(1);
    expect(applied.terrain.edit.causeKind).to.equal('authoring-command');
    expect(batches[0].facts.some(value => value.kind === 'TerrainWorkCommitted')).to.equal(false);
    expect(terrainScoreAt(world, 62, 10).editId).to.equal(applied.terrain.edit.editId);
    expect(world.enqueueIntervention(queued(world, plan.command)).reason).to.equal('duplicate-command'); world.dispose();
  });
  it('rejects the entire stroke when occupancy changes after preparation', () => {
    const world = ready(), plan = planTerrainCommand(stroke(world), world), actor = world.actors[0];
    world.enqueueIntervention(queued(world, plan.command)); actor.x = 64; actor.y = 20;
    world.step(); expect(world.interventionState.receipts.at(-1).status).to.equal('rejected');
    for (let x = 62; x < 68; x++) expect(world.hasGroundAt(x, 10)).to.equal(false);
    expect(world.terrainScoreState.transactions).to.have.length(0); world.dispose();
  });
  it('rejects stale revisions and cancellation without a partial patch or author fact', () => {
    const world = ready(), plan = planTerrainCommand(stroke(world), world);
    world.enqueueIntervention(queued(world, plan.command)); world.setGroundAt(80, 10); const revision = world.terrainRevision;
    world.step(); expect(world.hasGroundAt(62, 10)).to.equal(false); expect(world.terrainRevision).to.equal(revision);
    const next = stroke(world, { transactionId: 'brush:2' }); world.enqueueIntervention(queued(world, next)); world.cancelIntervention('brush:2');
    world.step(); expect(world.hasGroundAt(62, 10)).to.equal(false); world.dispose();
  });
  it('keeps already-solid AddSolid a no-op and annotation distinct from collision', () => {
    const world = ready(); world.setGroundAt(62, 10);
    const add = planTerrainCommand(stroke(world, { spans: [{ x1: 62, x2: 63, y: 10 }] }), world);
    expect(add.counts.solidAdded).to.equal(0); expect(add.counts.appearanceChanged).to.equal(0);
    const paint = stroke(world, { operation: 'annotate', transactionId: 'paint:1', spans: [{ x1: 62, x2: 63, y: 10 }], tag: 'marble' });
    world.enqueueIntervention(queued(world, paint)); world.step(); expect(world.groundColorAt(62, 10)).to.equal(3);
    expect(terrainScoreAt(world, 62, 10).tag).to.equal('marble'); expect(world.terrainScoreState.transactions.at(-1).solidAdded).to.equal(0); world.dispose();
  });
  it('refuses source materialization and steel without mutating collision cache ownership', () => {
    const world = ready(); world.terrain = { chunkWidth: 256, getChunk() { throw new Error('must not prepare'); } };
    expect(readTerrainCell(world, 62, 10).status).to.equal('unknown');
    const solid = new Uint32Array(256 * world.laneHeight / 32), steel = new Uint32Array(solid.length); steel[(10 * 256 + 62) >>> 5] |= 1 << ((10 * 256 + 62) & 31);
    world._collisionIndices[0] = 0; world._collisionSlots[0] = { solid, steel, objects: [] };
    const plan = planTerrainCommand(stroke(world), world); expect(plan.status).to.equal('rejected'); expect(plan.counts.protected).to.equal(1);
    world.terrain = null; world.dispose();
  });
  it('carries pending author inputs and provenance through the real checkpoint codec', () => {
    const world = ready(), other = ready(); world.enqueueIntervention(queued(world, stroke(world)));
    restoreProcgenCheckpoint(other, JSON.parse(JSON.stringify(captureProcgenCheckpoint(world))));
    world.step(); other.step(); expect(captureProcgenCheckpoint(other)).to.deep.equal(captureProcgenCheckpoint(world));
    const saved = captureProcgenCheckpoint(world); world.setGroundAt(100, 10); restoreProcgenCheckpoint(world, saved);
    expect(world.hasGroundAt(100, 10)).to.equal(false); expect(terrainScoreAt(world, 62, 10).tag).to.equal('clay'); world.dispose(); other.dispose();
  });
  it('rejects shadow allocation failures before publication', () => {
    const world = ready(), plan = planTerrainCommand(stroke(world), world), before = captureProcgenCheckpoint(world);
    const original = world.editChunks.chunkLength; world.editChunks.chunkLength = -1; world._stepping = true; world.soundEvents._tick = {};
    expect(() => applyTerrainPlan(plan, world)).to.throw(); world._stepping = false; world.soundEvents._tick = null; world.editChunks.chunkLength = original;
    expect(captureProcgenCheckpoint(world)).to.deep.equal(before); world.dispose();
  });
  it('does not reinterpret a historical contact using a later edit and declares evicted lineage unknown', () => {
    const world = { worldId: 'fixture', generation: 1, tickIndex: 1, terrainRevision: 1, width: 100000, height: 96,
      terrainScoreState: createTerrainScoreState(), terrainScorePending: { cells: [], overflow: false, revisionBefore: 0 } };
    commitTerrainScore(world, { operation: 'annotate', tag: 'first', revisionBefore: 0 }, [{ x: 62, y: 10, before: 1, after: 1 }]);
    world.terrainRevision = 2; commitTerrainScore(world, { operation: 'annotate', tag: 'later', revisionBefore: 1 }, [{ x: 62, y: 10, before: 1, after: 1 }]);
    expect(terrainScoreAt(world, 62, 10, 1).tag).to.equal('first');
    for (let index = 0; index < 513; index++) { world.terrainRevision++; commitTerrainScore(world, { operation: 'build' }, [{ x: 1000 + index * 16, y: 20, before: 0, after: 3 }]); }
    expect(world.terrainScoreState.chunks.size).to.be.at.most(512); expect(world.terrainScoreState.transactions.length).to.be.at.most(256);
    expect(terrainScoreAt(world, 62, 10).status).to.equal('unknown');
  });
});
