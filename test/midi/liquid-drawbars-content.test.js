import { expect } from 'chai';
import { readFile } from 'node:fs/promises';
import { compileSoundContent } from '../../js/midi/content/SoundContentCompiler.js';
import { compileInstrumentPerformance } from '../../js/midi/content/InstrumentPerformance.js';
import { describeNativeInstrumentEngines, NATIVE_SPECTRUM_PARAMETERS } from '../../js/app/midi-ui/NativeInstrumentSchema.js';

describe('original liquid-table and additive-drawbar recipes', () => {
  it('compiles three table and three additive voices with actual endpoint controls and declared partial decay', async () => {
    const source = JSON.parse(await readFile(new URL('../../content/sounds/liquid-drawbars.json', import.meta.url), 'utf8'));
    const targets = (await describeNativeInstrumentEngines([{ engineId: 'worklet-spectrum', engineVersion: 1, artifactHash: 'a'.repeat(64) }])).map(descriptor => ({ descriptor }));
    const compiled = await compileSoundContent(source, { targets }); expect(compiled.prepared.patches).to.have.length(6);
    expect(targets[0].descriptor.capabilities).to.include({ perVoiceTimbre: true, renderAcknowledgment: true, offlineRender: true, continuousPhysicalBindings: true });
    const definitions = compiled.prepared.patches.map(patch => patch.definition); expect(definitions.filter(patch => patch.parameters.sourceMode === 0)).to.have.length(3);
    for (const patch of definitions) {
      const plan = compileInstrumentPerformance(patch, Object.values(NATIVE_SPECTRUM_PARAMETERS));
      const low = plan.resolve({ variationAmount01: 0, macros: { body: 0, edge: 0, flow: 0, ring: 0 } }, 100), high = plan.resolve({ variationAmount01: 0, macros: { body: 1, edge: 1, flow: 1, ring: 1 } }, 100);
      expect(low.values).to.include({ body01: 0, edge01: 0, scan01: 0, releaseSeconds: 0.02 }); expect(high.values).to.include({ body01: 1, edge01: 1, scan01: 1, releaseSeconds: 2 });
      expect(patch.causalBindings[0]).to.include({ payloadField: 'positionYWorldPixels', unit: 'world-pixel', mode: 'continuous' });
    }
    const stars = definitions.find(patch => patch.id === 'spectrum.falling-stars'); expect(stars.parameters.partialDecaySeconds).to.equal(2.4); expect(stars.parameters.partial15T60Scale).to.be.lessThan(stars.parameters.partial0T60Scale);
    expect(compiled.qualification).to.equal('compiled-data-not-render-qualified');
  });
});
