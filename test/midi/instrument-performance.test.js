import { expect } from 'chai';
import { compileInstrumentPerformance, validateInstrumentControls, validateInstrumentMacros, captureInstrumentCause } from '../../js/midi/content/InstrumentPerformance.js';
import { compileSoundContent } from '../../js/midi/content/SoundContentCompiler.js';
import { NATIVE_FM_PARAMETERS, describeNativeInstrumentEngines } from '../../js/app/midi-ui/NativeInstrumentSchema.js';
import { readFile } from 'node:fs/promises';

const schema = [{ id: 'frequency', unit: 'Hz', min: 20, max: 20000, default: 440, discrete: false, liveSafe: false }];
const macro = (id, composition, minimum, maximum) => ({ id, name: id, default01: 0.5, mode: 'onset-only', smoothingMs: 0,
  perceptualDirection: 'Change excitation spectrum.', targets: [{ parameter: 'frequency', unit: composition === 'scale' ? 'ratio' : 'Hz',
    minimum, maximum, composition, curve: 'linear', clamp: true }] });
describe('typed effective onset controls', () => {
  it('takes world height only from the completed position and excludes camera or substitute payload coordinates', () => {
    const cause = captureInstrumentCause({ kind: 'MotionCommitted', eventId: 'motion:height', positionAfter: { x: 4, y: 27.5 }, cameraY: 900,
      physicalPayload: { displacementPixels: 3, positionYWorldPixels: 999 } });
    expect(cause.values).to.deep.equal({ displacementPixels: { value: 3, unit: 'world-pixel' }, positionXWorldPixels: { value: 4, unit: 'world-pixel' }, positionYWorldPixels: { value: 27.5, unit: 'world-pixel' } });
    expect(captureInstrumentCause({ kind: 'MotionCommitted', eventId: 'missing', physicalPayload: { positionYWorldPixels: 999 } }).values).to.deep.equal({});
  });
  it('recomputes continuous observations from the onset baseline with stable cross-source composition and no cumulative drift', () => {
    const parameters = [{ id: 'brightness', unit: 'normalized', min: 0, max: 1, default: 0.4, discrete: false, liveSafe: true, causalLiveSafe: true }];
    const binding = (id, sourceKind, payloadField, unit, composition, outputMin, outputMax) => ({ id, sourceKind, payloadField, unit, composition, outputMin, outputMax,
      target: 'brightness', inputMin: 0, inputMax: 8, outputUnit: composition === 'scale' ? 'ratio' : 'normalized', curve: 'linear', mode: 'continuous', smoothingMs: 24 });
    const plan = compileInstrumentPerformance({ parameters: {}, causalBindings: [binding('a-motion', 'MotionCommitted', 'displacementPixels', 'world-pixel', 'scale', 0.5, 1.5),
      binding('b-step', 'ContactResolved', 'stepHeightPixels', 'world-pixel', 'add', 0, 0.2)] }, parameters);
    const onset = plan.resolve({}, 10), motion = { sourceKind: 'MotionCommitted', eventId: 'motion', evidence: 'completed-world-fact', values: { displacementPixels: { value: 8, unit: 'world-pixel' } } },
      contact = { sourceKind: 'ContactResolved', eventId: 'step', evidence: 'completed-world-fact', values: { stepHeightPixels: { value: 4, unit: 'world-pixel' } } };
    expect(onset.continuousBase.brightness).to.equal(0.4);
    const a = plan.resolveContinuous(onset.continuousBase, [motion, contact], 20), b = plan.resolveContinuous(onset.continuousBase, [contact, motion], 20);
    expect(a).to.deep.equal(b); expect(a.values.brightness).to.be.closeTo(0.7, 1e-12); expect(a.smoothingMs).to.equal(24);
    expect(plan.resolveContinuous(onset.continuousBase, [motion, contact], 30).values).to.deep.equal(a.values);
    expect(a.deltas.every(delta => delta.interpolation === 'bounded-causal-slew')).to.equal(true);
    const absent = plan.resolveContinuous(onset.continuousBase, [{ ...motion, values: {} }], 40);
    expect(absent.bindingOutcomes.every(outcome => outcome.state === 'no-qualified-source')).to.equal(true);
    expect(absent.values.brightness).to.equal(0.4);
    expect(() => plan.resolveContinuous(onset.continuousBase, [motion, motion], 50)).to.throw('invalid continuous');
  });
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
  it('preserves explicitly authored bipolar/momentary semantics without rewriting legacy macro identities', () => {
    const original = macro('a', 'replace', 100, 1000), legacy = validateInstrumentMacros([original], schema)[0];
    expect(Object.hasOwn(legacy, 'bipolar')).to.equal(false); expect(Object.hasOwn(legacy, 'momentary')).to.equal(false);
    const authored = validateInstrumentMacros([{ ...original, bipolar: true, momentary: true }], schema)[0];
    expect(authored).to.include({ bipolar: true, momentary: true });
    expect(() => validateInstrumentMacros([{ ...original, bipolar: 'yes' }], schema)).to.throw();
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
