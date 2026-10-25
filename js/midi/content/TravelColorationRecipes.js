import { freezeData } from '../../core/CanonicalData.js';
import { prepareEffectGraphRevision } from './EffectGraphRevision.js';

export function createTravelColorationRecipe({ recipe = 'rail-comb', travelPixels = 256, depth01 = 0.75, feedback = 0.2, mix01 = 0.3,
  transition = 'glide', invert = false, revision = 1 } = {}) {
  if (!['rail-comb', 'return-flange'].includes(recipe) || !Number.isFinite(travelPixels) || travelPixels < 128 || travelPixels > 512 ||
      !Number.isFinite(depth01) || depth01 < 0 || depth01 > 1 || !Number.isFinite(feedback) || feedback < 0 || feedback > 0.35 ||
      !Number.isFinite(mix01) || mix01 < 0 || mix01 > 0.45 || !['glide', 'jump'].includes(transition) || typeof invert !== 'boolean' || !Number.isSafeInteger(revision) || revision < 1) throw new TypeError('Travel coloration exceeds its authored route, delay or mix domain.');
  const range = recipe === 'rail-comb' ? [0.0008, 0.006] : [0.0004, 0.008], centre = (range[0] + range[1]) / 2, radius = (range[1] - range[0]) * depth01 / 2;
  const node = (id, kind, parameters = {}) => ({ id, kind, parameters }), edge = (from, to) => ({ from: { nodeId: from, port: 'audio' }, to: { nodeId: to, port: 'audio' }, gain01: 1 });
  const nodes = [node('source', 'bus-in'), node('dry', 'gain', { gain01: 1 - mix01, gainMaximum01: 1 }), node('send', 'gain', { gain01: 1, gainMaximum01: 1 }),
    node('motion-delay', 'feedback-delay', { maxDelaySeconds: range[1], delaySeconds: centre, mode: transition, interpolation: 'lagrange3', jumpPolicy: 'coalesce-latest', transitionSeconds: 0.01,
      maximumSlew: 0.05, feedback, feedbackMaximum: 0.35, feedbackLowpassHz: 7000, feedbackHighpassHz: 120, wet01: 1 }),
    node('return', 'gain', { gain01: mix01, gainMaximum01: 0.45 }), node('output', 'bus-out')];
  const edges = [edge('source', 'dry'), edge('dry', 'output'), edge('source', 'send'), edge('send', 'motion-delay'), edge('return', 'output')];
  if (invert) { nodes.push(node('polarity', 'polarity-invert')); edges.push(edge('motion-delay', 'polarity'), edge('polarity', 'return')); }
  else edges.push(edge('motion-delay', 'return'));
  const plan = prepareEffectGraphRevision({ schema: 'lemmings-effect-graph/v1', id: 'travel-colour.' + recipe, revision,
    maximumLatencyFrames: 0, latencyPolicy: 'align-declared', maximumTailSeconds: 30, nodes, edges });
  return freezeData({ schema: 'lemmings-travel-colour/v1', recipe, graph: plan.definition,
    control: { nodeId: 'motion-delay', parameter: 'delaySeconds', minimum: centre - radius, maximum: centre + radius, travelPixels },
    source: 'existing-signed-distance-articulation-intents', curve: 'smoothstep-triangle-of-signed-world-distance',
    restPolicy: 'freeze-control-coordinate;finish-known-smoothing-and-admitted-tail', discontinuityPolicy: 'source-end-or-explicit-prepared-rebind',
    delayPolicy: transition === 'glide' ? 'bounded-tape-glide-with-intentional-pitch-change' : 'two-tap-unity-sum-jumps-with-one-coalesced-target',
    normalization: 'convex-dry-and-delayed-branch;depth-zero-is-not-bypass', qualification: 'implementation-awaiting-modulation-alias-and-device-qualification' });
}
export function travelColorationValue(control, signedDistancePixels) {
  if (!control || !Number.isFinite(signedDistancePixels) || !Number.isFinite(control.travelPixels) || control.travelPixels <= 0 ||
      !Number.isFinite(control.minimum) || !Number.isFinite(control.maximum) || control.minimum > control.maximum) throw new TypeError('A travel control requires a qualified signed-distance coordinate.');
  const phase = ((signedDistancePixels % control.travelPixels) + control.travelPixels) % control.travelPixels / control.travelPixels;
  const triangle = phase < 0.5 ? phase * 2 : 2 - phase * 2, smooth = triangle * triangle * (3 - 2 * triangle);
  return control.minimum + (control.maximum - control.minimum) * smooth;
}
