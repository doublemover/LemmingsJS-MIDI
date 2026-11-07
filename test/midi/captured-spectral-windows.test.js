import { createOwnerEffectGraphHost } from '../../js/app/midi-ui/OwnerEffectGraphHost.js';
import { createAudioResourceLeases } from '../../js/app/midi-ui/AudioResourceLeases.js';
import { createProcgenRetirementScope } from '../../js/app/procgen/ProcgenRetirement.js';
import { expect } from 'chai';
import { SpectralFreezeKernel } from '../../js/app/midi-ui/worklet/SpectralFreezeKernel.js';
import { createGlassHoldRecipe } from '../../js/midi/content/SpectralFreezeRecipes.js';
import { SPECTRAL_CAPTURE_POLICY, validateSpectralCaptureReceipt } from '../../js/midi/content/SpectralCaptureReceipt.js';
import { validateEffectPerformance } from '../../js/midi/content/EffectPerformance.js';
import { prepareEffectGraphRevision, effectGraphHash } from '../../js/midi/content/EffectGraphRevision.js';
import { prepareCapturedEffectReplay, createCapturedEffectReplayDriver } from '../../js/app/midi-ui/CapturedEffectReplay.js';
import { createOwnedEffectGraphKernel } from '../../js/app/midi-ui/OwnedEffectGraphKernel.js';
import { createEffectPerformanceCapture } from '../../js/app/procgen/workstation/EffectPerformanceCapture.js';

const signal = frame => Math.fround(Math.sin(frame * 0.071) * 0.1 + Math.sin(frame * 0.017) * 0.04);
const rejected = async work => { try { await work(); } catch (error) { return error; } throw new Error('Expected a covered-window rejection.'); };
const fixture = async (sampleRate = 48000, fftSize = 512) => {
  const definition = createGlassHoldRecipe({ fftSize, wetOnly: true }).graph, plan = prepareEffectGraphRevision(definition, { sampleRate }), hash = await effectGraphHash(plan), parameters = plan.nodes.find(node => node.id === 'freeze').parameters;
  const requestFrame = fftSize + 88, captureEnd = (Math.floor(requestFrame / (fftSize / 4)) + 1) * (fftSize / 4), thaw = captureEnd + 512;
  const kernel = new SpectralFreezeKernel({ sampleRate, parameters }); for (let frame = 0; frame < captureEnd + 32; frame++) kernel.sample(signal(frame), -signal(frame), frame >= requestFrame ? 1 : 0);
  const capture = kernel.captureReceipt(), anchor = { intentId: 'first', sourceTargetFrame: 0, executionEpoch: 'epoch-one' }, base = { schema: 'lemmings-effect-performance/v1', status: 'accepted', stage: 'effect-performance-captured', streamId: 'spectral-one', ownerRouteRevision: 1, graphDefinitionHash: hash, sampleRate, executionEpoch: 'epoch-one', clockAnchor: anchor, sourceEventIds: [], acousticReceipt: false };
  const source = { version: 1, operation: 'sound-only-revoice', sourceCanonicalHash: 'a'.repeat(64), nextSequence: null, effectCoverage: { captured: true, gaps: [] }, boundary: { state: { sourceTimeMs: 0 } }, finalBoundaryState: { sourceTimeMs: 2000 }, intents: [{ version: 1, intentId: 'first', scoreTime: { sourceTimeMs: 0, subTick: 0 } }], effectEvents: [
    { ...base, operation: 'graph', sequence: 1, targetFrame: 0, definition, spectralCapturePolicy: SPECTRAL_CAPTURE_POLICY },
    { ...base, operation: 'control', sequence: 2, targetFrame: requestFrame, nodeId: 'freeze', values: { hold01: 1 } },
    { ...base, operation: 'spectral-capture', sequence: 3, targetFrame: capture.endFrame, nodeId: 'freeze', spectralCapture: capture },
    { ...base, operation: 'control', sequence: 4, targetFrame: thaw, nodeId: 'freeze', values: { hold01: 0 } }
  ] };
  return { source, definition, parameters, capture, requestFrame, captureEnd, sampleRate };
};

describe('acknowledged spectral windows in owned captured revoice (PCM/browser qualification deferred)', function() {
  this.timeout(30000);
  for (const sampleRate of [44100, 48000, 96000]) for (const fftSize of [512, 1024, 2048]) it('retains the original window and matches a complete uninterrupted graph at ' + sampleRate + '/' + fftSize, async () => {
    const f = await fixture(sampleRate, fftSize), endFrame = f.captureEnd + 1200, strict = await prepareCapturedEffectReplay(f.source, sampleRate, endFrame), original = structuredClone(f.source);
    delete original.effectEvents[0].spectralCapturePolicy; original.effectEvents = original.effectEvents.filter(packet => packet.operation !== 'spectral-capture');
    const legacy = await prepareCapturedEffectReplay(original, sampleRate, endFrame), a = await createOwnedEffectGraphKernel({ definition: f.definition, sampleRate, frameOrigin: strict.frameOrigin }), b = await createOwnedEffectGraphKernel({ definition: f.definition, sampleRate, frameOrigin: legacy.frameOrigin }), strictDriver = createCapturedEffectReplayDriver(strict, a), reference = createCapturedEffectReplayDriver(legacy, b);
    const inputA = new Float32Array(2), inputB = new Float32Array(2), presence = new Uint8Array([1]); let difference = 0;
    for (let frame = 0; frame < endFrame; frame++) { inputA[0] = inputB[0] = signal(frame); inputA[1] = inputB[1] = -signal(frame); strictDriver.sample(0, 0, frame, inputA, presence); reference.sample(0, 0, frame, inputB, presence); difference = Math.max(difference, Math.abs(strictDriver.leftSample - reference.leftSample), Math.abs(strictDriver.rightSample - reference.rightSample)); }
    expect(difference).to.equal(0); expect(a.diagnostics().spectralStates[0]).to.include({ captureSerial: 1, captureEndFrame: f.capture.endFrame, captureStartFrame: f.capture.startFrame }); expect(strict.spectralCapture).to.include('processor-acknowledged-window'); expect(strict.initialMemory).to.include('cleared'); expect(strict.events.find(event => event.kind === 'spectral-capture').frame).to.equal(f.captureEnd - 1);
  });
  it('admits an end-exclusive capture boundary exactly at the final output frame', async () => {
    const f = await fixture(), source = structuredClone(f.source); source.effectEvents = source.effectEvents.slice(0, 3);
    const replay = await prepareCapturedEffectReplay(source, 48000, f.captureEnd); expect(replay.events.find(event => event.kind === 'spectral-capture').frame).to.equal(f.captureEnd - 1);
  });
  it('rejects missing, duplicate, foreign-epoch, rate-converted or uncovered window histories before rendering', async () => {
    const f = await fixture();
    const missing = structuredClone(f.source); missing.effectEvents.splice(2, 1); expect((await rejected(() => prepareCapturedEffectReplay(missing, 48000, 3000))).code).to.equal('effect-spectral-window-missing');
    const duplicate = structuredClone(f.source); duplicate.effectEvents.push({ ...duplicate.effectEvents[2], sequence: 5 }); expect((await rejected(() => prepareCapturedEffectReplay(duplicate, 48000, 3000))).code).to.equal('effect-spectral-window-history');
    const foreign = structuredClone(f.source); foreign.effectEvents[2].executionEpoch = 'another-epoch'; foreign.effectEvents[2].clockAnchor = { ...foreign.effectEvents[2].clockAnchor, executionEpoch: 'another-epoch' }; expect((await rejected(() => prepareCapturedEffectReplay(foreign, 48000, 3000))).code).to.equal('effect-spectral-window-history');
    expect((await rejected(() => prepareCapturedEffectReplay(f.source, 44100, 3000))).code).to.equal('effect-spectral-window-rate');
    const uncovered = structuredClone(f.source); for (const packet of uncovered.effectEvents) packet.clockAnchor.sourceTargetFrame = 256;
    expect((await rejected(() => prepareCapturedEffectReplay(uncovered, 48000, 3000))).code).to.equal('effect-spectral-window-before-range');
  });
  it('does not fabricate a capture for an explicitly canceled request before the next possible hop', async () => {
    const f = await fixture(), source = structuredClone(f.source); source.effectEvents.splice(2, 1); source.effectEvents[2].targetFrame = f.requestFrame + 1;
    const replay = await prepareCapturedEffectReplay(source, 48000, 2000), graph = await createOwnedEffectGraphKernel({ definition: f.definition }), driver = createCapturedEffectReplayDriver(replay, graph), samples = new Float32Array([0.1, -0.1]);
    for (let frame = 0; frame < 1400; frame++) { samples[0] = 0.1; samples[1] = -0.1; driver.sample(0, 0, frame, samples, new Uint8Array([1])); }
    expect(replay.events.some(event => event.kind === 'spectral-capture')).to.equal(false); expect(graph.diagnostics().spectralStates[0].captureSerial).to.equal(0);
  });
  it('fails at the exact frontier if the new source is unavailable or rendering skips the scheduled window', async () => {
    const f = await fixture(), replay = await prepareCapturedEffectReplay(f.source, 48000, 3000), graph = await createOwnedEffectGraphKernel({ definition: f.definition }), driver = createCapturedEffectReplayDriver(replay, graph), samples = new Float32Array(2), presence = new Uint8Array([0]);
    expect(() => { for (let frame = 0; frame < f.captureEnd; frame++) driver.sample(0, 0, frame, samples, presence); }).to.throw('complete original window'); expect(graph.diagnostics().muted).to.equal(true);
    const other = await createOwnedEffectGraphKernel({ definition: f.definition }), skipped = createCapturedEffectReplayDriver(replay, other); expect(() => skipped.sample(0, 0, f.captureEnd)).to.throw('exact replay frontier');
  });
  it('validates immutable processor evidence independently of requested controls and keeps its request frame in exact cuts', async () => {
    const f = await fixture(), captured = validateSpectralCaptureReceipt(f.capture); expect(captured).to.include({ requestFrame: f.requestFrame, endFrame: f.captureEnd, acousticReceipt: false });
    for (const mutate of [p => { p.startFrame++; }, p => { p.requestFrame = p.endFrame; }, p => { p.captureScales[0] = 2; }, p => { p.sourceWindowFrames--; }, p => { p.capturedSilence = !p.capturedSilence; }, p => { p.acousticReceipt = true; }]) { const bad = structuredClone(f.capture); mutate(bad); expect(() => validateSpectralCaptureReceipt(bad)).to.throw(); }
    const kernel = new SpectralFreezeKernel({ parameters: f.parameters }); for (let frame = 0; frame < 900; frame++) kernel.sample(signal(frame), -signal(frame), frame >= f.requestFrame ? 1 : 0);
    const bytes = new Uint8Array(kernel.snapshotBytes); kernel.snapshotInto(bytes); const copy = new SpectralFreezeKernel({ parameters: f.parameters }); copy.restoreFrom(bytes); expect(copy.captureReceipt()).to.deep.equal(kernel.captureReceipt()); const beforePanic = kernel.captureReceipt(); kernel.panic(); expect(kernel.captureReceipt()).to.deep.equal(beforePanic);
  });
  it('captures actual acknowledgment metadata under the existing source clock without inferring rendered audio', async () => {
    const f = await fixture(), receipts = [], state = { ownerRouteRevision: 1, graphDefinitionHash: f.source.effectEvents[0].graphDefinitionHash, sampleRate: 48000, targetFrame: f.capture.endFrame }, anchor = f.source.effectEvents[0].clockAnchor;
    const owner = createEffectPerformanceCapture({ owner: 'window-test', streamId: 'window-test', getContext: () => ({}), getExecutionEpoch: () => 'epoch-one', getAnchor: () => anchor, isEnabled: () => true, onReceipt: receipt => receipts.push(receipt) });
    owner.capture('spectral-capture', state, { nodeId: 'freeze', spectralCapture: f.capture }); expect(receipts).to.have.length(1); expect(validateEffectPerformance(receipts[0]).spectralCapture).to.deep.equal(f.capture); expect(receipts[0].acousticReceipt).to.equal(false); owner.dispose();
  });
  it('forwards metadata only from the current published arm and removes ownership on disposal (API doubles)', async () => {
    const resources = createAudioResourceLeases(), callbacks = new Map(), receipts = [], node = () => ({ connect() {}, disconnect() {}, gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} } }), context = { state: 'running', currentTime: 0, sampleRate: 48000, createGain: node };
    const host = createOwnerEffectGraphHost({ context, input: node(), dry: node(), destination: node(), resources, owner: 'spectral-owner', generation: 8, onEffectReceipt: receipt => receipts.push(receipt), prepareGraph: async (definition, options) => {
      callbacks.set(definition.id, options.onEffectReceipt); options.onEffectReceipt({ stage: 'candidate-metadata' });
      return { hash: definition.id, plan: { inputs: ['input'], outputs: ['output'], maximumTailFrames: 48000 }, diagnostics: () => ({ id: definition.id }), confirmReady: async () => {}, checkPublication() {}, getInput: node, getOutput: node, dispose: () => createProcgenRetirementScope().retire() };
    } });
    await host.prepare({ id: 'first' }); expect(receipts).to.have.length(0); callbacks.get('first')({ stage: 'spectral-capture-applied' }); expect(receipts[0]).to.include({ owner: 'spectral-owner', ownerGeneration: 8, ownerRouteRevision: 1 });
    await host.prepare({ id: 'second' }); callbacks.get('first')({ stage: 'retained-tail-metadata' }); expect(receipts).to.have.length(1); callbacks.get('second')({ stage: 'spectral-capture-applied' }); expect(receipts[1].ownerRouteRevision).to.equal(2);
    await host.dispose().completion; callbacks.get('second')({ stage: 'disposed-metadata' }); expect(receipts).to.have.length(2); expect(resources.diagnostics().reservations).to.equal(0); await resources.dispose().completion;
  });
  it('bounds worklet capture metadata until matching source-epoch acknowledgments release credits', async () => {
    const saved = Object.fromEntries(['AudioWorkletProcessor', 'sampleRate', 'currentFrame', 'registerProcessor'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)])); const posted = [];
    try {
      globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage: message => posted.push(structuredClone(message)), onmessage: null }; } }; globalThis.sampleRate = 48000; globalThis.currentFrame = 0; globalThis.registerProcessor = undefined;
      const { SpectralFreezeProcessor } = await import('../../js/app/midi-ui/worklet/SpectralFreezeProcessor.js?capture-window-credit-fixture');
      const run = acknowledge => {
        posted.length = 0; globalThis.currentFrame = 0; const processor = new SpectralFreezeProcessor({ processorOptions: { parameters: { fftSize: 512 }, sourceEpoch: 7 } }), input = new Float32Array(128).fill(0.1), left = new Float32Array(128), right = new Float32Array(128);
        const block = hold => { processor.process([[input, input]], [[left, right]], { hold: new Float32Array([hold]) }); globalThis.currentFrame += 128; };
        for (let index = 0; index < 4; index++) block(0);
        for (let capture = 1; capture <= 5; capture++) { block(1); if (acknowledge) processor.port.onmessage({ data: { type: 'spectral-capture-consumed', sourceEpoch: 7, serial: capture } }); else processor.port.onmessage({ data: { type: 'spectral-capture-consumed', sourceEpoch: 8, serial: capture } }); block(0); }
        return { processor, captures: posted.filter(message => message.type === 'spectral-capture') };
      };
      const blocked = run(false); expect(blocked.captures).to.have.length(4); expect(blocked.processor.kernel.muted).to.equal(true); expect(blocked.processor.kernel.faults).to.equal(1);
      const consumed = run(true); expect(consumed.captures).to.have.length(5); expect(consumed.processor.kernel.faults).to.equal(0); expect(consumed.processor.captureFlights.every(value => value === 0)).to.equal(true);
    } finally { for (const [key, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } }
  });
});
