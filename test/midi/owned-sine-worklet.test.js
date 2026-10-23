import { expect } from 'chai';
import { OwnedSineKernel, WIDTH, PROTOCOL, RECEIPT_WIDTH, BEGIN, UPDATE, END, CANCEL, LEASE,
  APPLIED, REJECTED, ENDED } from '../../js/app/midi-ui/worklet/OwnedSineProcessor.js';
import { createWorkletInstrumentBackend } from '../../js/app/midi-ui/workletInstrumentBackend.js';
import { createAudioCommandQueue } from '../../js/app/midi-ui/AudioCommandQueue.js';
import { createAudioResourceLeases } from '../../js/app/midi-ui/AudioResourceLeases.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';

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

const setupHost = () => {
  const nodes = [], context = { state: 'running', sampleRate: 48000, currentTime: 0, audioWorklet: { async addModule() {} } };
  const preview = { _generation: 0, _sessions: new Map([['owner', { generation: 0 }]]), _voices: new Set(), _semanticVoiceOwners: new Map(),
    _maxVoices: 64, _maxScheduledVoices: 96, _maxNoteSeconds: 8, _voiceSequence: 0, _nowMs: () => context.currentTime * 1000,
    _ownerReady: () => true, getAudioContext: () => context, _channel: () => ({ gain: {} }), _captureMetadata: fields => fields,
    _destroyVoice(voice, reason) { if (this._voices.delete(voice)) { voice.onDestroy?.(reason); voice.resourceLease?.release(); } } };
  const createWorkletNode = () => {
    const kernel = new OwnedSineKernel(48000), node = { kernel, disconnected: false, connect() {}, disconnect() { this.disconnected = true; },
      port: { onmessage: null, close() {}, postMessage(data) {
        if (data.type === 'commands') kernel.accept(data.data, data.count, data.packetSequence);
        else if (data.type === 'panic') kernel.panicPending = true;
        node.flush();
      } }, flush() {
        for (let index = 0; index < kernel.receiptCount; index += 64) this.port.onmessage?.({ data: { type: 'receipts', protocol: PROTOCOL,
          count: Math.min(64, kernel.receiptCount - index), data: kernel.receipts.slice(index * RECEIPT_WIDTH, (index + 64) * RECEIPT_WIDTH) } });
        kernel.receiptCount = 0;
      }, render(frames, start = 0) { const result = render(kernel, frames, start); this.flush(); return result; } };
    nodes.push(node); queueMicrotask(() => node.port.onmessage?.({ data: { type: 'ready', protocol: PROTOCOL, engineId: 'worklet-sine', engineVersion: 1,
      runtimeABI: 'owned-sine-f64-command-v1', buildId: 'owned-sine-v1', maxVoices: 64,
      sampleRate: 48000, width: WIDTH, capacity: 512 } })); return node;
  };
  const backend = createWorkletInstrumentBackend(preview, 'owner', { createWorkletNode });
  const patch = { status: 'ready', patch: { id: 'worklet-test', revision: 1, engineId: 'worklet-sine', engineVersion: 1,
    parameters: {}, sampleRefs: [], voicePolicy: { maxVoices: 64 }, mix: { gain01: 0.5, pan01: 0 } }, receipt: { patchId: 'worklet-test', revision: 1 } };
  const intent = voiceId => ({ version: 1, kind: 'begin', voiceId, generation: 1, velocity01: 0.8,
    pitch: { cents: 6000.001, referenceHz: 440 }, expression: {}, sourceEventIds: ['physical:1'] });
  return { preview, context, nodes, backend, patch, intent };
};

describe('Owned worklet host lifecycle', () => {
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
