import { expect } from 'chai';
import { createHash } from 'node:crypto';
import { inspectOwnedCueWave, prepareOwnedPcmCue } from '../../js/app/midi-ui/OwnedPcmCue.js';
import { encodeCausalRenderWave } from '../../js/app/midi-ui/CausalOwnedRender.js';
import { createAudioResourceLeases } from '../../js/app/midi-ui/AudioResourceLeases.js';
import { destroyNativeVoice } from '../../js/app/midi-ui/NativeVoiceLifetime.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';

const wave = () => {
  const pcm = new Uint8Array(256 * 8), view = new DataView(pcm.buffer); view.setFloat32(16, 0.25, true);
  const manifest = { pcmHash: createHash('sha256').update(pcm).digest('hex'), frames: 256, channels: 2, sampleRate: 48000, sampleFormat: 'ieee-float32-le' };
  return { bytes: encodeCausalRenderWave(pcm, 256, 48000, manifest), manifest };
};
const previewOwner = () => {
  const budget = createResourceBudget(), resources = createAudioResourceLeases({ resourceBudget: budget }), nodes = [];
  const node = () => { const result = { buffer: null, onended: null, disconnectFailure: false, started: false, stopped: false, disconnected: false,
    connect() {}, disconnect() { if (this.disconnectFailure) throw new Error('Native disconnection unknown.'); this.disconnected = true; }, start() { this.started = true; }, stop() { this.stopped = true; },
    gain: { calls: [], setValueAtTime(value, time) { this.calls.push(['set', value, time]); }, linearRampToValueAtTime(value, time) { this.calls.push(['ramp', value, time]); } } }; nodes.push(result); return result; };
  const context = { state: 'running', currentTime: 0, createBuffer(channels, frames, rate) { const data = Array.from({ length: channels }, () => new Float32Array(frames)); return { length: frames, numberOfChannels: channels, sampleRate: rate, getChannelData: index => data[index] }; }, createBufferSource: node, createGain: node };
  const preview = { _sessions: new Map([['cue', { generation: 0, workloadClass: 'cue' }]]), _context: context, _audioResources: resources, _voices: new Set(), _voicesByToken: new Map(), _retiredVoices: new Map(), _retirementFaults: new Set(), _voiceSequence: 0,
    _ownerReady: () => true, _inspectVoiceInterval: () => ({ accepted: true }), _nowMs: () => 0, _cueRouting: { getInput: () => ({}) },
    getMonitorRouteState: () => ({ cueIncludedInMasterCapture: true }), _observe() {}, _emitPlayback() {}, _setStatus() {}, _destroyVoice(voice, reason) { return destroyNativeVoice.call(this, voice, reason); } };
  return { preview, budget, resources, nodes };
};

describe('owned rendered PCM cue', () => {
  it('applies explicit bounded attenuation to the real native gain envelope without rewriting PCM', async () => {
    const f = previewOwner(), input = wave(), before = input.bytes.slice(), cue = await prepareOwnedPcmCue(f.preview, 'cue', input);
    for (const level01 of [NaN, Infinity, -0.1, 1.01]) expect(() => cue.play({ level01 })).to.throw('attenuation');
    expect(f.nodes).to.have.length(0); expect(cue.play({ level01: 0.25 }).status).to.equal('accepted');
    expect(f.nodes[1].gain.calls.map(call => call[1])).to.deep.equal([0, 0.25, 0.25, 0]); expect(input.bytes).to.deep.equal(before);
    const receipt = cue.dispose(); await receipt.completion; expect(receipt.outcome).to.equal('complete'); expect(f.budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('checks complete chunks, exact frames and PCM identity before allocating native storage', async () => {
    const input = wave(), f = previewOwner(); expect(inspectOwnedCueWave(input.bytes, input.manifest)).to.deep.equal({ offset: 56, bytes: 2048 });
    const changed = input.bytes.slice(); changed[56] ^= 1; let error;
    try { await prepareOwnedPcmCue(f.preview, 'cue', { ...input, bytes: changed }); } catch (caught) { error = caught; }
    expect(error.message).to.include('identity'); expect(f.budget.diagnostics().accountedBytes).to.equal(0);
    for (const offset of [4, 20, 22, 24, 44, 52]) { const bytes = input.bytes.slice(); bytes[offset] ^= 1; expect(() => inspectOwnedCueWave(bytes, input.manifest), String(offset)).to.throw(); }
  });
  it('plays once within cue admission and retires the source, buffer and source quota together', async () => {
    const f = previewOwner(), input = wave(), original = input.bytes.slice(), cue = await prepareOwnedPcmCue(f.preview, 'cue', input);
    expect(cue.metadata.cueIncludedInMasterCapture).to.equal(true); expect(cue.play().status).to.equal('accepted'); expect(f.preview._voices.size).to.equal(1); expect(() => cue.play()).to.throw();
    const source = f.nodes[0]; expect(source.buffer.getChannelData(0)[2]).to.equal(0.25); expect(input.bytes).to.deep.equal(original);
    const receipt = cue.onOwnerStop(); await receipt.completion; expect(receipt.outcome).to.equal('complete'); expect(source.stopped).to.equal(true); expect(source.buffer).to.equal(null); expect(f.preview._voices.size).to.equal(0); expect(f.budget.diagnostics().accountedBytes).to.equal(0);
    expect((await cue.completion).outcome).to.equal('complete');
  });
  it('declines a busy cue quota without stealing live voices or constructing a native source', async () => {
    const f = previewOwner(), cue = await prepareOwnedPcmCue(f.preview, 'cue', wave()); f.preview._inspectVoiceInterval = () => ({ accepted: false });
    expect(() => cue.play()).to.throw('quota'); expect(f.nodes).to.have.length(0); const retired = cue.dispose(); await retired.completion; expect(retired.outcome).to.equal('complete'); expect(f.budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('retains concrete native ownership and its declared PCM when disconnection is uncertain', async () => {
    const f = previewOwner(), cue = await prepareOwnedPcmCue(f.preview, 'cue', wave()); cue.play(); f.nodes[0].disconnectFailure = true;
    const retired = cue.onOwnerStop(); await retired.completion; expect(retired.outcome).not.to.equal('complete'); expect(f.preview._retiredVoices.size).to.equal(1); expect(f.budget.diagnostics().accountedBytes).to.be.greaterThan(2048);
  });
  it('rejects a changed session generation before playback', async () => {
    const f = previewOwner(), cue = await prepareOwnedPcmCue(f.preview, 'cue', wave()); f.preview._sessions.get('cue').generation++;
    expect(() => cue.play()).to.throw('changed'); const retired = cue.dispose(); await retired.completion; expect(f.budget.diagnostics().accountedBytes).to.equal(0);
  });
});
