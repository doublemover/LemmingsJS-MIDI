import { expect } from 'chai';
import { createHash } from 'node:crypto';
import { decodeWaveSource } from '../../js/app/resources/WaveSourceDecode.js';
import { createAudioAssetLoader } from '../../js/app/midi-ui/AudioAssetLoader.js';
import { DECODER_VERSION } from '../../js/app/midi-ui/AudioAssetRef.js';
import { WAVE_SOURCE_DECODER_VERSION } from '../../js/app/midi-ui/WaveSourceProfile.js';
import { createAudioResourceLeases } from '../../js/app/midi-ui/AudioResourceLeases.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';
import { prepareOwnedPcmBank } from '../../js/app/midi-ui/OwnedPcmBank.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fixture = (bits = 16, float = false) => {
  const values = float ? [-0.75, 0, 0.25] : bits === 8 ? [0, 128, 255] : [-(2 ** (bits - 1)), 0, 2 ** (bits - 1) - 1];
  const channels = 2, frames = values.length, bytes = new Uint8Array(44 + frames * channels * bits / 8), view = new DataView(bytes.buffer);
  const four = (at, text) => { for (let index = 0; index < 4; index++) bytes[at + index] = text.charCodeAt(index); };
  four(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); four(8, 'WAVE'); four(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, float ? 3 : 1, true); view.setUint16(22, channels, true); view.setUint32(24, 32000, true); view.setUint32(28, 32000 * channels * bits / 8, true);
  view.setUint16(32, channels * bits / 8, true); view.setUint16(34, bits, true); four(36, 'data'); view.setUint32(40, frames * channels * bits / 8, true);
  for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < channels; channel++) {
    const value = values[channel ? frames - 1 - frame : frame], at = 44 + (frame * channels + channel) * bits / 8;
    if (float) view.setFloat32(at, value, true); else if (bits === 8) view.setUint8(at, value);
    else if (bits === 16) view.setInt16(at, value, true); else if (bits === 32) view.setInt32(at, value, true);
    else { view.setUint8(at, value & 255); view.setUint8(at + 1, value >> 8 & 255); view.setUint8(at + 2, value >> 16 & 255); }
  }
  const expected = values.map(value => Math.fround(float ? value : bits === 8 ? (value - 128) / 128 : value / 2 ** (bits - 1)));
  const ref = { contentHash: hash(bytes), bytes: bytes.length, kind: 'sample', frames, channels, sourceSampleRate: 32000, path: 'source/original.wav', mime: 'audio/wav',
    decodeVersion: DECODER_VERSION, licenseId: 'NOASSERTION', attribution: 'Original synthetic decode fixture' };
  return { bytes, ref, expected };
};
const decode = input => decodeWaveSource({ bytes: input.bytes, ref: input.ref }, { maxBytes: input.bytes.length, estimatedPeakBytes: 16 * 1048576, yieldControl: async () => {} });
// Authored for the final deferred execution pass.
describe('source-rate WAV PCM cache variant', () => {
  for (const [bits, float] of [[8, false], [16, false], [24, false], [32, false], [32, true]]) {
    it('preserves integer sign, channel order and source-rate frames for ' + bits + (float ? ' float' : ' integer'), async () => {
      const input = fixture(bits, float), result = await decode(input), value = result.value;
      expect([...value.planes[0]]).to.deep.equal(input.expected); expect([...value.planes[1]]).to.deep.equal([...input.expected].reverse());
      expect(value).to.include({ sampleRate: 32000, frames: 3, channels: 2, decoderVersion: WAVE_SOURCE_DECODER_VERSION });
      expect(value.pcmHash).to.equal(hash(Buffer.concat(value.planes.map(plane => Buffer.from(plane.buffer)))));
    });
  }
  it('refuses corrupt float PCM and incompatible source metadata before publication', async () => {
    const input = fixture(32, true); new DataView(input.bytes.buffer).setFloat32(44, NaN, true); input.ref.contentHash = hash(input.bytes);
    let error; try { await decode(input); } catch (caught) { error = caught; } expect(error?.code).to.equal('invalid-data');
    const invalid = fixture(); invalid.ref.frames++;
    try { await decode(invalid); } catch (caught) { error = caught; } expect(error?.code).to.equal('content-mismatch');
  });
  it('shares source PCM without requesting a context and binds copied cloud banks to its decoded hash', async () => {
    const input = fixture(), budget = createResourceBudget(); let contextReads = 0;
    const jobs = { async compute(spec) { const result = await decode(await spec.prepareInput()); let phase = 'computed';
      return { value: result.value, release() { phase = 'released'; }, retirementState: () => ({ phase }) }; } };
    const loader = createAudioAssetLoader({ getContext() { contextReads++; return null; }, fetchAsset: async () => input.bytes, resourceBudget: budget, jobs });
    const a = await loader.acquire(input.ref, { decodeProfile: 'source-pcm' }), b = await loader.acquire(input.ref, { decodeProfile: 'source-pcm' });
    expect(contextReads).to.equal(0); expect(a.buffer).to.equal(b.buffer); expect(loader.diagnostics().decodes).to.equal(1);
    const resources = createAudioResourceLeases({ resourceBudget: budget }), bank = await prepareOwnedPcmBank(a, { resources, owner: 'source-test' });
    expect(bank.descriptor.pcmHash).to.equal(a.variant.pcmHash);
    a.buffer.getChannelData(0)[0] = 0.7;
    let rejected; try { await prepareOwnedPcmBank(a, { resources, owner: 'source-test' }); } catch (error) { rejected = error; }
    expect(rejected?.message).to.include('differs from its verified source variant');
    await bank.discard().completion; a.release(); b.release(); await loader.dispose().completion;
    expect(budget.diagnostics().accountedBytes).to.equal(0);
  });
});
