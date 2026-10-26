import { cloneData, freezeData, hashData } from '../../core/CanonicalData.js';

// These are two readouts of the same owned source/body control fixture. A wet
// body is still driven normally; muting its dry readout creates no extra strike.
export async function prepareGraftComparison(patch, mode) {
  if (!['exciter-only', 'body-only'].includes(mode) || !['worklet-sample', 'worklet-texture', 'worklet-friction', 'worklet-wind'].includes(patch?.engineId) || !Number.isInteger(patch.parameters?.graftModeCount) || patch.parameters.graftModeCount < 1 || patch.parameters.graftModeCount > 8) throw new TypeError('Choose a prepared private linear-body graft and an explicit dry or body readout.');
  const definition = cloneData(patch, { maxBytes: 65536, maxNodes: 8192 }), originalDefinitionHash = await hashData(definition), mix01 = mode === 'exciter-only' ? 0 : 1;
  definition.parameters.graftMix01 = mix01;
  definition.macros = definition.macros.filter(macro => !macro.targets.some(target => target.parameter === 'graftMix01'));
  const definitionHash = await hashData(definition);
  return freezeData({ definition, comparison: { schema: 'lemmings-graft-comparison/v1', mode, originalDefinitionHash, definitionHash, mix01,
    changes: 'only-dry-versus-body-readout;source-input-force-body-loss-and-pickups-preserved', source: 'same-authored-control-fixture;not-a-physical-take', level: 'fixed-original-gain;no-loudness-normalization', body: 'normal-excitation-and-independent-tail;not-a-free-running-body-only-oscillator' } });
}
