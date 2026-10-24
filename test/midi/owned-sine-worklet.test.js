import { expect } from 'chai';
import { OwnedSineKernel, WIDTH, PROTOCOL, RECEIPT_WIDTH, BEGIN, UPDATE, END, CANCEL, LEASE,
  APPLIED, REJECTED, ENDED, DISPLAY_PROTOCOL, DISPLAY_WIDTH, DISPLAY_VOICES } from '../../js/app/midi-ui/worklet/OwnedSineProcessor.js';
import { createWorkletInstrumentBackend } from '../../js/app/midi-ui/workletInstrumentBackend.js';
import { createAudioCommandQueue } from '../../js/app/midi-ui/AudioCommandQueue.js';
import { createAudioResourceLeases } from '../../js/app/midi-ui/AudioResourceLeases.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';
import { OwnedChoirKernel, CHOIR_WIDTH, CHOIR_VOICES } from '../../js/app/midi-ui/worklet/OwnedChoirProcessor.js';
import { OwnedPluckKernel, PLUCK_WIDTH, PLUCK_VOICES } from '../../js/app/midi-ui/worklet/OwnedPluckProcessor.js';
import { OwnedSpectrumKernel, SPECTRUM_WIDTH, SPECTRUM_VOICES } from '../../js/app/midi-ui/worklet/OwnedSpectrumProcessor.js';
import { OwnedGranularKernel, GRANULAR_WIDTH, GRANULAR_VOICES } from '../../js/app/midi-ui/worklet/OwnedGranularProcessor.js';

const row = (opcode, frame, sequence, slot = 0, token = 1, values = {}) => {
  const data = new Array(WIDTH).fill(0);
  Object.assign(data, { 0: 1, 1: frame, 2: sequence, 3: opcode, 4: slot, 5: token, 6: 440, 7: 0.5,
    8: 1, 9: 0, 10: 48, 11: 240, 12: 0.7, 13: 240, 16: 48000 * 8, 17: 1 }, values);
  return data;
};
const accept = (kernel, rows) => kernel.accept(Float64Array.from(rows.flat()), rows.length);
const render = (kernel, frames, start = 0) => {
  const left = new Float32Array(frames), right = new Float32Array(frames); kernel.render(left, right, start); return { left, right };
};
const receipts = kernel => Array.from({ length: kernel.receiptCount }, (_, index) =>
  Array.from(kernel.receipts.slice(index * RECEIPT_WIDTH, (index + 1) * RECEIPT_WIDTH)));

describe('Bounded audio command queue', () => {
  it('orders equal frames by sequence and keeps terminal capacity when controls fill the queue', () => {
    const queue = createAudioCommandQueue({ capacity: 4, terminalReserve: 1, maxHorizonFrames: 1000 });
    queue.enqueue({ opcode: UPDATE, frame: 20, sequence: 3 }, 0);
    queue.enqueue({ opcode: BEGIN, frame: 10, sequence: 2 }, 0);
    queue.enqueue({ opcode: UPDATE, frame: 10, sequence: 1 }, 0);
    expect(queue.enqueue({ opcode: UPDATE, frame: 30, sequence: 4 }, 0).reason).to.equal('audio-queue-full');
    expect(queue.enqueue({ opcode: END, frame: 30, sequence: 5 }, 0).status).to.equal('accepted');
    expect(queue.drainThrough(100).map(item => item.sequence)).to.deep.equal([1, 2, 3, 5]);
  });

  it('bounds the horizon and invalidates only the canceled ownership', () => {
    const queue = createAudioCommandQueue({ capacity: 4, terminalReserve: 1, maxHorizonFrames: 100 });
    expect(queue.enqueue({ opcode: BEGIN, frame: 101, sequence: 1 }, 0).status).to.equal('rejected');
    queue.enqueue({ opcode: BEGIN, frame: 10, sequence: 2, owner: 'A' }, 0);
    queue.enqueue({ opcode: BEGIN, frame: 20, sequence: 3, owner: 'B' }, 0);
    expect(queue.invalidate(command => command.owner === 'A')).to.equal(1);
    expect(queue.drainThrough(100).map(command => command.owner)).to.deep.equal(['B']);
  });
});

describe('Owned sine worklet kernel', () => {
  it('matches split and combined rendering with exact frame events and independent same-pitch voices', () => {
    const run = split => {
      const kernel = new OwnedSineKernel(48000);
      accept(kernel, [row(BEGIN, 3, 1), row(BEGIN, 3, 2, 1), row(UPDATE, 100, 3, 1, 1, { 6: 220, 8: 0.2501, 15: 3, 14: 32 }), row(END, 200, 4, 1, 1, { 13: 80 })]);
      if (!split) return render(kernel, 512).left;
      const output = new Float32Array(512); let cursor = 0;
      for (const size of [17, 64, 1, 127, 31, 128, 144]) { output.set(render(kernel, size, cursor).left, cursor); cursor += size; }
      return output;
    };
    expect(Array.from(run(false))).to.deep.equal(Array.from(run(true)));
    expect(run(false)[0]).to.equal(0); expect(run(false).slice(300).some(value => Math.abs(value) > 0)).to.equal(true);
  });

  it('makes shuffled future submission identical and preserves explicit equal-frame order', () => {
    const commands = [row(BEGIN, 0, 1), row(UPDATE, 200, 3, 0, 1, { 8: 0.2, 15: 2, 14: 16 }),
      row(UPDATE, 100, 2, 0, 1, { 8: 0.5001, 15: 2, 14: 16 }), row(UPDATE, 200, 4, 0, 1, { 8: 0.8, 15: 2, 14: 16 })];
    const a = new OwnedSineKernel(48000), b = new OwnedSineKernel(48000);
    accept(a, commands); accept(b, [...commands].reverse());
    expect(Array.from(render(a, 512).left)).to.deep.equal(Array.from(render(b, 512).left));
    expect(a.voice[8]).to.equal(0.8);
  });

  it('uses separate smoothing durations for simultaneously interrupted parameters', () => {
    const kernel = new OwnedSineKernel(48000);
    accept(kernel, [row(BEGIN, 0, 1), row(UPDATE, 10, 2, 0, 1, { 6: 880, 8: 0.2, 15: 3, 14: 100 }),
      row(UPDATE, 60, 3, 0, 1, { 8: 0.8, 15: 2, 14: 100 })]);
    render(kernel, 110); expect(kernel.voice[5]).to.equal(880);
    expect(kernel.voice[8]).to.be.lessThan(0.8);
    render(kernel, 50, 110); expect(kernel.voice[8]).to.equal(0.8);
  });

  it('purges only the matching generation and preserves another execution at the same pitch', () => {
    const kernel = new OwnedSineKernel(48000);
    accept(kernel, [row(BEGIN, 0, 1), row(BEGIN, 0, 2, 1, 1, { 0: 2 }), row(BEGIN, 1000, 3, 2), row(CANCEL, 100, 4)]);
    render(kernel, 1024); expect(Array.from(kernel.active.slice(0, 3))).to.deep.equal([0, 1, 0]);
    expect(kernel.queueLength).to.equal(0);
  });

  it('preserves emergency capacity and panics within one actual render block', () => {
    const kernel = new OwnedSineKernel(96000); accept(kernel, [row(BEGIN, 0, 1)]); render(kernel, 48);
    const commands = Array.from({ length: 450 }, (_, i) => row(UPDATE, 1000 + i, i + 2, 0, 1, { 15: 2 }));
    accept(kernel, commands); expect(kernel.counters[1]).to.equal(2);
    accept(kernel, [row(END, 100, 452)]); expect(kernel.queueLength).to.equal(449);
    kernel.panicPending = true; render(kernel, 32, 48);
    expect(kernel.active[0]).to.equal(0); expect(kernel.queueLength).to.equal(0);
    expect(receipts(kernel).some(receipt => receipt[0] === APPLIED && receipt[5] === 2)).to.equal(true);
  });

  it('rejects stale slots, late attacks, duplicate packets and out-of-Nyquist updates', () => {
    const kernel = new OwnedSineKernel(48000); render(kernel, 128);
    accept(kernel, [row(BEGIN, 0, 1)]); render(kernel, 128, 128);
    expect(kernel.active[0]).to.equal(0); expect(kernel.counters[2]).to.equal(1);
    accept(kernel, [row(BEGIN, 256, 2), row(UPDATE, 300, 3, 0, 2, { 15: 2 }), row(UPDATE, 301, 4, 0, 1, { 6: 48000, 15: 1 })]);
    kernel.accept(new Float64Array(0), 0, 1); render(kernel, 128, 256);
    expect(kernel.voice[5]).to.equal(440); expect(kernel.counters[0]).to.be.greaterThan(0);
    expect(receipts(kernel).filter(receipt => receipt[0] === REJECTED)).to.have.length.at.least(3);
  });

  it('keeps a static owned gate for 60 seconds and ends at its lease when liveness disappears', () => {
    const kernel = new OwnedSineKernel(8000);
    accept(kernel, [row(BEGIN, 0, 1, 0, 1, { 6: 220, 16: 8000 * 61, 13: 80 })]);
    for (let frame = 0; frame < 8000 * 60; frame += 128) render(kernel, 128, frame);
    expect(kernel.active[0]).to.equal(1);
    render(kernel, 8000, 8000 * 60); expect(kernel.active[0]).to.equal(0);
    expect(receipts(kernel).some(receipt => receipt[0] === ENDED && receipt[5] === 7)).to.equal(true);
  });

  it('silences a nonfinite voice while another voice and the render loop continue', () => {
    const kernel = new OwnedSineKernel(48000); accept(kernel, [row(BEGIN, 0, 1), row(BEGIN, 0, 2, 1)]);
    render(kernel, 128); kernel.voice[3] = NaN;
    const audio = render(kernel, 128, 128);
    expect(kernel.nonfinite).to.equal(1); expect(kernel.active[0]).to.equal(0); expect(kernel.active[1]).to.equal(1);
    expect(audio.left.every(Number.isFinite)).to.equal(true); expect(audio.left.some(value => Math.abs(value) > 0)).to.equal(true);
  });
});

const setupHost = (engineId = 'worklet-sine') => {
  const source = { 'worklet-sine': [OwnedSineKernel, WIDTH, 64, 'owned-sine-v2-display', 'owned-sine-f64-command-v1'],
    'worklet-choir': [OwnedChoirKernel, CHOIR_WIDTH, CHOIR_VOICES, 'owned-choir-v1', 'owned-choir-f64-command-v1'],
    'worklet-pluck': [OwnedPluckKernel, PLUCK_WIDTH, PLUCK_VOICES, 'owned-pluck-v1', 'owned-pluck-f64-command-v1'],
    'worklet-spectrum': [OwnedSpectrumKernel, SPECTRUM_WIDTH, SPECTRUM_VOICES, 'owned-spectrum-v1', 'owned-spectrum-f64-command-v1'] }[engineId];
  const granular = engineId === 'worklet-granular', actualSource = granular ? [OwnedGranularKernel, GRANULAR_WIDTH, GRANULAR_VOICES, 'owned-granular-v1', 'owned-granular-f64-command-v1'] : source;
  const nodes = [], contextListeners = new Set(); let contextState = 'running';
  const context = { get state() { return contextState; }, set state(value) { contextState = value; for (const listener of contextListeners) listener(); },
    addEventListener: (type, listener) => { if (type === 'statechange') contextListeners.add(listener); }, removeEventListener: (type, listener) => { if (type === 'statechange') contextListeners.delete(listener); },
    sampleRate: 48000, currentTime: 0, audioWorklet: { async addModule() {} } };
  const preview = { _generation: 0, _sessions: new Map([['owner', { generation: 0 }]]), _voices: new Set(), _semanticVoiceOwners: new Map(),
    _maxVoices: 64, _maxScheduledVoices: 96, _maxNoteSeconds: 8, _voiceSequence: 0, _nowMs: () => context.currentTime * 1000,
    _ownerReady: () => true, _workloadClass: () => 'live', getAudioContext: () => context, _channel: () => ({ gain: {} }), _captureMetadata: fields => fields,
    _inspectVoiceInterval: () => ({ accepted: true }), _inspectVoiceExtensions: () => ({ accepted: true }),
    _renderVoiceCount(voices = this._voices) { return [...voices].reduce((sum, voice) => sum + (voice.renderCost || 1), 0); },
    _destroyVoice(voice, reason) { if (this._voices.delete(voice)) { voice.onDestroy?.(reason); voice.resourceLease?.release(); } } };
  if (granular) preview._audioResources = createAudioResourceLeases();
  const createWorkletNode = (_context, _name, options) => {
    const kernel = granular ? new OwnedGranularKernel(48000, structuredClone(options.processorOptions.pcm)) : new actualSource[0](48000), node = { kernel, disconnected: false, connect() {}, disconnect() { this.disconnected = true; },
      port: { onmessage: null, close() {}, postMessage(data) {
        if (data.type === 'commands') kernel.accept(data.data, data.count, data.packetSequence);
        else if (data.type === 'panic') kernel.panicPending = true;
        node.flush();
      } }, flush() {
        for (let index = 0; index < kernel.receiptCount; index += 64) this.port.onmessage?.({ data: { type: 'receipts', protocol: PROTOCOL,
          count: Math.min(64, kernel.receiptCount - index), data: kernel.receipts.slice(index * RECEIPT_WIDTH, (index + 64) * RECEIPT_WIDTH) } });
        kernel.receiptCount = 0;
      }, render(frames, start = 0) { const result = render(kernel, frames, start); this.flush(); return result; } };
    nodes.push(node); queueMicrotask(() => node.port.onmessage?.({ data: { type: 'ready', protocol: PROTOCOL, engineId, engineVersion: 1,
      runtimeABI: actualSource[4], buildId: actualSource[3], maxVoices: actualSource[2], ...(granular ? { pcmBankHash: kernel.source.descriptor.bankHash } : {}),
      displayProtocol: DISPLAY_PROTOCOL, displayWidth: DISPLAY_WIDTH, displayVoices: DISPLAY_VOICES,
      sampleRate: 48000, width: actualSource[1], capacity: 512 } })); return node;
  };
  const backend = createWorkletInstrumentBackend(preview, 'owner', { createWorkletNode, engineId });
  const patch = { status: 'ready', patch: { id: 'worklet-test', revision: 1, engineId, engineVersion: 1,
    parameters: {}, sampleRefs: [], voicePolicy: { maxVoices: actualSource[2] }, mix: { gain01: 0.5, pan01: 0 } }, receipt: { patchId: 'worklet-test', revision: 1 } };
  const intent = voiceId => ({ version: 1, kind: 'begin', voiceId, generation: 1, velocity01: 0.8,
    pitch: { cents: 6000.001, referenceHz: 440 }, expression: {}, sourceEventIds: ['physical:1'] });
  return { preview, context, nodes, backend, patch, intent };
};

describe('Owned worklet host lifecycle', () => {
  it('prepares a verified PCM clone for the real granular kernel and retains it through parent release', async () => {
    const { backend, nodes, patch, preview, intent, context } = setupHost('worklet-granular'), samples = Float32Array.from({ length: 4800 }, (_, frame) => Math.sin(frame * 0.03) * 0.5),
      ref = { contentHash: 'a'.repeat(64), bytes: 19244, kind: 'sample', frames: samples.length, sourceSampleRate: 48000 },
      variant = { contentHash: ref.contentHash, frames: samples.length, channels: 1, targetSampleRate: 48000, decoderVersion: 'explicit-test-decoded-pcm-v1' },
      buffer = { length: samples.length, numberOfChannels: 1, sampleRate: 48000, getChannelData: () => samples };
    const pin = () => { let active = true; return { ref, variant, buffer, isActive: () => active, retain: pin, release: () => { if (!active) return false; active = false; return true; } }; };
    patch.patch.sampleRefs = [{ id: 'source', sha256: ref.contentHash, bytes: ref.bytes, required: true }]; patch.patch.parameters.motionRequired = 0;
    const prepared = await backend.prepare(patch, [pin()]); expect(prepared.status).to.equal('ready'); expect(prepared.sourceBank.bankHash).to.match(/^[a-f0-9]{64}$/);
    expect(preview._audioResources.diagnostics().consumerOwnedReservations).to.equal(2);
    const execution = backend.registerExecution({ executionEpoch: 'granular-source', generation: 1 }).execution;
    expect(backend.begin(intent('cloud'), 128, execution)).to.include({ status: 'accepted', stage: 'queued' }); await Promise.resolve(); const rendered = nodes[0].render(4096);
    expect(rendered.left.some(value => Math.abs(value) > 1e-5)).to.equal(true); expect(nodes[0].kernel.source.inspect().clouds[0].admittedGrains).to.be.greaterThan(0);
    backend.cancelGeneration(1, execution); await Promise.resolve(); nodes[0].render(2048, 4096); expect(nodes[0].kernel.source.inspect().activeGrains).to.equal(0);
    await backend.dispose().completion; expect(preview._audioResources.diagnostics().reservations).to.equal(1); context.state = 'closed'; expect(preview._audioResources.diagnostics().reservations).to.equal(0);
  });
  it('rejects unsupported table layouts before constructing a kernel or allocating a voice', async () => {
    const { backend, nodes, patch, preview } = setupHost('worklet-spectrum'); patch.patch.parameters.partialCount = 4;
    expect((await backend.prepare(patch)).status).to.equal('rejected'); expect(nodes).to.have.length(0); expect(preview._voices.size).to.equal(0); await backend.dispose().completion;
  });
  it('carries completed physical controls through the real host queue into each owned source without a new attack', async () => {
    for (const [engineId, target, stateIndex, expected] of [['worklet-choir', 'breath01', 9, 0.9], ['worklet-pluck', 'damping01', 3, 0.9 * (1 - 0.95 * 0.9)], ['worklet-spectrum', 'scan01', 8, 0.9]]) {
      const { backend, nodes, patch, intent, context } = setupHost(engineId), observed = [];
      patch.patch.causalBindings = [{ id: 'movement', sourceKind: 'MotionCommitted', payloadField: 'displacementPixels', unit: 'world-pixel', target,
        inputMin: 0, inputMax: 8, outputMin: 0.1, outputMax: 0.9, outputUnit: 'normalized', curve: 'linear', composition: 'replace', mode: 'continuous', smoothingMs: 8 }];
      expect((await backend.prepare(patch)).status).to.equal('ready'); const execution = backend.registerExecution({ executionEpoch: 'physical-source', generation: 1 }).execution;
      const stop = backend.observeCommandOutcomes(outcome => observed.push(outcome), { execution });
      expect(backend.begin(intent('held'), 128, execution).status).to.equal('accepted');
      const cause = { sourceKind: 'MotionCommitted', eventId: 'motion:one', evidence: 'completed-world-fact', values: { displacementPixels: { value: 8, unit: 'world-pixel' } } };
      expect(backend.updatePhysical('held', cause, 256, execution)).to.include({ status: 'accepted', stage: 'queued' });
      expect(backend.updatePhysical('held', cause, 255, execution).reason).to.equal('out-of-order-physical-control');
      await Promise.resolve(); nodes[0].render(1024); context.currentTime = 1024 / 48000;
      expect(nodes[0].kernel.source.state[stateIndex]).to.be.closeTo(expected, 1e-9); expect(nodes[0].kernel.voice[2]).to.equal(1);
      expect(observed.filter(outcome => outcome.stage === 'render-kernel-applied')).to.have.length(2);
      expect(backend.updatePhysical('held', { ...cause, eventId: 'motion:missing', values: {} }, 1152, execution)).to.include({ outputRequested: false, reason: 'no-qualified-control-measurement' });
      stop(); backend.cancelGeneration(1, execution); await Promise.resolve(); nodes[0].render(1024, 1024); await backend.dispose().completion;
    }
  });
  it('retires more than 1024 executions without consuming lifetime identity capacity', async () => {
    const { backend, nodes, patch, intent } = setupHost(); await backend.prepare(patch);
    let oldest;
    for (let index = 0; index < 1100; index++) {
      const { execution } = backend.registerExecution({ executionEpoch: 'reusable-label', generation: 1 });
      oldest ??= execution;
      expect(backend.begin(intent('same'), 48000, execution).status).to.equal('accepted');
      backend.cancelGeneration(1, execution); await Promise.resolve(); nodes[0].render(1);
      expect(backend.renderDiagnostics().executions).to.include({ active: 0, retiring: 0 });
    }
    expect(backend.begin(intent('stale'), 48000, oldest).reason).to.equal('execution-retired');
    expect(backend.update('same', {}, 48000, oldest).reason).to.equal('execution-retired');
    expect(backend.end('same', {}, 48000, oldest).reason).to.equal('execution-retired');
    expect(backend.renderDiagnostics().executions).to.include({ retired: 1100, peak: 1 });
    backend.dispose();
  });

  it('holds retiring identities through kernel cancellation and release-tail acknowledgment', async () => {
    const { backend, nodes, patch, intent, context } = setupHost(); await backend.prepare(patch);
    const handles = Array.from({ length: 64 }, (_, index) => backend.registerExecution({ executionEpoch: `run-${index}`, generation: 1 }).execution);
    expect(backend.registerExecution({ executionEpoch: 'overflow', generation: 1 }).reason).to.equal('execution-identity-capacity');
    backend.begin(intent('tail'), 100, handles[0]); await Promise.resolve(); nodes[0].render(128);
    context.currentTime = 128 / 48000; backend.retireExecution(handles[0]); await Promise.resolve();
    expect(backend.renderDiagnostics().executions.retiring).to.equal(1);
    nodes[0].render(128, 128);
    expect(backend.renderDiagnostics().executions.retiring).to.equal(1);
    nodes[0].render(256, 256); context.currentTime = 512 / 48000;
    expect(backend.registerExecution({ executionEpoch: 'replacement', generation: 1 }).status).to.equal('accepted');
    expect(backend.begin(intent('tail'), 1000, handles[0]).reason).to.equal('execution-retired');
    backend.dispose();
  });

  it('does not spend numeric epoch slots on unrelated rejected voice admissions', async () => {
    const { backend, patch, intent, preview } = setupHost(); await backend.prepare(patch);
    const blockers = Array.from({ length: 32 }, () => ({ start: 0, releaseAt: 8, renderCost: 2 }));
    for (const voice of blockers) preview._voices.add(voice);
    for (let index = 0; index < 100; index++) expect(backend.begin(intent('budget'), 480, `rejected-${index}`).reason).to.equal('shared-voice-budget');
    for (const voice of blockers) preview._voices.delete(voice);
    expect(backend.begin(intent('admitted'), 480, 'fresh').status).to.equal('accepted'); backend.dispose();
  });

  it('fences a faulted incarnation while allowing its replacement to register the same label', async () => {
    const { backend, nodes, patch, intent } = setupHost(); await backend.prepare(patch);
    const old = backend.registerExecution({ executionEpoch: 'live', generation: 1 }).execution;
    backend.begin(intent('same'), 100, old); nodes[0].onprocessorerror(); await backend.prepare(patch);
    const next = backend.registerExecution({ executionEpoch: 'live', generation: 1 }).execution;
    expect(backend.begin(intent('same'), 100, old).reason).to.equal('execution-retired');
    expect(backend.begin(intent('same'), 100, next).status).to.equal('accepted');
    backend.cancelGeneration(1, old); expect(backend.renderDiagnostics().activeVoices).to.equal(1); backend.dispose();
  });

  it('counts release layers reserved by another local backend before admitting a worklet source', async () => {
    const { backend, patch, intent, preview } = setupHost(); await backend.prepare(patch);
    for (let n = 0; n < 32; n++) preview._voices.add({ start: 0, releaseAt: 8, renderCost: 2 });
    expect(backend.begin(intent('over-budget'), 480).reason).to.equal('shared-voice-budget');
    expect(backend.renderDiagnostics().activeVoices).to.equal(0); backend.dispose();
  });

  it('requires a verified runtime handshake and joins applied receipts to independent executions', async () => {
    const { backend, nodes, patch, intent, preview } = setupHost();
    expect(backend.begin(intent('same'), 100).reason).to.equal('audio-not-ready');
    expect((await backend.prepare(patch)).status).to.equal('ready');
    expect(backend.begin(intent('same'), 100, 'live').stage).to.equal('queued');
    expect(backend.begin(intent('same'), 100, 'cue').status).to.equal('accepted');
    await Promise.resolve();
    nodes[0].render(256);
    const applied = backend.renderDiagnostics({ includeTraces: true }).traces.filter(trace => trace.stage === 'render-kernel-applied');
    expect(applied.map(trace => trace.executionEpoch)).to.deep.equal(['live', 'cue']);
    expect(applied.every(trace => trace.appliedFrame === 100)).to.equal(true);
    backend.dispose(); expect(preview._voices.size).to.equal(0);
  });

  it('cancels unsent future voices and refuses delayed commands from that immutable generation', async () => {
    const { backend, patch, intent, preview } = setupHost(); await backend.prepare(patch);
    expect(backend.begin(intent('future'), 48000).status).to.equal('accepted');
    const cancellation = backend.cancelGenerationWithReceipt(1, 'live');
    expect(cancellation.removedBeforeSubmission).to.equal(1); expect(preview._voices.size).to.equal(0);
    expect(backend.begin(intent('future'), 48000).reason).to.equal('generation-cancelled');
    backend.dispose();
  });

  it('contains processor failure, retains patch inspection and recovers with a new kernel', async () => {
    const { backend, nodes, patch, intent, preview } = setupHost(); await backend.prepare(patch); backend.begin(intent('a'), 100);
    nodes[0].onprocessorerror(); expect(preview._voices.size).to.equal(0); expect(nodes[0].disconnected).to.equal(true);
    expect(backend.renderDiagnostics().readiness).to.equal('processor-error');
    expect((await backend.prepare(patch)).status).to.equal('ready'); expect(nodes).to.have.length(2);
    expect(backend.begin(intent('b'), 100).status).to.equal('accepted'); backend.dispose();
  });
  it('contains native teardown failure, closes independent leaves and retains uncertain runtime storage', async () => {
    const { backend, nodes, patch, intent, preview, context } = setupHost();
    const budget = createResourceBudget({ limitBytes: 2 * 1024 * 1024 }); preview._audioResources = createAudioResourceLeases({ resourceBudget: budget });
    await backend.prepare(patch); backend.begin(intent('a'), 100); backend.begin(intent('b'), 100);
    let disconnects = 0, portCloses = 0;
    nodes[0].disconnect = () => { disconnects++; throw new Error('disconnect failed'); };
    nodes[0].port.close = () => { portCloses++; };
    nodes[0].onprocessorerror();
    expect(preview._voices.size).to.equal(0); expect(portCloses).to.equal(1); expect(disconnects).to.equal(1);
    expect(backend.renderDiagnostics().retirement.outcome).to.equal('partial');
    expect((await backend.prepare(patch)).reason).to.equal('audio-retirement-unknown');
    expect(preview._audioResources.retireOwner('owner').outcome).to.equal('partial');
    expect(budget.diagnostics().accountedBytes).to.be.greaterThan(0);
    backend.dispose(); expect(portCloses).to.equal(1); expect(disconnects).to.equal(1);
    context.state = 'closed'; preview._audioResources.confirmClosedContext(); expect(budget.diagnostics().accountedBytes).to.equal(0);
  });

  it('releases repeated Stop reservations, including admitted onsets still in host and kernel queues', async () => {
    const { backend, nodes, patch, intent, preview, context } = setupHost(); await backend.prepare(patch);
    for (let pass = 0; pass < 5; pass++) {
      const current = pass * 512; context.currentTime = current / 48000;
      backend.begin(intent('near:' + pass), current + 100);
      backend.begin(intent('far:' + pass), current + 48000);
      backend.onOwnerStop();
      expect(backend.begin(intent('too-soon'), current + 100).reason).to.equal('kernel-stop-pending');
      nodes[0].render(256, current);
      expect(backend.renderDiagnostics().inFlight).to.equal(0);
      expect(preview._voices.size).to.equal(0);
    }
    backend.dispose();
  });

  it('settles Stop immediately while addModule is still pending without constructing a kernel', async () => {
    const { backend, context, nodes, patch } = setupHost();
    context.audioWorklet.addModule = () => new Promise(() => {});
    const pending = backend.prepare(patch); backend.onOwnerStop();
    expect((await pending).reason).to.equal('preparation-cancelled'); expect(nodes).to.have.length(0);
    backend.dispose();
  });

  it('accepts an earlier control after a future end was queued and submits the source batch together', async () => {
    const { backend, nodes, patch, intent } = setupHost(); await backend.prepare(patch);
    backend.begin(intent('a'), 100); backend.end('a', { seconds: 0.01 }, 1000);
    expect(backend.update('a', { pressure01: 0.5001 }, 500).status).to.equal('accepted');
    await Promise.resolve(); expect(nodes[0].kernel.lastPacket).to.equal(1);
    nodes[0].render(1200);
    expect(backend.renderDiagnostics().counters.rejected).to.equal(0);
    backend.dispose();
  });

  it('denies fixed runtime storage before loading a module or constructing a worklet node', async () => {
    const { backend, context, nodes, patch, preview } = setupHost();
    const budget = createResourceBudget({ limitBytes: 4096 }); preview._audioResources = createAudioResourceLeases({ resourceBudget: budget });
    let moduleCalls = 0; context.audioWorklet.addModule = async () => { moduleCalls++; };
    expect((await backend.prepare(patch)).reason).to.equal('audio-resource-budget');
    expect(moduleCalls).to.equal(0); expect(nodes).to.have.length(0);
    expect(budget.diagnostics().accountedBytes).to.equal(0); backend.dispose();
  });

  it('rolls back failed initialization and releases admitted runtime/voice memory on processor failure', async () => {
    const { backend, context, nodes, patch, preview, intent } = setupHost();
    const budget = createResourceBudget({ limitBytes: 1024 * 1024 }); preview._audioResources = createAudioResourceLeases({ resourceBudget: budget });
    context.audioWorklet.addModule = async () => { throw new Error('module-load-failed'); };
    expect((await backend.prepare(patch)).reason).to.equal('module-load-failed');
    expect(budget.diagnostics().accountedBytes).to.equal(0);
    context.audioWorklet.addModule = async () => {};
    expect((await backend.prepare(patch)).status).to.equal('ready');
    backend.begin(intent('funded'), 100); await Promise.resolve();
    expect(preview._audioResources.diagnostics().reservations).to.equal(2);
    nodes[0].onprocessorerror();
    expect(preview._voices.size).to.equal(0); expect(budget.diagnostics().accountedBytes).to.equal(0);
    backend.dispose();
  });
});
