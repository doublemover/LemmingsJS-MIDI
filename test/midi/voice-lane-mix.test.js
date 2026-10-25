import { expect } from 'chai';
import { createVoiceLaneMix } from '../../js/app/midi-ui/VoiceLaneMix.js';
import { createAudioResourceLeases } from '../../js/app/midi-ui/AudioResourceLeases.js';
import { createLaneMixState, formatLaneGain, parseLaneGain } from '../../js/app/procgen/workstation/LaneMixState.js';
import { captureCausalPerformanceState, createCausalPerformanceState, diffCausalLanePerformance } from '../../js/app/procgen/workstation/CausalPerformanceState.js';
import { OwnedSineKernel, BEGIN, MIX, WIDTH } from '../../js/app/midi-ui/worklet/OwnedSineProcessor.js';

const param = () => ({ calls: [], setValueAtTime(value, time) { this.calls.push(['set', value, time]); }, linearRampToValueAtTime(value, time) { this.calls.push(['ramp', value, time]); }, cancelScheduledValues(time) { this.calls.push(['cancel', time]); } });
const node = parameter => ({ [parameter]: param(), connections: [], connect(target) { this.connections.push(target); }, disconnect() { this.connections = []; } });
const row = (opcode, sequence, frame, slot, values = {}) => Object.assign(new Array(WIDTH).fill(0), { 0: 1, 1: frame, 2: sequence, 3: opcode, 4: slot, 5: 1, 6: opcode === MIX ? 0 : 440, 7: 0.5, 8: 1, 12: 1, 13: 40, 16: 8000, 17: 1 }, values);

describe('independent lane mix ownership', () => {
  it('keeps lane gain/pan separate from physical expression and retires both native nodes exactly once', async () => {
    const resources = createAudioResourceLeases(), context = { currentTime: 0, sampleRate: 48000, createGain: () => node('gain'), createStereoPanner: () => node('pan') };
    const mix = createVoiceLaneMix({ preview: { _audioResources: resources }, context, owner: 'physical', generation: 1, destination: {}, start: 0, value: { gain: 2, pan: -1 } });
    expect(mix.input.gain.calls[0]).to.deep.equal(['set', 2, 0]);
    expect(mix.update({ gain: 0, pan: 1 }, 480).status).to.equal('accepted');
    expect(mix.input.gain.calls.some(call => call[0] === 'ramp' && call[1] === 0)).to.equal(true);
    await mix.dispose(); await mix.dispose(); expect(resources.diagnostics().reservations).to.equal(0);
  });
  it('preserves mute/solo identity under reorder and never fabricates signal evidence from event traffic', () => {
    const state = createLaneMixState(), a = { id: 'a', gain: 1, pan: 0, mute: false, solo: true }, b = { id: 'b', gain: 0.5, pan: 127, mute: false, solo: false };
    state.synchronize([a, b]); expect(state.mix('b')).to.include({ gain: 0, pan: 1, soloSuppressed: true });
    state.record('a', 100, 'accepted'); const view = state.view('a', { nowMs: 200, connected: true });
    expect(view).to.include({ localPeak: null, localRms: null, meterSource: 'semantic-event-activity', signalStatus: 'unavailable' });
    state.synchronize([b, a]); expect(state.mix('a').gain).to.equal(1); expect(state.view('a', { nowMs: 1200, connected: true }).eventRate).to.equal(0);
    expect(formatLaneGain(0)).to.equal('−∞ dB'); expect(formatLaneGain(1)).to.equal('0.0 dB'); expect(parseLaneGain('-6')).to.be.closeTo(0.501187233627, 1e-12);
  });
  it('records sparse lane mix edits as performance state and restores destination admission', () => {
    const before = [{ id: 'a', gain: 1, pan: 0, mute: false, solo: false }], after = [{ ...before[0], gain: 0.25, mute: true }];
    const replay = createCausalPerformanceState(captureCausalPerformanceState(before)); replay.apply(diffCausalLanePerformance(before, after, ['a']));
    expect(replay.getMix(0).gain).to.equal(0.25); expect(replay.getLaneState(0).available).to.equal(false);
  });
  it('mutes exactly one worklet voice without changing pressure, its neighbor or resumable mix ramps', () => {
    const kernel = new OwnedSineKernel(8000, 2), commands = [row(BEGIN, 1, 0, 0, { 14: 2 }), row(BEGIN, 2, 0, 1, { 14: 2 }), row(MIX, 3, 100, 0, { 7: 0, 9: -1, 14: 16 })];
    kernel.accept(Float64Array.from(commands.flat()), commands.length); const left = new Float32Array(108), right = new Float32Array(108); kernel.render(left, right, 0);
    const identity = { engineArtifactHash: 'a'.repeat(64), patchDefinitionHash: 'b'.repeat(64), graphRevision: 1 }, saved = new Uint8Array(kernel.stateByteLength()); kernel.snapshotInto(saved, identity);
    const resumed = new OwnedSineKernel(8000, 2); resumed.restoreFrom(saved, identity);
    const run = source => { const l = new Float32Array(100), r = new Float32Array(100); source.render(l, r, 108); return [Array.from(l), Array.from(r)]; };
    expect(run(resumed)).to.deep.equal(run(kernel)); expect(kernel.mix[0]).to.equal(0); expect(kernel.mix[6]).to.equal(1); expect(kernel.voice[8]).to.equal(1); expect(kernel.active[0]).to.equal(1);
  });
});
