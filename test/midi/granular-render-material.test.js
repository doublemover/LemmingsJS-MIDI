import { createQuarryBody } from '../../js/midi/content/DubQuarryRack.js';
import { expect } from 'chai';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { generateProceduralBiomeSource } from '../../js/midi/content/ProceduralBiomeSources.js';
import { PROCEDURAL_BIOME_IDENTITIES } from '../../js/midi/content/ProceduralBiomeIdentities.js';
import { decodeWaveSource } from '../../js/app/resources/WaveSourceDecode.js';
import { createAudioAssetLoader } from '../../js/app/midi-ui/AudioAssetLoader.js';
import { createAudioResourceLeases } from '../../js/app/midi-ui/AudioResourceLeases.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';
import { createProcgenRetirementScope } from '../../js/app/procgen/ProcgenRetirement.js';
import { prepareOwnedRenderMaterial } from '../../js/app/midi-ui/OwnedRenderMaterial.js';
import { verifyOwnedPcmPayload } from '../../js/app/resources/OwnedPcmVerification.js';
import { renderOwnedSourceControls } from '../../js/app/midi-ui/OwnedSourceControlRender.js';
import { renderCausalOwnedTake } from '../../js/app/midi-ui/CausalOwnedRender.js';
import { DECODER_VERSION } from '../../js/app/midi-ui/AudioAssetRef.js';
import { compileSoundContent } from '../../js/midi/content/SoundContentCompiler.js';
import { describeNativeInstrumentEngines } from '../../js/app/midi-ui/NativeInstrumentSchema.js';

const pcm = file => {
  const bytes = file.bytes, view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  for (let at = 12; at < bytes.length;) { const id = new TextDecoder().decode(bytes.subarray(at, at + 4)), length = view.getUint32(at + 4, true);
    if (id === 'data') return bytes.subarray(at + 8, at + 8 + length); at += 8 + length + length % 2; }
};
// Authored for the final deferred runtime pass; no listening evidence is implied.
describe('owned granular render material handoff', () => {
  it('binds source/PCM/bank hashes, renders control WAVs and preserves causal crop/stem identity without a live context', async () => {
    const original = PROCEDURAL_BIOME_IDENTITIES.find(entry => entry.id === 'water-lens'), bytes = generateProceduralBiomeSource(original.id), budget = createResourceBudget();
    let contextRequests = 0;
    const ref = { contentHash: original.sha256, bytes: original.bytes, kind: 'sample', path: original.path, mime: 'audio/wav', sourceSampleRate: original.sampleRate,
      frames: original.frames, channels: original.channels, decodeVersion: DECODER_VERSION, licenseId: 'NOASSERTION', attribution: 'Original synthetic source fixture' };
    const loader = createAudioAssetLoader({ getContext() { contextRequests++; return null; }, fetchAsset: async () => bytes, resourceBudget: budget,
      jobs: { async compute(spec) { const result = await decodeWaveSource(await spec.prepareInput(), { maxBytes: spec.maxBytes, estimatedPeakBytes: spec.estimatedPeakBytes });
        let phase = 'computed'; return { value: result.value, release() { phase = 'released'; }, retirementState: () => ({ phase }) }; } } });
    const provider = { async acquire() { const pin = await loader.acquire(ref, { decodeProfile: 'source-pcm' }), retirement = createProcgenRetirementScope();
      return { assets: [pin], release: () => retirement.retire([{ name: 'decoded-pin', run: () => pin.release() }]) }; } };
    const descriptors = await describeNativeInstrumentEngines([{ engineId: 'worklet-granular', engineVersion: 1, artifactHash: 'a'.repeat(64) }]);
    const authored = JSON.parse(await fs.readFile(new URL('../../content/sounds/granular-biomes.json', import.meta.url), 'utf8'));
    const compiled = await compileSoundContent(authored, { targets: descriptors.map(descriptor => ({ descriptor })) }), patch = compiled.prepared.patches.find(entry => entry.identity === 'biome.water-lens@1');
    const resources = createAudioResourceLeases({ resourceBudget: budget });
    const material = await prepareOwnedRenderMaterial({ provider, resources, definition: patch.definition, stage: {}, owner: 'test-render' });
    try {
      const checked = await verifyOwnedPcmPayload(material.payload, patch.definition.sampleRefs[0]);
      expect(checked.descriptor.bankHash).to.equal(material.descriptor.bankHash); expect(contextRequests).to.equal(0);
      const controls = await renderOwnedSourceControls({ definition: patch.archivedDefinition, descriptor: descriptors[0], pcm: material.payload,
        source: { packId: authored.pack.id, packVersion: authored.pack.version, contentHash: compiled.prepared.contentHash, patchIdentity: patch.identity, definitionHash: patch.definitionHash, attribution: authored.pack.attribution } }, { yieldControl: async () => {} });
      expect(controls.manifest.sourceBank.bankHash).to.equal(material.descriptor.bankHash); expect(controls.manifest.statistics.peak).to.be.greaterThan(0);
      expect(controls.manifest.quality).to.equal('source-rate-pcm-linear-read-resampling');
      const row = (kind, time, serial) => ({ version: 1, kind, worldId: 'world:test', generation: 1, actorId: 1, voiceId: 'actor:one', onsetId: 'onset:one', intentId: 'intent:' + serial, sourceEventIds: ['cause:' + serial],
        laneId: 0, pitch: { cents: 6000, referenceHz: 440 }, velocity01: 0.6, expression: {}, scoreTime: { sourceTimeMs: time, subTick: 0 } });
      const revoice = { operation: 'sound-only-revoice', version: 1, takeId: 'take:test', takeRevision: 1, sourceCanonicalHash: 'c'.repeat(64), sourceState: 'finalized', nextSequence: null,
        sourceVersions: {}, coverage: { status: 'known-covered' }, boundary: { status: 'captured-initial-state', state: { voices: [], sourceTimeMs: 0 } }, finalBoundaryState: { sourceTimeMs: 1000 }, intents: [row('begin', 100, 1), row('end', 600, 2)] };
      const input = { revoice, definition: patch.archivedDefinition, descriptor: descriptors[0], pcm: material.payload, sampleRate: 48000, endSeconds: 1, stemLaneIds: ['0'] };
      const full = await renderCausalOwnedTake(input, { yieldControl: async () => {} }), crop = await renderCausalOwnedTake({ ...input, startSeconds: 0.2 }, { yieldControl: async () => {} });
      expect(Buffer.from(pcm(full.files[0]))).to.deep.equal(Buffer.from(pcm(full.files[1])));
      expect(Buffer.from(pcm(crop.files[0]))).to.deep.equal(Buffer.from(pcm(full.files[0]).subarray(9600 * 8)));
      expect(full.manifest.realization.sourceBank.bankHash).to.equal(material.descriptor.bankHash);
      const bodyInput = await renderCausalOwnedTake({ ...input, startSeconds: 0.2, outputMode: 'source-pcm', effectGraph: createQuarryBody({ send01: 0.3 }), effectReturnNodeIds: ['return'] }, { yieldControl: async () => {} });
      expect(bodyInput.channels).to.equal(4); expect(bodyInput.frames).to.equal(48000);
      expect(bodyInput.manifest.realization.sourceBank.bankHash).to.equal(material.descriptor.bankHash);
      const expected = new DataView(pcm(full.files[0]).buffer, pcm(full.files[0]).byteOffset, pcm(full.files[0]).byteLength); let mismatches = 0;
      for (let frame = 0; frame < 48000; frame++) for (let channel = 0; channel < 2; channel++) if (bodyInput.planes[channel][frame] !== expected.getFloat32((frame * 2 + channel) * 4, true)) mismatches++;
      expect(mismatches).to.equal(0); expect(bodyInput.manifest.timelineZeroSourceFrame).to.equal(9600);
      const altered = structuredClone(material.payload); altered.planes[0][100] += 0.1;
      let rejected; try { await verifyOwnedPcmPayload(altered, patch.definition.sampleRefs[0]); } catch (error) { rejected = error; }
      expect(rejected?.code).to.equal('pcm-identity-mismatch');
      expect(createHash('sha256').update(bytes).digest('hex')).to.equal(original.sha256);
    } finally { await material.release().completion; await loader.dispose().completion; }
    expect(resources.diagnostics().reservations).to.equal(0); expect(budget.diagnostics().accountedBytes).to.equal(0);
  });
});
