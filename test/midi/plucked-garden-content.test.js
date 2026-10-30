import { expect } from 'chai';
import { readFile } from 'node:fs/promises';
import { compileSoundContent } from '../../js/midi/content/SoundContentCompiler.js';
import { compileInstrumentPerformance } from '../../js/midi/content/InstrumentPerformance.js';
import { describeNativeInstrumentEngines, NATIVE_PLUCK_PARAMETERS } from '../../js/app/midi-ui/NativeInstrumentSchema.js';

describe('original Plucked Garden source recipes', () => {
  it('retains real string/body/excitation parameters and effective onset macros for all four patches', async () => {
    const source = JSON.parse(await readFile(new URL('../../content/sounds/plucked-garden.json', import.meta.url), 'utf8'));
    const targets = (await describeNativeInstrumentEngines([{ engineId: 'worklet-pluck', engineVersion: 1, artifactHash: 'a'.repeat(64) }])).map(descriptor => ({ descriptor }));
    const compiled = await compileSoundContent(source, { targets }); expect(compiled.prepared.patches).to.have.length(4);
    expect(targets[0].descriptor.capabilities).to.include({ renderAcknowledgment: true, perVoiceDamping: true, offlineRender: true });
    const definitions = compiled.prepared.patches.map(patch => patch.definition);
    expect(new Set(definitions.map(patch => patch.parameters.pluckPosition01)).size).to.equal(4);
    for (const patch of definitions) {
      const plan = compileInstrumentPerformance(patch, Object.values(NATIVE_PLUCK_PARAMETERS));
      const low = plan.resolve({ variationAmount01: 0, macros: { body: 0, pick: 0, damp: 0, spark: 0 } }, 100);
      const high = plan.resolve({ variationAmount01: 0, macros: { body: 1, pick: 1, damp: 1, spark: 1 } }, 100);
      expect(high.values.bodyMix01).to.be.greaterThan(low.values.bodyMix01); expect(high.values.pluckPosition01).to.be.greaterThan(low.values.pluckPosition01);
      expect(high.values.stringT60Seconds).to.be.lessThan(low.values.stringT60Seconds); expect(high.values.excitationBrightness01).to.be.greaterThan(low.values.excitationBrightness01);
      expect(low.deltas.every(delta => delta.interpolation === 'onset-only')).to.equal(true);
    }
    expect(compiled.qualification).to.equal('compiled-data-not-render-qualified'); expect(source.pack.redistributionPolicy).to.equal('unknown');
  });
});
