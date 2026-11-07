import { expect } from 'chai';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { FIELD_RECORDING_IDENTITIES } from '../../js/midi/content/FieldRecordingIdentities.js';
import { getBundledSoundMaterial } from '../../js/midi/content/BundledSoundMaterial.js';
import { loadBundledSoundSource } from '../../js/midi/content/BundledSoundSources.js';
import { inspectWaveContainer } from '../../js/app/midi-ui/AudioAssetRef.js';
import { compileSoundContent } from '../../js/midi/content/SoundContentCompiler.js';
import { describeNativeInstrumentEngines } from '../../js/app/midi-ui/NativeInstrumentSchema.js';

describe('bundled NPS recorded granular biomes', () => {
  it('loads the exact four local recording excerpts without acquiring their remote originals', async () => {
    const source = JSON.parse(await fs.readFile(new URL('../../content/sounds/granular-biomes-recorded.json', import.meta.url), 'utf8'));
    const inventory = JSON.parse(await fs.readFile(new URL('../../content/sounds/field-recordings/provenance.json', import.meta.url), 'utf8'));
    expect(inventory.sources).to.have.length(4);
    const hashes = new Set();
    for (const [index, identity] of FIELD_RECORDING_IDENTITIES.entries()) {
      expect(getBundledSoundMaterial(source.files[index])).to.equal(identity);
      const bytes = await loadBundledSoundSource(identity, { readAsset: url => {
        expect(url.protocol).to.equal('file:'); expect(url.pathname).to.match(/field-recordings\/nps-[a-z]+\.json$/);
        return fs.readFile(url);
      } });
      const hash = createHash('sha256').update(bytes).digest('hex'); hashes.add(hash);
      expect(hash).to.equal(identity.sha256); expect(bytes.byteLength).to.equal(identity.bytes);
      expect(inspectWaveContainer(bytes)).to.include({ sampleRate: 32000, channels: 1, frames: identity.frames });
      expect(identity.frames).to.be.within(16000, 192000);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      expect(view.getInt16(44, true)).to.equal(0); expect(view.getInt16(bytes.length - 2, true)).to.equal(0);
      expect(inventory.sources[index].original.sha256).to.match(/^[a-f0-9]{64}$/);
      expect(source.files[index].rights).to.include({ kind: 'sample-recording', creator: 'National Park Service' });
      expect(source.recipes[index].sampleRefs[0].sha256).to.equal(hash);
    }
    expect(hashes.size).to.equal(4);
  });
  it('compiles the named recorded edition without replacing synthetic patch identities', async () => {
    const source = JSON.parse(await fs.readFile(new URL('../../content/sounds/granular-biomes-recorded.json', import.meta.url), 'utf8'));
    const descriptors = await describeNativeInstrumentEngines([{ engineId: 'worklet-granular', engineVersion: 1, artifactHash: 'a'.repeat(64) }]);
    const result = await compileSoundContent(source, { targets: descriptors.map(descriptor => ({ descriptor })) });
    expect(result.prepared.patches).to.have.length(4);
    for (const entry of result.prepared.patches) {
      expect(entry.state).to.equal('definition-admitted'); expect(entry.definition.id).to.match(/^biome\.recorded-/);
      expect(entry.definition.tags).to.include('field-recording').and.not.include('synthetic-source');
      expect(entry.definition.voicePolicy.maxVoices).to.equal(8); expect(entry.definition.parameters.maximumGrainChildren).to.equal(8);
      expect(entry.definition.macros.map(macro => macro.id)).to.deep.equal(['crowd', 'scale', 'scan', 'weather']);
      expect(entry.definition.causalBindings.every(binding => binding.sourceKind === 'MotionCommitted')).to.equal(true);
    }
  });
  it('refuses canceled reads, substituted identities and malformed recording payloads', async () => {
    const identity = FIELD_RECORDING_IDENTITIES[0], controller = new AbortController(); controller.abort();
    let reads = 0, rejected = 0;
    for (const [candidate, options] of [
      [identity, { signal: controller.signal, readAsset: async () => { reads++; return new Uint8Array(); } }],
      [{ ...identity }, { readAsset: async () => { reads++; return new Uint8Array(); } }],
      [identity, { readAsset: async () => new TextEncoder().encode(JSON.stringify({ schema: 'lemmings-bundled-recording/v1', id: 'substituted', base64: 'AA==' })) }]
    ]) {
      try { await loadBundledSoundSource(candidate, options); } catch { rejected++; }
    }
    expect(rejected).to.equal(3); expect(reads).to.equal(0);
  });
});
