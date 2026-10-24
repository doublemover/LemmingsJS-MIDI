import { expect } from 'chai';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { generateProceduralBiomeSource } from '../../js/midi/content/ProceduralBiomeSources.js';
import { PROCEDURAL_BIOME_IDENTITIES } from '../../js/midi/content/ProceduralBiomeIdentities.js';
import { compileSoundContent } from '../../js/midi/content/SoundContentCompiler.js';
import { describeNativeInstrumentEngines } from '../../js/app/midi-ui/NativeInstrumentSchema.js';
import { inspectWaveContainer } from '../../js/app/midi-ui/AudioAssetRef.js';

// Final deferred source/compile checks, not listening or device qualification.
describe('original synthetic granular biome content', () => {
  it('regenerates the immutable mono/stereo assets from fixed independent integer seeds', () => {
    const hashes = new Set();
    for (const spec of PROCEDURAL_BIOME_IDENTITIES) {
      const bytes = generateProceduralBiomeSource(spec.id), digest = createHash('sha256').update(bytes).digest('hex'), format = inspectWaveContainer(bytes);
      expect(digest).to.equal(spec.sha256); expect(bytes.byteLength).to.equal(spec.bytes); hashes.add(digest);
      expect(format).to.include({ frames: spec.frames, channels: spec.channels, sampleRate: spec.sampleRate });
      const view = new DataView(bytes.buffer);
      for (let channel = 0; channel < spec.channels; channel++) {
        expect(view.getInt16(44 + channel * 2, true)).to.equal(0); expect(view.getInt16(bytes.length - spec.channels * 2 + channel * 2, true)).to.equal(0);
      }
    }
    expect(hashes.size).to.equal(4);
  });
  it('compiles bounded cloud recipes with four working onset macros and explicit physical subscriptions', async () => {
    const source = JSON.parse(await fs.readFile(new URL('../../content/sounds/granular-biomes.json', import.meta.url), 'utf8'));
    const descriptors = await describeNativeInstrumentEngines([{ engineId: 'worklet-granular', engineVersion: 1, artifactHash: 'a'.repeat(64) }]);
    const result = await compileSoundContent(source, { targets: descriptors.map(descriptor => ({ descriptor })) });
    expect(result.prepared.patches).to.have.length(4);
    for (const entry of result.prepared.patches) {
      expect(entry.state).to.equal('definition-admitted'); expect(entry.definition.voicePolicy).to.deep.equal({ maxVoices: 8, steal: 'reject' });
      expect(entry.definition.macros).to.have.length(4); expect(entry.definition.sampleRefs).to.have.length(1);
      expect(entry.definition.causalBindings.every(binding => binding.sourceKind === 'MotionCommitted' && binding.mode === 'continuous')).to.equal(true);
      expect(entry.dependencies).to.deep.equal(entry.definition.sampleRefs.map(ref => ref.sha256));
      expect(entry.definition.parameters.motionRequired).to.equal(0);
    }
  });
});
