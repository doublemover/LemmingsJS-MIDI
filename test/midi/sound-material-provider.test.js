import { expect } from 'chai';
import { createHash } from 'node:crypto';
import { inspectWaveContainer } from '../../js/app/midi-ui/AudioAssetRef.js';
import { runBackgroundJobKernel } from '../../js/app/resources/BackgroundJobKernels.js';
import { createSoundMaterialProvider } from '../../js/app/midi-ui/SoundMaterialProvider.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';

const wav = ({ channels = 2, rate = 44100, frames = 1024, value = 0.25 } = {}) => {
  const bytes = new Uint8Array(44 + channels * frames * 4), view = new DataView(bytes.buffer);
  const four = (at, text) => { for (let index = 0; index < 4; index++) bytes[at + index] = text.charCodeAt(index); };
  four(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); four(8, 'WAVE'); four(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 3, true); view.setUint16(22, channels, true); view.setUint32(24, rate, true); view.setUint32(28, rate * channels * 4, true);
  view.setUint16(32, channels * 4, true); view.setUint16(34, 32, true); four(36, 'data'); view.setUint32(40, frames * channels * 4, true);
  for (let offset = 44; offset < bytes.length; offset += 4) view.setFloat32(offset, value, true);
  return bytes;
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const reject = async (promise, code) => { let error; try { await promise; } catch (caught) { error = caught; } expect(error?.code).to.equal(code); };

// Authored for the deferred runtime pass; no acoustic qualification is implied.
describe('shared sound material inspection and preparation', () => {
  it('derives stereo source metadata and refuses float corruption before decoding', async () => {
    const bytes = wav(), format = inspectWaveContainer(bytes);
    expect(format).to.include({ channels: 2, frames: 1024, sampleRate: 44100, bits: 32 });
    const good = await runBackgroundJobKernel('inspect-wave-asset', { bytes, contentHash: hash(bytes) }, { estimatedPeakBytes: 16 * 1048576 });
    expect(good.value).to.include({ sourceSampleRate: 44100, frames: 1024, contentHash: hash(bytes) });
    const bad = wav({ value: NaN }); await reject(runBackgroundJobKernel('inspect-wave-asset', { bytes: bad, contentHash: hash(bad) }, { estimatedPeakBytes: 16 * 1048576 }), 'invalid-data');
    await reject(runBackgroundJobKernel('inspect-wave-asset', { bytes, contentHash: '0'.repeat(64) }, { estimatedPeakBytes: 16 * 1048576 }), 'content-mismatch');
    expect(() => inspectWaveContainer(bytes.subarray(0, bytes.length - 1))).to.throw();
  });
  it('shares decoded PCM across installed pinned definitions while returning independent pins', async () => {
    const bytes = wav(), contentHash = hash(bytes), packHash = 'a'.repeat(64), definitionHash = 'b'.repeat(64), budget = createResourceBudget();
    const file = { path: 'samples/original.wav', sha256: contentHash, bytes: bytes.length, kind: 'sample', mediaType: 'audio/wav', rights: { licenseId: 'NOASSERTION', attribution: 'Original synthetic fixture' } };
    const patch = { identity: 'biome.test@1', definitionHash, state: 'definition-admitted', dependencies: [contentHash], definition: { sampleRefs: [{ sha256: contentHash, bytes: bytes.length }] } };
    const prepared = { contentHash: packHash, pack: { files: [file] }, patches: [patch] };
    let decodes = 0, packPins = 0, assetPins = 0;
    const provider = createSoundMaterialProvider({ resourceBudget: budget, registry: {
      async loadPack() { packPins++; return { prepared, release() { packPins--; } }; },
      async loadAsset() { assetPins++; return { blob: new Blob([bytes]), release() { assetPins--; } }; }
    }, jobs: { async compute(specification) {
      const result = await runBackgroundJobKernel(specification.kind, await specification.prepareInput(), { estimatedPeakBytes: specification.estimatedPeakBytes });
      let phase = 'computed'; return { value: result.value, release() { phase = 'released'; }, retirementState: () => ({ phase }) };
    } }, getContext: () => ({ sampleRate: 48000, state: 'running', async decodeAudioData() {
      decodes++; const samples = [new Float32Array(1115), new Float32Array(1115)];
      return { length: 1115, numberOfChannels: 2, sampleRate: 48000, getChannelData: channel => samples[channel] };
    } }) });
    const reference = { packHash, definitionHash, patchId: 'biome.test', revision: 1 };
    const a = await provider.acquire({ reference }), b = await provider.acquire({ reference });
    expect(a.assets[0].buffer).to.equal(b.assets[0].buffer); expect(decodes).to.equal(1); expect(packPins).to.equal(0); expect(assetPins).to.equal(0);
    a.release(); expect(b.assets[0].isActive()).to.equal(true); b.release();
    const retirement = provider.dispose(); await retirement.completion; expect(retirement.outcome).to.equal('complete'); expect(budget.diagnostics().accountedBytes).to.equal(0);
  });
});
