import { capturedSourceBusKey } from './CapturedSourceBus.js';
import { createOwnedEffectGraphKernel } from './OwnedEffectGraphKernel.js';
import { createSmoothedAudioParameter } from './SmoothedAudioParameter.js';
import { validateEffectPerformance } from '../../midi/content/EffectPerformance.js';
const fail = message => { throw Object.assign(new Error(message), { name: 'CausalRenderError', code: 'owned-image-rack-render' }); };
export function createCapturedCutGain(curve, audioFrame, sampleRate) {
  if (curve?.sourceTimeSeconds !== audioFrame / sampleRate || curve?.smoothingSeconds > 1) fail('A saved rack gain does not share its output frame.');
  const param = { setValueAtTime() {}, cancelScheduledValues() {}, linearRampToValueAtTime() {} };
  createSmoothedAudioParameter({ param, initialValue: 0, startTime: 0, smoothingSeconds: curve.smoothingSeconds, maxEvents: curve.maxEvents, valueMinimum: 0, valueMaximum: 1 }).validateSnapshot(curve);
  let at = 0, value = curve.value, target = curve.target, end = curve.remainingSeconds * sampleRate, cursor = 0;
  const interpolate = frame => end <= at || frame >= end ? target : value + (target - value) * Math.max(0, frame - at) / (end - at);
  return frame => { while (cursor < curve.future.length && curve.future[cursor].afterSeconds * sampleRate <= frame) { const event = curve.future[cursor++], next = event.afterSeconds * sampleRate; value = interpolate(next); at = next; target = event.value; end = next + event.durationSeconds * sampleRate; } return Math.fround(interpolate(frame)); };
}
export async function createCausalOwnedImageRack({ rack, sampleRate, activationAudioFrame, endFrame, effectEvents = [], effectCoverage, returnNodeIds = [] } = {}) {
  const state = rack?.metadata, cut = rack?.graphMetadata;
  if (state?.schema !== 'lemmings-owner-effect-cut/v1' || state.sampleRate !== sampleRate || cut?.sampleRate !== sampleRate || state.audioFrame !== cut.audioFrame || state.graphHash !== cut.graphHash || !['active', 'mute'].includes(state.mode) || state.outputGain01 !== (state.mode === 'mute' ? 0 : 1) || !Number.isSafeInteger(state.sourceOwnerRouteRevision) || !Number.isSafeInteger(activationAudioFrame) || activationAudioFrame < 0 || !Number.isSafeInteger(endFrame) || endFrame < 1 || !effectCoverage?.captured || effectCoverage.gaps?.length || !Array.isArray(effectEvents) || effectEvents.length > 8192) fail('The complete initial rack, original activation clock and gap-free effect capture are required.');
  const graph = await createOwnedEffectGraphKernel({ definition: rack.definition, sampleRate, returnNodeIds });
  try {
    const sourceRoutes = graph.plan.sidechainInputs.map(id => { const p = graph.plan.nodes.find(node => node.id === id).parameters; if (p.inputLayout !== 'audioStereo') fail('Use the exact prepared stereo source bus and an explicit graph channel adapter.'); return { nodeId: id, sourceBusId: p.sourceBusId, key: p.sourceBusId === 'owner' ? null : capturedSourceBusKey(p), tap: p.tap, layout: p.inputLayout }; });
    graph.restoreNativeCut({ metadata: cut, components: rack.components });
    if (sourceRoutes.length) graph.reconstructNativeSourcePresence();
    const dry = createCapturedCutGain(state.dry, state.audioFrame, sampleRate), input = createCapturedCutGain(state.input, state.audioFrame, sampleRate);
    const checks = [], strikes = [], streams = new Map(), seenStrikes = new Set(), tokens = new Map();
    for (const body of cut.hostState.bodies) tokens.set(body.nodeId, body.state.pending.reduce((max, row) => Math.max(max, row.command.token), 0));
    for (const raw of effectEvents) {
      const packet = validateEffectPerformance(raw), previous = streams.get(packet.streamId) || 0;
      if (packet.sequence <= previous) fail('Effect command capture has a nonmonotonic stream.'); streams.set(packet.streamId, packet.sequence);
      const frame = packet.targetFrame - activationAudioFrame; if (frame < 0 || frame > endFrame || frame === endFrame && packet.operation !== 'spectral-capture') continue;
      if (packet.sampleRate !== sampleRate || packet.graphDefinitionHash !== graph.hash || packet.ownerRouteRevision !== state.sourceOwnerRouteRevision + 1) fail('An effect command replaced the initial rack or changed its execution identity. Choose a covered fixed-rack range or dry output.');
      if (packet.operation === 'control') graph.scheduleNativeUpdate(packet.nodeId, packet.values, frame);
      else if (packet.operation === 'spectral-capture') { graph.validateSpectralCapture(packet.nodeId, packet.spectralCapture); checks.push({ frame, nodeId: packet.nodeId, capture: packet.spectralCapture, logicalFrameOffset: packet.spectralFrameOffset || 0 }); }
      else if (packet.operation === 'body-strike') {
        const strike = packet.strike, node = graph.plan.nodes.find(node => node.id === packet.nodeId), pulseIndex = node?.membrane?.pulses.findIndex(pulse => pulse.milliseconds === strike.pulseMilliseconds);
        if (!node?.membrane || pulseIndex < 0 || seenStrikes.has(strike.intentId)) fail('The applied finite strike has no unique saved body pulse.'); seenStrikes.add(strike.intentId);
        const token = (tokens.get(packet.nodeId) || 0) + 1; tokens.set(packet.nodeId, token);
        strikes.push({ frame, sequence: packet.sequence, nodeId: packet.nodeId, command: { frame, token, pulseIndex, x01: strike.x01, y01: strike.y01, amplitude01: strike.amplitude01 } });
      } else fail('The captured rack contains a topology or message-time lifecycle change outside this fixed-rack continuation profile. Choose a covered range or dry output.');
    }
    strikes.sort((a, b) => a.frame - b.frame || a.sequence - b.sequence); checks.sort((a, b) => a.frame - b.frame);
    let frame = 0, strikeCursor = 0, checkCursor = 0, leftSample = 0, rightSample = 0, dryLeftSample = 0, dryRightSample = 0, returnLeftSample = 0, returnRightSample = 0, baseDryGain = 0, baseInputGain = 0;
    const checkSpectral = current => { while (checkCursor < checks.length && checks[checkCursor].frame === current) { const check = checks[checkCursor++], original = rack.components.find(row => row.nodeId === check.nodeId), offset = original.logicalAudioFrame - activationAudioFrame - check.logicalFrameOffset;
      graph.assertSpectralCapture(check.nodeId, { ...check.capture, startFrame: check.capture.startFrame + offset, endFrame: check.capture.endFrame + offset }); } };
    return Object.freeze({ graph, sourceRoutes, sample(left, right, sidechainSamples = null, presence = null, routing = null) {
      if (frame >= endFrame) fail('The rack continuation passed its declared range.'); checkSpectral(frame);
      while (strikeCursor < strikes.length && strikes[strikeCursor].frame === frame) { const strike = strikes[strikeCursor++]; graph.enqueueNativeBodyStrike(strike.nodeId, strike.command); }
      baseInputGain = input(frame); baseDryGain = dry(frame);
      const send = routing?.inputGain ?? baseInputGain; graph.sample(Math.fround(left * send), Math.fround(right * send), sidechainSamples, presence); const direct = routing?.dryGain ?? baseDryGain;
      dryLeftSample = Math.fround(left * direct); dryRightSample = Math.fround(right * direct); returnLeftSample = Math.fround(graph.leftSample * state.outputGain01); returnRightSample = Math.fround(graph.rightSample * state.outputGain01);
      leftSample = Math.fround(dryLeftSample + returnLeftSample); rightSample = Math.fround(dryRightSample + returnRightSample); frame++;
    }, finish() { checkSpectral(frame); graph.assertHealthy(); if (frame !== endFrame || strikeCursor !== strikes.length || checkCursor !== checks.length) fail('A captured rack command missed its declared frontier.'); return this.receipt(); },
    receipt: () => ({ schema: 'lemmings-captured-rack-continuation-render/v1', graphHash: graph.hash, sourceAudioFrame: state.audioFrame, activationAudioFrame, frames: frame, mode: state.mode, automation: graph.nativeCutReceipt(), finiteStrikes: strikes.length, sourceRoutes, sourcePresence: 'actual-source-tap-enable-boundaries;effect-status-message-lag-not-replayed', checkedSpectralWindows: checkCursor, route: 'one-complete-saved-owner-rack-with-retained-memory-and-captured-control-curves', finalMasterProtection: 'excluded', qualification: 'implementation-awaiting-live-offline-pcm-equivalence' }),
    get baseDryGain() { return baseDryGain; }, get baseInputGain() { return baseInputGain; }, get dryLeftSample() { return dryLeftSample; }, get dryRightSample() { return dryRightSample; }, get returnLeftSample() { return returnLeftSample; }, get returnRightSample() { return returnRightSample; }, get leftSample() { return leftSample; }, get rightSample() { return rightSample; }, dispose: () => graph.panic() });
  } catch (error) { graph.panic(); throw error; }
}
