import { expect } from 'chai';
import { OwnedSineKernel, OwnedSineProcessor, WIDTH, BEGIN, UPDATE, END, PROTOCOL,
  DISPLAY_PROTOCOL, DISPLAY_WIDTH, DISPLAY_VOICES } from '../../js/app/midi-ui/worklet/OwnedSineProcessor.js';
import { createAudioDisplayTelemetry } from '../../js/app/midi-ui/AudioDisplayTelemetry.js';
import { createAudioResourceLeases } from '../../js/app/midi-ui/AudioResourceLeases.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';

const command = (opcode = BEGIN, frame = 0, sequence = 1, slot = 0, token = 1, extra = {}) => {
  const data = new Float64Array(WIDTH);
  Object.assign(data, { 0: 1, 1: frame, 2: sequence, 3: opcode, 4: slot, 5: token, 6: 440, 7: 0.5, 8: 1,
    9: 0, 10: 0, 11: 0, 12: 1, 13: 48, 16: 48000, 17: 1 }, extra); return data;
};
const wanted = (count = 1) => { const tokens = new Uint32Array(64); tokens.fill(1, 0, count); return tokens; };
const render = (kernel, frames, first = 0) => { const left = new Float32Array(frames), right = new Float32Array(frames); kernel.render(left, right, first); return { left, right }; };
const identity = { worldId: 'world', generation: 1, executionEpoch: 'take', contextEpoch: 4, graphRevision: 2, routeRevision: 3 };
const voice = (slot = 0, generation = 1) => ({ slot, slotToken: 1, epochToken: 1, semanticGeneration: generation, semanticEpoch: 'take',
  voiceId: 'voice:' + slot, patchId: 'patch', patchRevision: 1 });
const packet = (slot = 0, token = 1, generation = 1, serial = 1) => {
  const data = new Float64Array(DISPLAY_VOICES * DISPLAY_WIDTH);
  Object.assign(data, { 0: slot, 1: token, 2: 1, 3: generation, 4: 0, 5: 2400, 6: 2400, 7: 0,
    8: 0.35, 9: 0.5, 10: 1, 11: 440, 12: 1, 13: 0, 14: 1, 15: 0, 16: 2399, 17: serial });
  return { type: 'display-samples', protocol: PROTOCOL, displayProtocol: DISPLAY_PROTOCOL, revision: 1,
    sequence: serial, count: 1, data, droppedWindows: 0 };
};
const host = ({ owner = 'owner', engineId, resources, getRouteState } = {}) => {
  const voices = [voice()], context = { sampleRate: 48000, currentTime: 0.05 }, state = { epoch: 4 }, messages = [];
  const telemetry = createAudioDisplayTelemetry({ owner, engineId, resources, getContext: () => context, getContextEpoch: () => state.epoch,
    getVoices: () => voices, getRouteState, send: value => { messages.push(value.type === 'display-config' ? { ...value, tokens: value.tokens.slice() } : value); } });
  telemetry.setContext(identity); telemetry.admit(voices[0], { actorId: 3, onsetId: 'onset' });
  return { telemetry, voices, context, state, messages };
};

describe('Worklet-owned display reductions', () => {
  it('names the actual owned source and retains unclipped headroom without inventing sine phase', () => {
    for (const engineId of ['worklet-pluck', 'worklet-choir']) {
      const owner = host({ engineId }); owner.context.currentTime = 0; const samples = [], stop = owner.telemetry.observe(sample => samples.push(sample), { identity });
      const incoming = packet(); incoming.data[8] = 0.9; incoming.data[9] = 1.2; owner.telemetry.consume(incoming);
      expect(samples).to.have.length(1); expect(samples[0].nodeId).to.equal(engineId + '.voice-output');
      expect(samples[0].quantities.find(value => value.name === 'peak').value).to.equal(1.2);
      expect(samples[0].quantities.find(value => value.name === 'amplitude-envelope').value).to.equal(1);
      expect(samples[0].quantities.some(value => value.name === 'oscillator-phase')).to.equal(false); stop(); owner.telemetry.dispose();
    }
  });
  it('keeps current owner mute evidence separate from measured voice energy and acoustic audibility', () => {
    let muted = false; const owner = host({ getRouteState: () => ({ muted, evidenceClass: 'owner-routing-state' }) });
    const stop = owner.telemetry.observe(() => {}, { identity }); owner.telemetry.consume(packet());
    expect(owner.telemetry.inspect()[0].routeState).to.include({ muted: false, outputAudibility: 'unknown', observedAtFrame: 2400 });
    muted = true; owner.telemetry.consume(packet(0, 1, 1, 2));
    expect(owner.telemetry.inspect()[0].routeState.muted).to.equal(true);
    expect(owner.telemetry.inspect()[0].quantities.find(quantity => quantity.name === 'rms').value).to.equal(0.35);
    expect(owner.telemetry.inspect()[0].acousticReceipt).to.equal(false); stop(); owner.telemetry.dispose();
  });
  it('keeps diagnostics off inert and retains fixed storage with observations enabled', () => {
    const a = new OwnedSineKernel(48000), b = new OwnedSineKernel(48000); a.accept(command(), 1); b.accept(command(), 1);
    b.configureDisplay(wanted(), 2400, 1); const state = b.displayState, data = b.displayData;
    for (let frame = 0; frame < 4800; frame += 128) {
      const disabled = render(a, 128, frame), enabled = render(b, 128, frame);
      expect(enabled.left).to.deep.equal(disabled.left); expect(enabled.right).to.deep.equal(disabled.right);
    }
    expect(a.displayReady).to.equal(false); expect(a.displaySequence).to.equal(0);
    expect(b.displayState).to.equal(state); expect(b.displayData).to.equal(data); expect(b.displayReady).to.equal(true);
  });

  it('measures each actual pre-sum voice window without including its pending onset silence', () => {
    const kernel = new OwnedSineKernel(48000); kernel.configureDisplay(wanted(), 2400, 1); kernel.accept(command(BEGIN, 480), 1);
    const pcm = render(kernel, 2400), row = kernel.displayData;
    let square = 0, peak = 0;
    for (let n = 480; n < 2400; n++) { const value = Math.hypot(pcm.left[n], pcm.right[n]); square += value * value; peak = Math.max(peak, value); }
    expect(kernel.displayCount).to.equal(1); expect(row[4]).to.equal(480); expect(row[5]).to.equal(2400); expect(row[6]).to.equal(1920);
    expect(row[7]).to.equal(480); expect(row[8]).to.be.closeTo(Math.sqrt(square / 1920), 1e-7); expect(row[9]).to.be.closeTo(peak, 1e-7);
  });

  it('publishes applied parameter state only after a delayed command reaches its frame', () => {
    const kernel = new OwnedSineKernel(48000); kernel.configureDisplay(wanted(), 1600, 1); kernel.accept(command(), 1);
    kernel.accept(command(UPDATE, 2400, 2, 0, 1, { 8: 0, 14: 1, 15: 2 }), 1, 2);
    render(kernel, 1600); expect(kernel.displayData[12]).to.equal(1); expect(kernel.displayData[7]).to.equal(0);
    render(kernel, 1600, 1600); expect(kernel.displayData[12]).to.equal(0); expect(kernel.displayData[7]).to.equal(2400);
  });

  it('reports valid terminal zero separately from missing phase and drops only display windows under pressure', () => {
    const kernel = new OwnedSineKernel(48000); kernel.configureDisplay(wanted(), 2400, 1); kernel.accept(command(), 1);
    kernel.accept(command(END, 1000, 2, 0, 1, { 13: 48 }), 1, 2); render(kernel, 2400);
    expect(kernel.displayData[9]).to.equal(0); expect(kernel.displayData[15]).to.equal(2); expect(kernel.displayData[6]).to.equal(1);
    const busy = new OwnedSineKernel(48000); busy.configureDisplay(wanted(), 2400, 1); busy.accept(command(), 1); render(busy, 9600);
    expect(busy.displayDropped).to.equal(3); expect(busy.displaySequence).to.equal(4); expect(busy.counters[1]).to.equal(0);
  });

  it('caps selected reductions at32 and rejects stale mask revisions without touching music', () => {
    const kernel = new OwnedSineKernel(48000);
    expect(kernel.configureDisplay(wanted(33), 2400, 1)).to.equal(false);
    expect(kernel.configureDisplay(wanted(32), 2400, 1)).to.equal(true);
    expect(kernel.configureDisplay(wanted(), 2400, 1)).to.equal(false);
    for (let slot = 0; slot < 64; slot++) kernel.accept(command(BEGIN, 0, slot + 1, slot), 1, slot + 1);
    render(kernel, 2400); expect(kernel.displayCount).to.equal(32); expect(kernel.active.reduce((sum, value) => sum + value, 0)).to.equal(64);
  });

  it('allows only one feature packet in flight while latest windows replace older unsent windows', () => {
    const previousRate = globalThis.sampleRate, previousFrame = globalThis.currentFrame, sent = [];
    const port = { onmessage: null, postMessage: item => sent.push({ ...item, data: item.data?.slice() }) };
    Object.defineProperty(OwnedSineProcessor.prototype, 'port', { value: port, configurable: true });
    try {
      globalThis.sampleRate = 48000; globalThis.currentFrame = 0;
      const processor = new OwnedSineProcessor({}); processor.kernel.configureDisplay(wanted(), 2400, 1); processor.kernel.accept(command(), 1);
      for (let frame = 0; frame < 9600; frame += 128) { globalThis.currentFrame = frame; processor.process([], [[new Float32Array(128), new Float32Array(128)]]); }
      const features = sent.filter(item => item.type === 'display-samples'); expect(features).to.have.length(1);
      expect(processor.kernel.displayDropped).to.be.greaterThan(0);
      port.onmessage({ data: { type: 'display-ack', sequence: features[0].sequence } });
      expect(sent.filter(item => item.type === 'display-samples')).to.have.length(2);
    } finally {
      delete OwnedSineProcessor.prototype.port;
      if (previousRate === undefined) delete globalThis.sampleRate; else globalThis.sampleRate = previousRate;
      if (previousFrame === undefined) delete globalThis.currentFrame; else globalThis.currentFrame = previousFrame;
    }
  });
});

describe('Audio display observation leases', () => {
  it('enforces each observer voice budget even when another observer expands the union', () => {
    const { telemetry, voices, context, messages } = host(), small = [], large = [];
    const second = voice(1); voices.push(second); telemetry.admit(second, { actorId: 4, onsetId: 'second' }); context.currentTime = 0;
    telemetry.observe(value => small.push(value), { identity, maxVoices: 1 });
    telemetry.observe(value => large.push(value), { identity, maxVoices: 2 }); context.currentTime = 0.05;
    const revision = messages.filter(item => item.type === 'display-config').at(-1).revision;
    for (let slot = 0; slot < 2; slot++) { const incoming = packet(slot); incoming.revision = revision; telemetry.consume(incoming); }
    expect(small).to.have.length(1); expect(large).to.have.length(2);
    expect(small[0].selectionCoverage).to.include({ eligible: 2, selected: 1, omitted: 1 });
    expect(large[0].selectionCoverage).to.include({ eligible: 2, selected: 2, omitted: 0 }); telemetry.dispose();
  });

  it('stamps immutable admission identity and keeps measured, applied and kernel state separate', () => {
    const { telemetry, context } = host(), samples = []; context.currentTime = 0;
    telemetry.observe(value => samples.push(value), { identity }); telemetry.setContext({ ...identity, worldId: 'later-world' });
    context.currentTime = 0.05; telemetry.consume(packet()); const sample = samples[0];
    expect(sample).to.include({ owner: 'owner', worldId: 'world', contextEpoch: 4, actorId: 3, scope: 'actorVoice', acousticReceipt: false });
    expect(sample.routeState.muted).to.equal(null); expect(sample.detector.envelope).to.equal('window-peak');
    expect(sample.quantities.find(value => value.name === 'peak').evidenceClass).to.equal('measured');
    expect(sample.quantities.find(value => value.name === 'pressure').evidenceClass).to.equal('applied-parameter');
    expect(sample.quantities.find(value => value.name === 'oscillator-phase').unit).to.equal('radians');
    expect(Object.isFrozen(sample.quantities[0])).to.equal(true); telemetry.dispose();
  });

  it('isolates two owner leases and observer exceptions and revokes without changing voices', () => {
    const a = host({ owner: 'A' }), b = host({ owner: 'B' }), samplesA = [], samplesB = [];
    a.context.currentTime = b.context.currentTime = 0;
    const releaseA = a.telemetry.observe(value => samplesA.push(value), { identity });
    a.telemetry.observe(() => { throw new Error('observer'); }, { identity });
    const releaseB = b.telemetry.observe(value => samplesB.push(value), { identity }); releaseB(); releaseB();
    a.context.currentTime = b.context.currentTime = 0.05; a.telemetry.consume(packet()); b.telemetry.consume(packet());
    expect(samplesA).to.have.length(1); expect(samplesB).to.have.length(0); expect(a.voices).to.have.length(1);
    expect(a.telemetry.diagnostics().observerErrors).to.equal(1); releaseA(); a.telemetry.dispose(); b.telemetry.dispose();
  });

  it('filters exact execution/generation and recycled slots and discards hidden/context-stale callbacks', () => {
    const { telemetry, voices, context, state } = host(), samples = []; context.currentTime = 0;
    telemetry.observe(value => samples.push(value), { identity }); context.currentTime = 0.05;
    telemetry.consume(packet(0, 1, 2)); expect(samples).to.have.length(0);
    telemetry.retire(voices[0]); voices[0] = { ...voice(0, 2), slotToken: 2 }; telemetry.admit(voices[0], { actorId: 3, onsetId: 'new' }); telemetry.configure();
    telemetry.consume(packet(0, 2, 2)); expect(samples).to.have.length(0);
    state.epoch = 5; telemetry.consume(packet()); expect(samples).to.have.length(0); telemetry.stop(); telemetry.consume(packet());
    expect(telemetry.diagnostics().observers).to.equal(0); expect(telemetry.inspect()).to.have.length(0);
  });

  it('pre-admits observer storage and releases it on the final unsubscribe', () => {
    const budget = createResourceBudget(), resources = createAudioResourceLeases({ resourceBudget: budget }), { telemetry, context } = host({ resources });
    context.currentTime = 0; const release = telemetry.observe(() => {}, { identity });
    expect(resources.diagnostics().exactBytes).to.equal(512); expect(resources.diagnostics().estimatedBytes).to.equal(192 * 1024);
    release(); expect(budget.diagnostics().residentBytes).to.equal(0); telemetry.dispose();
    const denied = host({ resources: createAudioResourceLeases({ resourceBudget: createResourceBudget({ limitBytes: 4096 }) }) });
    expect(() => denied.telemetry.observe(() => {}, { identity })).to.throw('available'); expect(denied.messages).to.have.length(0); denied.telemetry.dispose();
  });

  it('uses stable crowd LOD and does not reset a detector when its demand mask stays unchanged', () => {
    const { telemetry, voices, context, messages } = host();
    for (let slot = 1; slot < 64; slot++) { const entry = voice(slot); voices.push(entry); telemetry.admit(entry, { actorId: slot + 3, onsetId: 'onset:' + slot }); }
    context.currentTime = 0; telemetry.observe(() => {}, { identity, maxVoices: 32, rateHz: 30 });
    expect(telemetry.diagnostics()).to.include({ eligible: 64, selected: 32 });
    const count = messages.length; telemetry.configure(); expect(messages).to.have.length(count); telemetry.dispose();
  });

  it('rejects malformed display packets without affecting audio and acknowledges the display credit', () => {
    const { telemetry, context, messages } = host(); context.currentTime = 0;
    telemetry.observe(() => { throw new Error('unexpected'); }, { identity }); context.currentTime = 0.05;
    const invalid = packet(); invalid.data[12] = 100; telemetry.consume(invalid);
    expect(telemetry.diagnostics().rejected).to.equal(1); expect(messages.at(-1).type).to.equal('display-ack'); telemetry.dispose();
  });
});
