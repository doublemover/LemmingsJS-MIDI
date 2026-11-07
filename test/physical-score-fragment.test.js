import { expect } from 'chai';
import { validatePhysicalScoreFragment, instantiatePhysicalScoreFragment, createFragmentQualificationCandidate, capturePhysicalScoreFragment, planPhysicalScoreFragment, validateFragmentInstances } from '../js/app/procgen/workstation/PhysicalScoreFragment.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { captureProcgenCheckpoint } from '../js/app/procgen/workstation/ProcgenCheckpoint.js';
import { reduceCanonicalProcgenProject } from '../js/app/procgen/workstation/ProcgenWorkstationProject.js';
import { terrainScoreAt } from '../js/app/procgen/TerrainScoreLayer.js';
const fragment = () => validatePhysicalScoreFragment({ version: 1, id: 'cell', revision: 1, source: { revision: 'source:1' }, pixelOrigin: { x: 100, y: 10 }, bounds: { x1: 0, x2: 8, y1: 0, y2: 8 }, collision: { spans: [{ x1: 0, x2: 8, y: 7, solid: true, tag: 'floor' }] },
  graph: { version: 1, revision: 1, pickups: [{ id: 'gate', geometry: { kind: 'segment', points: [{ x: 4, y: 0 }, { x: 4, y: 7 }] }, ensembleId: 'crew' }],
    ensembles: [{ id: 'crew', membershipMode: 'dynamic', maximumMembers: 16, selector: { kind: 'region', bounds: { x1: 0, x2: 8, y1: 0, y2: 8 } } }],
    instruments: [{ id: 'pluck', sourceKind: 'PickupCrossing', pickupId: 'gate', ensembleId: 'crew', pitchCents: 6900, velocity01: 0.7, route: 'browser', role: 'pluck' }] },
  ports: [{ id: 'in', role: 'inlet', position: { x: 1, y: 6 }, direction: 'right' }, { id: 'out', role: 'outlet', position: { x: 6, y: 6 }, direction: 'right' }],
  externalReferences: [{ kind: 'route', id: 'browser', policy: 'explicit-binding' }, { kind: 'materialTag', id: 'floor', policy: 'explicit-binding' }], parameters: [{ name: 'pitch', group: 'instruments', objectId: 'pluck', path: 'pitchCents', unit: 'cents', min: 2400, max: 9600 }] });
const placement = id => ({ namespace: id, x: 100, y: 10, bindings: { 'route:browser': 'local-browser', 'materialTag:floor': 'authored-floor' } });
describe('immutable physical score fragments', () => {
  let masks; before(async () => { masks = await loadProcgenMasks(); });
  it('remaps all local cause dependencies and keeps two instances independent', () => {
    const a = instantiatePhysicalScoreFragment(fragment(), placement('first')), b = instantiatePhysicalScoreFragment(fragment(), placement('second'));
    expect(a.graph.pickups[0].geometry.points[0]).to.deep.equal({ x: 104, y: 10 });
    expect(a.graph.instruments[0].pickupId).to.equal(a.graph.pickups[0].id); expect(a.graph.pickups[0].ensembleId).to.equal(a.graph.ensembles[0].id);
    expect(a.graph.pickups[0].id).not.to.equal(b.graph.pickups[0].id); expect(a.instance.fragmentRevision).to.equal(1); expect(a.fragment.runtimeState).to.equal('not-captured');
    expect(Object.isFrozen(a.graph.pickups[0])).to.equal(true); expect(JSON.parse(JSON.stringify(a)).instance).to.deep.equal(a.instance);
  });
  it('never binds an absent external reference by matching destination names', () => {
    const a = instantiatePhysicalScoreFragment(fragment(), { ...placement('missing'), bindings: {} });
    expect(a.status).to.equal('unresolved'); expect(a.graph.instruments[0].mute).to.equal(true); expect(a.graph.instruments[0].route).not.to.equal('browser');
  });
  it('rejects scaling/reflection claims and exposes only an unadmitted qualification candidate', () => {
    expect(() => instantiatePhysicalScoreFragment(fragment(), { ...placement('scale'), transform: 'scale-x2' })).to.throw('transform');
    expect(() => instantiatePhysicalScoreFragment(fragment(), { ...placement('mirror'), transform: 'reflect-x' })).to.throw('qualification');
    const candidate = createFragmentQualificationCandidate(fragment(), { ...placement('mirror'), transform: 'reflect-x' });
    expect(candidate.status).to.equal('qualification-only'); expect(candidate.ports[0].direction).to.equal('left'); expect(candidate.graph.pickups[0].geometry.points[0].x).to.equal(103);
  });
  it('applies only typed local parameter bindings and pins placed revisions across library updates', () => {
    const a = instantiatePhysicalScoreFragment(fragment(), { ...placement('tuned'), parameters: { pitch: 7200 } }); expect(a.graph.instruments[0].pitchCents).to.equal(7200);
    expect(() => instantiatePhysicalScoreFragment(fragment(), { ...placement('bad'), parameters: { prototype: 2 } })).to.throw('parameter');
    const p = { procgen: { revision: 1, lanes: [], physicalGraph: { version: 1, revision: 1, instruments: [] }, fragments: [fragment()], fragmentInstances: [a.instance] } };
    const updated = reduceCanonicalProcgenProject(p, { type: 'procgen/fragments', fragments: [{ ...fragment(), revision: 2 }] }); expect(updated.procgen.fragmentInstances[0].fragmentRevision).to.equal(1);
    const detached = reduceCanonicalProcgenProject(updated, { type: 'procgen/detachFragment', instanceId: 'tuned' }); expect(detached.procgen.fragmentInstances[0].detached).to.equal(true); expect(detached.procgen.physicalGraph).to.equal(p.procgen.physicalGraph);
    expect(validateFragmentInstances([a.instance])[0]).to.deep.equal(a.instance);
  });
  it('rejects runtime actor selectors and recursive/nested containment', () => {
    const source = JSON.parse(JSON.stringify(fragment())); source.graph.ensembles[0].selector = { kind: 'actors', identities: [{ worldId: 'world', generation: 1, actorId: 1 }] };
    expect(() => validatePhysicalScoreFragment(source)).to.throw('live actor'); expect(() => validatePhysicalScoreFragment({ ...fragment(), children: [{ fragmentId: 'cell' }] })).to.throw('nested');
  });
  it('captures only immutable authoring and previews without mutating a world or issuing notes', () => {
    const world = new ProcgenLaneWorld({ masks, assists: false }), before = captureProcgenCheckpoint(world);
    const captured = capturePhysicalScoreFragment(world, { id: 'air', source: { revision: 'fixture:1' }, bounds: { x1: 100, x2: 108, y1: 10, y2: 18 }, graph: { version: 1, revision: 1, instruments: [] } });
    expect(captured.collision.spans).to.have.length(8); expect(captureProcgenCheckpoint(world)).to.deep.equal(before);
    const project = { procgen: { physicalGraph: { version: 1, revision: 1, instruments: [] } } }, plan = planPhysicalScoreFragment(world, project, fragment(), placement('placed'));
    expect(plan.status).to.equal('prepared'); expect(plan.previewHardwareNotes).to.equal(false); expect(captureProcgenCheckpoint(world)).to.deep.equal(before); world.dispose();
  });
  it('keeps per-span annotation and collision together in one real terrain transaction', () => {
    const world = new ProcgenLaneWorld({ masks, assists: false });
    const terrain = { operation: 'replaceSolid', annotationPolicy: 'replace', transactionId: 'mixed', generation: world.generation, spans: [{ x1: 100, x2: 104, y: 10, solid: true, tag: 'a', materialId: null }, { x1: 104, x2: 108, y: 10, solid: true, tag: 'b', materialId: null }] };
    world.enqueueIntervention({ id: 'mixed', transactionId: 'mixed', kind: 'terrain-edit', target: { generation: world.generation }, parameters: { terrain } }); world.step();
    expect(terrainScoreAt(world, 102, 10).tag).to.equal('a'); expect(terrainScoreAt(world, 106, 10).tag).to.equal('b'); expect(world.terrainScoreState.transactions.at(-1).spans).to.have.length(2);
    const tileRevision = world.terrainTileRevisions.get(0); terrain.transactionId = 'relabel'; terrain.spans[0].tag = 'c';
    world.enqueueIntervention({ id: 'relabel', transactionId: 'relabel', kind: 'terrain-edit', target: { generation: world.generation }, parameters: { terrain } }); world.step();
    expect(terrainScoreAt(world, 102, 10).tag).to.equal('c'); expect(world.terrainTileRevisions.get(0)).to.equal(tileRevision); world.dispose();
  });
});

describe('real shared-action fragment transform fixture', () => {
  it('measures translation/reflection and does not infer doubled-geometry timing', async () => {
    const { replayPhysicalFragmentCircuit } = await import('./support/physical-fragment-circuit.js'), masks = await loadProcgenMasks();
    const original = replayPhysicalFragmentCircuit(masks), moved = replayPhysicalFragmentCircuit(masks, { translation: 100 }), mirrored = replayPhysicalFragmentCircuit(masks, { reflection: true }), scaled = replayPhysicalFragmentCircuit(masks, { scale: 2 });
    expect(original.periodsTicks).not.to.have.length(0); expect(moved.periodsTicks).to.deep.equal(original.periodsTicks); expect(mirrored.periodsTicks).to.deep.equal(original.periodsTicks);
    expect(new Set(original.periodsTicks)).to.deep.equal(new Set([120])); expect(new Set(scaled.periodsTicks)).to.deep.equal(new Set([242]));
    expect(scaled.periodsTicks[0]).not.to.equal(original.periodsTicks[0] * 2);
  });
});
