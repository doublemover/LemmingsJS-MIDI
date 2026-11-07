import { expect } from 'chai';
import { createAudioResourceLeases } from '../../js/app/midi-ui/AudioResourceLeases.js';
import { createLiveLaneSourceBuses } from '../../js/app/midi-ui/LiveLaneSourceBuses.js';
import { createVoiceLaneMix } from '../../js/app/midi-ui/VoiceLaneMix.js';
import { OwnedSineKernel, OwnedSineProcessor, WIDTH, BEGIN, MIX, REJECTED } from '../../js/app/midi-ui/worklet/OwnedSineProcessor.js';
import { LIVE_LANE_TAP_LIMIT, LIVE_LANE_TAP_PROTOCOL } from '../../js/app/midi-ui/OwnedSourceLayout.js';

const parameter = () => ({ calls: [], setValueAtTime(value, time) { this.calls.push(['set', value, time]); }, linearRampToValueAtTime(value, time) { this.calls.push(['ramp', value, time]); }, cancelScheduledValues() {} });
const node = () => ({ gain: parameter(), pan: parameter(), connections: new Set(), connect(target) { this.connections.add(target); }, disconnect(target) { if (target) this.connections.delete(target); else this.connections.clear(); } });
const pair = frames => [new Float32Array(frames), new Float32Array(frames)];
const command = (opcode, frame, sequence, values = {}) => Object.assign(new Array(WIDTH).fill(0), { 0: 1, 1: frame, 2: sequence, 3: opcode, 4: 0, 5: 9, 6: opcode === BEGIN ? 440 : 0, 7: 0.5, 8: 1, 12: 1, 13: 100, 16: 48000, 17: 1 }, values);
const identity = { engineArtifactHash: 'a'.repeat(64), patchDefinitionHash: 'b'.repeat(64), graphRevision: 1 };

describe('carried source lane identity (fixtures awaiting the combined runtime pass)', () => {
  it('schedules native donor fades at the target frame and keeps selected voice ancestry unchanged', async () => {
    const context = { state: 'running', currentTime: 0, sampleRate: 48000, createGain: node, createStereoPanner: node }, resources = createAudioResourceLeases();
    const buses = createLiveLaneSourceBuses({ context, resources, owner: 'physical', generation: 7, isCurrent: () => true }); buses.declare(['a', 'b', 'c']);
    const mix = createVoiceLaneMix({ preview: { _audioResources: resources, _laneSourcesFor: () => buses }, context, owner: 'physical', generation: 7, destination: node(), start: 0, laneId: 'a', voiceId: 'held' });
    const pin = id => buses.pin({ sourceBusId: 'lane:' + id, tap: 'pre-fader', inputLayout: 'audioStereo' }), a = pin('a');
    const selected = buses.pin({ sourceBusId: 'voices:selected', voiceSelection: [{ voiceId: 'held', generation: 7 }], tap: 'pre-fader', inputLayout: 'audioStereo' });
    expect(mix.input.connections.has(selected.node)).to.equal(true);
    expect(mix.update({ gain: 1, pan: 0 }, 4800, 'b').status).to.equal('accepted');
    const b = pin('b'), pathA = [...mix.input.connections].find(value => value.connections.has(a.node)), pathB = [...mix.input.connections].find(value => value.connections.has(b.node));
    expect(pathA.gain.calls.find(call => call[0] === 'ramp' && call[1] === 0)?.[2]).to.be.closeTo(0.108, 1e-12);
    expect(pathB.gain.calls.find(call => call[0] === 'ramp' && call[1] === 1)?.[2]).to.be.closeTo(0.108, 1e-12);
    expect(pathB.gain.calls[0]).to.deep.equal(['set', 0, 0]); expect(context.currentTime).to.equal(0);
    const retained = resources.diagnostics().reservations;
    expect(mix.update({ gain: 1, pan: 0 }, 4900, 'c')).to.include({ status: 'rejected', reason: 'lane-source-transfer-admission' });
    expect(resources.diagnostics().reservations).to.equal(retained); expect(mix.input.connections.has(selected.node)).to.equal(true);
    context.currentTime = 0.2;
    expect(mix.update({ gain: 1, pan: 0 }, 10000, 'c').status).to.equal('accepted'); expect(pathA.connections.size).to.equal(0);
    mix.dispose(); a.release(); b.release(); selected.release(); await buses.dispose().completion;
    expect(resources.diagnostics().reservations).to.equal(0); await resources.dispose().completion;
  });

  it('never reuses a retired bus slot as a stable lane identity', async () => {
    const context = { state: 'running', currentTime: 0, sampleRate: 48000, createGain: node }, resources = createAudioResourceLeases();
    const buses = createLiveLaneSourceBuses({ context, resources, owner: 'physical', generation: 1, isCurrent: () => true }); buses.declare(['a', 'b']);
    const records = [], producer = buses.registerRenderer({ attach: bus => { records.push({ laneId: bus.laneId, index: bus.index, token: bus.laneToken }); }, detach() {} });
    const pin = id => buses.pin({ sourceBusId: 'lane:' + id, tap: 'post-fader', inputLayout: 'audioStereo' });
    const first = pin('a'); first.release(); const next = pin('b');
    expect(records[0].index).to.equal(records[1].index); expect(records[0].token).not.to.equal(records[1].token);
    expect(buses.laneToken('a')).to.equal(records[0].token); next.release(); producer(); await buses.dispose().completion; await resources.dispose().completion;
  });

  for (const rate of [44100, 48000, 96000]) it('preserves dry audio, exact fade timing, selected groups and state cuts at ' + rate + ' Hz', () => {
    const original = new OwnedSineKernel(rate, 1); original.setLaneIdentity(0, 9, 11);
    const rows = [command(BEGIN, 0, 1), command(MIX, 128, 2, { 6: 22, 7: 1, 14: Math.ceil(rate * 0.008) })];
    original.accept(Float64Array.from(rows.flat()), 2);
    const run = (kernel, frames, laneTokens = [11, 22, 0]) => {
      const channels = laneTokens.map(() => pair(frames)), preChannels = laneTokens.map(() => pair(frames)), left = new Float32Array(frames), right = new Float32Array(frames);
      kernel.render(left, right, kernel.lastFrame, { routeMode: 'mask', routes: new Uint16Array([4]), tokens: new Uint32Array([9]), laneTokens: Uint32Array.from(laneTokens), channels, preChannels });
      return { left, right, channels, preChannels };
    };
    const start = run(original, 200);
    for (let frame = 0; frame < 200; frame++) {
      const amount = frame < 128 ? 0 : (frame - 128) / Math.ceil(rate * 0.008);
      expect(start.channels[0][0][frame]).to.be.closeTo(start.left[frame] * (1 - amount), 1e-7);
      expect(start.channels[1][0][frame]).to.be.closeTo(start.left[frame] * amount, 1e-7);
      expect(start.channels[2][0][frame]).to.equal(start.left[frame]);
    }
    const bytes = new Uint8Array(original.stateByteLength()); original.snapshotInto(bytes, identity);
    const restored = new OwnedSineKernel(rate, 1); restored.restoreFrom(bytes, identity);
    expect(run(restored, 1000)).to.deep.equal(run(original, 1000));
    const reused = run(restored, 128, [33, 22, 0]); expect(reused.channels[0][0].every(value => value === 0)).to.equal(true);
    expect(reused.channels[1][0]).to.deep.equal(reused.left); expect(reused.channels[2][0]).to.deep.equal(reused.left);
  });

  it('refuses overlapping fades before changing either route or lane mix', () => {
    const kernel = new OwnedSineKernel(48000, 1); kernel.setLaneIdentity(0, 9, 1);
    kernel.accept(Float64Array.from([command(BEGIN, 0, 1), command(MIX, 10, 2, { 6: 2, 7: 1, 14: 384 }), command(MIX, 20, 3, { 6: 3, 7: 0, 14: 384 })].flat()), 3);
    kernel.render(...pair(30), 0);
    expect(kernel.laneRoutes[1]).to.equal(2); expect(kernel.mix[1]).to.equal(1);
    expect(Array.from({ length: kernel.receiptCount }, (_, index) => Array.from(kernel.receipts.subarray(index * 6, index * 6 + 6))).some(row => row[0] === REJECTED && row[1] === 3)).to.equal(true);
    expect(kernel.setLaneIdentity(0, 8, 3)).to.equal(false); expect(kernel.setLaneIdentity(0, 9, 3)).to.equal(false);
  });

  it('applies processor lane metadata independently of pending future transfer commands', () => {
    const saved = { port: Object.getOwnPropertyDescriptor(OwnedSineProcessor.prototype, 'port'), rate: Object.getOwnPropertyDescriptor(globalThis, 'sampleRate'), frame: Object.getOwnPropertyDescriptor(globalThis, 'currentFrame') };
    const port = { postMessage() {} };
    Object.defineProperty(OwnedSineProcessor.prototype, 'port', { configurable: true, value: port }); globalThis.sampleRate = 48000; globalThis.currentFrame = 0;
    try {
      const processor = new OwnedSineProcessor({ processorOptions: { maxVoices: 1, laneTapProtocol: LIVE_LANE_TAP_PROTOCOL } });
      const send = data => port.onmessage({ data: { protocol: LIVE_LANE_TAP_PROTOCOL, ...data } });
      send({ type: 'lane-route', slot: 0, token: 9, laneToken: 1, route: 0 }); send({ type: 'lane-tap', index: 0, laneToken: 1, enabled: true });
      processor.kernel.accept(Float64Array.from([command(BEGIN, 0, 1), command(MIX, 256, 2, { 6: 2, 7: 1, 14: 384 })].flat()), 2);
      const outputs = Array.from({ length: 1 + LIVE_LANE_TAP_LIMIT * 2 }, () => pair(128)); processor.process([], outputs);
      expect(outputs[2][0]).to.deep.equal(outputs[0][0]);
      send({ type: 'lane-tap', index: 0, laneToken: 3, enabled: true }); globalThis.currentFrame = 128; processor.process([], outputs);
      expect(outputs[2][0].every(value => value === 0)).to.equal(true); expect(outputs[0][0].some(value => value !== 0)).to.equal(true);
    } finally {
      for (const [target, key, descriptor] of [[OwnedSineProcessor.prototype, 'port', saved.port], [globalThis, 'sampleRate', saved.rate], [globalThis, 'currentFrame', saved.frame]]) {
        if (descriptor) Object.defineProperty(target, key, descriptor); else delete target[key];
      }
    }
  });
});
