import { prepareCapturedSpectralReplay } from './CapturedSpectralReplay.js';
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
  const projectedPackets = packets.map(packet => ({ packet, projected: project(packet) })).filter(value => value.projected.frame < endFrame || value.packet.operation === 'spectral-capture' && value.projected.frame === endFrame);
  const graphPackets = projectedPackets.filter(value => value.packet.operation === 'graph').map(value => value.packet);
  if (graphPackets.length !== 1) fail('effect-transition-replay-unavailable', 'Captured command revoice currently requires one prepared graph throughout its history. Split graph replacements into separate takes or choose static revoice.');
  const publication = graphPackets[0], initial = project(publication), original = prepareEffectGraphRevision(publication.definition, { sampleRate: publication.sampleRate });
  if (await effectGraphHash(original) !== publication.graphDefinitionHash) fail('effect-history-identity', 'Captured effect definition differs from its published graph hash.');
  const plan = prepareEffectGraphRevision(publication.definition, { sampleRate });
  if (plan.impulseCount) fail('effect-command-native-body-unavailable', 'Captured command revoice does not yet schedule native convolution graphs. Use explicit static body rendering or master capture.');
  if (initial.origin < 0) fail('effect-clock-origin-unavailable', 'The effect analysis grid precedes the captured audio context.');
  const spectral = prepareCapturedSpectralReplay({ packets: projectedPackets, publication, plan, frameOrigin: initial.origin, sampleRate });
  const events = [...spectral.events], bodySourceIntentIds = [], bodySources = new Set(); let previous = 0, lastBodyDriveFrame = 0;
  for (const { packet, projected } of projectedPackets) {
    if (packet.streamId !== publication.streamId || packet.ownerRouteRevision !== publication.ownerRouteRevision || packet.graphDefinitionHash !== publication.graphDefinitionHash || packet.sequence <= previous) fail('effect-history-order', 'Captured effects mix routes, streams or nonmonotonic command identities.'); previous = packet.sequence;
    if (packet.operation === 'body-panic') fail('effect-body-lifecycle-replay-unavailable', 'A body-only Panic was submitted through the message port; its applied audio frame is unavailable in this captured-command profile.');
    if (packet.operation === 'bypass') fail('effect-lifecycle-replay-unavailable', 'This history includes an effect stop, bypass, mute or Panic. Choose a range ending before that transition or explicit static revoice.');
    if (packet.operation === 'control') {
      if (projected.frame < 0 || projected.frame < initial.frame) fail('effect-control-before-publication', 'A captured parameter precedes its prepared graph.');
      if (plan.nodes.some(node => node.spectral) && Math.abs(projected.origin - initial.origin) > 1) fail('effect-analysis-grid-rebased', 'Spectral capture crosses an audio-clock rebase; its original analysis grid is unavailable in this render profile.');
      if (spectral.strict && spectral.nodes.has(packet.nodeId)) continue;
      events.push({ frame: projected.frame, nodeId: packet.nodeId, values: packet.values, sequence: packet.sequence, sourceEventIds: packet.sourceEventIds });
    } else if (packet.operation === 'body-strike') {
      const strike = packet.strike, intent = intents.get(strike.intentId), node = plan.nodes.find(node => node.id === packet.nodeId), pulseIndex = node?.membrane?.pulses.findIndex(pulse => pulse.milliseconds === strike.pulseMilliseconds);
      if (!intent || intent.kind !== 'begin' || intent.route !== 'prepared-body' || intent.voiceId !== strike.voiceId || intent.onsetId !== strike.onsetId || intent.worldId !== strike.worldId || intent.generation !== strike.generation || intent.actorId !== strike.actorId || intent.articulationState?.contactCoordinate?.contactInstanceId !== strike.contactInstanceId || intent.preparedBodyStrike?.surfaceId !== strike.surfaceId || intent.preparedBodyStrike?.surfaceRevision !== strike.surfaceRevision || intent.preparedBodyStrike?.pulseMilliseconds !== strike.pulseMilliseconds || Math.abs(intent.velocity01 * intent.preparedBodyStrike.amplitudeScale01 - strike.amplitude01) > 1e-12 || JSON.stringify(intent.sourceEventIds) !== JSON.stringify(strike.sourceEventIds) || !node?.membrane || pulseIndex < 0 || bodySources.has(strike.intentId) || projected.frame < 0 || projected.frame < initial.frame || projected.frame !== timing.frameFor(intent)) fail('effect-body-source-identity', 'An acknowledged body strike differs from its unique original semantic source or exact prepared node.');
      const pulse = node.membrane.pulses[pulseIndex]; bodySources.add(strike.intentId); bodySourceIntentIds.push(strike.intentId); lastBodyDriveFrame = Math.max(lastBodyDriveFrame, projected.frame + pulse.frames);
      events.push({ kind: 'body-strike', frame: projected.frame, nodeId: packet.nodeId, sequence: packet.sequence, sourceEventIds: packet.sourceEventIds, strike,
        command: { frame: projected.frame, token: bodySourceIntentIds.length, x01: strike.x01, y01: strike.y01, amplitude01: strike.amplitude01, pulseIndex }, endFrame: projected.frame + pulse.frames });
    }
  }
  events.sort((a, b) => a.frame - b.frame || a.sequence - b.sequence);
  const supports = new Map();
  for (const event of events) if (event.kind === 'body-strike') {
    const held = (supports.get(event.nodeId) || []).filter(end => end > event.frame);
    if (held.length >= 4) fail('effect-body-exciter-capacity', 'Captured finite sources exceed four simultaneous exciters on this body.');
    held.push(event.endFrame); supports.set(event.nodeId, held);
  }
  const body = { schema: 'lemmings-captured-effect-replay/v1', definition: plan.definition, events, bodySourceIntentIds, lastBodyDriveFrame, graphStartFrame: initial.frame, frameOrigin: initial.origin,
    sampleRate, graphHash: await effectGraphHash(plan), capturedGraphHash: publication.graphDefinitionHash, sourceCanonicalHash: source.sourceCanonicalHash,
    transitionFrames: Math.max(1, Math.round(sampleRate * 0.02)), operation: 'captured-API-command-revoice',
    initialMemory: 'cleared-new-realization;not-an-exact-live-DSP-state-reconstruction',
    evidence: 'controls:native-API-submission-not-processor-acknowledgment;finite-strikes:processor-frame-acknowledged;no-acoustic-output-claim',
    spectralCapture: spectral.evidence,
    timing: 'captured-source-intent-frame-plus-original-audio-frame-delta;nearest-output-frame', policy: 'one-graph;owned-processors;forward-preroll;no-in-range-lifecycle-transition' };
  return freezeData({ ...body, hash: await hashData(body, { maxBytes: 4 * 1048576, maxNodes: 131072 }) });
}
export function createCapturedEffectReplayDriver(replay, graph) {
  if (!replay || replay.schema !== 'lemmings-captured-effect-replay/v1' || graph.hash !== replay.graphHash) fail('effect-replay-identity', 'Effect command replay needs its exact admitted graph.');
  for (const event of replay.events) { if (event.kind === 'spectral-capture') { if (typeof graph.validateSpectralCapture !== 'function' || typeof graph.assertSpectralCapture !== 'function') fail('effect-spectral-replay-unavailable', 'The graph cannot validate acknowledged analysis windows.'); graph.validateSpectralCapture(event.nodeId, event.capture); } else if (event.kind !== 'body-strike') graph.validateUpdate(event.nodeId, event.values); }
  let cursor = 0, leftSample = 0, rightSample = 0;
  return Object.freeze({ sample(left, right, frame, sidechainSamples = null, presence = null) {
    const begin = cursor;
    while (cursor < replay.events.length && replay.events[cursor].frame <= frame) { const event = replay.events[cursor++]; if (event.kind === 'spectral-capture') { if (event.frame !== frame) fail('effect-spectral-late-replay', 'An analysis window missed its exact replay frontier.'); graph.update(event.nodeId, { hold01: 1 }); } else if (event.kind === 'body-strike') { if (event.frame !== frame) fail('effect-body-late-replay', 'A finite source missed its exact replay frame.'); graph.enqueueBodyStrike(event.nodeId, event.command); } else graph.update(event.nodeId, event.values); }
    const gate = Math.max(0, Math.min(1, (frame - replay.graphStartFrame) / replay.transitionFrames));
    if (sidechainSamples) for (let index = 0; index < sidechainSamples.length; index++) sidechainSamples[index] *= gate;
    graph.sample(left * gate, right * gate, sidechainSamples, presence);
    for (let index = begin; index < cursor; index++) { const event = replay.events[index]; if (event.kind === 'spectral-capture') graph.assertSpectralCapture(event.nodeId, event.capture); }
    leftSample = graph.leftSample + left * (1 - gate); rightSample = graph.rightSample + right * (1 - gate);
  }, get leftSample() { return leftSample; }, get rightSample() { return rightSample; } });
}
