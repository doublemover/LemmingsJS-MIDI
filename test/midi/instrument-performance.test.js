import { expect } from 'chai';
import { compileInstrumentPerformance, validateInstrumentControls, validateInstrumentMacros } from '../../js/midi/content/InstrumentPerformance.js';
import { compileSoundContent } from '../../js/midi/content/SoundContentCompiler.js';
import { NATIVE_FM_PARAMETERS, describeNativeInstrumentEngines } from '../../js/app/midi-ui/NativeInstrumentSchema.js';
import { readFile } from 'node:fs/promises';

const schema = [{ id: 'frequency', unit: 'Hz', min: 20, max: 20000, default: 440, discrete: false, liveSafe: false }];
const macro = (id, composition, minimum, maximum) => ({ id, name: id, default01: 0.5, mode: 'onset-only', smoothingMs: 0,
  perceptualDirection: 'Change excitation spectrum.', targets: [{ parameter: 'frequency', unit: composition === 'scale' ? 'ratio' : 'Hz',
    minimum, maximum, composition, curve: 'linear', clamp: true }] });
describe('typed effective onset controls', () => {
  it('composes replacements then stable-ID deltas before the final clamp independently of traversal', () => {
    const macros = [macro('z-base', 'replace', 300, 500), macro('a-add', 'add', -10, 30), macro('b-scale', 'scale', 1, 3)];
    const patch = { parameters: {}, macros }, first = compileInstrumentPerformance(patch, schema).resolve({}, 42);
    expect(first.values.frequency).to.equal(820); expect(first.deltas.map(delta => delta.macroId)).to.deep.equal(['z-base', 'a-add', 'b-scale']);
    expect(first.deltas.every(delta => delta.applyFrame === 42 && delta.origin === 'macro' && delta.effectiveValue === 820 && !delta.clamped)).to.equal(true);
    expect(compileInstrumentPerformance({ ...patch, macros: [...macros].reverse() }, schema).resolve({}, 42)).to.deep.equal(first);
    const clipped = compileInstrumentPerformance(patch, schema).resolve({ macros: { 'b-scale': 1 } }, 43);
    expect(clipped.values.frequency).to.equal(1230);
  });
  it('rejects unit ambiguity, duplicate replacement owners, unrealized continuous curves and unknown performer controls', () => {
    expect(() => validateInstrumentMacros([macro('a', 'replace', 100, 1000), macro('b', 'replace', 200, 2000)], schema)).to.throw('ownership conflict');
    const wrong = macro('a', 'replace', 100, 1000); wrong.targets[0].unit = 's'; expect(() => validateInstrumentMacros([wrong], schema)).to.throw('typed macro target');
    const plan = compileInstrumentPerformance({ parameters: {}, macros: [] }, schema);
    expect(() => plan.resolve({ macros: { missing: 0.5 } }, 0)).to.throw('unknown macro');
    expect(() => validateInstrumentControls({ macros: { a: Infinity } })).to.throw('normalized');
    const live = macro('a', 'replace', 100, 1000); live.mode = 'continuous'; expect(() => compileInstrumentPerformance({ parameters: {}, macros: [live] }, schema)).to.throw();
  });
  it('changes actual native FM/envelope inputs at authored endpoints while preserving explicit onset semantics', async () => {
    const source = JSON.parse(await readFile(new URL('../../content/sounds/fm-forge.json', import.meta.url), 'utf8'));
    const targets = (await describeNativeInstrumentEngines([{ engineId: 'native-fm', engineVersion: 1, artifactHash: 'a'.repeat(64) }])).map(descriptor => ({ descriptor }));
    const content = await compileSoundContent(source, { targets });
    for (const entry of content.prepared.patches) {
      const plan = compileInstrumentPerformance(entry.definition, Object.values(NATIVE_FM_PARAMETERS));
      const base = plan.resolve({ variationAmount01: 0 }, 100), low = plan.resolve({ macros: { hardness: 0, ring: 0, alloy: 0 }, variationAmount01: 0 }, 100), high = plan.resolve({ macros: { hardness: 1, ring: 1, alloy: 1 }, variationAmount01: 0 }, 100);
      expect(base.values.indexStart).to.be.closeTo(entry.definition.parameters.indexStart, 1e-12);
      expect(high.values.indexStart).to.be.greaterThan(low.values.indexStart); expect(high.values.decaySeconds).to.be.greaterThan(low.values.decaySeconds);
      expect(high.values.modulatorRatio).not.to.equal(low.values.modulatorRatio); expect(base.deltas.every(delta => delta.interpolation === 'onset-only')).to.equal(true);
    }
  });
});
