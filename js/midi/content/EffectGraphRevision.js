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
      graph.latencyPolicy !== 'align-declared' || !Number.isSafeInteger(graph.maximumLatencyFrames) || !finite(graph.maximumLatencyFrames, 0, sampleRate) ||
      !finite(graph.maximumTailSeconds, 0, 30)) fail('Effect graph identity, inventory, latency or tail policy is invalid.');
  const nodes = new Map(), incoming = new Map(), outgoing = new Map(); let stateBytes = 0;
  for (const entry of graph.nodes) {
    keys(entry, ['id', 'kind', 'parameters']);
    if (!id(entry.id) || nodes.has(entry.id) || !['bus-in', 'bus-out', 'gain', 'feedback-delay'].includes(entry.kind)) fail('Unknown, duplicate or unsupported effect processor.');
    let parameters, maximumTailFrames = 0, bytes = 0;
    if (entry.kind === 'gain') { keys(entry.parameters, ['gain01']); if (!finite(entry.parameters.gain01, 0, 2)) fail('Effect gain exceeds its linear amplitude domain.'); parameters = entry.parameters; }
    else if (entry.kind === 'feedback-delay') {
      keys(entry.parameters, Object.keys(delayDefaults)); parameters = { ...delayDefaults, ...entry.parameters };
      if (!finite(parameters.maxDelaySeconds, 2 / sampleRate, 3) || !finite(parameters.delaySeconds, 1 / sampleRate, parameters.maxDelaySeconds) ||
          !['glide', 'jump'].includes(parameters.mode) || !finite(parameters.transitionSeconds, 2 / sampleRate, 0.2) || !finite(parameters.maximumSlew, 0.00001, 0.25) ||
          !finite(parameters.feedbackMaximum, 0, 0.7) || !finite(parameters.feedback, -parameters.feedbackMaximum, parameters.feedbackMaximum) || !finite(parameters.feedbackLowpassHz, 200, sampleRate * 0.4) ||
          !finite(parameters.feedbackHighpassHz, 20, Math.min(1000, parameters.feedbackLowpassHz)) || !finite(parameters.wet01, 0, 1)) fail('Delay parameters exceed their bounded processor profile.');
      const repeats = parameters.feedbackMaximum === 0 ? 1 : Math.ceil(Math.log(0.001) / Math.log(parameters.feedbackMaximum)) + 1;
      maximumTailFrames = Math.ceil((repeats * parameters.maxDelaySeconds + 1) * sampleRate);
      bytes = (Math.ceil(parameters.maxDelaySeconds * sampleRate) + 4) * 8 + 6 * 8;
    } else { keys(entry.parameters, []); parameters = {}; }
    stateBytes += bytes;
    nodes.set(entry.id, { id: entry.id, kind: entry.kind, parameters, ports: { input: entry.kind === 'bus-in' ? null : 'audioStereo', output: entry.kind === 'bus-out' ? null : 'audioStereo' },
      processingLatencyFrames: 0, maximumTailFrames, stateBytes: bytes, stateCapability: entry.kind === 'feedback-delay' ? 'deterministic-preroll' : 'stateless',
      costClass: entry.kind === 'feedback-delay' ? 'fixed-stereo-two-tap-delay' : 'native-gain-routing', qualification: 'implementation-awaiting-full-graph-qualification' });
    incoming.set(entry.id, []); outgoing.set(entry.id, []);
  }
  if (stateBytes > maxStateBytes) fail('Effect graph exceeds the admitted delay storage.');
  const edges = [], edgeKeys = new Set();
  for (const entry of graph.edges) {
    keys(entry, ['from', 'to', 'gain01']); keys(entry.from, ['nodeId', 'port']); keys(entry.to, ['nodeId', 'port']);
    const source = nodes.get(entry.from.nodeId), target = nodes.get(entry.to.nodeId), key = JSON.stringify([entry.from.nodeId, entry.from.port, entry.to.nodeId, entry.to.port]);
    if (!source || !target || entry.from.port !== 'audio' || entry.to.port !== 'audio' || !source.ports.output || !target.ports.input ||
        source.ports.output !== target.ports.input || !finite(entry.gain01, 0, 1) || edgeKeys.has(key) || source.id === target.id) fail('Effect edge is missing, duplicated, cyclic or has incompatible typed ports.');
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
    if (node.kind !== 'bus-in' && !inputs.length || node.kind !== 'bus-out' && !outgoing.get(key).length) fail('Every effect node must belong to a complete source-to-output route.');
    const arrival = Math.max(0, ...inputs.map(edge => latency.get(edge.from.nodeId)));
    for (const edge of inputs) edge.alignmentFrames = arrival - latency.get(edge.from.nodeId);
    const inputBound = node.kind === 'bus-in' ? 1 : inputs.reduce((sum, edge) => sum + amplitude.get(edge.from.nodeId) * edge.gain01, 0);
    const gainBound = node.kind === 'gain' ? node.parameters.gain01 : node.kind === 'feedback-delay' ? 1 / (1 - node.parameters.feedbackMaximum * 1.1) : 1;
    amplitude.set(key, inputBound * gainBound); if (amplitude.get(key) > 16) fail('Compounded effect route gain exceeds its admitted headroom.');
    latency.set(key, arrival + node.processingLatencyFrames); tails.set(key, Math.max(0, ...inputs.map(edge => tails.get(edge.from.nodeId))) + node.maximumTailFrames);
    if (node.kind === 'bus-in' || inputs.some(edge => reachable.has(edge.from.nodeId))) reachable.add(key);
  }
  const inputs = [...nodes.values()].filter(node => node.kind === 'bus-in').map(node => node.id).sort(before), outputs = [...nodes.values()].filter(node => node.kind === 'bus-out').map(node => node.id).sort(before);
  const latencyFrames = Math.max(0, ...outputs.map(key => latency.get(key))), maximumTailFrames = Math.max(0, ...outputs.map(key => tails.get(key)));
  if (!inputs.length || !outputs.length || outputs.some(key => !reachable.has(key)) || latencyFrames > graph.maximumLatencyFrames || maximumTailFrames > graph.maximumTailSeconds * sampleRate)
    fail('Effect route is unreachable or exceeds its complete latency/tail budget.');
  const definition = { ...graph, nodes: [...nodes.values()].sort((a, b) => before(a.id, b.id)).map(({ id, kind, parameters }) => ({ id, kind, parameters })),
    edges: edges.map(({ from, to, gain01 }) => ({ from, to, gain01 })).sort((a, b) => before(JSON.stringify(a), JSON.stringify(b))) };
  canonicalDataText(definition, { maxBytes: 65536, maxNodes: 8192 });
  return freezeData({ schema: 'lemmings-effect-plan/v1', definition, sampleRate, order, nodes: order.map(key => nodes.get(key)), edges: edges.sort((a, b) => before(JSON.stringify(a), JSON.stringify(b))), inputs, outputs, latencyFrames, maximumTailFrames, stateBytes,
    nativeNodeEstimateBytes: (nodes.size * 4 + edges.length) * 8192, feedbackPolicy: 'only-inside-bounded-delay-operator', alignment: 'declared-processing-latency-only-creative-delay-preserved',
    tailPolicy: 'hard-owned-deadline-with-conservative-feedback-decay-model', maximumGraphGainBound: Math.max(...amplitude.values()),
    outputProtection: 'required-shared-owner-master-external-to-creative-graph' });
}

export const effectGraphHash = plan => hashData({ schema: plan.schema, definition: plan.definition, sampleRate: plan.sampleRate });
