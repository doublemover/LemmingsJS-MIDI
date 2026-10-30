import { expect } from 'chai';
import { readFile } from 'node:fs/promises';
import { compileSoundContent } from '../../js/midi/content/SoundContentCompiler.js';
import { compileInstrumentPerformance } from '../../js/midi/content/InstrumentPerformance.js';
import { describeNativeInstrumentEngines, NATIVE_CHOIR_PARAMETERS } from '../../js/app/midi-ui/NativeInstrumentSchema.js';

describe('original Artificial Choir source recipes', () => {
  it('compiles four distinct artificial vowels with executable onset controls and explicit live capabilities', async () => {
    const source = JSON.parse(await readFile(new URL('../../content/sounds/artificial-choir.json', import.meta.url), 'utf8'));
    const targets = (await describeNativeInstrumentEngines([{ engineId: 'worklet-choir', engineVersion: 1, artifactHash: 'a'.repeat(64) }])).map(descriptor => ({ descriptor }));
    const compiled = await compileSoundContent(source, { targets }); expect(compiled.prepared.patches).to.have.length(4);
    expect(targets[0].descriptor.capabilities).to.include({ renderAcknowledgment: true, perVoiceTimbre: true, offlineRender: true });
    const definitions = compiled.prepared.patches.map(patch => patch.definition);
    expect(new Set(definitions.map(patch => patch.parameters.sizeRatio)).size).to.equal(4);
    expect(definitions.filter(patch => patch.parameters.vowelStep === 1)).to.have.length(1);
    for (const patch of definitions) {
      const plan = compileInstrumentPerformance(patch, Object.values(NATIVE_CHOIR_PARAMETERS));
      const low = plan.resolve({ variationAmount01: 0, macros: { vowel: 0, breath: 0, size: 0, chorus: 0 } }, 100);
      const high = plan.resolve({ variationAmount01: 0, macros: { vowel: 1, breath: 1, size: 1, chorus: 1 } }, 100);
      expect(high.values).to.include({ vowel01: 1, breath01: 0.7, sizeRatio: 2, chorusCents: 12 });
      expect(low.values).to.include({ vowel01: 0, breath01: 0, sizeRatio: 0.5, chorusCents: 0 });
      expect(high.values).not.to.have.property('frequencyHz'); expect(low.deltas.every(delta => delta.interpolation === 'onset-only')).to.equal(true);
    }
    expect(compiled.qualification).to.equal('compiled-data-not-render-qualified');
  });
});
