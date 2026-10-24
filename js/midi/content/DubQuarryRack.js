import { freezeData } from '../../core/CanonicalData.js';
import { prepareEffectGraphRevision } from './EffectGraphRevision.js';

export function createQuarryEcho({ revision = 1, delaySeconds = 0.24, feedback = 0.3, return01 = 0.2, send01 = 0, mode = 'glide' } = {}) {
  const bus = (id, kind, parameters = {}) => ({ id, kind, parameters });
  const edge = (from, to) => ({ from: { nodeId: from, port: 'audio' }, to: { nodeId: to, port: 'audio' }, gain01: 1 });
  return prepareEffectGraphRevision({ schema: 'lemmings-effect-graph/v1', id: 'dub-quarry.echo', revision, latencyPolicy: 'align-declared', maximumLatencyFrames: 0, maximumTailSeconds: 30,
    nodes: [bus('source', 'bus-in'), bus('dry', 'gain', { gain01: 1, gainMaximum01: 1 }), bus('send', 'gain', { gain01: send01, gainMaximum01: 0.65 }),
      bus('echo', 'feedback-delay', { maxDelaySeconds: 1, delaySeconds, mode, feedback, feedbackMaximum: 0.7, feedbackLowpassHz: 6000, feedbackHighpassHz: 120, wet01: 1 }),
      bus('return', 'gain', { gain01: return01, gainMaximum01: 0.35 }), bus('output', 'bus-out')],
    edges: [edge('source', 'dry'), edge('dry', 'output'), edge('source', 'send'), edge('send', 'echo'), edge('echo', 'return'), edge('return', 'output')] }).definition;
}

export function validateOwnerEffectRack(value) {
  if (value == null) return null;
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some(key => !['schema', 'graph', 'bypass'].includes(key)) ||
      value.schema !== 'lemmings-owner-effect-rack/v1' || !['active', 'neutral', 'tail', 'mute'].includes(value.bypass)) throw new TypeError('Invalid saved owner effect rack.');
  const graph = prepareEffectGraphRevision(value.graph, { sampleRate: 96000 }).definition;
  return freezeData({ schema: 'lemmings-owner-effect-rack/v1', graph, bypass: value.bypass });
}
