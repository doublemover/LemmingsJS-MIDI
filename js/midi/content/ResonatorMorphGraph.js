import { createPairedModalBodyParameters } from './PairedModalBodyProfile.js';
import { prepareEffectGraphRevision } from './EffectGraphRevision.js';
import { freezeData } from '../../core/CanonicalData.js';

export async function createResonatorMorphGraph({ map, a, b, morph01 = 0, inputGain01 = 1, wet01 = 0.2, travelPixels = 256, revision = 1 } = {}, sampleRate = 48000) {
  if (!Number.isFinite(wet01) || wet01 < 0 || wet01 > 0.35 || !Number.isFinite(travelPixels) || travelPixels < 128 || travelPixels > 1024 || !Number.isSafeInteger(revision) || revision < 1) throw new TypeError('The paired-body return or real travel domain is unavailable.');
  const parameters = await createPairedModalBodyParameters({ map, a, b, morph01, inputGain01 }, sampleRate), node = (id, kind, parameters = {}) => ({ id, kind, parameters }), edge = (from, to) => ({ from: { nodeId: from, port: 'audio' }, to: { nodeId: to, port: 'audio' }, gain01: 1 });
  const plan = prepareEffectGraphRevision({ schema: 'lemmings-effect-graph/v1', id: 'reviewed.resonator-morph', revision, latencyPolicy: 'align-declared', maximumLatencyFrames: 0, maximumTailSeconds: 20,
    nodes: [node('source', 'bus-in'), node('dry', 'gain', { gain01: 1 - wet01, gainMaximum01: 1 }), node('morph-body', 'paired-modal-body', parameters), node('return', 'gain', { gain01: wet01, gainMaximum01: 0.35 }), node('output', 'bus-out')],
    edges: [edge('source', 'dry'), edge('dry', 'output'), edge('source', 'morph-body'), edge('morph-body', 'return'), edge('return', 'output')] }, { sampleRate });
  return freezeData({ schema: 'lemmings-resonator-morph-graph/v1', graph: plan.definition, mapHash: parameters.map.hash, profileIdentity: parameters.profileIdentity,
    control: { nodeId: 'morph-body', parameter: 'morph01', minimum: 0, maximum: 1, travelPixels, startPixels: 0, curve: 'clamped-signed-distance' },
    source: 'same-canonical-owner-audio-sum;no-added-onsets-or-actor-timing-changes', tailPolicy: 'canonical-owner-admitted-body-tail-and-explicit-clear', transitionPolicy: parameters.map.transitionPolicy, qualification: 'implementation-pending-live-route-PCM-and-matched-level-listening' });
}
