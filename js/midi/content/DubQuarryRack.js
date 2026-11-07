import { validateEffectVoiceSelection } from './EffectVoiceSelection.js';
import { freezeData } from '../../core/CanonicalData.js';
import { prepareEffectGraphRevision } from './EffectGraphRevision.js';
import { createOriginalImpulseDescriptor } from './ProceduralImpulseMaterial.js';

export function createQuarryEcho({ revision = 1, delaySeconds = 0.24, feedback = 0.3, return01 = 0.2, send01 = 0, mode = 'glide', feedbackLowpassHz = 6000 } = {}) {
  const bus = (id, kind, parameters = {}) => ({ id, kind, parameters });
  const edge = (from, to) => ({ from: { nodeId: from, port: 'audio' }, to: { nodeId: to, port: 'audio' }, gain01: 1 });
  return prepareEffectGraphRevision({ schema: 'lemmings-effect-graph/v1', id: 'dub-quarry.echo', revision, latencyPolicy: 'align-declared', maximumLatencyFrames: 0, maximumTailSeconds: 30,
    nodes: [bus('source', 'bus-in'), bus('dry', 'gain', { gain01: 1, gainMaximum01: 1 }), bus('send', 'gain', { gain01: send01, gainMaximum01: 0.65 }),
      bus('echo', 'feedback-delay', { maxDelaySeconds: 1, delaySeconds, mode, feedback, feedbackMaximum: 0.7, feedbackLowpassHz, feedbackHighpassHz: 120, wet01: 1 }),
      bus('return', 'gain', { gain01: return01, gainMaximum01: 0.35 }), bus('output', 'bus-out')],
    edges: [edge('source', 'dry'), edge('dry', 'output'), edge('source', 'send'), edge('send', 'echo'), edge('echo', 'return'), edge('return', 'output')] }).definition;
}

export function createQuarryDuck(options = {}) {
  const echo = createQuarryEcho(options);
  const edge = (from, fromPort, to, toPort) => ({ from: { nodeId: from, port: fromPort }, to: { nodeId: to, port: toPort }, gain01: 1 });
  return prepareEffectGraphRevision({ ...echo, id: 'dub-quarry.duck',
    nodes: [...echo.nodes, { id: 'detector', kind: 'envelope-detector', parameters: { kind: 'peak', attackSeconds: 0.003, releaseSeconds: 0.15, referenceAmplitude: 0.25 } },
      { id: 'duck-map', kind: 'envelope-mapping', parameters: { mapping: 'linear-amplitude', neutral01: 1, depth01: 0.75, polarity: -1 } },
      { id: 'duck-return', kind: 'modulated-gain', parameters: {} }],
    edges: [...echo.edges.filter(value => !(value.from.nodeId === 'echo' && value.to.nodeId === 'return')),
      edge('source', 'audio', 'detector', 'audio'), edge('detector', 'envelope', 'duck-map', 'envelope'),
      edge('duck-map', 'modulation', 'duck-return', 'gain'), edge('echo', 'audio', 'duck-return', 'audio'), edge('duck-return', 'audio', 'return', 'audio')] }).definition;
}

export function createQuarryTape({ age01 = 0.35, ...options } = {}) {
  if (!Number.isFinite(age01) || age01 < 0 || age01 > 1 || options.delaySeconds != null && (options.delaySeconds < 0.16 || options.delaySeconds > 0.75)) throw new TypeError('Quarry Tape requires bounded AGE and a 160–750 ms delay.');
  const graph = createQuarryEcho({ ...options, feedbackLowpassHz: 7000 - age01 * 5500 });
  return prepareEffectGraphRevision({ ...graph, id: 'dub-quarry.tape', maximumLatencyFrames: 128,
    nodes: [...graph.nodes, { id: 'preamp', kind: 'nonlinear-chain', parameters: { stages: [{ shape: 'cubic', driveDb: 0, bias: 0 }], antialiasMode: 'adaa1', oversample: 2,
      driveDb: 2 + age01 * 10, inputHighpassHz: 100, outputDcBlockHz: 20, outputTrim01: 0.7 } }],
    edges: [...graph.edges.filter(edge => !(edge.from.nodeId === 'send' && edge.to.nodeId === 'echo')),
      { from: { nodeId: 'send', port: 'audio' }, to: { nodeId: 'preamp', port: 'audio' }, gain01: 1 }, { from: { nodeId: 'preamp', port: 'audio' }, to: { nodeId: 'echo', port: 'audio' }, gain01: 1 }] }).definition;
}

export function createQuarryTapeSpring({ springBlend01 = 0.15, ...options } = {}) {
  if (!Number.isFinite(springBlend01) || springBlend01 < 0 || springBlend01 > 0.3) throw new TypeError('The shared spring blend must remain between zero and 0.3.');
  const tape = createQuarryTape(options), impulse = createOriginalImpulseDescriptor('quarry-hollow-spring'), edge = (from, to, gain01 = 1) => ({ from: { nodeId: from, port: 'audio' }, to: { nodeId: to, port: 'audio' }, gain01 });
  return prepareEffectGraphRevision({ ...tape, id: 'dub-quarry.tape-spring', latencyPolicy: 'uncompensated-native', maximumLatencyFrames: null,
    nodes: [...tape.nodes, { id: 'spring', kind: 'convolution-native', parameters: {}, impulse },
      { id: 'wet-sum', kind: 'gain', parameters: { gain01: 1, gainMaximum01: 1 } }],
    edges: [...tape.edges.filter(edge => !(edge.from.nodeId === 'echo' && edge.to.nodeId === 'return')),
      // Keep the parallel body within the echo branch's declared gain bound.
      edge('echo', 'spring', 1 / Math.max(1, impulse.maximumLinearGain)), edge('echo', 'wet-sum', 1 - springBlend01), edge('spring', 'wet-sum', springBlend01), edge('wet-sum', 'return')] }).definition;
}

export function createQuarryBody({ revision = 1, bodyId = 'quarry-hollow-spring', return01 = 0.15, send01 = 0 } = {}) {
  const impulse = createOriginalImpulseDescriptor(bodyId);
  const bus = (id, kind, parameters = {}) => ({ id, kind, parameters });
  const edge = (from, to) => ({ from: { nodeId: from, port: 'audio' }, to: { nodeId: to, port: 'audio' }, gain01: 1 });
  return prepareEffectGraphRevision({ schema: 'lemmings-effect-graph/v1', id: 'dub-quarry.body.' + bodyId, revision, latencyPolicy: 'uncompensated-native', maximumLatencyFrames: null, maximumTailSeconds: 3,
    nodes: [bus('source', 'bus-in'), bus('dry', 'gain', { gain01: 1, gainMaximum01: 1 }), bus('send', 'gain', { gain01: send01, gainMaximum01: 0.65 }),
      { ...bus('body', 'convolution-native'), impulse }, bus('return', 'gain', { gain01: return01, gainMaximum01: 0.3 }), bus('output', 'bus-out')],
    edges: [edge('source', 'dry'), edge('dry', 'output'), edge('source', 'send'), edge('send', 'body'), edge('body', 'return'), edge('return', 'output')] }).definition;
}

export function validateOwnerEffectRack(value) {
  if (value == null) return null;
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some(key => !['schema', 'graph', 'bypass'].includes(key)) ||
      value.schema !== 'lemmings-owner-effect-rack/v1' || !['active', 'neutral', 'tail', 'mute'].includes(value.bypass)) throw new TypeError('Invalid saved owner effect rack.');
  const graph = prepareEffectGraphRevision(value.graph, { sampleRate: 96000 }).definition;
  return freezeData({ schema: 'lemmings-owner-effect-rack/v1', graph, bypass: value.bypass });
}


export function scopeQuarryThrowToVoices(graph, voiceSelection, tap = 'post-fader') {
  const members = validateEffectVoiceSelection(voiceSelection), plan = prepareEffectGraphRevision(graph), sourceEdge = plan.definition.edges.find(edge => edge.from.nodeId === 'source' && edge.to.nodeId === 'send' && edge.from.port === 'audio' && edge.to.port === 'audio');
  if (!sourceEdge || plan.nodes.some(node => node.id === 'throw-source') || !['pre-fader', 'post-fader'].includes(tap)) throw new TypeError('Selected throws require the authored Quarry source/send boundary and an explicit lane tap.');
  return prepareEffectGraphRevision({ ...plan.definition, id: plan.definition.id + '.voices', nodes: [...plan.definition.nodes, { id: 'throw-source', kind: 'sidechain-in', parameters: { sourceBusId: 'voices:selected', tap, inputLayout: 'audioStereo', voiceSelection: members } }],
    edges: plan.definition.edges.map(edge => edge === sourceEdge ? { ...edge, from: { nodeId: 'throw-source', port: 'audio' } } : edge) }).definition;
}
