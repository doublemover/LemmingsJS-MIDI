import { planCausalReinterpretation, PHYSICAL_CAPTURE_PROFILE } from '../js/app/procgen/workstation/CausalTake.js';
import { expect } from 'chai';
import { analyzeTopology, reuseTopologyResult, validateTopologyRegion, validateTopologyResult, bindTopologyFact } from '../js/app/procgen/workstation/physical/TopologyInstrumentRegion.js';
import { createCausalMusicEngine } from '../js/app/procgen/workstation/CausalMusicEngine.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { prepareTopologyAnalysis, publishTopologyAnalysis, captureTerrainTopology } from '../js/app/procgen/ProcgenTerrainTopology.js';
import { captureProcgenCheckpoint, restoreProcgenCheckpoint } from '../js/app/procgen/workstation/ProcgenCheckpoint.js';

const region = (extra = {}) => validateTopologyRegion({ id: 'room', revision: 1, bounds: { x1: 0, y1: 0, x2: 10, y2: 10 },
  mapping: { revision: 1, bodyId: 'authored-modal-body', basePitchCents: 6000, referenceAreaPixels2: 64 }, ...extra });
const input = (r, solid, sourceRevision = 1) => {
  const mask = [], b = r.bounds;
  for (let y = b.y1 - r.halo; y < b.y2 + r.halo; y++) for (let x = b.x1 - r.halo; x < b.x2 + r.halo; x++) mask.push(solid(x, y));
  return { region: r, mask, worldId: 'scene', generation: 1, tick: sourceRevision, sourceRevision };
};
const cavity = (x, y) => x >= 1 && x < 9 && y >= 1 && y < 9 ? 0 : 1;
const chambers = (x, y) => y >= 1 && y <= 3 && (x >= 1 && x <= 3 || x >= 5 && x <= 7) ? 0 : 1;
const batch = (r, current, history, facts = []) => ({ version: 1, batchId: `scene:1:${current.sourceRevision}`, worldId: 'scene', generation: 1, tick: current.sourceRevision,
  completeness: { status: 'complete', dropped: 0 }, snapshot: { actors: [], terrainRevision: current.sourceRevision, topology: { version: 1,
    regions: [{ regionId: r.id, regionRevision: r.revision, status: 'complete', current, history }] } },
  facts: facts.map((fact, index) => ({ actorId: index + 1, laneId: 0, eventId: `work:${current.sourceRevision}:${index}`, causalSequence: current.sourceRevision * 100 + index, ...fact })) });
const work = (revision, x, y, changed = 1) => ({ kind: 'TerrainWorkCommitted', operationKind: 'dig', physicalPayload: { sourceEditRevisionAfter: revision, changedSolidCells: changed, targetX: x, targetY: y } });

describe('bounded collision topology and causal excitation binding', () => {
  it('measures square pixels and boundary edges without claiming acoustic volume', () => {
    const r = region(), result = analyzeTopology(input(r, cavity));
    expect(result.components).to.have.length(1); expect(result.components[0]).to.include({ areaPixels2: 64, boundaryLengthPixels: 32, enclosure: 'closed' });
    expect(result.components[0].centroid).to.deep.equal({ x: 5, y: 5 }); expect(result.units.acoustics).to.equal('authored-interpretation-not-measurement');
    expect(validateTopologyResult(JSON.parse(JSON.stringify(result)))).to.deep.equal(result);
    const corrupt = JSON.parse(JSON.stringify(result)); corrupt.runs[1] = Number.MAX_SAFE_INTEGER; expect(() => validateTopologyResult(corrupt)).to.throw();
  });
  it('records zero new analysis work for a proven unchanged region and rejects forged reuse metadata', () => {
    const first = analyzeTopology(input(region(), cavity)), reused = reuseTopologyResult(first, { tick: 2, sourceRevision: 2 });
    expect(reused.work).to.deep.equal({ cells: 0, neighborVisits: 0, reusedFromRevision: 1 }); expect(reused.runs).to.equal(first.runs); expect(reused.components[0].id).to.equal(first.components[0].id);
    expect(reused.components[0].lineage).to.deep.equal({ kind: 'unchanged', parentIds: [first.components[0].id] }); expect(validateTopologyResult(JSON.parse(JSON.stringify(reused)))).to.deep.equal(reused);
    for (const mutate of [value => { value.work.cells = 1; }, value => { value.work.neighborVisits = 1; }, value => { value.work.reusedFromRevision = 2; }, value => { value.components[0].geometryChanged = true; }, value => { value.components[0].lineage.parentIds = []; }]) { const copy = JSON.parse(JSON.stringify(reused)); mutate(copy); expect(() => validateTopologyResult(copy)).to.throw(); }
    expect(() => reuseTopologyResult(first, { tick: 0, sourceRevision: 2 })).to.throw(); expect(() => reuseTopologyResult(first, { tick: 2, sourceRevision: 1 })).to.throw();
  });
  it('distinguishes open ROI seams and unknown coverage from enclosed rooms', () => {
    const r = region({ allowOpen: true }), open = analyzeTopology(input(r, (x, y) => y === 5 && x >= 8 ? 0 : cavity(x, y)));
    expect(open.components[0].enclosure).to.equal('open'); expect(open.components[0].openings).to.have.length(1);
    const unknown = analyzeTopology(input(r, (x, y) => x === 0 && y === 5 ? -1 : cavity(x, y)));
    expect(unknown.components[0].enclosure).to.equal('unknown'); expect(unknown.components[0].musical.status).to.equal('unsupported');
  });
  it('implements declared diagonal connectivity and deterministic split/merge lineage', () => {
    const pixels = (x, y) => x === 2 && y === 2 || x === 3 && y === 3 ? 0 : 1;
    expect(analyzeTopology(input(region(), pixels)).components).to.have.length(2);
    expect(analyzeTopology(input(region({ connectivity: 8 }), pixels)).components).to.have.length(1);
    const r = region(), first = analyzeTopology(input(r, chambers)), joined = analyzeTopology(input(r, (x, y) => x === 4 && y === 2 ? 0 : chambers(x, y), 2), first);
    expect(joined.components).to.have.length(1); expect(joined.components[0].lineage.kind).to.equal('merged'); expect(joined.components[0].lineage.parentIds).to.have.length(2);
    expect(joined.removedComponentIds).to.have.length(1);
    const split = analyzeTopology(input(r, chambers, 3), joined); expect(split.components.map(c => c.lineage.kind)).to.deep.equal(['split', 'split']);
    expect(new Set(split.components.map(c => c.id)).size).to.equal(2); expect(split.nextSerial).to.be.greaterThan(joined.nextSerial);
  });
  it('binds two local work revisions honestly and never substitutes newest for missing post-transaction evidence', () => {
    const r = region(), first = analyzeTopology(input(r, chambers)), joined = analyzeTopology(input(r, (x, y) => x === 4 && y === 2 ? 0 : chambers(x, y), 2), first);
    const postRegion = region({ bindingPolicy: 'postTransaction' }), firstPost = analyzeTopology(input(postRegion, chambers)), joinedPost = analyzeTopology(input(postRegion, (x, y) => x === 4 && y === 2 ? 0 : chambers(x, y), 2), firstPost);
    const source = batch(r, joined, [first, joined]), local = batch(postRegion, joinedPost, [firstPost, joinedPost]), fact = work(1, 2, 2), end = bindTopologyFact(r, source, fact), post = bindTopologyFact(postRegion, local, fact);
    expect(end).to.include({ sourceEditRevision: 1, boundTopologyRevision: 2, interpretation: 'completed-tick-musical-interpretation' });
    expect(post).to.include({ sourceEditRevision: 1, boundTopologyRevision: 1, interpretation: 'exact-local-revision' });
    local.snapshot.topology.regions[0].history = [joinedPost]; expect(bindTopologyFact(postRegion, local, fact).status).to.equal('unsupported');
  });
  it('derives authored pitches only from actual successful work and releases vanished held components without replacement attacks', () => {
    const r = region(), first = analyzeTopology(input(r, chambers)), graph = { version: 1, revision: 1, topologyRegions: [r], instruments: [
      { id: 'dig-room', sourceKind: 'TerrainWorkCommitted', topologyRegionId: 'room', pitchCents: 6000, velocity01: 0.7, route: 'local', role: 'strike' },
      { id: 'contact-room', sourceKind: 'ContactSpanBegan', topologyRegionId: 'room', pitchCents: 6000, velocity01: 0.5, route: 'local', role: 'held' }] };
    const engine = createCausalMusicEngine({ getGraph: () => graph });
    const initial = engine.processBatch(batch(r, first, [first], [work(1, 2, 2), work(1, 2, 2, 0), { kind: 'ContactSpanBegan', spanId: 'support:1', surfaceRevision: 1, anchor: { x: 6, y: 2 } }]));
    expect(initial.filter(i => i.kind === 'begin')).to.have.length(2); expect(initial[0].topologyBinding.bodyId).to.equal(r.mapping.bodyId);
    const joined = analyzeTopology(input(r, (x, y) => x === 4 && y === 2 ? 0 : chambers(x, y), 2), first), after = engine.processBatch(batch(r, joined, [first, joined]));
    expect(after.map(i => i.kind)).to.deep.equal(['end']); expect(after[0].terminationReason).to.equal('topology-component-changed');
  });
  it('preserves an initial held component when no topology revision changed', () => {
    const r = region(), first = analyzeTopology(input(r, cavity)), graph = { version: 1, revision: 1, topologyRegions: [r], instruments: [{ id: 'held', sourceKind: 'ContactSpanBegan', topologyRegionId: 'room', pitchCents: 6000, velocity01: 0.5, route: 'local', role: 'held' }] };
    const engine = createCausalMusicEngine({ getGraph: () => graph }); engine.processBatch(batch(r, first, [first], [{ kind: 'ContactSpanBegan', spanId: 'support:1', surfaceRevision: 1, anchor: { x: 2, y: 2 } }]));
    const next = batch(r, first, [first]); next.tick = 2; next.batchId = 'scene:1:2'; expect(engine.processBatch(next)).to.have.length(0);
  });
  it('refuses reinterpretation when the requested ROI was never captured', () => {
    const r = region(), graph = { version: 1, revision: 1, topologyRegions: [r], instruments: [{ id: 'room', sourceKind: 'TerrainWorkCommitted', topologyRegionId: r.id, pitchCents: 6000, velocity01: 1, route: 'local', role: 'strike' }] };
    const manifest = { schema: 'lemmings-causal-take', version: 1, takeId: 'fixture', revision: 1, canonicalHash: 'fixture', captureProfile: PHYSICAL_CAPTURE_PROFILE,
      coverage: { status: 'complete', sourceRange: { firstTick: 1, lastTick: 2, worldId: 'scene' }, available: PHYSICAL_CAPTURE_PROFILE, gaps: [], topologyRegions: [] } };
    const plan = planCausalReinterpretation({ manifest, graph }); expect(plan.supported).to.equal(false);
    expect(plan.requirements.find(value => value.kind === 'topology-geometry-v1').reason).to.equal('topology-region-not-captured');
  });
  it('refuses changed or unbound region definitions before contact excitation', () => {
    const r = region(), result = analyzeTopology(input(r, cavity)), source = batch(r, result, [result]), fact = work(1, 2, 2);
    for (const changed of [{ bounds: { x1: 0, x2: 11, y1: 0, y2: 10 } }, { connectivity: 8 }, { halo: 2 }, { allowOpen: true }, { mapping: { ...r.mapping, bodyId: 'different' } }, { heldPolicy: 'retain-onset' }]) expect(bindTopologyFact(region(changed), source, fact).status).to.equal('unsupported');
    const legacy = JSON.parse(JSON.stringify(source)); delete legacy.snapshot.topology.regions[0].current.definitionSignature; expect(bindTopologyFact(r, legacy, fact).status).to.equal('unsupported');
  });
  it('rejects late analysis after an edit or authoring revision and restores bounded histories', async () => {
    const masks = await loadProcgenMasks(), world = new ProcgenLaneWorld({ masks, assists: false });
    const r = region({ bounds: { x1: 62, x2: 70, y1: 10, y2: 18 }, allowOpen: true, bindingPolicy: 'postTransaction' }); world.configureTopologyRegions([r]);
    const job = prepareTopologyAnalysis(world, r), result = analyzeTopology(job); world.setGroundAt(65, 12);
    expect(publishTopologyAnalysis(world, job, result)).to.equal(false);
    captureTerrainTopology(world); const saved = captureProcgenCheckpoint(world); world.configureTopologyRegions([{ ...r, revision: 2 }]);
    expect(publishTopologyAnalysis(world, job, result)).to.equal(false); restoreProcgenCheckpoint(world, saved);
    expect(world.terrainTopology.profiles[0].revision).to.equal(1); expect(world.terrainTopology.regions.get('room').history.length).to.be.at.most(4); world.dispose();
  });
  it('falls back to full analysis after missing invalidation history and refuses malformed saved invalidation state', async () => {
    const masks = await loadProcgenMasks(), world = new ProcgenLaneWorld({ masks, assists: false }), r = region({ bounds: { x1: 62, x2: 70, y1: 10, y2: 18 } });
    try { world.configureTopologyRegions([r]); world.captureTerrainTopology('endOfTick'); const first = world.terrainTopology.regions.get('room').current;
      world.terrainTopology.invalidationRevision = -1; world.setGroundAt(120, 10); world.captureTerrainTopology('endOfTick'); const current = world.terrainTopology.regions.get('room').current;
      expect(current).not.to.equal(first); expect(current.work.cells).to.equal(64); expect(current.sourceRevision).to.equal(world.terrainRevision);
      const before = captureProcgenCheckpoint(world);
      for (const field of ['dirty', 'invalidationRevision']) { const copy = JSON.parse(JSON.stringify(before)), node = copy.graph.nodes.find(node => Object.hasOwn(node.props || {}, field)); node.props[field] = field === 'dirty' ? 'unknown' : world.terrainRevision + 1; expect(() => restoreProcgenCheckpoint(world, copy)).to.throw('topology invalidation'); expect(captureProcgenCheckpoint(world)).to.deep.equal(before); }
    } finally { world.dispose(); }
  });
});
