import { freezeData } from '../../core/CanonicalData.js';
import { prepareEffectGraphRevision } from './EffectGraphRevision.js';

export const SYMPATHETIC_MAP_RECIPES = Object.freeze(['string-trellis', 'metal-constellation', 'undertone-basin', 'felt-bridge']);
export function createSympatheticMapRecipe({ recipe = 'string-trellis', sourceBusId = 'owner', tap = 'pre-fader', couple01 = 0.65, damp01 = 0.3, tuneRatio = 1,
  touchBody = 0, audition = 'all', wet01 = 0.2, revision = 1 } = {}) {
  if (!SYMPATHETIC_MAP_RECIPES.includes(recipe) || !['all', 'direct', 'sympathetic'].includes(audition) || !Number.isFinite(tuneRatio) || tuneRatio < 0.5 || tuneRatio > 2 || !Number.isFinite(wet01) || wet01 < 0 || wet01 > 0.35) throw new TypeError('Choose a bounded authored sympathetic map.');
  const felt = recipe === 'felt-bridge';
  const ratios = felt ? [1] : recipe === 'string-trellis' ? [1, 1.25, 1.5, 2] : recipe === 'metal-constellation' ? [1, 1.13, 1.37, 1.69, 1.95, 2.23] : [1, 4 / 3, 1.5];
  if (!Number.isInteger(touchBody) || touchBody < 0 || touchBody >= ratios.length) throw new RangeError('The selected excitation body is absent.');
  const partials = felt ? [1, 2.76, 5.4, 8.9, 13.3, 18.5] : recipe === 'metal-constellation' ? [1, 2.77, 5.4] : recipe === 'undertone-basin' ? [1, 1.58, 2.14] : [1, 2, 3], base = recipe === 'undertone-basin' ? 120 : 180;
  const longT60 = felt ? [2, 1.6, 1.1, 0.8, 0.5, 0.3] : null, lossMasks = felt ? [{ id: 'felt-alternating', extraAmplitudeT60Seconds: 0.06, weights: [0.1, 1, 0.15, 1, 0.25, 0.8] }, { id: 'felt-complement', extraAmplitudeT60Seconds: 0.09, weights: [0.9, 0.1, 0.7, 0.2, 0.8, 0.15] }] : [];
  const pickupGrid = felt ? { id: 'felt-authored-observation', width: 2, height: 2, leftPosition: { x01: 0.15, y01: 0.5 }, rightPosition: { x01: 0.85, y01: 0.5 },
    weights: [0.65, 0.3, -0.12, 0.08, -0.04, 0.02, 0.5, -0.45, -0.22, 0.15, 0.09, -0.05, 0.65, 0.3, -0.12, 0.08, -0.04, 0.02, 0.5, -0.45, -0.22, 0.15, 0.09, -0.05] } : null;
  const bodies = ratios.map((ratio, index) => ({ id: recipe + '-' + index, excitation01: index === touchBody ? 1 : 0,
    pickup01: audition === 'all' || (audition === 'direct') === (index === touchBody) ? 1 : 0,
    modes: partials.map((partial, mode) => ({ frequencyHz: base * tuneRatio * ratio * partial, decaySeconds: felt ? longT60[mode] / 1.5 : [2.6, 1.5, 0.8][mode], gain01: felt ? [1, 0.7, 0.5, 0.4, 0.3, 0.2][mode] : [1, 0.45, 0.22][mode] })) }));
  const edges = [];
  for (let body = 0; body < bodies.length - (recipe === 'metal-constellation' ? 0 : 1); body++) for (let mode = 0; mode < (recipe === 'undertone-basin' ? 1 : 3); mode++)
    edges.push({ fromBody: bodies[body].id, fromMode: mode, toBody: bodies[(body + 1) % bodies.length].id, toMode: mode, amount: recipe === 'metal-constellation' ? 0.04 : 0.07 });
  const node = (id, kind, parameters = {}) => ({ id, kind, parameters }), edge = (a, b) => ({ from: { nodeId: a, port: 'audio' }, to: { nodeId: b, port: 'audio' }, gain01: 1 });
  const plan = prepareEffectGraphRevision({ schema: 'lemmings-effect-graph/v1', id: 'sympathetic-map.' + recipe, revision, latencyPolicy: 'align-declared', maximumLatencyFrames: 0, maximumTailSeconds: 15,
    nodes: [node('source', 'bus-in'), node('dry', 'gain', { gain01: 1 - wet01, gainMaximum01: 1 }), node('excitation', 'sidechain-in', { sourceBusId, tap, inputLayout: 'audioStereo' }),
      node('send', 'gain', { gain01: 1, gainMaximum01: 1 }), node('bodies', 'sympathetic-network', { bodies, edges, couple01, damp01, ...(felt ? { lossMasks, pickupGrid } : {}) }), node('return', 'gain', { gain01: wet01, gainMaximum01: 0.35 }), node('output', 'bus-out')],
    edges: [edge('source', 'dry'), edge('dry', 'output'), edge('excitation', 'send'), edge('send', 'bodies'), edge('bodies', 'return'), edge('return', 'output')] });
  return freezeData({ schema: 'lemmings-sympathetic-map/v1', recipe, graph: plan.definition, bodyIds: bodies.map(body => body.id), sourceBusId, tap,
    controlPolicy: 'COUPLE-DAMP-authored-loss-and-prepared-pickup-positions-continuous;TUNE-and-excitation-body-prepare-new-network-with-old-tail', lossMaskIds: lossMasks.map(mask => mask.id),
    ...(felt ? { openModeT60Seconds: longT60, openDecayControls: 'DAMP=0;mode-loss-amounts=0', preparationMeaning: 'two-authored-mode-masks-and-signed-observation-grid;not-solved-geometric-mode-shapes-or-point-damping', pickupGridId: pickupGrid.id, pickupPositions: { left: pickupGrid.leftPosition, right: pickupGrid.rightPosition } } : {}),
    audition, anchorPolicy: 'explicit-authored-body-identities;terrain-region-and-contact-slot-bindings-not-implied',
    basinPolicy: recipe === 'undertone-basin' ? 'fundamental-mode-only-coupling;not-a-claimed-lowpass-filter' : null,
    causalPolicy: 'actual-local-bus-excites-persistent-audio-state;no-extra-semantic-onset-or-simulation-intervention',
    qualification: 'implementation-awaiting-full-macro-level-listening-and-network-cost-qualification' });
}
