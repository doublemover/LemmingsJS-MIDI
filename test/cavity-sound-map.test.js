import { expect } from 'chai';
import { createCavitySoundMap, compileCavitySoundMap, validateCavitySoundMap } from '../js/app/procgen/workstation/physical/CavitySoundMap.js';
import { analyzeTopology, validateTopologyRegion, bindTopologyFact } from '../js/app/procgen/workstation/physical/TopologyInstrumentRegion.js';
import { validateCausalInstrumentGraph } from '../js/app/procgen/workstation/CausalMusicEngine.js';
import { SympatheticNetworkKernel } from '../js/app/midi-ui/worklet/SympatheticNetworkKernel.js';
import { createSceneCavityBody } from '../js/app/procgen/workstation/SceneCavityBody.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';

const fixture = ({ recipe = 'clay-chamber', revision = 1, size = 8, throatWidth = 0, unknown = false } = {}) => {
  const duet = recipe === 'throat-duet', map = createCavitySoundMap({ id: 'original.' + recipe, bodyRecipe: recipe, topologyRegionRef: { id: 'body', revision: 1 }, anchorIds: duet ? ['left', 'right'] : ['left'], ...(duet ? { throat: { x: 10, y1: 2, y2: 10, referenceWidthPixels: 8 } } : {}) });
  const region = validateTopologyRegion({ id: 'body', revision: 1, bounds: { x1: 0, x2: 24, y1: 0, y2: 24 }, anchors: duet ? [{ id: 'left', x: 6, y: 6 }, { id: 'right', x: 15, y: 6 }] : [{ id: 'left', x: 8, y: 8 }], mapping: { revision: 1, bodyId: map.id, basePitchCents: 5700, referenceAreaPixels2: 64 } }), mask = [];
  for (let y = -1; y < 25; y++) for (let x = -1; x < 25; x++) mask.push(unknown && x === 0 ? -1 : duet ? y >= 2 && y < 10 && (x >= 2 && x < 10 || x >= 11 && x < 19 || x === 10 && y < 2 + throatWidth) ? 0 : 1 : x >= 4 && x < 4 + size && y >= 4 && y < 4 + size ? 0 : 1);
  const result = analyzeTopology({ region, mask, worldId: 'fixture', generation: 1, tick: revision, sourceRevision: revision });
  return { map, region, result };
};
const compile = value => compileCavitySoundMap(value.map, value.region, value.result);
const batch = value => ({ worldId: 'fixture', generation: 1, tick: value.result.tick, snapshot: { terrainRevision: value.result.sourceRevision, topology: { regions: [{ regionId: 'body', regionRevision: value.region.revision, current: value.result }] } } });

describe('authored cavity sound maps and prepared ownership', () => {
  it('uses an authored adjacent anchor to resolve a thin wall without selecting a distant component or guessing through ambiguity', () => {
    const value = fixture({ recipe: 'throat-duet' }), source = batch(value), fact = { kind: 'ContactResolved', anchor: { x: 10, y: 6 }, surfaceRevision: 1 };
    expect(bindTopologyFact(value.region, source, fact).status).to.equal('unsupported'); const left = bindTopologyFact(value.region, source, fact, { anchorId: 'left' }), right = bindTopologyFact(value.region, source, fact, { anchorId: 'right' }); expect(left.status).to.equal('complete'); expect(right.status).to.equal('complete'); expect(left.componentId).not.to.equal(right.componentId);
    expect(bindTopologyFact(value.region, source, { ...fact, anchor: { x: 26, y: 6 } }, { anchorId: 'left' })).to.include({ status: 'unsupported', reason: 'source-outside-topology-region' }); expect(bindTopologyFact(value.region, source, fact)).to.include({ status: 'unsupported', reason: 'topology-component-unavailable' });
    expect(() => validateCausalInstrumentGraph({ version: 1, revision: 1, topologyRegions: [value.region], instruments: [{ id: 'contact', sourceKind: 'ContactResolved', topologyRegionId: 'body', topologyAnchorId: 'missing', pitchCents: 5700, velocity01: 0.5, route: 'local', role: 'chamber' }] })).to.throw('anchor');
  });
  it('maps measured64/256square pixels to explicit220/110Hz existing modal bodies with bounded units and identity', async () => {
    const small = await compile(fixture()), wide = await compile(fixture({ size: 16, revision: 2 }));
    expect(small.bindings[0].frequencyHz).to.equal(220); expect(wide.bindings[0].frequencyHz).to.equal(110); expect(small.bindings[0].areaPixels2).to.equal(64); expect(wide.bindings[0].areaPixels2).to.equal(256);
    expect(small.cost.modes).to.equal(4); expect(small.semanticOnsetsAdded).to.equal(0); expect(small.bindings[0].t60Seconds).to.be.within(0.3, 1.5); expect(small.interpretation).to.include('not-3d'); expect(small.bodyIdentityHash).not.to.equal(wide.bodyIdentityHash);
    const kernel = new SympatheticNetworkKernel({ parameters: small.graph.nodes.find(node => node.id === 'body').parameters }); for (let frame = 0; frame < 48000; frame++) kernel.sample(frame === 0 ? 0.2 : 0, 0); expect(kernel.diagnostics().faults).to.equal(0);
  });
  it('retains two anchored pitches and only directly excites the selected body across a real declared connecting cross-section', async () => {
    const separated = await compile(fixture({ recipe: 'throat-duet' })), joined = await compile(fixture({ recipe: 'throat-duet', throatWidth: 1, revision: 2 }));
    expect(separated.bindings.map(row => row.frequencyHz)).to.deep.equal([220, 330]); expect(joined.bindings.map(row => row.bodyId)).to.deep.equal(separated.bindings.map(row => row.bodyId)); expect(joined.openingWidthPixels).to.equal(1);
    const first = separated.graph.nodes.find(node => node.id === 'body').parameters, second = joined.graph.nodes.find(node => node.id === 'body').parameters;
    expect(first.edges).to.have.length(0); expect(second.edges).to.have.length(1); expect(first.bodies.map(body => body.excitation01)).to.deep.equal([1, 0]);
    for (const [parameters, coupled] of [[first, false], [second, true]]) { const kernel = new SympatheticNetworkKernel({ parameters }); for (let frame = 0; frame < 128; frame++) kernel.sample(frame === 0 ? 0.2 : 0, 0); const receiverEnergy = kernel.state.slice(8, 16).reduce((sum, value) => sum + value * value, 0); expect(receiverEnergy > 0).to.equal(coupled); expect(kernel.diagnostics().faults).to.equal(0); }
  });
  it('changes reference-normalized chime brightness and refuses missing geometry or edited region definitions', async () => {
    const small = await compile(fixture({ recipe: 'crumbled-chimes' })), wide = await compile(fixture({ recipe: 'crumbled-chimes', size: 16 })); expect(small.bindings[0].excitationBrightness01).to.be.greaterThan(wide.bindings[0].excitationBrightness01);
    expect((await compile(fixture({ unknown: true }))).status).to.equal('unavailable'); const value = fixture(), edited = { ...value.region, bounds: { ...value.region.bounds, x2: 23 } }; expect((await compileCavitySoundMap(value.map, edited, value.result)).status).to.equal('unavailable');
    const corrupt = JSON.parse(JSON.stringify(value.map)); corrupt.descriptorMappings.referenceAreaPixels2 = -64; expect(() => validateCavitySoundMap(corrupt)).to.throw();
  });
  it('admits only the current exact prepared geometry and retires replaced body preparation without catch-up strikes', async () => {
    const value = fixture(), wide = fixture({ size: 16, revision: 2 }), context = { state: 'running', sampleRate: 48000 }, budget = createResourceBudget(); let active = null, publications = 0;
    const owner = createSceneCavityBody({ mechanism: { schema: 'lemmings-scene-cavity-route/v1', map: value.map }, getGraph: () => ({ topologyRegions: [value.region] }), getContext: () => context, getOwnerState: () => active, resourceBudget: budget, prepareGraph: async graph => active = { revision: ++publications, mode: 'active', activeGraph: { hash: 'a'.repeat(64) } } });
    try { owner.observe(batch(value), 'execution'); await owner.ensure(); expect(owner.state().prepared).to.equal(true); const intent = { kind: 'begin', worldId: 'fixture', generation: 1, topologyBinding: { regionId: 'body', boundTopologyRevision: 1, componentId: value.result.components[0].id } }; expect(owner.canEmit(intent)).to.equal(true);
      owner.observe(batch(wide), 'execution'); expect(owner.canEmit(intent)).to.equal(false); await owner.ensure(); expect(owner.state().bindings[0].frequencyHz).to.equal(110); expect(publications).to.equal(2);
      owner.observe({ ...batch(wide), snapshot: { terrainRevision: 2, topology: { regions: [] } } }, 'execution'); expect(owner.canEmit({ ...intent, topologyBinding: { ...intent.topologyBinding, boundTopologyRevision: 2 } })).to.equal(false); expect(owner.canEmit({ kind: 'end' })).to.equal(true);
    } finally { await owner.dispose().completion; expect(budget.diagnostics().accountedBytes).to.equal(0); }
  });
  it('reports an externally replaced exact body as unavailable without reclaiming its route', async () => {
    const value = fixture(), context = { state: 'running', sampleRate: 48000 }, budget = createResourceBudget(); let active = null, publications = 0;
    const owner = createSceneCavityBody({ mechanism: { schema: 'lemmings-scene-cavity-route/v1', map: value.map }, getGraph: () => ({ topologyRegions: [value.region] }), getContext: () => context, getOwnerState: () => active, resourceBudget: budget, prepareGraph: async () => active = { revision: ++publications, mode: 'active', activeGraph: { hash: 'a'.repeat(64) } } });
    try { owner.observe(batch(value), 'execution'); await owner.ensure(); expect(owner.state().prepared).to.equal(true); active = { revision: 2, mode: 'active', activeGraph: { hash: 'b'.repeat(64) } }; await owner.ensure(); expect(owner.state().prepared).to.equal(false); expect(owner.state().active).to.equal(false); expect(publications).to.equal(1); } finally { await owner.dispose().completion; expect(budget.diagnostics().accountedBytes).to.equal(0); }
  });
  it('waits without repeated staging allocation until the previous native tail has really retired', async () => {
    const value = fixture(), wide = fixture({ size: 16, revision: 2 }), context = { state: 'running', sampleRate: 48000 }, budget = createResourceBudget(); let active = { retiringGraphs: 1 }, publications = 0;
    const owner = createSceneCavityBody({ mechanism: { schema: 'lemmings-scene-cavity-route/v1', map: value.map }, getGraph: () => ({ topologyRegions: [value.region] }), getContext: () => context, getOwnerState: () => active, resourceBudget: budget, prepareGraph: async () => active = { revision: ++publications, mode: 'active', retiringGraphs: 0, activeGraph: { hash: 'a'.repeat(64) } } });
    try { const bytes = budget.diagnostics().accountedBytes; owner.observe(batch(value), 'execution'); for (let attempt = 0; attempt < 32; attempt++) await owner.ensure(); expect(publications).to.equal(0); expect(owner.state()).to.include({ prepared: false, preparing: false, error: 'waiting-for-previous-body-tail' }); expect(budget.diagnostics().accountedBytes).to.equal(bytes); owner.observe(batch(wide), 'execution'); active = { retiringGraphs: 0 }; await owner.ensure(); expect(owner.state().bindings[0].frequencyHz).to.equal(110); expect(publications).to.equal(1); } finally { await owner.dispose().completion; expect(budget.diagnostics().accountedBytes).to.equal(0); }
  });
  it('keeps pending workspace until a canceled preparation actually settles and publishes no obsolete body', async () => {
    const value = fixture(), budget = createResourceBudget(), context = { state: 'running', sampleRate: 48000 }; let release, entered; const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
    const owner = createSceneCavityBody({ mechanism: { schema: 'lemmings-scene-cavity-route/v1', map: value.map }, getGraph: () => ({ topologyRegions: [value.region] }), getContext: () => context, getOwnerState: () => null, resourceBudget: budget, prepareGraph: async (graph, options) => { entered(); await gate; options.signal.throwIfAborted(); throw new Error('Stale candidate may not publish.'); } });
    owner.observe(batch(value), 'execution'); await started; owner.reset(); const receipt = owner.dispose(); expect(receipt.outcome).to.equal('pending'); expect(budget.diagnostics().residentBytes).to.be.greaterThan(2 * 1048576); release(); await receipt.completion; expect(receipt.outcome).to.equal('complete'); expect(budget.diagnostics().accountedBytes).to.equal(0); expect(owner.state().prepared).to.equal(false);
  });
});
