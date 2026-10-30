import { expect } from 'chai';
import fs from 'node:fs/promises';
import { compileSoundContent } from '../../js/midi/content/SoundContentCompiler.js';
import { describeNativeInstrumentEngines } from '../../js/app/midi-ui/NativeInstrumentSchema.js';
import { renderOwnedSourceControls } from '../../js/app/midi-ui/OwnedSourceControlRender.js';

// Authored for final runtime qualification after the issue implementation pass.
describe('fixed control references for the actual owned physical/spectral sources', () => {
  it('renders default macro/variation composition with pinned banks and explicit missing physical inputs', async () => {
    const families = [['plucked-garden.json', 'worklet-pluck'], ['artificial-choir.json', 'worklet-choir'], ['liquid-drawbars.json', 'worklet-spectrum']];
    const descriptors = await describeNativeInstrumentEngines(families.map(([, engineId]) => ({ engineId, engineVersion: 1, artifactHash: 'a'.repeat(64) })));
    for (const [file, engineId] of families) {
      const authored = JSON.parse(await fs.readFile(new URL('../../content/sounds/' + file, import.meta.url), 'utf8'));
      const compiled = await compileSoundContent(authored, { targets: descriptors.map(descriptor => ({ descriptor })) });
      const patch = compiled.prepared.patches[0], descriptor = descriptors.find(entry => entry.engineId === engineId);
      const input = { definition: patch.archivedDefinition, descriptor, source: { packId: authored.pack.id, packVersion: authored.pack.version,
        contentHash: compiled.prepared.contentHash, patchIdentity: patch.identity, definitionHash: patch.definitionHash, attribution: authored.pack.attribution } };
      const a = await renderOwnedSourceControls({ ...input, sampleRate: 44100 }), b = await renderOwnedSourceControls({ ...input, sampleRate: 48000 });
      for (const result of [a, b]) {
        expect(result.manifest).to.include({ renderScope: 'fixed-controls-from-silence', physicalTakeEvidence: false, acousticReceipt: false });
        expect(result.manifest.engineRequirement.engineId).to.equal(engineId); expect(result.manifest.pcmHash).to.match(/^[a-f0-9]{64}$/);
        expect(result.manifest.statistics.peak).to.be.greaterThan(0); expect(Number.isFinite(result.manifest.statistics.rms)).to.equal(true);
        expect(result.manifest.sourcePerformance.physicalSources).to.equal('none-in-authored-control-fixture');
        expect(result.manifest.sourcePerformance.bindingOutcomes.every(entry => entry.state === 'no-qualified-source')).to.equal(true);
      }
      expect(a.manifest.sourcePerformance.seed).to.equal(b.manifest.sourcePerformance.seed);
      if (engineId !== 'worklet-pluck') expect(a.manifest.fixedBank.hash).to.equal(b.manifest.fixedBank.hash);
    }
  });
});
