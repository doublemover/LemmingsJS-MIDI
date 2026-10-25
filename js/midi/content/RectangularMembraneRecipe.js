import { freezeData } from '../../core/CanonicalData.js';
import { prepareEffectGraphRevision } from './EffectGraphRevision.js';

export function createRectangularMembraneRecipe({ sourceBusId = 'owner', gridSize = 8, fundamentalHz = 180, decaySeconds = 1.8, damp01 = 0,
  strikeX01 = 0.5, strikeY01 = 0.5, pickupLeftX01 = 0.31, pickupLeftY01 = 0.43, pickupRightX01 = 0.69, pickupRightY01 = 0.43, wet01 = 0.25, revision = 1 } = {}) {
  if (!Number.isFinite(wet01) || wet01 < 0 || wet01 > 0.5) throw new TypeError('Choose an admitted membrane return level.');
  const node = (id, kind, parameters = {}) => ({ id, kind, parameters }), edge = (from, to) => ({ from: { nodeId: from, port: 'audio' }, to: { nodeId: to, port: 'audio' }, gain01: 1 });
  const plan = prepareEffectGraphRevision({ schema: 'lemmings-effect-graph/v1', id: 'rectangular-membrane.authored-skin', revision, latencyPolicy: 'align-declared', maximumLatencyFrames: 0, maximumTailSeconds: 8,
    nodes: [node('source', 'bus-in'), node('dry', 'gain', { gain01: 1 - wet01, gainMaximum01: 1 }), node('excitation', 'sidechain-in', { sourceBusId, tap: 'pre-fader', inputLayout: 'audioStereo' }),
      node('skin', 'rectangular-membrane', { gridSize, fundamentalHz, decaySeconds, excitationGain01: 1, damp01, strikeX01, strikeY01, pickupLeftX01, pickupLeftY01, pickupRightX01, pickupRightY01 }),
      node('return', 'gain', { gain01: wet01, gainMaximum01: 0.5 }), node('output', 'bus-out')],
    edges: [edge('source', 'dry'), edge('dry', 'output'), edge('excitation', 'skin'), edge('skin', 'return'), edge('return', 'output')] });
  return freezeData({ schema: 'lemmings-rectangular-membrane-recipe/v1', graph: plan.definition, sourceBusId, bodyNodeId: 'skin',
    surface: { units: 'normalized-interior-grid', bounds: [0, 0, 1, 1], boundary: 'fixed-zero', topology: 'authored-rectangle', sourceEditRevision: null, boundTopologyRevision: null },
    controlPolicy: 'independent-strike-and-stereo-pickup-positions;positive-loss-only;new-grid-or-tuning-keeps-old-tail',
    sourcePolicy: 'actual-owner-or-lane-audio;no-invented-physical-contact-or-note',
    qualification: plan.nodes.find(node => node.membrane).membrane.qualification });
}
