import { freezeData } from '../../core/CanonicalData.js';
import { prepareEffectGraphRevision } from './EffectGraphRevision.js';

export const CROSS_EXCITATION_RECIPES = freezeData([
  { id: 'tools-talk', name: 'Tools Talk', mode: '12-band-vocoder' },
  { id: 'rust-bloom', name: 'Rust Bloom', mode: 'stereo-ring-modulation' },
  { id: 'footstep-air', name: 'Footstep Air', mode: 'full-band-follower' },
  { id: 'mirror-breath', name: 'Mirror Breath', mode: 'prepared-one-way-follower' }
]);
export function createCrossExcitationRecipe({ recipe = 'tools-talk', donorLaneId, carrierLaneId, tap = 'post-fader',
  bite01 = 0.5, merge01 = 0.25, air01 = recipe === 'footstep-air' ? 0.03 : 0.1, revision = 1 } = {}) {
  const metadata = CROSS_EXCITATION_RECIPES.find(value => value.id === recipe);
  if (!metadata || ![donorLaneId, carrierLaneId].every(id => typeof id === 'string' && /^[a-zA-Z0-9._:-]{1,96}$/.test(id)) || donorLaneId === carrierLaneId ||
      !['pre-fader', 'post-fader'].includes(tap) || !Number.isSafeInteger(revision) || revision < 1 ||
      ![[bite01, 1], [merge01, 0.35], [air01, 0.3]].every(([value, maximum]) => Number.isFinite(value) && value >= 0 && value <= maximum)) throw new TypeError('Cross-excitation requires distinct declared lanes and bounded authored controls.');
  const node = (id, kind, parameters = {}) => ({ id, kind, parameters });
  const edge = (from, to, toPort = 'audio', fromPort = 'audio') => ({ from: { nodeId: from, port: fromPort }, to: { nodeId: to, port: toPort }, gain01: 1 });
  const nodes = [node('source', 'bus-in'), node('dry', 'gain', { gain01: 1, gainMaximum01: 1 }),
    node('donor', 'sidechain-in', { sourceBusId: 'lane:' + donorLaneId, tap, inputLayout: 'audioStereo' }),
    node('carrier', 'sidechain-in', { sourceBusId: 'lane:' + carrierLaneId, tap, inputLayout: 'audioStereo' }),
    node('send', 'gain', { gain01: 0.35, gainMaximum01: 0.65 }), node('return', 'gain', { gain01: merge01, gainMaximum01: 0.35 }), node('output', 'bus-out')];
  const edges = [edge('source', 'dry'), edge('dry', 'output'), edge('carrier', 'send'), edge('return', 'output')];
  if (recipe === 'tools-talk') {
    nodes.push(node('interaction', 'multiband-vocoder', { bands: 12, lowHz: 120, highHz: 6000, attackSeconds: 0.004,
      releaseSeconds: 0.08 * 2 ** (0.5 - bite01), depth01: 0.7, baseline01: air01, wetTrim01: 0.25, dry01: 0 }));
    edges.push(edge('donor', 'interaction', 'donorAudio'), edge('send', 'interaction', 'carrierAudio'), edge('interaction', 'return'));
  } else if (recipe === 'rust-bloom') {
    nodes.push(node('interaction', 'ring-modulator', { highpassHz: 100, drive01: 0.5 + bite01 * 1.5, outputTrim01: 1 }),
      node('air', 'gain', { gain01: air01, gainMaximum01: 0.3 }));
    edges.push(edge('donor', 'interaction', 'donorAudio'), edge('send', 'interaction', 'carrierAudio'), edge('interaction', 'return'), edge('send', 'air'), edge('air', 'return'));
  } else {
    nodes.push(node('contact-band', 'nonlinear-chain', { stages: [{ shape: 'cubic', driveDb: 0, bias: 0 }], antialiasMode: 'direct', oversample: 2,
      driveDb: 0, inputHighpassHz: 100, outputDcBlockHz: 20, outputTrim01: 0.7 }),
    node('follower', 'envelope-detector', { kind: 'peak', attackSeconds: 0.003, releaseSeconds: 0.06 * 2 ** (0.5 - bite01), referenceAmplitude: 0.25 }),
    node('envelope', 'envelope-mapping', { mapping: 'linear-amplitude', neutral01: air01, depth01: Math.min(0.8, 1 - air01), polarity: 1 }), node('interaction', 'modulated-gain'));
    edges.push(edge('donor', 'contact-band'), edge('contact-band', 'follower'), edge('follower', 'envelope', 'envelope', 'envelope'),
      edge('envelope', 'interaction', 'gain', 'modulation'), edge('send', 'interaction'), edge('interaction', 'return'));
  }
  const plan = prepareEffectGraphRevision({ schema: 'lemmings-effect-graph/v1', id: 'cross-excitation.' + recipe, revision, latencyPolicy: 'align-declared', maximumLatencyFrames: 128,
    maximumTailSeconds: 30, nodes, edges });
  return freezeData({ schema: 'lemmings-cross-excitation-recipe/v1', id: recipe, name: metadata.name, mode: metadata.mode, graph: plan.definition,
    donorRoute: { laneId: donorLaneId, tap }, carrierRoute: { laneId: carrierLaneId, tap }, controls: { bite01, merge01, air01 },
    lineagePolicy: 'retain-original-intents-and-bus-membership;no-additional-semantic-onsets', direction: 'donor-to-carrier-only',
    dryPolicy: 'preserve-complete-owner-dry-source-with-declared-graph-alignment;add-bounded-carrier-return',
    latencyPolicy: 'reactive-no-lookahead;prepared-FIR-alignment', qualification: 'implementation-awaiting-graph-spectral-listening-and-device-qualification' });
}
