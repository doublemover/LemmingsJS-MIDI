import { freezeData } from '../../core/CanonicalData.js';
import { prepareEffectGraphRevision } from './EffectGraphRevision.js';

export const SYMPATHETIC_MAP_RECIPES = Object.freeze(['string-trellis', 'metal-constellation', 'undertone-basin']);
export function createSympatheticMapRecipe({ recipe = 'string-trellis', sourceBusId = 'owner', tap = 'pre-fader', couple01 = 0.65, damp01 = 0.3, tuneRatio = 1,
  touchBody = 0, audition = 'all', wet01 = 0.2, revision = 1 } = {}) {
  if (!SYMPATHETIC_MAP_RECIPES.includes(recipe) || !['all', 'direct', 'sympathetic'].includes(audition) || !Number.isFinite(tuneRatio) || tuneRatio < 0.5 || tuneRatio > 2 || !Number.isFinite(wet01) || wet01 < 0 || wet01 > 0.35) throw new TypeError('Choose a bounded authored sympathetic map.');
  const ratios = recipe === 'string-trellis' ? [1, 1.25, 1.5, 2] : recipe === 'metal-constellation' ? [1, 1.13, 1.37, 1.69, 1.95, 2.23] : [1, 4 / 3, 1.5];
  if (!Number.isInteger(touchBody) || touchBody < 0 || touchBody >= ratios.length) throw new RangeError('The selected excitation body is absent.');
  const partials = recipe === 'metal-constellation' ? [1, 2.77, 5.4] : recipe === 'undertone-basin' ? [1, 1.58, 2.14] : [1, 2, 3], base = recipe === 'undertone-basin' ? 120 : 180;
  const bodies = ratios.map((ratio, index) => ({ id: recipe + '-' + index, excitation01: index === touchBody ? 1 : 0,
    pickup01: audition === 'all' || (audition === 'direct') === (index === touchBody) ? 1 : 0,
    modes: partials.map((partial, mode) => ({ frequencyHz: base * tuneRatio * ratio * partial, decaySeconds: [2.6, 1.5, 0.8][mode], gain01: [1, 0.45, 0.22][mode] })) }));
  const edges = [];
  for (let body = 0; body < bodies.length - (recipe === 'metal-constellation' ? 0 : 1); body++) for (let mode = 0; mode < (recipe === 'undertone-basin' ? 1 : 3); mode++)
    edges.push({ fromBody: bodies[body].id, fromMode: mode, toBody: bodies[(body + 1) % bodies.length].id, toMode: mode, amount: recipe === 'metal-constellation' ? 0.04 : 0.07 });
  const node = (id, kind, parameters = {}) => ({ id, kind, parameters }), edge = (a, b) => ({ from: { nodeId: a, port: 'audio' }, to: { nodeId: b, port: 'audio' }, gain01: 1 });
  const plan = prepareEffectGraphRevision({ schema: 'lemmings-effect-graph/v1', id: 'sympathetic-map.' + recipe, revision, latencyPolicy: 'align-declared', maximumLatencyFrames: 0, maximumTailSeconds: 15,
    nodes: [node('source', 'bus-in'), node('dry', 'gain', { gain01: 1 - wet01, gainMaximum01: 1 }), node('excitation', 'sidechain-in', { sourceBusId, tap, inputLayout: 'audioStereo' }),
      node('send', 'gain', { gain01: 1, gainMaximum01: 1 }), node('bodies', 'sympathetic-network', { bodies, edges, couple01, damp01 }), node('return', 'gain', { gain01: wet01, gainMaximum01: 0.35 }), node('output', 'bus-out')],
    edges: [edge('source', 'dry'), edge('dry', 'output'), edge('excitation', 'send'), edge('send', 'bodies'), edge('bodies', 'return'), edge('return', 'output')] });
  return freezeData({ schema: 'lemmings-sympathetic-map/v1', recipe, graph: plan.definition, bodyIds: bodies.map(body => body.id), sourceBusId, tap,
    controlPolicy: 'COUPLE-and-DAMP-continuous;TUNE-and-TOUCH-prepare-new-network-with-old-tail',
    audition, anchorPolicy: 'explicit-authored-body-identities;terrain-region-and-contact-slot-bindings-not-implied',
    basinPolicy: recipe === 'undertone-basin' ? 'fundamental-mode-only-coupling;not-a-claimed-lowpass-filter' : null,
    causalPolicy: 'actual-local-bus-excites-persistent-audio-state;no-extra-semantic-onset-or-simulation-intervention',
    qualification: 'implementation-awaiting-full-macro-level-listening-and-network-cost-qualification' });
}
