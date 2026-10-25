import { validateEffectPerformance } from '../../midi/content/EffectPerformance.js';
import { prepareEffectGraphRevision, effectGraphHash } from '../../midi/content/EffectGraphRevision.js';
import { createCausalRenderTiming } from './CausalRenderTiming.js';
import { freezeData, hashData } from '../../core/CanonicalData.js';

const fail = (code, message) => { throw Object.assign(new Error(message), { name: 'EffectRenderError', code }); };
export async function prepareCapturedEffectReplay(source, sampleRate, endFrame) {
  if (!source?.effectCoverage?.captured || source.effectCoverage.gaps?.length || !Array.isArray(source.effectEvents) || !source.effectEvents.length || source.effectEvents.length > 8192 || source.nextSequence != null || !Number.isSafeInteger(endFrame) || endFrame < 1) fail('effect-history-unavailable', 'This range has no complete captured effect command history. Choose explicit static effects or a covered take.');
  const packets = source.effectEvents.map(validateEffectPerformance), timing = createCausalRenderTiming(source, sampleRate), intents = new Map(source.intents.map(intent => [intent.intentId, intent]));
  const project = packet => {
    const anchor = packet.clockAnchor, intent = anchor && intents.get(anchor.intentId);
    if (!intent || !anchor.executionEpoch || anchor.executionEpoch !== packet.executionEpoch) fail('effect-clock-unavailable', 'An effect command has no captured intent/audio-clock anchor. Prepare effects after the running take has established its audio clock.');
    const referenceFrame = timing.frameFor(intent), frame = Math.round(referenceFrame + (packet.targetFrame - anchor.sourceTargetFrame) * sampleRate / packet.sampleRate);
    if (!Number.isSafeInteger(frame)) fail('effect-frame-overflow', 'Captured effect timing exceeds its safe frame domain.');
    return { frame, origin: Math.round(anchor.sourceTargetFrame * sampleRate / packet.sampleRate - referenceFrame) };
  };
  const projectedPackets = packets.map(packet => ({ packet, projected: project(packet) })).filter(value => value.projected.frame < endFrame);
  const graphPackets = projectedPackets.filter(value => value.packet.operation === 'graph').map(value => value.packet);
  if (graphPackets.length !== 1) fail('effect-transition-replay-unavailable', 'Captured command revoice currently requires one prepared graph throughout its history. Split graph replacements into separate takes or choose static revoice.');
  const publication = graphPackets[0], initial = project(publication), original = prepareEffectGraphRevision(publication.definition, { sampleRate: publication.sampleRate });
  if (await effectGraphHash(original) !== publication.graphDefinitionHash) fail('effect-history-identity', 'Captured effect definition differs from its published graph hash.');
  const plan = prepareEffectGraphRevision(publication.definition, { sampleRate });
  if (plan.impulseCount) fail('effect-command-native-body-unavailable', 'Captured command revoice does not yet schedule native convolution graphs. Use explicit static body rendering or master capture.');
  if (initial.origin < 0) fail('effect-clock-origin-unavailable', 'The effect analysis grid precedes the captured audio context.');
  const events = []; let previous = 0;
  for (const { packet, projected } of projectedPackets) {
    if (packet.streamId !== publication.streamId || packet.ownerRouteRevision !== publication.ownerRouteRevision || packet.graphDefinitionHash !== publication.graphDefinitionHash || packet.sequence <= previous) fail('effect-history-order', 'Captured effects mix routes, streams or nonmonotonic command identities.'); previous = packet.sequence;
    if (packet.operation === 'body-panic') fail('effect-body-lifecycle-replay-unavailable', 'A body-only Panic was submitted through the message port; its applied audio frame is unavailable in this captured-command profile.');
    if (packet.operation === 'bypass') fail('effect-lifecycle-replay-unavailable', 'This history includes an effect stop, bypass, mute or Panic. Choose a range ending before that transition or explicit static revoice.');
    if (packet.operation === 'control') {
      if (projected.frame < 0 || projected.frame < initial.frame) fail('effect-control-before-publication', 'A captured parameter precedes its prepared graph.');
      if (plan.nodes.some(node => node.spectral) && Math.abs(projected.origin - initial.origin) > 1) fail('effect-analysis-grid-rebased', 'Spectral capture crosses an audio-clock rebase; its original analysis grid is unavailable in this render profile.');
      events.push({ frame: projected.frame, nodeId: packet.nodeId, values: packet.values, sequence: packet.sequence, sourceEventIds: packet.sourceEventIds });
    }
  }
  events.sort((a, b) => a.frame - b.frame || a.sequence - b.sequence);
  const body = { schema: 'lemmings-captured-effect-replay/v1', definition: plan.definition, events, graphStartFrame: initial.frame, frameOrigin: initial.origin,
    sampleRate, graphHash: await effectGraphHash(plan), capturedGraphHash: publication.graphDefinitionHash, sourceCanonicalHash: source.sourceCanonicalHash,
    transitionFrames: Math.max(1, Math.round(sampleRate * 0.02)), operation: 'captured-API-command-revoice',
    initialMemory: 'cleared-new-realization;not-an-exact-live-DSP-state-reconstruction',
    evidence: 'native-API-submission-not-processor-or-acoustic-acknowledgment',
    spectralCapture: 'replayed-analysis-requests;original-window-readiness-and-capture-receipts-not-reconstructed',
    timing: 'captured-source-intent-frame-plus-original-audio-frame-delta;nearest-output-frame', policy: 'one-graph;owned-processors;forward-preroll;no-in-range-lifecycle-transition' };
  return freezeData({ ...body, hash: await hashData(body, { maxBytes: 4 * 1048576, maxNodes: 131072 }) });
}
export function createCapturedEffectReplayDriver(replay, graph) {
  if (!replay || replay.schema !== 'lemmings-captured-effect-replay/v1' || graph.hash !== replay.graphHash) fail('effect-replay-identity', 'Effect command replay needs its exact admitted graph.');
  for (const event of replay.events) graph.validateUpdate(event.nodeId, event.values);
  let cursor = 0, leftSample = 0, rightSample = 0;
  return Object.freeze({ sample(left, right, frame, sidechainSamples = null, presence = null) {
    while (cursor < replay.events.length && replay.events[cursor].frame <= frame) { const event = replay.events[cursor++]; graph.update(event.nodeId, event.values); }
    const gate = Math.max(0, Math.min(1, (frame - replay.graphStartFrame) / replay.transitionFrames));
    if (sidechainSamples) for (let index = 0; index < sidechainSamples.length; index++) sidechainSamples[index] *= gate;
    graph.sample(left * gate, right * gate, sidechainSamples, presence);
    leftSample = graph.leftSample + left * (1 - gate); rightSample = graph.rightSample + right * (1 - gate);
  }, get leftSample() { return leftSample; }, get rightSample() { return rightSample; } });
}
