import { expect } from 'chai';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { PROCEDURAL_TACTILE_IDENTITIES } from '../../js/midi/content/ProceduralTactileIdentities.js';
import { generateProceduralSoundSource } from '../../js/midi/content/ProceduralSoundSources.js';
import { getProceduralSoundMaterial } from '../../js/midi/content/ProceduralSoundMaterial.js';
import { inspectWaveContainer } from '../../js/app/midi-ui/AudioAssetRef.js';
import { compileSoundContent } from '../../js/midi/content/SoundContentCompiler.js';
import { describeNativeInstrumentEngines } from '../../js/app/midi-ui/NativeInstrumentSchema.js';
import { createSampleMapResolver } from '../../js/midi/content/SampleInstrumentMap.js';

// Deferred final acceptance fixtures. These assertions do not establish listening
// quality, measured pitch error or browser-native resampling tolerances.
describe('original tactile proof content', () => {
  it('regenerates eight exact bounded PCM sources with independently faded contact regions', () => {
    const hashes = new Set();
    for (const asset of PROCEDURAL_TACTILE_IDENTITIES) {
      const bytes = generateProceduralSoundSource(asset), format = inspectWaveContainer(bytes), view = new DataView(bytes.buffer);
      expect(createHash('sha256').update(bytes).digest('hex')).to.equal(asset.sha256); hashes.add(asset.sha256);
      expect(format).to.include({ sampleRate: 32000, channels: 1, frames: 24000 }); expect(bytes.length).to.equal(48044);
      expect(getProceduralSoundMaterial({ ...asset, kind: 'sample', mediaType: 'audio/wav' })).to.equal(asset);
      for (let region = 0; region < 3; region++) {
        for (let frame = 0; frame <= 16; frame++) expect(view.getInt16(44 + (region * 8000 + frame) * 2, true)).to.equal(0);
        expect(view.getInt16(44 + ((region + 1) * 8000 - 1) * 2, true)).to.equal(0);
      }
    }
    expect(hashes.size).to.equal(8);
  });
  it('compiles twenty-four gesture zones with exact layer boundaries and stable event-owned alternates', async () => {
    const source = JSON.parse(await fs.readFile(new URL('../../content/sounds/tactile-contacts.json', import.meta.url), 'utf8'));
    const descriptors = await describeNativeInstrumentEngines([{ engineId: 'native-sample', engineVersion: 1, artifactHash: 'a'.repeat(64) }]);
    const compiled = await compileSoundContent(source, { targets: descriptors.map(descriptor => ({ descriptor })) }), entry = compiled.prepared.patches[0], patch = entry.definition;
    expect(entry.state).to.equal('definition-admitted'); expect(patch.sampleRefs).to.have.length(8); expect(patch.sampleMap.zones).to.have.length(24);
    expect(patch.sampleMap.normalizationRef).to.equal(null);
    const select = createSampleMapResolver(patch.sampleMap, patch.sampleRefs, { patchId: patch.id, patchRevision: patch.revision });
    const begin = { version: 1, kind: 'begin', voiceId: 'voice', onsetId: 'contact', worldId: 'world', generation: 7, actorId: 3,
      sampleKitId: 'kit', laneId: 0, pitch: { cents: 6000 }, velocity01: 0.5 };
    for (const gesture of patch.sampleMap.articulations) {
      const firm = select({ ...begin, sampleGesture: gesture.id }), soft = select({ ...begin, sampleGesture: gesture.id, velocity01: 0.49999 });
      expect(firm.selection.velocityMin01).to.equal(0.5); expect(soft.selection.velocityMax01).to.equal(0.5);
      expect(firm.selection.articulationId).to.equal(gesture.id); expect(select({ ...begin, sampleGesture: gesture.id })).to.deep.equal(firm);
      expect(firm.endFrame - firm.onsetFrame).to.equal(8000); expect(firm.pitchRange).to.deep.equal({ minCents: 5400, maxCents: 6600 });
    }
    expect(select({ ...begin, sampleGesture: 'unmapped' }).selection).to.include({ neutralFallback: true, articulationId: 'center' });
    expect(() => select({ ...begin, pitch: { cents: 6601 } })).to.throw('no authored zone');
  });
});
