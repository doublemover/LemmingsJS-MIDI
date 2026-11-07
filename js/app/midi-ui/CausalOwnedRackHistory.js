import { createCausalOwnedImageRack } from './CausalOwnedImageRack.js';
import { capturedEffectSourceRoutes } from './CapturedSourceBus.js';
import { createOwnedEffectGraphKernel, prepareOwnedEffectGraphPlan } from './OwnedEffectGraphKernel.js';
import { validateEffectPerformance } from '../../midi/content/EffectPerformance.js';
import { effectGraphHash } from '../../midi/content/EffectGraphRevision.js';
const fail = message => { throw Object.assign(new Error(message), { name: 'CausalRenderError', code: 'captured-owned-rack-history' }); };
const ramp = (frame, start, width) => Math.max(0, Math.min(1, (frame - start) / width));
export async function createCausalOwnedRackHistory(options = {}) {
  const { rack, sampleRate, activationAudioFrame, endFrame, effectEvents = [] } = options;
  const packets = effectEvents.map(validateEffectPerformance), publications = packets.filter(packet => packet.operation === 'graph' && packet.targetFrame >= activationAudioFrame && packet.targetFrame < activationAudioFrame + endFrame);
  if (!publications.length) return createCausalOwnedImageRack(options);
  if (publications.length > 31 || rack.metadata.input.future.length || rack.metadata.dry.future.length || rack.metadata.input.remainingSeconds || rack.metadata.dry.remainingSeconds) fail('Changing-rack continuation needs one stable initial owner route and at most thirty-one later publications.');
  const initialRevision = rack.metadata.sourceOwnerRouteRevision + 1, initialPlan = prepareOwnedEffectGraphPlan(rack.definition, sampleRate);
  const initial = { revision: initialRevision, hash: rack.metadata.graphHash, plan: initialPlan, start: 0, width: 0, detach: null, detachWidth: 0, retire: endFrame, packets: [], initial: true };
  const entries = [initial], byRevision = new Map([[initialRevision, initial]]); let previousSequence = 0, stream = null;
  for (const packet of packets) {
    if (packet.targetFrame < activationAudioFrame || packet.targetFrame >= activationAudioFrame + endFrame && packet.operation !== 'spectral-capture') continue;
    if (packet.targetFrame > activationAudioFrame + endFrame) continue;
    if (packet.sequence <= previousSequence || stream !== null && stream !== packet.streamId || packet.sampleRate !== sampleRate) fail('Rack history needs one original ordered stream at its captured sample rate.'); previousSequence = packet.sequence; stream = packet.streamId;
    if (packet.operation === 'graph') {
      const prior = entries[entries.length - 1], transition = packet.routeTransition, old = transition?.previous;
      if (!transition || !old || old.ownerRouteRevision !== prior.revision || old.graphDefinitionHash !== prior.hash || packet.ownerRouteRevision <= prior.revision || byRevision.has(packet.ownerRouteRevision)) fail('Every captured replacement must identify its exact preceding owner route.');
      const start = packet.targetFrame - activationAudioFrame, expectedRetire = Math.max(packet.targetFrame + transition.transitionFrames, old.lastBodyDriveFrame) + prior.plan.maximumTailFrames;
      if (start < prior.start || Math.abs(expectedRetire - old.retireAtFrame) > 1) fail('A replacement tail differs from its captured input ramp, body frontier or graph tail bound.');
      prior.detach = start; prior.detachWidth = transition.transitionFrames; prior.retire = Math.min(endFrame, old.retireAtFrame - activationAudioFrame);
      const plan = prepareOwnedEffectGraphPlan(packet.definition, sampleRate);
      if (plan.impulseCount || plan.nodes.some(node => node.spectral)) fail('Later publications require an owned graph; native convolution and new processor analysis grids need their complete preparation history.');
      const hash = await effectGraphHash(plan); if (hash !== packet.graphDefinitionHash) fail('A captured replacement definition differs from its immutable graph hash.');
      const entry = { revision: packet.ownerRouteRevision, hash, plan, start, width: transition.transitionFrames, detach: null, detachWidth: 0, retire: endFrame, packets: [], initial: false }; entries.push(entry); byRevision.set(entry.revision, entry);
    } else {
      const entry = byRevision.get(packet.ownerRouteRevision); if (!entry || entry.hash !== packet.graphDefinitionHash || !entry.initial && !['control', 'body-strike'].includes(packet.operation)) fail('A command has no captured graph owner or requires unsupported new-body lifecycle evidence.'); entry.packets.push(packet);
    }
  }
  let peakStateBytes = 0;
  const sourceRoutes = [], routeIndices = new Map();
  for (const entry of entries) {
    entry.sourceRoutes = capturedEffectSourceRoutes(entry.plan);
    entry.sourceIndices = entry.sourceRoutes.map(route => {
      const identity = JSON.stringify([route.key, route.tap, route.layout]);
      if (!routeIndices.has(identity)) { routeIndices.set(identity, sourceRoutes.length); sourceRoutes.push(route); }
      return routeIndices.get(identity);
    });
    entry.sidechainSamples = new Float32Array(entry.sourceRoutes.length * 2); entry.presence = new Uint8Array(entry.sourceRoutes.length);
  }
  if (sourceRoutes.length > 256) fail('The captured graph history exceeds its bounded donor-route inventory.');
  for (const entry of entries) {
    const concurrent = entries.filter(candidate => candidate.start <= entry.start && candidate.retire > entry.start);
    if (concurrent.length > 2) fail('This history exceeds the two concurrently owned graph profile.'); peakStateBytes = Math.max(peakStateBytes, concurrent.reduce((sum, candidate) => sum + candidate.plan.stateBytes, 0));
    if (entry.packets.some(packet => packet.targetFrame - activationAudioFrame < entry.start || (packet.targetFrame - activationAudioFrame > entry.retire || packet.targetFrame - activationAudioFrame === entry.retire && packet.operation !== 'spectral-capture'))) fail('A captured control precedes publication or outlives its retained graph.');
    entry.controls = entry.packets.filter(packet => packet.operation === 'control' || packet.operation === 'body-strike').sort((a, b) => a.targetFrame - b.targetFrame || a.sequence - b.sequence); entry.cursor = 0;
    entry.strikeTokens = new Map(); const strikeIntents = new Set();
    for (const packet of entry.controls) if (packet.operation === 'body-strike') {
      const body = entry.plan.nodes.find(node => node.id === packet.nodeId)?.membrane;
      if (!body || !body.pulses.some(pulse => pulse.milliseconds === packet.strike.pulseMilliseconds) || strikeIntents.has(packet.strike.intentId)) fail('Every captured finite strike needs one unique intent and the original prepared body pulse.');
      strikeIntents.add(packet.strike.intentId);
    }
  }
  if (peakStateBytes > 16 * 1048576) fail('The two-graph continuation exceeds its admitted processor-state workspace.');
  const initialDriver = await createCausalOwnedImageRack({ ...options, endFrame: initial.retire, effectEvents: initial.packets });
  try {
    if (initial.detach !== null) initialDriver.graph.scheduleNativeSidechainGate(0, initial.detach, initial.detachWidth);
    const active = [{ entry: initial, driver: initialDriver, graph: initialDriver.graph }], completed = [];
    let cursor = 1, frame = 0, peakGraphs = 1, nextBoundary = Math.min(entries[1]?.start ?? Infinity, initial.retire), dryLeftSample = 0, dryRightSample = 0, returnLeftSample = 0, returnRightSample = 0, leftSample = 0, rightSample = 0;
    const updateBoundary = () => { nextBoundary = Math.min(cursor < entries.length ? entries[cursor].start : Infinity, ...active.map(member => member.entry.retire)); };
    const advance = async at => {
      if (at !== frame || at < nextBoundary) fail('Prepare a captured graph boundary at its exact next output frame.');
      for (let index = active.length - 1; index >= 0; index--) if (active[index].entry.retire === at) { const member = active[index]; if (member.entry.initial) member.driver.finish(); else member.graph.assertHealthy(); completed.push({ revision: member.entry.revision, graphHash: member.entry.hash, retiredAtFrame: at }); member.graph.panic(); active.splice(index, 1); }
      while (cursor < entries.length && entries[cursor].start === at) {
        const entry = entries[cursor++], graph = await createOwnedEffectGraphKernel({ definition: entry.plan.definition, sampleRate });
        try { if (graph.hash !== entry.hash) fail('The prepared replacement differs from its captured definition.'); for (const packet of entry.controls) if (packet.operation === 'control') graph.validateUpdate(packet.nodeId, packet.values); active.push({ entry, graph, driver: null }); } catch (error) { graph.panic(); throw error; }
      }
      if (active.length > 2) fail('More than two active graphs reached the same output frame.'); peakGraphs = Math.max(peakGraphs, active.length); updateBoundary();
    };
    const dryGain = at => { const next = entries[1]; return next && at >= next.start ? rack.metadata.dry.value * (1 - ramp(at, next.start, next.width)) : rack.metadata.dry.value; };
    const receipt = () => ({ schema: 'lemmings-captured-rack-continuation-render/v1', graphHash: initial.hash, sourceAudioFrame: rack.metadata.audioFrame, activationAudioFrame, frames: frame, sourceRoutes,
      route: 'saved-initial-rack-plus-captured-replacement-input-ramps-and-retained-tails', initialMemory: 'restored-independent-owned-image', subsequentMemory: 'new-owned-graphs-from-recorded-publications;API-control-projection', graphs: entries.map(entry => ({ ownerRouteRevision: entry.revision, graphHash: entry.hash, startFrame: entry.start, inputRampFrames: entry.width, detachFrame: entry.detach, retireFrame: entry.retire })), peakGraphs, peakStateBytes, completed,
      stems: 'one-shared-source-stream;simultaneous-owner-dry-and-sum-of-all-retained-returns', sourcePresence: 'actual-source-tap-enable-boundaries;effect-status-message-lag-not-replayed', finalMasterProtection: 'excluded', qualification: 'implementation-awaiting-live-offline-pcm-equivalence' });
    return Object.freeze({ sourceRoutes, advance, get nextBoundary() { return nextBoundary; }, sample(left, right, sidechains, presence) {
      if (frame >= endFrame || frame >= nextBoundary) fail('Prepare the exact captured graph publication/retirement boundary before sampling.');
      returnLeftSample = returnRightSample = 0;
      for (const member of active) {
        const { entry, graph, driver } = member;
        const sidechainGain = entry.initial ? 1 : entry.detach !== null && frame >= entry.detach ? ramp(entry.detach, entry.start, entry.width) * (1 - ramp(frame, entry.detach, entry.detachWidth)) : ramp(frame, entry.start, entry.width);
        for (let index = 0; index < entry.sourceIndices.length; index++) {
          const source = entry.sourceIndices[index];
          entry.sidechainSamples[index * 2] = Math.fround((sidechains?.[source * 2] ?? 0) * sidechainGain);
          entry.sidechainSamples[index * 2 + 1] = Math.fround((sidechains?.[source * 2 + 1] ?? 0) * sidechainGain);
          entry.presence[index] = presence?.[source] ?? Number(sidechains !== null && sidechains !== undefined);
        }
        if (entry.initial) { const inputGain = entry.detach !== null && frame >= entry.detach ? rack.metadata.input.value * (1 - ramp(frame, entry.detach, entry.detachWidth)) : rack.metadata.input.value; driver.sample(left, right, entry.sidechainSamples, entry.presence, { inputGain, dryGain: 0 }); returnLeftSample = Math.fround(returnLeftSample + driver.returnLeftSample); returnRightSample = Math.fround(returnRightSample + driver.returnRightSample); }
        else {
          while (entry.cursor < entry.controls.length && entry.controls[entry.cursor].targetFrame - activationAudioFrame === frame) {
            const packet = entry.controls[entry.cursor++];
            if (packet.operation === 'control') graph.update(packet.nodeId, packet.values);
            else {
              const strike = packet.strike, token = (entry.strikeTokens.get(packet.nodeId) || 0) + 1;
              entry.strikeTokens.set(packet.nodeId, token);
              graph.enqueueBodyStrike(packet.nodeId, { frame: frame - entry.start, token, pulseIndex: entry.plan.nodes.find(node => node.id === packet.nodeId).membrane.pulses.findIndex(pulse => pulse.milliseconds === strike.pulseMilliseconds), x01: strike.x01, y01: strike.y01, amplitude01: strike.amplitude01 });
            }
          }
          const inputGain = entry.detach !== null && frame >= entry.detach ? ramp(entry.detach, entry.start, entry.width) * (1 - ramp(frame, entry.detach, entry.detachWidth)) : ramp(frame, entry.start, entry.width);
          graph.sample(Math.fround(left * inputGain), Math.fround(right * inputGain), entry.sidechainSamples, entry.presence); returnLeftSample = Math.fround(returnLeftSample + graph.leftSample); returnRightSample = Math.fround(returnRightSample + graph.rightSample);
        }
      }
      const direct = dryGain(frame); dryLeftSample = Math.fround(left * direct); dryRightSample = Math.fround(right * direct); leftSample = Math.fround(dryLeftSample + returnLeftSample); rightSample = Math.fround(dryRightSample + returnRightSample); frame++;
    }, finish() { if (frame !== endFrame) fail('The rack history did not reach the declared crop horizon.'); for (const member of active) { if (member.entry.initial) member.driver.finish(); else { member.graph.assertHealthy(); if (member.entry.cursor !== member.entry.controls.length) fail('A retained graph missed a captured control.'); } } return receipt(); }, receipt,
    get leftSample() { return leftSample; }, get rightSample() { return rightSample; }, get dryLeftSample() { return dryLeftSample; }, get dryRightSample() { return dryRightSample; }, get returnLeftSample() { return returnLeftSample; }, get returnRightSample() { return returnRightSample; },
    dispose() { for (const member of active) member.graph.panic(); active.length = 0; } });
  } catch (error) { initialDriver.dispose(); throw error; }
}
