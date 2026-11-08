import { expect } from 'chai';
import { createOriginalAcousticMap, createOriginalAcousticZone } from '../js/midi/content/OriginalAcousticMap.js';
import { compileAcousticMap } from '../js/midi/content/AcousticMap.js';
import { createWorldSpatialControl } from '../js/app/procgen/workstation/WorldSpatialControl.js';
import { spatialSourcePoint, createCausalSpatialPlayback } from '../js/app/procgen/workstation/CausalSpatialPlayback.js';
import { validateSpatialState, validateSpatialAttachment } from '../js/midi/content/SpatialState.js';
import { createResourceBudget, ResourceBudgetError } from '../js/app/resources/ResourceBudget.js';

const zones = () => ['felt', 'glass'].map((id, index) => createOriginalAcousticZone({ zoneId: id, materialResponseId: id, priority: 0, worldRegion: { kind: 'rectangle', bounds: { x1: index * 64, x2: 128 + index * 64, y1: 0, y2: 96 } } }));
const batch = (tick = 1) => ({ worldId: 'acoustic-test-world', generation: 1, tick, sourceTimeMs: tick * 12, tickDurationMs: 12, completeness: { status: 'complete' }, snapshot: { terrainRevision: 1, actors: [{ actorId: 7, x: 80, y: 70, laneId: 0 }] } });

describe('committed world acoustic controls (deferred grouped qualification)', () => {
  it('normalizes immutable spatial snapshots repeatedly and admits safe sanitized attachment records (#1270)', () => {
    const control = createWorldSpatialControl(), map = createOriginalAcousticMap({ listener: { x: 64, y: 70 }, zones: zones() }); control.configure(map); control.observe(batch());
    const input = { voiceId: 'immutable-observation', actorId: 7, attachment: Object.assign(Object.create(null), { kind: 'actor' }) }, first = control.state(input).state, original = JSON.stringify(first);
    expect(validateSpatialState(Object.freeze({ ...first }))).to.deep.equal(first); expect(validateSpatialState(first)).to.equal(first); expect(Object.isFrozen(first.sourceAttachment)).to.equal(true);
    const later = batch(2); later.snapshot.actors[0].x = 100; control.observe(later); expect(control.state(input).state.sourceWorldPosition.x).to.equal(100); expect(JSON.stringify(first)).to.equal(original);
    expect(validateSpatialAttachment(Object.assign(Object.create(null), { kind: 'persistent-body', bodyId: 'room', position: Object.assign(Object.create(null), { x: 10, y: 20 }) }))).to.deep.equal({ kind: 'persistent-body', bodyId: 'room', position: { x: 10, y: 20 } });
    expect(() => validateSpatialAttachment(Object.create({ kind: 'actor' }))).to.throw('explicitly');
  });
  it('keeps camera changes out of fixed-listener controls and separates actor from fixed strike attachment', () => {
    let camera = { x: 10, y: 10 }; const control = createWorldSpatialControl({ getCameraPosition: () => camera }), map = createOriginalAcousticMap({ listener: { x: 64, y: 70 }, zones: zones() }); control.configure(map); control.observe(batch());
    const fixed = { voiceId: 'strike', actorId: 7, attachment: { kind: 'struck-point' }, sourcePosition: { x: 40, y: 70 } }, first = control.state(fixed).state; camera = { x: 4000, y: -2000 }; control.observe(batch()); expect(control.state(fixed).state).to.deep.equal(first);
    const moving = control.state({ ...fixed, voiceId: 'moving', attachment: { kind: 'actor' } }).state; expect(moving.sourceWorldPosition).to.deep.equal({ x: 80, y: 70 }); expect(first.sourceWorldPosition).to.deep.equal({ x: 40, y: 70 });
  });
  it('normalizes equal-priority overlaps independently of serialized zone order', () => {
    const a = compileAcousticMap(createOriginalAcousticMap({ zones: zones() })), b = compileAcousticMap(createOriginalAcousticMap({ zones: zones().reverse() }));
    const position = { x: 96, y: 50 }; expect(a.evaluate(position)).to.deep.equal(b.evaluate(position)); const membership = a.evaluate(position); expect(membership.memberships.reduce((sum, zone) => sum + zone.blend01, membership.dryRemainder01)).to.be.closeTo(1, 1e-12);
  });
  it('recovers the exact observed crossing point rather than moving the strike to the actor endpoint', () => {
    const graph = { pickups: [{ id: 'gate', revision: 2, geometry: { kind: 'segment', points: [{ x: 96, y: 0 }, { x: 96, y: 100 }] } }] }, fact = { positionAfter: { x: 101, y: 80 } }, intent = { observation: { kind: 'PickupCrossing', gateId: 'gate', gateRevision: 2, local01: 0.8 } };
    expect(spatialSourcePoint(fact, intent, graph)).to.deep.equal({ x: 96, y: 80 }); expect(spatialSourcePoint(fact, { observation: { ...intent.observation, gateRevision: 1 } }, graph)).to.equal(null);
  });
});


describe('spatial plan admission and retirement (functional campaign deferred)', () => {
  const create = (getGraph, resourceBudget) => createCausalSpatialPlayback({ getGraph, resourceBudget, world: {}, session: { acousticMapMatches: () => true, acousticMapState: () => ({ mapHash: 'a'.repeat(64) }) },
    getSources: () => [], updateSources: () => [], toFrame: () => 4096, getExecutionEpoch: () => 'spatial-test', getContext: () => ({ sampleRate: 48000, currentTime: 0 }) });
  it('retries an identical map object after a refused retained-plan reservation', async () => {
    const budget = createResourceBudget({ limitBytes: 64 * 1048576 }); let deny = true;
    const map = createOriginalAcousticMap({ id: 'retry-map' }), owner = create(() => ({ acousticMap: map, instruments: [] }), {
      reserve(request) { if (deny && request.kind === 'bounded-spatial-observations-and-occlusion-cache' && request.bytes > 4096) { deny = false; throw new ResourceBudgetError('candidate', request.bytes, 0); } return budget.reserve(request); }, release: budget.release });
    const source = { ...batch(), facts: [] }; expect(() => owner.before([], source)).to.throw('accounted bytes'); expect(owner.diagnostics().enabled).to.equal(false);
    owner.before([], source); expect(owner.diagnostics().mapId).to.equal('retry-map'); expect(owner.diagnostics().actorCount).to.equal(1);
    const receipt = owner.dispose(); await receipt.completion; expect(receipt.outcome).to.equal('complete'); expect(budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('drops compiled plans and observations before reducing or releasing the owner', async () => {
    const budget = createResourceBudget({ limitBytes: 64 * 1048576 }); let map = createOriginalAcousticMap(); const owner = create(() => ({ acousticMap: map, instruments: [] }), budget), baseline = budget.diagnostics().accountedBytes;
    owner.before([], { ...batch(), facts: [] }); expect(budget.diagnostics().accountedBytes).to.be.greaterThan(baseline);
    owner.reset(); expect(owner.diagnostics()).to.include({ enabled: false, actorCount: 0, sourceTick: -1, worldId: null }); expect(budget.diagnostics().accountedBytes).to.equal(baseline);
    owner.before([], { ...batch(2), facts: [] }); map = null; owner.before([], { ...batch(3), facts: [] }); expect(owner.diagnostics()).to.include({ enabled: false, actorCount: 0, worldId: null }); expect(budget.diagnostics().accountedBytes).to.equal(baseline);
    const receipt = owner.dispose(); await receipt.completion; expect(receipt.outcome).to.equal('complete'); expect(budget.diagnostics().accountedBytes).to.equal(0);
  });
});
