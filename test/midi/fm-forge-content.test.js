import { expect } from 'chai';
import { readFile } from 'node:fs/promises';
import { compileSoundContent, convertSoundQuantity } from '../../js/midi/content/SoundContentCompiler.js';
import { describeNativeInstrumentEngines } from '../../js/app/midi-ui/NativeInstrumentSchema.js';
import { planNativeFmSource } from '../../js/app/midi-ui/NativeFmSource.js';

describe('original FM Forge source content', () => {
  let source, targets;
  before(async () => {
    source = JSON.parse(await readFile(new URL('../../content/sounds/fm-forge.json', import.meta.url), 'utf8'));
    targets = (await describeNativeInstrumentEngines([{ engineId: 'native-fm', engineVersion: 1, artifactHash: 'a'.repeat(64) }])).map(descriptor => ({ descriptor }));
  });
  it('compiles four distinct inherited recipes without claiming render or redistribution qualification', async () => {
    const result = await compileSoundContent(source, { targets });
    expect(result.compilerRevision).to.equal('typed-recipes-v13'); expect(result.prepared.patches).to.have.length(4);
    expect(result.qualification).to.equal('compiled-data-not-render-qualified');
    expect(source.pack).to.include({ licenseId: 'NOASSERTION', redistributionPolicy: 'unknown' });
    const patches = new Map(result.prepared.patches.map(patch => [patch.definition.id, patch.definition]));
    expect(patches.get('forge.glass-rivet').parameters).to.include({ modulatorRatio: 2.71, indexStart: 3.5, indexEnd: 0.15, indexSeconds: 0.8 });
    expect(patches.get('forge.copper-tine').parameters).to.include({ dualPair: 1, secondaryMix01: 0.7, secondaryIndexStart: 0, secondaryIndexEnd: 0 });
    expect(patches.get('forge.alarm-bloom').parameters).to.include({ modulatorRatio: 1.414, indexStart: 0.5, indexEnd: 4 });
    expect(patches.get('forge.rubber-bolt').parameters).to.include({ pitchSettleCents: 700, pitchSettleSeconds: 0.035, decaySeconds: 0.26 });
    for (const [id, definition] of patches) for (const note of [36, 60, 84]) {
      const plan = planNativeFmSource({ fundamentalHz: 440 * 2 ** ((note - 69) / 12), sampleRate: 48000, parameters: definition.parameters });
      expect(plan.sourceCost).to.equal(id === 'forge.copper-tine' ? 4 : id === 'forge.rubber-bolt' ? 3 : 2);
      expect(plan.quality).to.equal('conservative-sideband-estimate-not-spectral-qualified');
    }
  });
  it('keeps dimensionless index separate from deviation Hz and gives traversal a stable content identity', async () => {
    expect(() => convertSoundQuantity({ value: 3.5, unit: 'Hz' }, 'dimensionless')).to.throw('explicit conversion');
    const first = await compileSoundContent(source, { targets }), reverse = structuredClone(source); reverse.recipes.reverse();
    const second = await compileSoundContent(reverse, { targets });
    expect(second.artifacts.map(artifact => artifact.renderKey)).to.deep.equal(first.artifacts.map(artifact => artifact.renderKey));
  });
});
