import { expect } from 'chai';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { compileSoundContent } from '../../js/midi/content/SoundContentCompiler.js';
import { describeNativeInstrumentEngines } from '../../js/app/midi-ui/NativeInstrumentSchema.js';
import { renderOwnedSineControls } from '../../js/app/midi-ui/OwnedSineOfflineRender.js';

const chunks = bytes => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), found = new Map();
  for (let offset = 12; offset < bytes.byteLength;) {
    const id = new TextDecoder().decode(bytes.subarray(offset, offset + 4)), length = view.getUint32(offset + 4, true);
    found.set(id, bytes.subarray(offset + 8, offset + 8 + length)); offset += 8 + length + length % 2;
  }
  return found;
};
describe('actual sine-kernel control reference rendering', () => {
  let input;
  before(async () => {
    const descriptors = await describeNativeInstrumentEngines(['native-oscillator', 'worklet-sine'].map(engineId => ({ engineId, engineVersion: 1, artifactHash: 'a'.repeat(64) })));
    const source = JSON.parse(await fs.readFile(new URL('../../content/sounds/native.json', import.meta.url), 'utf8'));
    const compiled = await compileSoundContent(source, { targets: descriptors.map(descriptor => ({ descriptor })) });
    const entry = compiled.prepared.patches.find(patch => patch.identity === 'foundation.held-sine@2');
    input = { definition: entry.archivedDefinition, descriptor: descriptors.find(descriptor => descriptor.engineId === 'worklet-sine'), sampleRate: 48000,
      source: { packId: compiled.prepared.pack.id, packVersion: compiled.prepared.pack.version, contentHash: compiled.prepared.contentHash,
        patchIdentity: entry.identity, definitionHash: entry.definitionHash, attribution: 'Component render fixture' } };
  });
  it('embeds exact source and independent PCM integrity, renders pan changes and finishes the actual release tail', async () => {
    const result = await renderOwnedSineControls(input, { yieldControl: async () => {} }), inventory = chunks(result.bytes), pcm = inventory.get('data');
    expect(new TextDecoder().decode(result.bytes.subarray(0, 4))).to.equal('RIFF');
    expect(new DataView(inventory.get('fmt ').buffer, inventory.get('fmt ').byteOffset).getUint16(0, true)).to.equal(3);
    const embedded = JSON.parse(new TextDecoder().decode(inventory.get('lmjs')));
    expect(embedded).to.deep.equal(result.manifest); expect(embedded.source).to.deep.equal(input.source);
    expect(createHash('sha256').update(pcm).digest('hex')).to.equal(embedded.pcmHash);
    expect(embedded).to.include({ acousticReceipt: false, physicalTakeEvidence: false, normalization: 'none', channels: 2, sampleRate: 48000 });
    const samples = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    const energy = (first, last, channel) => { let sum = 0; for (let frame = first; frame < last; frame++) sum += samples.getFloat32((frame * 2 + channel) * 4, true) ** 2; return sum; };
    expect(energy(19200, 24000, 0)).to.be.greaterThan(energy(19200, 24000, 1));
    expect(energy(38400, 43200, 1)).to.be.greaterThan(energy(38400, 43200, 0));
    expect(energy(embedded.frames - 128, embedded.frames, 0) + energy(embedded.frames - 128, embedded.frames, 1)).to.equal(0);
    expect(embedded.statistics.peak).to.be.greaterThan(0); expect(embedded.statistics.overFullScaleSamples).to.equal(0);
  });
  it('is byte deterministic for one definition, rate and fixture without changing the definition', async () => {
    const before = JSON.stringify(input), first = await renderOwnedSineControls(input, { yieldControl: async () => {} }), second = await renderOwnedSineControls(input, { yieldControl: async () => {} });
    expect(Buffer.from(first.bytes).equals(Buffer.from(second.bytes))).to.equal(true); expect(JSON.stringify(input)).to.equal(before);
  });
  it('rejects changed source identity and unsupported rates and cancels at cooperative boundaries', async () => {
    for (const request of [{ ...input, sampleRate: 22050 }, { ...input, source: { ...input.source, definitionHash: 'b'.repeat(64) } }]) {
      let error; try { await renderOwnedSineControls(request); } catch (failure) { error = failure; } expect(error).to.be.instanceOf(Error);
    }
    const controller = new AbortController(); let error;
    try { await renderOwnedSineControls(input, { signal: controller.signal, yieldControl: async () => controller.abort(new Error('stop-render')) }); } catch (failure) { error = failure; }
    expect(error.message).to.equal('stop-render');
  });
});
