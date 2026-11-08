import { prepareEffectGraphRevision } from '../../midi/content/EffectGraphRevision.js';
import { freezeData, hashData } from '../../core/CanonicalData.js';

const fail = (code, message) => { throw Object.assign(new Error(message), { name: 'EffectRenderError', code }); };
export async function prepareCapturedEffectHistory(source, sampleRate, endFrame, projectedPackets, project, prepareSingle) {
  const publications = projectedPackets.filter(value => value.packet.operation === 'graph');
  if (publications.length > 32 || projectedPackets.some(({ packet }) => !['graph', 'control'].includes(packet.operation)))
    fail('effect-transition-replay-unavailable', 'Changing-graph revoice supports at most 32 continuous publications and controls. Body strikes, bypass and processor acknowledgments require their own transition profile.');
  const first = publications[0].packet, groups = new Map(); let previousSequence = 0;
  for (const { packet } of projectedPackets) {
    if (packet.sequence <= previousSequence || packet.streamId !== first.streamId || packet.executionEpoch !== first.executionEpoch || packet.sampleRate !== first.sampleRate)
      fail('effect-history-order', 'Graph history must retain one ordered stream, context rate and execution epoch.');
    previousSequence = packet.sequence;
    if (packet.operation === 'graph') {
      if (groups.has(packet.ownerRouteRevision) || !packet.routeTransition) fail('effect-transition-evidence-unavailable', 'Each graph revision needs its captured input ramp and predecessor tail deadline. Older publications remain available for static revoice.');
      groups.set(packet.ownerRouteRevision, []);
    }
    const group = groups.get(packet.ownerRouteRevision);
    if (!group || (group.length && group[0].graphDefinitionHash !== packet.graphDefinitionHash)) fail('effect-history-order', 'A control must belong to an already published exact graph revision.');
    group.push(packet);
  }
  const graphs = []; let peakStateBytes = 0;
  for (let index = 0; index < publications.length; index++) {
    const { packet, projected } = publications[index], transition = packet.routeTransition, predecessor = graphs[index - 1];
    if (index && projected.frame < 0) fail('effect-transition-before-source', 'Multiple replacements before the captured source boundary need a separate initial-state reconstruction.');
    if (!predecessor && transition.previous !== null || predecessor && (!transition.previous || transition.previous.ownerRouteRevision !== predecessor.ownerRouteRevision || transition.previous.graphDefinitionHash !== predecessor.capturedGraphHash || packet.ownerRouteRevision <= predecessor.ownerRouteRevision || projected.frame < predecessor.startFrame))
      fail('effect-transition-predecessor', 'The recorded replacement must identify the immediately preceding captured route.');
    const plan = prepareEffectGraphRevision(packet.definition, { sampleRate });
    if (plan.impulseCount || plan.sidechainInputs.length || plan.nodes.some(node => node.spectral || node.membrane))
      fail('effect-transition-node-unavailable', 'Changing-graph revoice currently needs owned audio-input graphs without external donors, spectral grids or finite-body commands.');
    if (predecessor) {
      const old = transition.previous, originalPlan = prepareEffectGraphRevision(predecessor.definition, { sampleRate: packet.sampleRate });
      const expected = Math.max(transition.startFrame + transition.transitionFrames, old.lastBodyDriveFrame) + originalPlan.maximumTailFrames;
      if (Math.abs(expected - old.retireAtFrame) > 1) fail('effect-transition-tail-identity', 'The predecessor tail deadline differs from its captured ramp, last drive or exact graph tail bound.');
      predecessor.detachFrame = projected.frame;
      predecessor.detachTransitionFrames = Math.max(1, Math.round(transition.transitionFrames * sampleRate / packet.sampleRate));
      predecessor.retireFrame = project({ ...packet, targetFrame: old.retireAtFrame }).frame;
      if (predecessor.retireFrame < predecessor.detachFrame + predecessor.detachTransitionFrames - 1) fail('effect-transition-tail-identity', 'A resampled tail ends before its input ramp.');
    }
    const replay = await prepareSingle({ ...source, effectEvents: groups.get(packet.ownerRouteRevision) }, sampleRate, endFrame);
    graphs.push({ ownerRouteRevision: packet.ownerRouteRevision, capturedGraphHash: packet.graphDefinitionHash, definition: replay.definition, graphHash: replay.graphHash,
      startFrame: replay.graphStartFrame, transitionFrames: replay.transitionFrames, detachFrame: null, detachTransitionFrames: null, retireFrame: null,
      stateBytes: plan.stateBytes, maximumTailFrames: plan.maximumTailFrames, latencyFrames: plan.latencyFrames, processingRevisions: plan.processingRevisions, replay });
  }
  for (let index = 0; index < graphs.length; index++) {
    const graph = graphs[index], active = graphs.slice(0, index + 1).filter(member => member.retireFrame === null || member.retireFrame > Math.max(0, graph.startFrame));
    if (active.length > 2) fail('effect-transition-capacity', 'This history needs more than two concurrent owned graphs at a publication.');
    peakStateBytes = Math.max(peakStateBytes, active.reduce((sum, member) => sum + member.stateBytes, 0));
    if (graph.replay.events.some(event => graph.retireFrame !== null && event.frame >= graph.retireFrame)) fail('effect-transition-command-after-retirement', 'A captured control exceeds its exact retained graph deadline.');
  }
  const initial = graphs[0].replay, events = graphs.flatMap(graph => graph.replay.events), body = {
    schema: 'lemmings-captured-effect-history/v1', definition: initial.definition, graphHash: initial.graphHash, capturedGraphHash: initial.capturedGraphHash,
    sourceCanonicalHash: source.sourceCanonicalHash, sampleRate, endFrame, graphs, events, bodySourceIntentIds: [], lastBodyDriveFrame: 0,
    graphStartFrame: initial.graphStartFrame, frameOrigin: initial.frameOrigin, capturedFrameOrigin: initial.capturedFrameOrigin, peakStateBytes, maximumConcurrentGraphs: 2,
    latencyFrames: Math.max(...graphs.map(graph => graph.latencyFrames)),
    maximumTailFrames: Math.max(...graphs.map(graph => graph.maximumTailFrames)),
    retirementEndFrame: Math.max(0, ...graphs.map(graph => graph.retireFrame ?? 0)),
    operation: 'captured-API-command-revoice', initialMemory: initial.initialMemory,
    evidence: 'captured-native-API-route-ramps-and-tail-deadlines;not-processor-or-device-application',
    timing: initial.timing, spectralCapture: null,
    policy: 'one-original-source-render;two-concurrent-owned-graphs;retained-tails;forward-preroll;no-exact-live-DSP-state-claim' };
  return freezeData({ ...body, hash: await hashData(body, { maxBytes: 4 * 1048576, maxNodes: 131072 }) });
}
export function capturedEffectHistoryReceipt(replay) {
  return replay?.schema === 'lemmings-captured-effect-history/v1' ? {
    schema: replay.schema, hash: replay.hash, maximumConcurrentGraphs: replay.maximumConcurrentGraphs, peakStateBytes: replay.peakStateBytes,
    maximumTailFrames: replay.maximumTailFrames, latencyFrames: replay.latencyFrames, retirementEndFrame: replay.retirementEndFrame, policy: replay.policy,
    graphs: replay.graphs.map(({ ownerRouteRevision, graphHash, capturedGraphHash, startFrame, transitionFrames, detachFrame, detachTransitionFrames, retireFrame, stateBytes, maximumTailFrames, latencyFrames, processingRevisions, replay: member }) => ({
      ownerRouteRevision, graphHash, capturedGraphHash, startFrame, transitionFrames, detachFrame, detachTransitionFrames, retireFrame, stateBytes, maximumTailFrames, latencyFrames, processingRevisions, capturedFrameOrigin: member.capturedFrameOrigin, commandReplayHash: member.hash })) } : null;
}
