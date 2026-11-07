import assert from 'node:assert/strict';
import { authorScenePerformanceMacros } from '../../js/midi/content/ScenePerformanceMacros.js';
import { describeNativeInstrumentEngines } from '../../js/app/midi-ui/NativeInstrumentSchema.js';
import { prepareWindModel } from '../../js/midi/content/WindModel.js';
import { prepareFrictionModel } from '../../js/midi/content/FrictionModel.js';

describe('original scene source performance controls', () => {
  for (const engineId of ['native-fm', 'native-modal', 'worklet-pluck', 'worklet-choir', 'worklet-spectrum', 'worklet-friction', 'worklet-wind', 'worklet-texture', 'worklet-sample']) it('authors four independent neutral source controls for ' + engineId, async () => {
    const [descriptor] = await describeNativeInstrumentEngines([{ engineId, engineVersion: 1, artifactHash: 'a'.repeat(64) }]), parameters = Object.fromEntries(descriptor.parameters.map(spec => [spec.id, spec.default])), original = { engineId, parameters, macros: [] }, result = authorScenePerformanceMacros(original, descriptor);
    assert.equal(original.macros.length, 0); assert.equal(result.macros.length, 4); assert.equal(new Set(result.macros.flatMap(macro => macro.targets.map(target => target.parameter))).size, 4);
    for (const macro of result.macros) { assert.equal(macro.mode, 'onset-only'); const target = macro.targets[0], spec = descriptor.parameters.find(spec => spec.id === target.parameter); assert.equal(target.unit, spec.unit); assert.ok(Math.abs(target.minimum + (target.maximum - target.minimum) * macro.default01 - parameters[target.parameter]) < 1e-12); }
  });
  it('retains authored IDs and target ownership instead of composing a second replacement', async () => {
    const [descriptor] = await describeNativeInstrumentEngines([{ engineId: 'native-modal', engineVersion: 1, artifactHash: 'a'.repeat(64) }]), macro = { id: 'authored-site', name: 'SITE', targets: [{ parameter: 'strikePosition01' }] }, input = { engineId: 'native-modal', parameters: {}, macros: [macro] }, result = authorScenePerformanceMacros(input, descriptor);
    assert.equal(result.macros[0], macro); assert.equal(result.macros.flatMap(row => row.targets).filter(target => target.parameter === 'strikePosition01').length, 1);
  });
  for (const kind of [0, 1, 2]) it('keeps wind/friction pressure endpoints in each actual model domain ' + kind, async () => {
    for (const engineId of ['worklet-wind', 'worklet-friction']) {
      const [descriptor] = await describeNativeInstrumentEngines([{ engineId, engineVersion: 1, artifactHash: 'a'.repeat(64) }]), wind = engineId === 'worklet-wind', pressure = wind ? [0.35, 0.3, 0.35][kind] : [0.4, 0.25, 0.5][kind], definition = { engineId, parameters: wind ? { windKind: kind, airPressure01: pressure } : { frictionKind: kind, frictionPressure01: pressure }, macros: [] }, result = authorScenePerformanceMacros(definition, descriptor), target = result.macros.find(row => row.targets[0].parameter === (wind ? 'airPressure01' : 'frictionPressure01')).targets[0];
      for (const value of [target.minimum, target.maximum]) { if (wind) assert.doesNotThrow(() => prepareWindModel({ kind: ['hollow-reed', 'air-pipe', 'overblown-branch'][kind], air01: value })); else assert.doesNotThrow(() => prepareFrictionModel({ kind: ['hairline', 'glass-drag', 'rosin-grain'][kind], pressure01: value })); }
    }
  });
});
