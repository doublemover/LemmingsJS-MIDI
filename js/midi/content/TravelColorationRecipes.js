import { freezeData } from '../../core/CanonicalData.js';
import { prepareEffectGraphRevision } from './EffectGraphRevision.js';

export function createTravelColorationRecipe({ recipe = 'rail-comb', travelPixels = 256, depth01 = 0.75, feedback = 0.2, mix01 = 0.3,
  transition = 'glide', invert = false, revision = 1 } = {}) {
  const notch = recipe === 'hollow-steps', throughZero = recipe === 'through-zero';
  if (!['rail-comb', 'return-flange', 'hollow-steps', 'through-zero'].includes(recipe) || !Number.isFinite(travelPixels) || travelPixels < 128 || travelPixels > 512 ||
      !Number.isFinite(depth01) || depth01 < 0 || depth01 > 1 || !Number.isFinite(feedback) || feedback < 0 || feedback > (notch ? 0.25 : 0.35) ||
      !Number.isFinite(mix01) || mix01 < 0 || mix01 > (notch ? 0.5 : 0.45) || !['glide', 'jump'].includes(transition) || notch && transition !== 'glide' || typeof invert !== 'boolean' || !Number.isSafeInteger(revision) || revision < 1) throw new TypeError('Travel coloration exceeds its authored route, delay or mix domain.');
  const range = notch ? [160, 1600] : recipe === 'rail-comb' ? [0.0008, 0.006] : [0.0004, 0.008], centre = (range[0] + range[1]) / 2, radius = (range[1] - range[0]) * depth01 / 2;
  const node = (id, kind, parameters = {}) => ({ id, kind, parameters }), edge = (from, to) => ({ from: { nodeId: from, port: 'audio' }, to: { nodeId: to, port: 'audio' }, gain01: 1 });
  const nodes = [node('source', 'bus-in'), node('dry', 'gain', { gain01: 1 - mix01, gainMaximum01: 1 }), node('send', 'gain', { gain01: 1, gainMaximum01: 1 }),
    ...(notch ? [node('motion-notches', 'allpass-notch', { baseFrequencyHz: centre, ratio: 1.6, feedback, feedbackMaximum: 0.25, wet01: 1, maximumSlewHzPerSample: 4 })] : [node('motion-delay', 'feedback-delay', { maxDelaySeconds: range[1], delaySeconds: centre, mode: transition, interpolation: 'lagrange3', jumpPolicy: 'coalesce-latest', transitionSeconds: 0.01,
      maximumSlew: 0.05, feedback, feedbackMaximum: 0.35, feedbackLowpassHz: 7000, feedbackHighpassHz: 120, wet01: 1 })]),
    node('return', 'gain', { gain01: mix01, gainMaximum01: notch ? 0.5 : 0.45 }), node('output', 'bus-out')];
  const processor = notch ? 'motion-notches' : 'motion-delay';
  const referenceSeconds = throughZero ? centre : 0;
  if (throughZero) nodes.push(node('reference-delay', 'feedback-delay', { maxDelaySeconds: centre, delaySeconds: centre, mode: 'glide', interpolation: 'linear', feedback: 0, feedbackMaximum: 0, wet01: 1 }));
  const edges = [...(throughZero ? [edge('source', 'reference-delay'), edge('reference-delay', 'dry')] : [edge('source', 'dry')]), edge('dry', 'output'), edge('source', 'send'), edge('send', processor), edge('return', 'output')];
  if (invert) { nodes.push(node('polarity', 'polarity-invert')); edges.push(edge(processor, 'polarity'), edge('polarity', 'return')); }
  else edges.push(edge(processor, 'return'));
  const plan = prepareEffectGraphRevision({ schema: 'lemmings-effect-graph/v1', id: 'travel-colour.' + recipe, revision,
    maximumLatencyFrames: 0, latencyPolicy: 'align-declared', maximumTailSeconds: 30, nodes, edges });
  return freezeData({ schema: 'lemmings-travel-colour/v1', recipe, graph: plan.definition,
    control: { nodeId: processor, parameter: notch ? 'baseFrequencyHz' : 'delaySeconds', minimum: centre - radius, maximum: centre + radius, travelPixels },
    source: 'existing-signed-distance-articulation-intents', curve: 'smoothstep-triangle-of-signed-world-distance',
    restPolicy: 'freeze-control-coordinate;finish-known-smoothing-and-admitted-tail', discontinuityPolicy: 'source-end-or-explicit-prepared-rebind',
    delayPolicy: notch ? 'bounded-direct-frequency-normalized-lattice;no-LFO' : transition === 'glide' ? 'bounded-tape-glide-with-intentional-pitch-change' : 'two-tap-unity-sum-jumps-with-one-coalesced-target',
    creativeReferenceDelaySeconds: referenceSeconds, relativeDelaySeconds: throughZero ? [range[0] - centre, range[1] - centre] : null,
    referencePolicy: throughZero ? 'both-branches-causal-positive-delays;neutral-bypass-restores-immediate-owner-dry' : 'immediate-owner-dry',
    normalization: 'convex-dry-and-processed-branch;depth-zero-is-not-bypass', qualification: 'implementation-awaiting-modulation-alias-and-device-qualification' });
}
export function travelColorationValue(control, signedDistancePixels) {
  if (!control || !Number.isFinite(signedDistancePixels) || !Number.isFinite(control.travelPixels) || control.travelPixels <= 0 ||
      !Number.isFinite(control.minimum) || !Number.isFinite(control.maximum) || control.minimum > control.maximum) throw new TypeError('A travel control requires a qualified signed-distance coordinate.');
  if (control.curve != null && !['clamped-signed-distance', 'smoothstep-triangle'].includes(control.curve)) throw new TypeError('Unknown travel control curve.');
  if (control.curve === 'clamped-signed-distance') { if (!Number.isFinite(control.startPixels)) throw new TypeError('A clamped route needs its explicit origin.'); const position = Math.max(0, Math.min(1, (signedDistancePixels - control.startPixels) / control.travelPixels)), smooth = position * position * (3 - 2 * position); return control.minimum + (control.maximum - control.minimum) * smooth; }
  const phase = ((signedDistancePixels % control.travelPixels) + control.travelPixels) % control.travelPixels / control.travelPixels;
  const triangle = phase < 0.5 ? phase * 2 : 2 - phase * 2, smooth = triangle * triangle * (3 - 2 * triangle);
  return control.minimum + (control.maximum - control.minimum) * smooth;
}
