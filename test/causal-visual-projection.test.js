import { expect } from 'chai';
import { createProcgenPresentationSnapshot } from '../js/app/procgen/ProcgenPresentationSnapshot.js';
import { projectCausalHistory, explainCausalVisual, causalIntentOutcome, causalActionGlyph } from '../js/app/procgen/workstation/CausalVisualProjection.js';

const presentation = (extra = {}) => createProcgenPresentationSnapshot({ worldId: 'world', generation: 1, tick: 20, terrainRevision: 0, revision: 1, projectionRevision: 1,
  rect: { left: 20, top: 30, width: 800, height: 400 }, backingSize: { width: 800, height: 400 }, logicalSize: { width: 400, height: 200 }, originX: 0, viewWidth: 200, laneHeight: 100, layoutKey: 'strip',
  rows: [{ lane: 0, sourceY: 0, sourceHeight: 100, destinationY: 0, destinationHeight: 180 }], ...extra });
const source = (eventId = 'fact-1', extra = {}) => ({ eventId, recorded: true, tick: 10, kind: 'TerrainWorkCommitted', action: 'build', actorId: 7, laneIndex: 0, point: { x: 100, y: 20, evidence: 'observed-startpoint' }, ...extra });
const intent = (intentId = 'intent-1', extra = {}) => ({ intentId, batchId: 'batch-10', worldId: 'world', generation: 1, tick: 10, laneId: 'lane-1', laneIndex: 0, actorId: 7, actorState: 'past-reference', voiceId: 'voice-1', mappingId: 'mapping-1', graphRevision: null,
  kind: 'begin', pitchCents: 6000, velocity01: 0.75, sources: [source()], receipts: [], omittedSources: 0, omittedReceipts: 0, ...extra });
const displays = events => [{ lane: { id: 'lane-1' }, mix: {}, evidence: { history: events, omitted: 0, historyOmitted: 0, historyExpired: 0 } }];
const project = (events, options = {}) => projectCausalHistory({ displays: displays(events), presentation: presentation(), ...options });

describe('world-projected historical causal marks', () => {
  it('uses observed coordinates through the accepted CSS-scaled row projection rather than current actor pose', () => {
    const value = project([intent()]); expect(value.marks).to.have.length(1); expect(value.marks[0]).to.include({ x: 420, y: 102, count: 1 });
    expect(value.marks[0].causes[0]).to.include({ eventId: 'fact-1', actorId: 7, glyph: '▱' }); expect(value.marks[0].causes[0].point).to.deep.equal(source().point);
    expect(causalActionGlyph({ kind: 'ContactSpanBegan', action: 'walking' })).to.equal('▽'); expect(causalActionGlyph({ kind: 'GateCrossed', action: 'building' })).to.equal('↦');
    const moved = project([intent()], { presentation: presentation({ originX: 50, projectionRevision: 2 }) }); expect(moved.marks[0].x).to.equal(220); expect(moved.projectionRevision).to.equal(2);
  });
  it('requires the exact world/generation and a source tick already visible in the accepted frame', () => {
    for (const change of [{ worldId: 'other' }, { generation: 2 }]) { const value = project([intent('i', change)]); expect(value.marks).to.have.length(0); expect(value.summary.sourceMismatch).to.equal(1); }
    const future = project([intent('future', { sources: [source('future', { tick: 21 })] })]); expect(future.marks).to.have.length(0); expect(future.summary.pending).to.equal(1);
    expect(project([intent()], { presentation: null }).summary.pending).to.equal(1);
  });
  it('keeps identical replay IDs in separate physical runtime bindings', () => {
    const first = project([intent('same', { sourceKey: 'binding-1' })]), replay = project([intent('same', { sourceKey: 'binding-2' })]);
    expect(first.causes[0].key).not.to.equal(replay.causes[0].key); expect(explainCausalVisual(first.causes[0])).to.include('Source binding: binding-1');
  });
  it('keeps missing or cropped coordinates available as text without nearest-actor or lane-center marks', () => {
    for (const point of [null, { x: 201, y: 20 }, { x: 100, y: 101 }]) {
      const value = project([intent('i', { sources: [source('fact', { point })] })]); expect(value.causes).to.have.length(1); expect(value.marks).to.have.length(0);
      expect(value.summary.unlocated + value.summary.outside).to.equal(1);
    }
    const unknown = project([intent('i', { sources: [source('missing', { recorded: false, point: null })] })]); expect(explainCausalVisual(unknown.causes[0])).to.include('no nearest-actor fallback');
  });
  it('counts distinct dense physical facts and retains fanout/fanin identities for drilldown', () => {
    const first = intent(), second = intent('intent-2', { voiceId: 'voice-2', sources: [source(), source('fact-2', { actorId: 9, point: { x: 101, y: 20, evidence: 'observed-endpoint' } })] });
    const value = project([first, second]); expect(value.causes).to.have.length(2); expect(value.marks).to.have.length(1); expect(value.marks[0].count).to.equal(2);
    expect(value.causes[0].intents.map(value => value.intentId)).to.deep.equal(['intent-1', 'intent-2']); expect(value.causes[1].intents[0].sources).to.have.length(2);
    expect(explainCausalVisual(value.causes[0], 1)).to.include('intent-2').and.include('fact-1, fact-2');
  });
  it('does not collapse equal-pitch actors or confuse submission, degradation, cancellation and render evidence', () => {
    const submitted = { status: 'accepted', stage: 'submitted', targetTimeDomain: 'performance-microseconds', targetFrame: 5000, executionEpoch: 'midi-epoch', sinkId: 'midi' };
    const events = [intent('i1', { receipts: [submitted] }), intent('i2', { actorId: 9, sources: [source('fact-2', { actorId: 9 })], receipts: [{ ...submitted, status: 'rejected', reason: 'voice-budget' }] })];
    const value = project(events); expect(value.causes[0].outcome).to.equal('api-submitted'); expect(value.causes[1].outcome).to.equal('rejected'); expect(value.marks[0].count).to.equal(2);
    const text = explainCausalVisual(value.causes[0]); expect(text).to.include('frozen pitch 6000 cents').and.include('historical graph revision unknown').and.include('target 5000 performance-microseconds; execution midi-epoch').and.include('API submission is not acoustic evidence');
    expect(causalIntentOutcome(intent('degraded', { receipts: [submitted, { ...submitted, status: 'degraded' }] }))).to.equal('degraded');
    expect(causalIntentOutcome(intent('mixed', { receipts: [submitted, { ...submitted, sinkId: 'local', status: 'rejected' }] }))).to.equal('mixed');
    expect(causalIntentOutcome(intent('cancelled', { receipts: [{ terminalState: 'cancelled' }] }))).to.equal('cancelled');
    expect(causalIntentOutcome(intent('semantic', { receipts: [{ status: 'accepted', stage: 'semantic-observation', outputRequested: false }] }))).to.equal('unconfirmed');
  });
  it('keeps terminated actors as historical references and current mute separate from past submission', () => {
    const value = project([intent('past', { actorState: 'terminated' })], { displays: [{ mix: { mute: true }, evidence: { history: [intent('past', { actorState: 'terminated' })] } }] });
    expect(value.marks[0].causes[0].actorState).to.equal('terminated'); expect(explainCausalVisual(value.causes[0])).to.include('actor 7 (terminated)').and.include('Current lane mix: muted');
  });
  it('bounds marks without silently losing dense identities or eviction/expiry summaries', () => {
    const events = Array.from({ length: 12 }, (_, index) => intent('i-' + index, { sources: [source('f-' + index, { point: { x: index * 16, y: 40, evidence: 'observed-endpoint' } })] }));
    const value = project(events, { maximumMarks: 2 }); expect(value.causes).to.have.length(12); expect(value.marks).to.have.length(2); expect(value.summary.omitted).to.be.greaterThan(0);
    const bounded = project(events, { displays: [{ evidence: { history: events, historyOmitted: 5, historyExpired: 7, omitted: 9 } }] }); expect(bounded.summary).to.include({ historyOmitted: 5, expired: 7, omitted: 9 });
  });
});
