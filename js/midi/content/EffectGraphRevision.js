import { prepareVocoderBankProfile, VOCODER_BANK_REVISION } from './VocoderBankProfile.js';
import { describeEffectNodePorts, isAudioEffectPort } from './EffectPorts.js';
import { prepareEnvelopeDetectorProfile, ENVELOPE_DETECTOR_REVISION } from './EnvelopeDetectorProfile.js';
import { prepareEnvelopeMappingProfile, ENVELOPE_MAPPING_REVISION } from './EnvelopeMappingProfile.js';
import { validateImpulseResponseDescriptor } from './ImpulseResponseDescriptor.js';
import { prepareNonlinearChainProfile, NONLINEAR_KERNEL_REVISION } from './NonlinearChainProfile.js';
import { DELAY_KERNEL_REVISION, ALIGNMENT_KERNEL_REVISION } from './EffectRuntimeRevisions.js';
import { cloneData, freezeData, canonicalDataText, hashData } from '../../core/CanonicalData.js';

export const EFFECT_GRAPH_SCHEMA = 'lemmings-effect-graph/v1';
const id = value => typeof value === 'string' && /^[a-z][a-z0-9._:-]{0,127}$/i.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
const finite = (value, lo, hi) => Number.isFinite(value) && value >= lo && value <= hi;
const fail = message => { throw Object.assign(new Error(message), { name: 'EffectGraphError', code: 'invalid-effect-graph' }); };
const keys = (object, allowed) => { if (!object || Object.getPrototypeOf(object) !== Object.prototype || Object.keys(object).some(key => !allowed.includes(key))) fail('Unknown effect graph field or invalid record.'); };
const before = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const delayDefaults = Object.freeze({ maxDelaySeconds: 1, delaySeconds: 0.24, mode: 'glide', transitionSeconds: 0.015, maximumSlew: 0.25,
  feedback: 0.3, feedbackMaximum: 0.7, feedbackLowpassHz: 6000, feedbackHighpassHz: 120, wet01: 0.2 });

export function prepareEffectGraphRevision(raw, { sampleRate = 48000, maxStateBytes = 64 * 1048576 } = {}) {
  if (![44100, 48000, 96000].includes(sampleRate) || !Number.isSafeInteger(maxStateBytes) || maxStateBytes < 0 || maxStateBytes > 64 * 1048576) fail('Effect graph rate or resource profile is unavailable.');
  const graph = cloneData(raw, { maxBytes: 65536, maxNodes: 8192, domain: 'Effect graph' });
  keys(graph, ['schema', 'id', 'revision', 'nodes', 'edges', 'latencyPolicy', 'maximumLatencyFrames', 'maximumTailSeconds']);
  if (graph.schema !== EFFECT_GRAPH_SCHEMA || !id(graph.id) || !Number.isSafeInteger(graph.revision) || !finite(graph.revision, 1, 2147483647) ||
      !Array.isArray(graph.nodes) || !graph.nodes.length || graph.nodes.length > 64 || !Array.isArray(graph.edges) || graph.edges.length > 256 ||
      !['align-declared', 'uncompensated-native'].includes(graph.latencyPolicy) || !(graph.maximumLatencyFrames === null && graph.latencyPolicy === 'uncompensated-native' || Number.isSafeInteger(graph.maximumLatencyFrames) && finite(graph.maximumLatencyFrames, 0, sampleRate)) ||
      !finite(graph.maximumTailSeconds, 0, 30)) fail('Effect graph identity, inventory, latency or tail policy is invalid.');
  const nodes = new Map(), incoming = new Map(), outgoing = new Map(); let stateBytes = 0, impulseCount = 0, impulseDecodedBytes = 0, impulseNativeEstimateBytes = 0, nonlinearCount = 0;
  for (const entry of graph.nodes) {
    keys(entry, ['id', 'kind', 'parameters', 'impulse']);
    if (!id(entry.id) || nodes.has(entry.id) || !['bus-in', 'bus-out', 'gain', 'feedback-delay', 'convolution-native', 'nonlinear-chain', 'sidechain-in', 'envelope-detector', 'envelope-mapping', 'modulated-gain', 'mono-to-stereo', 'stereo-to-mono', 'multiband-vocoder'].includes(entry.kind)) fail('Unknown, duplicate or unsupported effect processor.');
    if (entry.kind !== 'convolution-native' && entry.impulse != null) fail('Only a convolution processor accepts an impulse descriptor.');
    let parameters, impulse = null, nonlinear = null, detector = null, mapping = null, vocoder = null, maximumTailFrames = 0, bytes = 0, processingLatencyFrames = 0;
    if (entry.kind === 'sidechain-in') {
      keys(entry.parameters, ['sourceBusId', 'tap', 'inputLayout']); parameters = { tap: 'pre-fader', inputLayout: 'audioStereo', ...entry.parameters };
      if (typeof parameters.sourceBusId !== 'string' || !/^(?:owner|lane:[a-zA-Z0-9._:-]{1,96})$/.test(parameters.sourceBusId) || !['pre-fader', 'post-fader'].includes(parameters.tap) || !['audioMono', 'audioStereo'].includes(parameters.inputLayout)) fail('Sidechain buses require a bounded same-owner source identity, tap and explicit audio layout.');
    } else if (entry.kind === 'multiband-vocoder') {
      vocoder = prepareVocoderBankProfile(entry.parameters, sampleRate); parameters = vocoder.parameters; bytes = vocoder.stateBytes; maximumTailFrames = vocoder.maximumTailFrames;
    } else if (entry.kind === 'envelope-detector') {
      detector = prepareEnvelopeDetectorProfile(entry.parameters, sampleRate); parameters = detector.parameters; bytes = detector.stateBytes; maximumTailFrames = detector.maximumTailFrames;
    } else if (entry.kind === 'envelope-mapping') {
      mapping = prepareEnvelopeMappingProfile(entry.parameters); parameters = mapping.parameters; bytes = mapping.stateBytes + mapping.lookupBytes;
    } else if (entry.kind === 'gain') { keys(entry.parameters, ['gain01', 'gainMaximum01']); if (!finite(entry.parameters.gainMaximum01 ?? 2, 0, 2) || !finite(entry.parameters.gain01, 0, entry.parameters.gainMaximum01 ?? 2)) fail('Effect gain exceeds its linear amplitude domain.'); parameters = { gain01: entry.parameters.gain01, gainMaximum01: entry.parameters.gainMaximum01 ?? 2 }; }
    else if (entry.kind === 'feedback-delay') {
      keys(entry.parameters, Object.keys(delayDefaults)); parameters = { ...delayDefaults, ...entry.parameters };
      if (!finite(parameters.maxDelaySeconds, 2 / sampleRate, 3) || !finite(parameters.delaySeconds, 1 / sampleRate, parameters.maxDelaySeconds) ||
          !['glide', 'jump'].includes(parameters.mode) || !finite(parameters.transitionSeconds, 2 / sampleRate, 0.2) || !finite(parameters.maximumSlew, 0.00001, 0.25) ||
          !finite(parameters.feedbackMaximum, 0, 0.7) || !finite(parameters.feedback, -parameters.feedbackMaximum, parameters.feedbackMaximum) || !finite(parameters.feedbackLowpassHz, 200, sampleRate * 0.4) ||
          !finite(parameters.feedbackHighpassHz, 20, Math.min(1000, parameters.feedbackLowpassHz)) || !finite(parameters.wet01, 0, 1)) fail('Delay parameters exceed their bounded processor profile.');
      const repeats = parameters.feedbackMaximum === 0 ? 1 : Math.ceil(Math.log(0.001) / Math.log(parameters.feedbackMaximum)) + 1;
      maximumTailFrames = Math.ceil((repeats * parameters.maxDelaySeconds + 1) * sampleRate);
      bytes = (Math.ceil(parameters.maxDelaySeconds * sampleRate) + 4) * 8 + 6 * 8;
    } else if (entry.kind === 'nonlinear-chain') {
      nonlinear = prepareNonlinearChainProfile(entry.parameters, sampleRate); parameters = nonlinear.parameters; processingLatencyFrames = nonlinear.processingLatencyFrames; maximumTailFrames = nonlinear.maximumTailFrames; bytes = nonlinear.stateBytes;
      if (++nonlinearCount > 4) fail('This graph profile admits at most four shared nonlinear processing islands.');
    } else if (entry.kind === 'convolution-native') {
      keys(entry.parameters, []); parameters = {}; impulse = validateImpulseResponseDescriptor(entry.impulse); processingLatencyFrames = null;
      if (graph.latencyPolicy !== 'uncompensated-native') fail('Unmeasured native convolution latency requires an explicit uncompensated graph policy.');
      const decodedBytes = (Math.ceil(impulse.asset.frames * sampleRate / impulse.asset.sourceSampleRate) + 1) * impulse.asset.channels * 4;
      impulseCount++; impulseDecodedBytes += decodedBytes; impulseNativeEstimateBytes += decodedBytes * 4 + 8 * 1048576;
      if (impulseCount > 4 || decodedBytes > 32 * 1048576 || impulseDecodedBytes > 64 * 1048576) fail('Shared convolution body count or decoded PCM exceeds its graph profile.');
      maximumTailFrames = Math.ceil((impulse.asset.frames / impulse.asset.sourceSampleRate + impulse.predelaySeconds) * sampleRate);
    } else { keys(entry.parameters, []); parameters = {}; }
    stateBytes += bytes;
    nodes.set(entry.id, { id: entry.id, kind: entry.kind, parameters, ...(impulse ? { impulse } : {}), ...(nonlinear ? { nonlinear } : {}), ...(detector ? { detector } : {}), ...(mapping ? { mapping } : {}), ...(vocoder ? { vocoder } : {}), ports: describeEffectNodePorts(entry.kind, parameters),
      processingLatencyFrames, maximumTailFrames, stateBytes: bytes, stateCapability: ['feedback-delay', 'convolution-native', 'nonlinear-chain', 'envelope-detector', 'envelope-mapping', 'multiband-vocoder'].includes(entry.kind) ? 'deterministic-preroll' : 'stateless',
      costClass: entry.kind === 'multiband-vocoder' ? 'four-biquads-and-one-linked-envelope-per-band' : entry.kind === 'envelope-detector' ? 'fixed-window-linked-envelope' : entry.kind === 'envelope-mapping' ? 'prepared-signal-rate-gain-mapping' : entry.kind === 'modulated-gain' ? 'audio-rate-external-gain-control' : entry.kind === 'feedback-delay' ? 'fixed-stereo-two-tap-delay' : entry.kind === 'convolution-native' ? 'shared-native-convolution' : entry.kind === 'nonlinear-chain' ? 'bounded-polyphase-nonlinear-chain' : 'native-gain-routing', qualification: 'implementation-awaiting-full-graph-qualification' });
    incoming.set(entry.id, []); outgoing.set(entry.id, []);
  }
  if (stateBytes > maxStateBytes) fail('Effect graph exceeds the admitted delay storage.');
  const edges = [], edgeKeys = new Set();
  for (const entry of graph.edges) {
    keys(entry, ['from', 'to', 'gain01']); keys(entry.from, ['nodeId', 'port']); keys(entry.to, ['nodeId', 'port']);
    const source = nodes.get(entry.from.nodeId), target = nodes.get(entry.to.nodeId), key = JSON.stringify([entry.from.nodeId, entry.from.port, entry.to.nodeId, entry.to.port]);
    const sourcePort = source?.ports.outputs[entry.from.port], targetPort = target?.ports.inputs[entry.to.port];
    if (!source || !target || !sourcePort || !targetPort || sourcePort.type !== targetPort.type || sourcePort.unit !== targetPort.unit ||
        !finite(entry.gain01, 0, 1) || !isAudioEffectPort(sourcePort) && entry.gain01 !== 1 || edgeKeys.has(key) || source.id === target.id) fail('Effect edge is missing, duplicated, cyclic or has incompatible typed ports/units.');
    edgeKeys.add(key); const edge = { from: entry.from, to: entry.to, gain01: entry.gain01, alignmentFrames: 0 };
    edges.push(edge); incoming.get(target.id).push(edge); outgoing.get(source.id).push(edge);
  }
  const pending = new Map([...incoming].map(([key, list]) => [key, list.length])), order = [], ready = [...nodes.keys()].filter(key => !pending.get(key)).sort(before);
  while (ready.length) {
    const key = ready.shift(); order.push(key);
    for (const edge of outgoing.get(key)) { const target = edge.to.nodeId; pending.set(target, pending.get(target) - 1); if (!pending.get(target)) { ready.push(target); ready.sort(before); } }
  }
  if (order.length !== nodes.size) fail('Arbitrary feedback cycles are unsupported; use the bounded feedback-delay processor.');
  const latency = new Map(), tails = new Map(), reachable = new Set(), amplitude = new Map();
  for (const key of order) {
    const node = nodes.get(key), inputs = incoming.get(key);
    const sourceNode = node.kind === 'bus-in' || node.kind === 'sidechain-in';
    if (!sourceNode && !inputs.length || node.kind !== 'bus-out' && !outgoing.get(key).length) fail('Every effect node must belong to a complete source-to-output route.');
    for (const [port, descriptor] of Object.entries(node.ports.inputs)) {
      const count = inputs.filter(edge => edge.to.port === port).length;
      if (!count || !descriptor.multiple && count !== 1) fail('Effect input port is missing or has ambiguous control membership.');
    }
    const signalInputs = inputs.filter(edge => isAudioEffectPort(node.ports.inputs[edge.to.port]) && (node.kind !== 'multiband-vocoder' || edge.to.port === 'carrierAudio'));
    const timingInputs = Object.keys(node.ports.outputs).some(port => isAudioEffectPort(node.ports.outputs[port])) || node.kind === 'bus-out' ? signalInputs : inputs;
    const inputLatencies = timingInputs.map(edge => latency.get(edge.from.nodeId)), arrival = inputLatencies.includes(null) ? null : Math.max(0, ...inputLatencies);
    for (const edge of inputs) edge.alignmentFrames = graph.latencyPolicy === 'align-declared' && isAudioEffectPort(node.ports.inputs[edge.to.port]) && (node.kind !== 'multiband-vocoder' || edge.to.port === 'carrierAudio') ? arrival - latency.get(edge.from.nodeId) : 0;
    const inputBound = sourceNode ? 1 : signalInputs.reduce((sum, edge) => sum + amplitude.get(edge.from.nodeId) * edge.gain01, 0);
    const gainBound = node.kind === 'gain' ? node.parameters.gainMaximum01 : node.kind === 'feedback-delay' ? 1 / (1 - node.parameters.feedbackMaximum * 1.1) : node.kind === 'convolution-native' ? node.impulse.maximumLinearGain : 1;
    amplitude.set(key, ['envelope-detector', 'envelope-mapping'].includes(node.kind) ? 1 : node.nonlinear ? Math.min(inputBound * node.nonlinear.maximumLinearGain, node.nonlinear.maximumOutputAmplitude) : inputBound * (node.vocoder?.maximumLinearGain ?? gainBound)); if (amplitude.get(key) > 16) fail('Compounded effect route gain exceeds its admitted headroom.');
    latency.set(key, arrival === null || node.processingLatencyFrames === null ? null : arrival + node.processingLatencyFrames); tails.set(key, Math.max(0, ...inputs.map(edge => tails.get(edge.from.nodeId) + edge.alignmentFrames)) + node.maximumTailFrames);
    if (sourceNode || inputs.some(edge => reachable.has(edge.from.nodeId))) reachable.add(key);
  }
  const sidechainInputs = [...nodes.values()].filter(node => node.kind === 'sidechain-in').map(node => node.id).sort(before);
  if ([...nodes.values()].filter(node => node.vocoder).length > 2 || sidechainInputs.length > 8 || [...nodes.values()].filter(node => node.detector).length > 16 || [...nodes.values()].filter(node => node.mapping).length > 16) fail('Sidechain bus, detector or mapping count exceeds its prepared profile.');
  const inputs = [...nodes.values()].filter(node => node.kind === 'bus-in').map(node => node.id).sort(before), outputs = [...nodes.values()].filter(node => node.kind === 'bus-out').map(node => node.id).sort(before);
  const outputLatencies = outputs.map(key => latency.get(key)), latencyFrames = outputLatencies.includes(null) ? null : Math.max(0, ...outputLatencies), maximumTailFrames = Math.max(0, ...outputs.map(key => tails.get(key)));
  const alignmentStateBytes = edges.reduce((sum, edge) => sum + (edge.alignmentFrames ? (Math.ceil(edge.alignmentFrames) + 2) * 8 : 0), 0); stateBytes += alignmentStateBytes;
  if (stateBytes > maxStateBytes) fail('Complete effect and alignment storage exceeds the admitted graph profile.');
  if (!inputs.length || !outputs.length || outputs.some(key => !reachable.has(key)) || latencyFrames != null && graph.maximumLatencyFrames != null && latencyFrames > graph.maximumLatencyFrames || maximumTailFrames > graph.maximumTailSeconds * sampleRate)
    fail('Effect route is unreachable or exceeds its complete latency/tail budget.');
  const definition = { ...graph, nodes: [...nodes.values()].sort((a, b) => before(a.id, b.id)).map(({ id, kind, parameters, impulse }) => ({ id, kind, parameters, ...(impulse ? { impulse } : {}) })),
    edges: edges.map(({ from, to, gain01 }) => ({ from, to, gain01 })).sort((a, b) => before(JSON.stringify(a), JSON.stringify(b))) };
  canonicalDataText(definition, { maxBytes: 65536, maxNodes: 8192 });
  return freezeData({ schema: 'lemmings-effect-plan/v1', definition, sampleRate, order, nodes: order.map(key => nodes.get(key)), edges: edges.sort((a, b) => before(JSON.stringify(a), JSON.stringify(b))), inputs, outputs, sidechainInputs, latencyFrames, maximumTailFrames, stateBytes, impulseCount, impulseDecodedBytes, nonlinearCount, alignmentStateBytes,
    processingRevisions: { delay: [...nodes.values()].some(node => node.kind === 'feedback-delay') ? DELAY_KERNEL_REVISION : null, nonlinear: nonlinearCount ? NONLINEAR_KERNEL_REVISION : null, alignment: alignmentStateBytes ? ALIGNMENT_KERNEL_REVISION : null,
      ...([...nodes.values()].some(node => node.detector) ? { detector: ENVELOPE_DETECTOR_REVISION } : {}), ...([...nodes.values()].some(node => node.mapping) ? { envelopeMapping: ENVELOPE_MAPPING_REVISION } : {}), ...([...nodes.values()].some(node => node.vocoder) ? { vocoder: VOCODER_BANK_REVISION } : {}) },
    processingCost: { vocoderBiquadsPerFrame: [...nodes.values()].reduce((sum, node) => sum + (node.vocoder?.filterCount || 0), 0), envelopeFollowersPerFrame: [...nodes.values()].reduce((sum, node) => sum + (node.vocoder?.followerCount || (node.detector ? 1 : 0)), 0), unit: 'prepared-operator-count-not-measured-CPU' },
    nativeNodeEstimateBytes: (nodes.size * 4 + edges.length) * 8192 + impulseNativeEstimateBytes, feedbackPolicy: 'only-inside-bounded-delay-operator', alignment: graph.latencyPolicy === 'align-declared' ? 'declared-processing-latency-only-linear-fractional-creative-delay-preserved' : 'disabled-unknown-native-latency',
    tailPolicy: 'hard-owned-deadline-with-conservative-feedback-decay-model', maximumGraphGainBound: Math.max(...amplitude.values()),
    outputProtection: 'required-shared-owner-master-external-to-creative-graph' });
}

export const effectGraphHash = plan => hashData({ schema: plan.schema, definition: plan.definition, sampleRate: plan.sampleRate, processingRevisions: plan.processingRevisions, ...(plan.nodes.some(node => node.vocoder) ? { vocoderRealizations: plan.nodes.filter(node => node.vocoder).map(node => ({ id: node.id, bands: node.vocoder.bands, sumScale: node.vocoder.sumScale })) } : {}) });
