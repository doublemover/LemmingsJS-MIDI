import { prepareEffectGraphRevision } from './EffectGraphRevision.js';
import { createOriginalImpulseDescriptor } from './ProceduralImpulseMaterial.js';
import { freezeData } from '../../core/CanonicalData.js';

export function createAcousticZoneRecipe(id, sampleRate = 48000, absorb01 = 0) {
  if (!['felt-pocket', 'glass-arcade', 'pipe-corridor', 'open-clearing'].includes(id) || !Number.isFinite(absorb01) || absorb01 < 0 || absorb01 > 1) throw new TypeError('Choose a declared original acoustic response and normalized absorption.');
  const model = { id, revision: 1, directSource: 'separately-rendered;no-dry-signal-in-return', lowpassHz: id === 'felt-pocket' ? 2400 : id === 'glass-arcade' ? 8000 : 5000, highpassHz: id === 'pipe-corridor' ? 120 : 20,
    qualification: 'authored-coloration;not-pixel-derived-or-measured-room-acoustics' };
  if (id === 'open-clearing') return freezeData({ ...model, graph: null, maximumTailSeconds: 0 });
  const nodes = [{ id: 'input', kind: 'bus-in', parameters: {} }, { id: 'output', kind: 'bus-out', parameters: {} }], edges = [],
    edge = (from, to, gain01 = 1) => ({ from: { nodeId: from, port: 'audio' }, to: { nodeId: to, port: 'audio' }, gain01 });
  if (id === 'glass-arcade') {
    const impulse = { ...createOriginalImpulseDescriptor('quarry-hollow-spring'), predelaySeconds: 0.015 };
    nodes.push({ id: 'body', kind: 'convolution-native', parameters: {}, impulse });
    edges.push(edge('input', 'body', 1 / Math.max(1, impulse.maximumLinearGain)), edge('body', 'output'));
    model.impulseMeaning = 'original1.2-second synthetic reflection body,15ms declared predelay and8kHz authored return lowpass;no measuredT60 claim';
  } else {
    const times = id === 'pipe-corridor' ? [0.047, 0.071, 0.113] : [0.012], feedback = id === 'pipe-corridor' ? 0.22 : 0.1;
    for (const [index, delaySeconds] of times.entries()) {
      const nodeId = 'echo-' + index;
      nodes.push({ id: nodeId, kind: 'feedback-delay', parameters: { maxDelaySeconds: 0.25, delaySeconds, mode: 'glide', feedback, feedbackMaximum: id === 'pipe-corridor' ? 0.35 : 0.1, feedbackLowpassHz: model.lowpassHz, feedbackHighpassHz: model.highpassHz, wet01: 1 } });
      edges.push(edge('input', nodeId), edge(nodeId, 'output', 1 / times.length));
    }
  }
  model.lowpassHz = Math.max(200, model.lowpassHz * 2 ** (-3 * absorb01));
  model.graph = prepareEffectGraphRevision({ schema: 'lemmings-effect-graph/v1', id: 'acoustic.' + id, revision: 1, nodes, edges, latencyPolicy: id === 'glass-arcade' ? 'uncompensated-native' : 'align-declared', maximumLatencyFrames: id === 'glass-arcade' ? null : 0, maximumTailSeconds: 3 }, { sampleRate }).definition;
  model.maximumTailSeconds = 3;
  return freezeData(model);
}
