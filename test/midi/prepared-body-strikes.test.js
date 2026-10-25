import { expect } from 'chai';
import { createCausalMusicEngine, validateCausalInstrumentGraph } from '../../js/app/procgen/workstation/CausalMusicEngine.js';
import { createPreparedBodyStrikeBackend } from '../../js/app/procgen/workstation/PreparedBodyStrikeBackend.js';
import { preparedBodyIdentity } from '../../js/midi/content/PreparedSurface.js';
import { planPreparedBodyStrike } from '../../js/midi/content/PreparedBodyStrike.js';
import { createRectangularMembraneRecipe } from '../../js/midi/content/RectangularMembraneRecipe.js';
import { createOwnedEffectGraphKernel } from '../../js/app/midi-ui/OwnedEffectGraphKernel.js';
import { prepareCapturedEffectReplay } from '../../js/app/midi-ui/CapturedEffectReplay.js';
import { validateEffectPerformance } from '../../js/midi/content/EffectPerformance.js';
import { renderCausalOwnedTake } from '../../js/app/midi-ui/CausalOwnedRender.js';
import { describeNativeInstrumentEngines } from '../../js/app/midi-ui/NativeInstrumentSchema.js';
import { createEffectPerformanceCapture } from '../../js/app/procgen/workstation/EffectPerformanceCapture.js';

const surfaceMap = { id: 'map', revision: 1, regionInstanceId: 'region', sourceEditRevision: 0, boundTopologyRevision: 0, bounds: { x1: 0, y1: 0, x2: 100, y2: 100 } };
const surface = { schema: 'lemmings-prepared-surface/v1', id: 'skin', revision: 1, surfaceMap, heldContactPolicy: 'keep-old-tail', unknownPolicy: 'release', preparations: [{ id: 'loss', kind: 'touch', sourceLanes: [0], actions: ['blocking'], beginPolicy: 'current-observed-contact', radius01: 0.18, amount01: 0.5 }] };
const strikeMapping = { surfaceId: 'skin', surfaceRevision: 1, pulseMilliseconds: 8, amplitudeScale01: 0.8, pitchPolicy: 'fixed-prepared-body' };
const instrument = id => ({ id, sourceKind: 'ContactSpanBegan', pitchCents: 6000, velocity01: 0.6, role: 'finite-contact', route: 'prepared-body', preparedBodyStrike: strikeMapping });
function intentsFor(count = 1) {
  const mapping = { version: 1, revision: 1, preparedSurfaces: [surface], instruments: Array.from({ length: count }, (_, index) => instrument('strike-' + index)) }, engine = createCausalMusicEngine({ getGraph: () => mapping });
  const batch = { version: 1, worldId: 'world', generation: 1, batchId: 'batch', tick: 1, sourceTimeMs: 100, tickDurationMs: 40, terrainRevisionBefore: 0, terrainRevisionAfter: 0, completeness: { status: 'complete', dropped: 0 },
    facts: [{ kind: 'ContactSpanBegan', eventId: 'contact', causalSequence: 1, actorId: 7, laneId: 0, worldId: 'world', generation: 1, spanId: 'span', action: 'blocking', actionInstanceId: 'action', observedTick: 1, causeKind: 'support', surfaceRevision: 0, anchor: { x: 25, y: 70 }, positionAfter: { x: 25, y: 69 }, physicalPayload: { evidence: 'completed-support-cell' } }] };
  const intents = engine.processBatch(batch); engine.dispose(); return intents.filter(intent => intent.kind === 'begin');
}
async function fixture() {
  const graph = await createOwnedEffectGraphKernel({ definition: createRectangularMembraneRecipe().graph }), profile = graph.plan.nodes.find(node => node.membrane).membrane;
  const identity = await preparedBodyIdentity({ documentEpoch: 'document', executionEpoch: 'execution', worldId: 'world', generation: 1, surfaceId: 'skin', surfaceRevision: 1, surfaceMap, owner: 'owner', ownerGeneration: 0, ownerRouteRevision: 1, graphDefinitionHash: graph.hash, nodeId: 'skin', processorRevision: profile.revision });
  const body = { ...identity, sampleRate: 48000, pulses: profile.pulses.map(pulse => ({ frames: pulse.frames, milliseconds: pulse.milliseconds })) };
  let listener, present = true; const commands = [], receipts = [];
  const backend = createPreparedBodyStrikeBackend({ owner: 'fixture', resolveBody: () => present ? body : null, inventory: () => present ? [body] : [],
    observe: value => { listener = value; return () => { listener = null; }; }, enqueue: (nodeId, command) => { commands.push(command); return graph.enqueueBodyStrike(nodeId, command); }, panicBody() { graph.panic(); return { status: 'accepted' }; }, onReceipt: value => receipts.push(value) });
  return { graph, profile, body, backend, commands, receipts, deliver: receipt => listener({ ...receipt, owner: body.owner, ownerGeneration: body.ownerGeneration, ownerRouteRevision: body.ownerRouteRevision, graphDefinitionHash: body.graphDefinitionHash, nodeId: 'skin' }), retire() { present = false; } };
}
describe('observed contact sources into exact persistent bodies', () => {
  it('keeps two intentional mappings from one contact as two sources and uses their actual mapped point', async () => {
    const f = await fixture(), intents = intentsFor(2), execution = f.backend.registerExecution({ executionEpoch: 'execution', generation: 1 }).execution;
    expect(intents).to.have.length(2);
    for (const intent of intents) expect(f.backend.begin(intent, 4800, execution).status).to.equal('accepted');
    expect(f.commands).to.have.length(2); expect(f.commands[0]).to.include({ x01: 0.25, y01: 0.7, amplitude01: 0.48 }); expect(f.commands[0].token).not.to.equal(f.commands[1].token);
    for (const intent of intents) expect(f.backend.end(intent.voiceId, {}, 4800, execution).status).to.equal('accepted');
    expect(f.backend.diagnostics()).to.include({ pendingExciters: 2, semanticGates: 0 });
    for (let frame = 0; frame < 5500; frame++) f.graph.sample(0, 0);
    expect(f.graph.diagnostics().membraneStates[0].energy).to.be.greaterThan(0); f.retire(); const retirement = f.backend.dispose(); await retirement.completion; expect(retirement.outcome).to.equal('complete');
  });
  it('declines a stale map, foreign execution, unsupported tuning composition and a fifth simultaneous source', async () => {
    const f = await fixture(), [intent] = intentsFor(), execution = f.backend.registerExecution({ executionEpoch: 'execution', generation: 1 }).execution;
    expect(() => planPreparedBodyStrike({ ...intent, preparedBodyStrike: { ...strikeMapping, surfaceRevision: 2 } }, f.body, 0, 1)).to.throw('exact observed contact');
    expect(() => validateCausalInstrumentGraph({ version: 1, revision: 1, preparedSurfaces: [surface], instruments: [{ ...instrument('bad'), route: 'local' }] })).to.throw('Finite body');
    for (let index = 0; index < 4; index++) expect(f.backend.begin({ ...intent, intentId: 'i-' + index, voiceId: 'v-' + index, onsetId: 'v-' + index }, 4800, execution).status).to.equal('accepted');
    expect(f.backend.begin({ ...intent, intentId: 'fifth', voiceId: 'fifth', onsetId: 'fifth' }, 4800, execution).reason).to.equal('finite-body-exciter-capacity');
    f.retire(); await f.backend.dispose().completion;
  });
  it('retains a finite child until an exact receipt or actual body retirement after semantic end', async () => {
    const f = await fixture(), [intent] = intentsFor(), execution = f.backend.registerExecution({ executionEpoch: 'execution', generation: 1 }).execution;
    f.backend.begin(intent, 4800, execution); f.backend.end(intent.voiceId, {}, 4800, execution); const retired = f.backend.retireExecution(execution); expect(retired.outcome).to.equal('pending');
    f.deliver({ status: 'accepted', stage: 'body-strike-applied', token: 1, targetFrame: 4800, appliedFrame: 4800, applicationEvidence: 'processor-frame-acknowledged' }); expect(f.backend.diagnostics().pendingExciters).to.equal(1);
    f.deliver({ status: 'accepted', stage: 'body-strike-ended', token: 1, targetFrame: 4800, observedFrame: 5184, reasonCode: 0 }); await retired.completion; expect(retired.outcome).to.equal('complete'); await f.backend.dispose().completion;
  });
});

describe('captured finite-source revoice', () => {
  async function sourceFixture() {
    const f = await fixture(), [intent] = intentsFor(), plan = planPreparedBodyStrike(intent, f.body, 4800, 1), base = { schema: 'lemmings-effect-performance/v1', status: 'accepted', stage: 'effect-performance-captured', streamId: 'body-stream', ownerRouteRevision: 1, graphDefinitionHash: f.graph.hash, sampleRate: 48000, targetFrame: 4800, executionEpoch: 'execution', clockAnchor: { intentId: intent.intentId, sourceTargetFrame: 4800, executionEpoch: 'execution' }, sourceEventIds: [], acousticReceipt: false };
    const source = { operation: 'sound-only-revoice', version: 1, takeId: 'take:body', takeRevision: 1, sourceCanonicalHash: 'c'.repeat(64), sourceState: 'finalized', nextSequence: null, sourceVersions: { physicalMusic: 12 },
      coverage: { status: 'known-covered' }, boundary: { status: 'captured-initial-state', state: { voices: [], sourceTimeMs: 0 } }, finalBoundaryState: { sourceTimeMs: 500 }, effectCoverage: { captured: true, gaps: [] },
      intents: [intent, { ...intent, kind: 'end', intentId: 'body:end', terminationReason: 'one-shot', articulationState: null, scoreTime: { sourceTimeMs: 140, subTick: 0 } }], effectEvents: [
        { ...base, operation: 'graph', sequence: 1, targetFrame: 1000, definition: f.graph.plan.definition },
        { ...base, operation: 'body-strike', sequence: 2, nodeId: 'skin', sourceEventIds: intent.sourceEventIds, strike: { ...plan.source, x01: 0.25, y01: 0.7, amplitude01: 0.48, pulseMilliseconds: 8, applicationEvidence: 'processor-frame-acknowledged' } }
      ] };
    f.retire(); await f.backend.dispose().completion; return source;
  }
  it('renders one original finite force with no extra dry oscillator and preserves it across a source state cut', async () => {
    const source = await sourceFixture(), replay = await prepareCapturedEffectReplay(source, 48000, 12000), [descriptor] = await describeNativeInstrumentEngines([{ engineId: 'worklet-sine', engineVersion: 1, artifactHash: 'a'.repeat(64) }]);
    const definition = { schemaVersion: 2, id: 'body.fixture', revision: 1, name: 'Body fixture', author: 'Fixture', tags: [], engineId: 'worklet-sine', engineVersion: 1, parameters: { attackSeconds: 0.005, decaySeconds: 0, sustain01: 1, releaseSeconds: 0.01 }, sampleRefs: [], modulations: [], macros: [], causalBindings: [], voicePolicy: { maxVoices: 2, steal: 'reject' }, mix: { gain01: 0.7, pan01: 0 } };
    const input = { definition, descriptor, revoice: source, sampleRate: 48000, startSeconds: 0.12, endSeconds: 0.25, capturedEffects: true, effectReplayHash: replay.hash, effectGraph: replay.definition, tail: { mode: 'exact-crop' } };
    const a = await renderCausalOwnedTake(input, { yieldControl: async () => {} }), b = await renderCausalOwnedTake({ ...input, restorationMode: 'owned-state-cut' }, { yieldControl: async () => {} });
    expect(a.manifest.commands).to.include({ capturedBegins: 1, acknowledgedFiniteBodyBegins: 1, submitted: 0, peakVoices: 0 }); expect(a.manifest.effectGraph.realization.membraneStates[0].strikes.applied).to.equal(1);
    expect(a.manifest.effectGraph.realization.membraneStates[0].energy).to.be.greaterThan(0); expect(a.files.map(file => file.manifest.pcmHash)).to.deep.equal(b.files.map(file => file.manifest.pcmHash));
  });
  it('rejects forged source identities, unknown application evidence and duplicate captured onsets', async () => {
    const source = await sourceFixture(), packet = source.effectEvents[1]; expect(() => validateEffectPerformance({ ...packet, strike: { ...packet.strike, applicationEvidence: 'API-submitted' } })).to.throw();
    source.effectEvents.push({ ...packet, sequence: 3 }); let error; try { await prepareCapturedEffectReplay(source, 48000, 12000); } catch (caught) { error = caught; } expect(error.code).to.equal('effect-body-source-identity');
  });
});

describe('effect metadata before the first actual source clock anchor', () => {
  it('retains bounded graph and control metadata and flushes it in original order at the first real anchor', () => {
    const context = {}, receipts = [], reservations = new Map(); let anchor = null;
    const capture = createEffectPerformanceCapture({ owner: 'fixture', streamId: 'stream', getContext: () => context, getExecutionEpoch: () => 'execution', getAnchor: () => anchor, isEnabled: () => true, onReceipt: value => receipts.push(value),
      resourceBudget: { reserve: ({ token, bytes }) => { reservations.set(token, bytes); return true; }, release: ({ token }) => { reservations.delete(token); return true; } } });
    const state = { ownerRouteRevision: 1, graphDefinitionHash: 'a'.repeat(64), sampleRate: 48000, targetFrame: 1000 };
    capture.capture('graph', state, { definition: createRectangularMembraneRecipe().graph }); capture.capture('control', { ...state, targetFrame: 1100 }, { nodeId: 'skin', values: { damp01: 0.5 } });
    expect(receipts).to.have.length(0); expect(capture.state().pendingUnanchored).to.equal(2); expect(reservations.size).to.equal(1);
    anchor = { intentId: 'actual-source', sourceTargetFrame: 4800, executionEpoch: 'execution' }; capture.flush();
    expect(receipts.map(value => value.sequence)).to.deep.equal([1, 2]); expect(receipts.map(value => value.targetFrame)).to.deep.equal([1000, 1100]); expect(receipts[0].clockAnchor).to.deep.equal(anchor); expect(reservations.size).to.equal(0); capture.dispose();
  });
  it('marks an unanchored context replacement as missing effect coverage without borrowing another clock', () => {
    let context = {}, anchor = null; const receipts = [], capture = createEffectPerformanceCapture({ owner: 'fixture', streamId: 'stream', getContext: () => context, getExecutionEpoch: () => 'execution', getAnchor: () => anchor, isEnabled: () => true, onReceipt: value => receipts.push(value) });
    capture.capture('graph', { ownerRouteRevision: 1, graphDefinitionHash: 'a'.repeat(64), sampleRate: 48000, targetFrame: 1000 }, { definition: createRectangularMembraneRecipe().graph });
    context = {}; anchor = { intentId: 'new-context-source', sourceTargetFrame: 4800, executionEpoch: 'execution' }; capture.flush();
    expect(receipts).to.have.length(1); expect(receipts[0]).to.include({ status: 'rejected', stage: 'effect-performance-capture', reason: 'effect-capture-clock-owner-changed' }); capture.dispose();
  });
});
