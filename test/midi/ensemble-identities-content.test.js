import { expect } from 'chai';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { compileSoundContent } from '../../js/midi/content/SoundContentCompiler.js';
import { compileInstrumentPerformance } from '../../js/midi/content/InstrumentPerformance.js';
import { describeNativeInstrumentEngines, NATIVE_PLUCK_PARAMETERS } from '../../js/app/midi-ui/NativeInstrumentSchema.js';
import { nativeSoundCollection } from '../../js/app/procgen/workstation/NativeSoundCollections.js';

describe('separate ensemble identity source', () => {
  it('preserves the published subtle source and supplies bounded, repeatable identities with fixed pitch', async () => {
    const original = await readFile(new URL('../../content/sounds/plucked-garden.json', import.meta.url));
    expect(createHash('sha256').update(original).digest('hex')).to.equal('4fd59a5b2fd34a345edef182eb31d63c426ff6d617939ff78eb36863a89010ec');
    const source = JSON.parse(await readFile(new URL('../../content/sounds/ensemble-identities.json', import.meta.url), 'utf8'));
    const targets = (await describeNativeInstrumentEngines([{ engineId: 'worklet-pluck', engineVersion: 1, artifactHash: 'a'.repeat(64) }])).map(descriptor => ({ descriptor }));
    const compiled = await compileSoundContent(source, { targets }); expect(compiled.prepared.patches).to.have.length(1);
    const patch = compiled.prepared.patches[0].definition, owner = compileInstrumentPerformance(patch, Object.values(NATIVE_PLUCK_PARAMETERS));
    expect(patch.id).to.equal('ensemble.timber-pickers'); expect(patch.voicePolicy.maxVoices).to.equal(16); expect(patch.causalBindings).to.deep.equal([]);
    expect(nativeSoundCollection(patch.id).id).to.equal('ensemble-identities');
    const identities = Array.from({ length: 64 }, (_, index) => ({ worldId: 'ensemble-content', generation: 1, actorId: index, onsetId: 'onset-' + index }));
    const values = identities.map(identity => owner.resolve({}, 100, identity).values), zero = identities.map(identity => owner.resolve({ variationAmount01: 0 }, 100, identity).values);
    for (let index = 63; index >= 0; index--) {
      expect(owner.resolve({}, 100, { ...identities[index], laneId: 'migrated', poolSlot: 4 }).values).to.deep.equal(values[index]);
      expect(zero[index]).to.deep.equal(zero[0]);
      for (const parameter of Object.values(NATIVE_PLUCK_PARAMETERS)) expect(values[index][parameter.id]).to.be.within(parameter.min, parameter.max);
    }
    for (const [parameter, minimumSpan] of [['pluckPosition01', 0.2], ['excitationBrightness01', 0.3], ['bodyMix01', 0.1]])
      expect(Math.max(...values.map(row => row[parameter])) - Math.min(...values.map(row => row[parameter]))).to.be.greaterThan(minimumSpan);
    expect(patch.variation.targets.some(target => /pitch|frequency|ratioHz/i.test(target.parameter))).to.equal(false);
    const actor = identities[0], first = owner.resolve({}, 100, actor), strike = owner.resolve({}, 200, { ...actor, onsetId: 'second-strike' });
    expect(strike.values.pluckPosition01).to.equal(first.values.pluckPosition01); expect(strike.values.stringT60Seconds).to.equal(first.values.stringT60Seconds);
    expect(strike.values.excitationBrightness01).not.to.equal(first.values.excitationBrightness01);
  });
});
