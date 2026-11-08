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
  it('tombstones an individual source actor in a shared intent without retiring its other source or voice owner', () => {
    const store = fixture(), value = input(); value.batch.facts.push({ ...value.batch.facts[0], eventId: 'fact-2', actorId: 9 }); value.intents[0].actorId = null; value.intents[0].sourceEventIds = ['fact-1', 'fact-2'];
    try { store.observe(value); store.observe(input({ batch: { ...value.batch, batchId: 'terminal', tick: 11, facts: [{ eventId: 'terminal', kind: 'ActorTerminated', actorId: 7 }] }, intents: [], receipts: [] }));
      const event = read(store).history[0]; expect(event.actorState).to.equal('past-reference'); expect(event.sources[0]).to.include({ actorId: 7, actorState: 'terminated', terminationTick: 11 }); expect(event.sources[1]).to.include({ actorId: 9, actorState: 'past-reference', terminationTick: null });
      store.observe(input({ batch: { ...value.batch, batchId: 'terminals', tick: 12, facts: [{ eventId: 'repeat-terminal', kind: 'ActorTerminated', actorId: 7 }, { eventId: 'next-terminal', kind: 'ActorTerminated', actorId: 9 }] }, intents: [], receipts: [] }));
      expect(read(store).history[0].sources.map(source => source.terminationTick)).to.deep.equal([11, 12]);
    } finally { store.dispose(); }
  });
  it('joins producer mapping metadata only to the exact constructed intent and never substitutes the current project revision', () => {
    const store = fixture(), value = input(), provenance = { version: 1, intentId: 'intent-1', batchId: 'world:1:10', generation: 1, mappingId: 'map-1', graphRevision: 3, mappingRevision: 1, evidence: 'canonical-intent-construction' };
    try { store.observe({ ...value, provenances: [provenance] }); expect(read(store).record.events[0]).to.include({ graphRevision: 3, mappingRevision: 1 }); expect(snapshot(store, { revision: 40 }).detail).to.include('graph revision 3; definition revision 1');
      for (const changed of [{ batchId: 'foreign' }, { generation: 2 }, { mappingId: 'another' }, { graphRevision: -1 }, { mappingRevision: 4 }]) { store.observe({ ...value, provenances: [{ ...provenance, ...changed }] }); expect(read(store).record.events[0]).to.include({ graphRevision: null, mappingRevision: null, mappingEvidence: 'unrecorded' }); }
      store.observe({ ...value, provenances: [provenance, { ...provenance, graphRevision: 4 }] }); expect(read(store).record.events[0].graphRevision).to.equal(null);
      expect(store.observe({ ...value, provenances: null })).to.equal(false);
    } finally { store.dispose(); }
  });
  it('retains immutable observed points and a terminal tombstone without looking up current actors', () => {
    const store = fixture(), value = input(); value.batch.worldId = 'world'; value.batch.facts[0].positionBefore = { x: 100, y: 50 };
    try { store.observe(value); value.batch.facts[0].positionBefore.x = 900;
      expect(read(store).history[0].sources[0].point).to.deep.equal({ x: 100, y: 50, evidence: 'observed-startpoint' });
      store.observe(input({ batch: { ...value.batch, batchId: 'terminal', tick: 11, facts: [{ eventId: 'terminal-fact', actorId: 7, kind: 'ActorTerminated' }] }, intents: [], receipts: [] }));
      expect(read(store).history[0]).to.include({ actorState: 'terminated', terminationTick: 11 }); expect(read(store).history[0].sources[0].point.x).to.equal(100);
    } finally { store.dispose(); }
  });
  it('bounds and expires causal history independently of the last OLED cause and fences out-of-order/source-reused data', () => {
    const store = fixture({ maximumHistory: 2, historyTicks: 3 });
    try { for (let tick = 10; tick < 14; tick++) { const value = input(); value.batch.tick = tick; value.batch.batchId = 'b-' + tick; value.intents[0].intentId = 'i-' + tick; value.intents[0].batchId = value.batch.batchId; store.observe(value); }
      expect(read(store).history.map(value => value.intentId)).to.deep.equal(['i-12', 'i-13']); expect(read(store).historyOmitted).to.equal(2);
      expect(store.observe(input())).to.equal(false); expect(read(store).latestTick).to.equal(13);
      store.observe(input({ batch: { ...input().batch, tick: 20 }, intents: [], receipts: [] })); expect(read(store).history).to.have.length(0); expect(read(store).record.events[0].intentId).to.equal('i-13'); expect(read(store).historyExpired).to.equal(2);
      expect(store.read(lane.id, 'another-document').history).to.have.length(0);
    } finally { store.dispose(); }
  });
  it('accepts a late receipt only for a retained historical execution after a newer cause arrived', () => {
    const store = fixture();
    try { const first = input(); store.observe(first); const next = input(); next.batch.tick = 11; next.batch.batchId = 'next'; next.intents[0].batchId = 'next'; next.intents[0].intentId = 'next-intent'; store.observe(next);
      expect(store.receipt(first.sourceKey, { ...first.receipts[0], stage: 'submitted' })).to.equal(true); expect(read(store).history[0].receipts.some(value => value.stage === 'submitted')).to.equal(true);
      expect(read(store).record.events[0].intentId).to.equal('next-intent'); expect(read(store).record.events[0].receipts.some(value => value.stage === 'submitted')).to.equal(false);
    } finally { store.dispose(); }
  });
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
    const budget = createResourceBudget({ limitBytes: 1048576, costFactors: { checkpoint: 1 } }), store = fixture({ resourceBudget: budget, maximumLanes: 1, maximumHistory: 4 });
    const value = input(), before = JSON.stringify(value); expect(budget.diagnostics().residentBytes).to.equal(0);
    store.observe(value); expect(JSON.stringify(value)).to.equal(before); expect(budget.diagnostics().residentBytes).to.equal(262144); store.dispose(); store.dispose(); expect(budget.diagnostics().residentBytes).to.equal(0);
  });
  it('shows denied display storage as unavailable while observation remains a safe optional consumer', () => {
    const store = fixture({ resourceBudget: createResourceBudget({ limitBytes: 4096 }), maximumLanes: 1 });
    try { expect(store.observe(input())).to.equal(false); expect(read(store)).to.include({ available: false, reason: 'Display evidence storage unavailable', record: null }); expect(snapshot(store).priority).to.equal('blocked'); }
    finally { store.dispose(); }
  });
});

describe('truthful lane display pages', () => {
  it('keeps a rejected local path and successful MIDI submission as mixed sink outcomes rather than universal failure', () => {
    const store = fixture(), value = input(); value.receipts[0] = { ...value.receipts[0], status: 'rejected', reason: 'clock-unavailable' };
    value.receipts.push({ ...value.receipts[0], sinkId: 'midi', status: 'accepted', stage: 'submitted', reason: null, targetTimeDomain: 'performance-microseconds' });
    try { store.observe(value); const result = snapshot(store, { page: 'output' }); expect(result).to.include({ evidenceClass: 'mixed', priority: 'ordinary', glyph: '±' }); expect(result.detail).to.include('One sink rejected: clock-unavailable').and.include('MIDI API submitted; receiver unknown'); }
    finally { store.dispose(); }
  });
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
