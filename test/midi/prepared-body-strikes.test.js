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
import { RectangularMembraneKernel } from '../../js/app/midi-ui/worklet/RectangularMembraneKernel.js';
import { createMembraneStrikeTransport } from '../../js/app/midi-ui/MembraneStrikeTransport.js';
import { createLaneDisplayEvidence } from '../../js/app/procgen/workstation/LaneDisplayEvidence.js';
import { createLaneDisplaySnapshot } from '../../js/app/procgen/workstation/LaneDisplaySnapshot.js';
import { projectCausalHistory, explainCausalVisual } from '../../js/app/procgen/workstation/CausalVisualProjection.js';

const surfaceMap = { id: 'map', revision: 1, regionInstanceId: 'region', sourceEditRevision: 0, boundTopologyRevision: 0, bounds: { x1: 0, y1: 0, x2: 100, y2: 100 } };
const surface = { schema: 'lemmings-prepared-surface/v1', id: 'skin', revision: 1, surfaceMap, heldContactPolicy: 'keep-old-tail', unknownPolicy: 'release', preparations: [{ id: 'loss', kind: 'touch', sourceLanes: [0], actions: ['blocking'], beginPolicy: 'current-observed-contact', radius01: 0.18, amount01: 0.5 }] };
const strikeMapping = { surfaceId: 'skin', surfaceRevision: 1, pulseMilliseconds: 8, amplitudeScale01: 0.8, pitchPolicy: 'fixed-prepared-body' };
const instrument = id => ({ id, sourceKind: 'ContactSpanBegan', pitchCents: 6000, velocity01: 0.6, role: 'finite-contact', route: 'prepared-body', preparedBodyStrike: strikeMapping });
function causesFor(count = 1) {
  const mapping = { version: 1, revision: 1, preparedSurfaces: [surface], instruments: Array.from({ length: count }, (_, index) => instrument('strike-' + index)) }, engine = createCausalMusicEngine({ getGraph: () => mapping });
  const batch = { version: 1, worldId: 'world', generation: 1, batchId: 'batch', tick: 1, sourceTimeMs: 100, tickDurationMs: 40, terrainRevisionBefore: 0, terrainRevisionAfter: 0, completeness: { status: 'complete', dropped: 0 },
    facts: [{ kind: 'ContactSpanBegan', eventId: 'contact', causalSequence: 1, actorId: 7, laneId: 0, worldId: 'world', generation: 1, spanId: 'span', action: 'blocking', actionInstanceId: 'action', observedTick: 1, causeKind: 'support', surfaceRevision: 0, anchor: { x: 25, y: 70 }, positionAfter: { x: 25, y: 69 }, physicalPayload: { evidence: 'completed-support-cell' } }] };
  const intents = engine.processBatch(batch); engine.dispose(); return { batch, intents: intents.filter(intent => intent.kind === 'begin') };
}
const intentsFor = count => causesFor(count).intents;
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
  for (const panic of [false, true]) it(`joins actual processor-frame ${panic ? 'application then panic' : 'application and completion'} to shared-body intents without claiming actor audibility`, async () => {
    const f = await fixture(), { batch, intents } = causesFor(2), execution = f.backend.registerExecution({ executionEpoch: 'execution', generation: 1 }).execution;
    const store = createLaneDisplayEvidence(), lane = { id: 'lane-1', name: 'Shared body', mode: 'physical', gain: 1 }, sourceKey = 'document:world:1', packets = [], faults = [];
    const kernel = new RectangularMembraneKernel({ parameters: createRectangularMembraneRecipe().graph.nodes.find(node => node.kind === 'rectangular-membrane').parameters });
    const transport = createMembraneStrikeTransport({ profile: f.profile, node: { port: { postMessage: packet => packets.push(packet) } }, context: { currentTime: 0, sampleRate: 48000 }, nodeId: 'skin', graphDefinitionHash: f.graph.hash, onReceipt: f.deliver, onUnknown: error => faults.push(error) });
    try {
      store.setLanes([lane.id]); for (const intent of intents) expect(f.backend.begin(intent, 128, execution).status).to.equal('accepted');
      store.observe({ sourceKey, lanes: [lane], batch, intents, receipts: intents.map(intent => ({ intentId: intent.intentId, batchId: batch.batchId, generation: 1, sinkId: 'physical-shared-body', executionEpoch: 'execution', status: 'accepted', stage: 'scheduled', outputRequested: true, targetFrame: 128, targetTimeDomain: 'audio-sample-frames' })) });
      for (const command of f.commands) transport.enqueue(command);
      for (const packet of packets) { expect(kernel.enqueueStrike(packet.command)).to.equal(true); transport.consume({ type: 'body-strike-admission', revision: f.profile.revision, token: packet.command.token, frame: 0, accepted: true, reasonCode: 0, muted: false }); }
      for (let frame = 0; frame < (panic ? 129 : 128 + f.profile.pulses[1].frames); frame++) kernel.sample(0, 0);
      transport.consume({ type: 'body-strike-receipts', revision: f.profile.revision, data: kernel.strikes.drainReceipts() });
      if (panic) { kernel.panic(129); transport.consume({ type: 'body-strike-receipts', revision: f.profile.revision, data: kernel.strikes.drainReceipts() }); }
      transport.assertComplete(); expect(faults).to.have.length(0); if (panic) expect(kernel.energy).to.equal(0); else expect(kernel.energy).to.be.greaterThan(0);
      for (const receipt of f.receipts) { expect(receipt).to.include({ batchId: batch.batchId, generation: 1, sinkId: 'physical-shared-body', targetTimeDomain: 'audio-sample-frames', bodyInstanceId: f.body.bodyInstanceId }); expect(store.receipt(sourceKey, receipt)).to.equal(true); }
      const evidence = store.read(lane.id, sourceKey), model = projectCausalHistory({ displays: [{ mix: {}, evidence }] }); expect(model.causes).to.have.length(1); expect(model.causes[0].outcome).to.equal(panic ? 'cancelled' : 'processor-applied'); expect(model.causes[0].intents).to.have.length(2);
      for (let index = 0; index < 2; index++) { const text = explainCausalVisual(model.causes[0], index); expect(text).to.include('processor acknowledged frame 128 at 48000 Hz').and.include(f.body.bodyInstanceId).and.include('individual audibility remain unconfirmed'); }
      const snapshot = createLaneDisplaySnapshot({ lane, evidence, page: 'output' }); expect(snapshot).to.include(panic ? { evidenceClass: 'cancelled', glyph: '⊘', top: 'Intent cancelled' } : { evidenceClass: 'processor-applied', glyph: '▣' }); if (panic) expect(snapshot.bottom).to.include('Cancelled: body-strike-panic');
      const foreign = { ...f.receipts.find(receipt => receipt.stage === 'body-strike-applied'), executionEpoch: 'foreign' }; expect(store.receipt(sourceKey, foreign)).to.equal(false); expect(store.receipt('old-document', { ...foreign, executionEpoch: 'execution' })).to.equal(false);
    } finally { store.dispose(); f.retire(); await f.backend.dispose().completion; }
  });
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
