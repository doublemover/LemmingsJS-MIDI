import { expect } from 'chai';
import { createLaneDisplayEvidence } from '../js/app/procgen/workstation/LaneDisplayEvidence.js';
import { createLaneDisplaySnapshot } from '../js/app/procgen/workstation/LaneDisplaySnapshot.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';

const lane = { id: 'lane-1', name: 'Complete descriptive patch name', role: 'percussion', family: 'sine', mode: 'physical', gain: 1 };
const input = (extra = {}) => ({ sourceKey: 'document:world:1', lanes: [lane], batch: { batchId: 'world:1:10', generation: 1, tick: 10, completeness: { status: 'complete', dropped: 0 },
  facts: [{ eventId: 'fact-1', kind: 'TerrainWorkCommitted', action: 'dig', actorId: 7, causalSequence: 10 }] },
intents: [{ intentId: 'intent-1', batchId: 'world:1:10', generation: 1, laneId: 0, actorId: 7, voiceId: 'voice-1', mappingId: 'map-1', kind: 'begin', physicalSourceKind: 'TerrainWorkCommitted', physicalAction: 'dig', sourceEventIds: ['fact-1'], pitch: { cents: 6000 }, velocity01: 0.7 }],
receipts: [{ intentId: 'intent-1', batchId: 'world:1:10', generation: 1, executionEpoch: 'audio:1', sinkId: 'local', status: 'accepted', stage: 'queued', targetFrame: 400, targetTimeDomain: 'audio-frame' }], ...extra });
const read = store => store.read(lane.id, 'document:world:1');
const snapshot = (store, options = {}) => createLaneDisplaySnapshot({ lane, evidence: read(store), mix: { outputState: 'source-events' }, ...options });
const fixture = options => { const store = createLaneDisplayEvidence(options); store.setLanes([lane.id]); return store; };

describe('bounded live lane display evidence', () => {
  it('joins exact observed facts, intents and sink receipts without retaining mutable source objects', () => {
    const store = fixture(), value = input();
    try {
      store.observe(value); value.batch.facts[0].action = 'changed'; value.intents[0].pitch.cents = 7000; value.receipts[0].stage = 'rendered';
      const event = read(store).record.events[0]; expect(event).to.include({ actorId: 7, mappingId: 'map-1', pitchCents: 6000, graphRevision: null });
      expect(event.sources[0]).to.include({ eventId: 'fact-1', action: 'dig', recorded: true }); expect(event.receipts[0].stage).to.equal('queued');
      expect(Object.isFrozen(event.sources[0])).to.equal(true); expect(snapshot(store).evidenceClass).to.equal('sink-admitted'); expect(snapshot(store).detail).to.include('render unknown').and.include('graph revision unknown');
    } finally { store.dispose(); }
  });
  it('does not infer an absent fact or attach mismatching generation, batch or intent receipts', () => {
    const store = fixture(), value = input(); value.batch.facts = [];
    value.receipts = ['generation', 'batchId', 'intentId'].map(key => ({ ...input().receipts[0], [key]: key === 'generation' ? 2 : 'another' }));
    try { store.observe(value); const evidence = read(store); expect(evidence.record.completeness).to.equal('partial'); expect(evidence.record.events[0].sources[0].recorded).to.equal(false);
      expect(evidence.record.events[0].receipts).to.have.length(0); expect(snapshot(store).evidenceClass).to.equal('intent-observed'); }
    finally { store.dispose(); }
  });
  it('only applies late submissions to the retained exact sink and execution epoch', () => {
    const store = fixture(), value = input(); value.receipts[0].targetTimeDomain = 'performance-microseconds'; value.receipts[0].sinkId = 'midi';
    try { store.observe(value); const receipt = { ...value.receipts[0], stage: 'submitted' };
      for (const changed of [{ executionEpoch: 'audio:2' }, { sinkId: 'other' }, { batchId: 'old' }, { generation: 0 }]) expect(store.receipt(value.sourceKey, { ...receipt, ...changed })).to.equal(false);
      expect(store.receipt('another-source', receipt)).to.equal(false); expect(store.receipt(value.sourceKey, receipt)).to.equal(true);
      expect(snapshot(store, { page: 'output' })).to.include({ evidenceClass: 'api-submitted', bottom: 'MIDI API submitted; receiver unknown' });
    } finally { store.dispose(); }
  });
  it('keeps reused actor indices and changed source generations from rebinding historical causes', () => {
    const store = fixture(); try { store.observe(input()); expect(store.read(lane.id, 'document:world:2').record).to.equal(null);
      store.observe(input({ sourceKey: 'document:world:2', intents: [], receipts: [] })); expect(read(store).record).to.equal(null); expect(store.read(lane.id, 'document:world:2').record).to.equal(null); }
    finally { store.dispose(); }
  });
  it('bounds fanout, retained lanes and source references and reports every omitted range', () => {
    const store = fixture({ maximumLanes: 1 }), value = input();
    value.intents = Array.from({ length: 600 }, (_, index) => ({ ...value.intents[0], intentId: 'intent-' + index, sourceEventIds: Array.from({ length: 20 }, (_, source) => 'fact-' + source) }));
    try { expect(() => store.setLanes(['lane-1', 'lane-2'])).to.throw(); store.observe(value);
      expect(read(store).record.events).to.have.length(4); expect(read(store).record.events[0].sources).to.have.length(4); expect(read(store).record.events[0].omittedSources).to.equal(16);
      expect(read(store).omitted).to.equal(596); expect(read(store).record.completeness).to.equal('partial'); store.setLanes(['lane-2']); expect(store.diagnostics().lanes).to.equal(0);
    } finally { store.dispose(); }
  });
  it('records receipt overflow without claiming complete coverage', () => {
    const store = fixture(), value = input(); value.receipts = Array.from({ length: 10 }, (_, index) => ({ ...value.receipts[0], sinkId: 'sink-' + index }));
    try { store.observe(value); expect(read(store).record.events[0].receipts).to.have.length(4); expect(read(store).record.events[0].omittedReceipts).to.equal(6); expect(read(store).record.completeness).to.equal('partial'); }
    finally { store.dispose(); }
  });
  it('marks a newly capped late receipt range partial without rebinding to a different execution', () => {
    const store = fixture(), value = input(); value.receipts = Array.from({ length: 4 }, (_, index) => ({ ...value.receipts[0], stage: 'stage-' + index }));
    try { store.observe(value); expect(read(store).record.completeness).to.equal('complete'); expect(store.receipt(value.sourceKey, { ...value.receipts[0], stage: 'submitted' })).to.equal(true);
      expect(read(store).record.completeness).to.equal('partial'); expect(read(store).record.events[0].omittedReceipts).to.equal(1); expect(read(store).record.events[0].receipts).to.have.length(4); }
    finally { store.dispose(); }
  });
  it('admits owned storage lazily and retires it without modifying input data or output owners', () => {
    const budget = createResourceBudget({ limitBytes: 1048576, costFactors: { checkpoint: 1 } }), store = fixture({ resourceBudget: budget, maximumLanes: 1 });
    const value = input(), before = JSON.stringify(value); expect(budget.diagnostics().residentBytes).to.equal(0);
    store.observe(value); expect(JSON.stringify(value)).to.equal(before); expect(budget.diagnostics().residentBytes).to.equal(131072); store.dispose(); store.dispose(); expect(budget.diagnostics().residentBytes).to.equal(0);
  });
  it('shows denied display storage as unavailable while observation remains a safe optional consumer', () => {
    const store = fixture({ resourceBudget: createResourceBudget({ limitBytes: 4096 }), maximumLanes: 1 });
    try { expect(store.observe(input())).to.equal(false); expect(read(store)).to.include({ available: false, reason: 'Display evidence storage unavailable', record: null }); expect(snapshot(store).priority).to.equal('blocked'); }
    finally { store.dispose(); }
  });
});

describe('truthful lane display pages', () => {
  it('keeps intentional output-off and preparation distinct from lost output without masking manual pages', () => {
    const store = fixture();
    try {
      store.observe(input()); const options = { page: 'cause', simulation: { state: 'paused' }, mix: { outputState: 'output-disconnected' }, operational: { noteOutput: { state: 'not-selected' }, localBackend: { enabled: false, state: 'idle' } } };
      const off = snapshot(store, options); expect(off).to.include({ priority: 'ordinary', outputState: 'local-output-off' }); expect(off.top).to.include('actor 7'); expect(off.detail).to.include('world paused; output local output off');
      expect(snapshot(store, { ...options, page: 'identity' }).top).to.equal('World paused · OFF');
      expect(snapshot(store, { ...options, operational: { noteOutput: { state: 'not-selected' }, localBackend: { enabled: false, state: 'starting' } } })).to.include({ priority: 'ordinary', outputState: 'output-preparing' });
      expect(snapshot(store, { ...options, operational: { noteOutput: { state: 'selected' } } })).to.include({ priority: 'ordinary', outputState: 'midi-output-off' });
      expect(snapshot(store, { ...options, operational: { noteOutput: { state: 'lost' } } })).to.include({ priority: 'blocked', outputState: 'output-disconnected' });
      expect(snapshot(store, { ...options, operational: { noteOutput: { state: 'not-selected' }, localBackend: { state: 'interrupted', enabled: false } } })).to.include({ priority: 'blocked', outputState: 'local-output-error' });
    } finally { store.dispose(); }
  });
  it('exposes the frozen target, source revisions and qualified receipt timing without substituting the current patch', () => {
    const store = fixture();
    try {
      store.observe(input()); const value = snapshot(store, { revision: 40, lane: { ...lane, instrumentPatchId: 'new-current-patch' } });
      expect(value).to.include({ projectRevision: 40, evidenceRevision: 1, patchIdentity: 'new-current-patch' });
      expect(value.detail).to.include('Frozen intent pitch 6000 cents; velocity 0.7').and.include('target 400 audio-frame; execution audio:1').and.include('graph revision unknown');
    } finally { store.dispose(); }
  });
  it('restores a manually selected page after an active parameter draft ends', () => {
    const store = fixture(); try { store.observe(input()); const selected = { page: 'cause' };
      expect(snapshot(store, selected).top).to.include('actor 7'); expect(snapshot(store, { ...selected, activeControl: { name: 'Level', value: '-' } })).to.include({ priority: 'edit', top: 'Level', bottom: '- · draft', displayPage: 'cause' });
      expect(snapshot(store, selected).top).to.include('actor 7'); }
    finally { store.dispose(); }
  });
  it('prioritizes output blockers and rejected admission over an active edit', () => {
    const store = fixture(), value = input(); value.receipts[0] = { ...value.receipts[0], status: 'rejected', reason: 'voice-budget' };
    try { store.observe(value); const result = snapshot(store, { activeControl: { name: 'Level', value: '2' } }); expect(result).to.include({ priority: 'blocked', evidenceClass: 'rejected', top: 'Intent rejected', glyph: '×' }); expect(result.bottom).to.equal('Rejected: voice-budget');
      expect(snapshot(store, { mix: { outputState: 'solo-suppressed' } }).top).to.equal('solo suppressed'); }
    finally { store.dispose(); }
  });
  it('keeps historical ticks and unknown level/audio/receiver values without an animation clock', () => {
    const store = fixture(); try { store.observe(input()); store.observe(input({ batch: { ...input().batch, batchId: 'world:1:50', tick: 50 }, intents: [], receipts: [] }));
      const value = snapshot(store, { page: 'cause' }); expect(value).to.include({ sourceTick: 10, ageTicks: 40, stale: true }); expect(value.bottom).to.include('stale'); expect(value.meter).to.deep.equal({ source: 'unavailable', peak: null, rms: null });
      expect(snapshot(store, { page: 'parameter', parameter: { parameter: 'sustain', requestedValue: 127, submittedValue: null } }).bottom).to.equal('API unknown · receiver unknown'); }
    finally { store.dispose(); }
  });
  it('does not turn terminal, semantic or unqualified submitted receipts into output admission', () => {
    const store = fixture(); try { for (const stage of ['voice-terminal', 'semantic-observation', 'submitted', 'rendered']) { const value = input(); value.receipts[0].stage = stage; store.observe(value); expect(snapshot(store).evidenceClass).to.equal('intent-observed'); } }
    finally { store.dispose(); }
  });
});
