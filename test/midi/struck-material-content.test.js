import { expect } from 'chai';
import { readFile } from 'node:fs/promises';
import { compileSoundContent } from '../../js/midi/content/SoundContentCompiler.js';
import { compileInstrumentPerformance } from '../../js/midi/content/InstrumentPerformance.js';
import { describeNativeInstrumentEngines, NATIVE_MODAL_PARAMETERS } from '../../js/app/midi-ui/NativeInstrumentSchema.js';
import { planNativeModalSource } from '../../js/app/midi-ui/NativeModalSource.js';
import { resolveOwnedArticulationPolicy } from '../../js/app/midi-ui/OwnedArticulationPolicy.js';

describe('original struck material source recipes', () => {
  it('compiles four original bodies and an explicit unclassified body into the real native adapter', async () => {
    const source = JSON.parse(await readFile(new URL('../../content/sounds/struck-materials.json', import.meta.url), 'utf8'));
    const targets = (await describeNativeInstrumentEngines([{ engineId: 'native-modal', engineVersion: 1, artifactHash: 'a'.repeat(64) }])).map(descriptor => ({ descriptor }));
    const output = await compileSoundContent(source, { targets }); expect(output.prepared.patches).to.have.length(5);
    for (const patch of output.prepared.patches) {
      const performance = compileInstrumentPerformance(patch.definition, Object.values(NATIVE_MODAL_PARAMETERS));
      for (const amount of [0, 0.5, 1]) {
        const effective = performance.resolve({ variationAmount01: 0, macros: { mass: amount, hardness: amount, damping: amount, hollow: amount } }, 48000);
        const plan = planNativeModalSource({ fundamentalHz: 440, sampleRate: 48000, parameters: effective.values });
        expect(plan.sourceCost).to.be.within(1, 8); expect(plan.modes.every(mode => mode.modeT60Seconds > 0 && Number.isFinite(mode.gain01))).to.equal(true);
        const policy = resolveOwnedArticulationPolicy({ engineId: 'native-modal', parameters: effective.values }); expect(policy.oneShotTailSeconds).to.be.at.least(plan.longestT60Seconds);
      }
    }
    const timber = output.prepared.patches.find(patch => patch.definition.id === 'material.timber');
    const glass = output.prepared.patches.find(patch => patch.definition.id === 'material.glass');
    expect(timber.definition.parameters.mode1Ratio).to.equal(2.76); expect(glass.definition.parameters.bodyT60Seconds).to.equal(1.8);
    expect(output.qualification).to.equal('compiled-data-not-render-qualified'); expect(source.pack.redistributionPolicy).to.equal('unknown');
  });
});
