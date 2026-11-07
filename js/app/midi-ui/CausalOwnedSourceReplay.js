import { createOwnedControlKernel } from '../resources/OwnedControlKernel.js';
import { getOwnedSourceProfile } from './OwnedSourceProfiles.js';
import { verifyOwnedPcmPayload } from '../resources/OwnedPcmVerification.js';
import { verifyOwnedPcmSetPayload } from '../resources/OwnedPcmSetVerification.js';
import { createCapturedCutGain } from './CausalOwnedImageRack.js';
import { LIVE_LANE_TAP_LIMIT } from './OwnedSourceLayout.js';
import { capturedSourceBusKey } from './CapturedSourceBus.js';
const fail = message => { throw Object.assign(new Error(message), { name: 'CausalRenderError', code: 'captured-source-replay' }); };
const natural = value => Number.isSafeInteger(value) && value >= 0;
export async function createCausalOwnedSourceReplay({ inventory, rate, materials, options, remapLanes, needTaps = false }) {
  const { source: row, activation, started, stopped, events } = inventory, profile = getOwnedSourceProfile(row.reference.engineRequirement.engineId), descriptor = options.descriptors.find(value => value.engineId === profile.id && value.engineVersion === row.reference.engineRequirement.engineVersion);
  const pcm = materials.find(value => value.sourceId === row.sourceId)?.pcm ?? null;
  const verified = profile.requiresPCM ? await (profile.requiresPCMSet ? verifyOwnedPcmSetPayload : verifyOwnedPcmPayload)(pcm, profile.requiresPCMSet ? row.reference.definition.sampleRefs : row.reference.definition.sampleRefs[0], options) : null;
  const kernel = await createOwnedControlKernel(profile, rate, row.metadata.cut.maxVoices, { ...options, pcm: verified, patch: row.reference.definition });
  options.signal?.throwIfAborted(); kernel.restoreFrom(row.bytes, { engineArtifactHash: descriptor.artifactHash, patchDefinitionHash: row.reference.definitionHash, graphRevision: row.metadata.cut.graphRevision }); remapLanes(kernel, row.metadata.host.laneIdentities, activation.laneIdentities);
  const publication = row.metadata.host.publication;
  if (publication?.schema !== 'lemmings-renderer-publication-cut/v1' || publication.audioFrame !== row.metadata.audioFrame || publication.sampleRate !== rate) fail('The original source publication envelope is unavailable.');
  const gain = createCapturedCutGain(publication.curve, publication.audioFrame, rate), origin = row.metadata.cut.frame, blockFrames = started.blockFrames;
  const left = new Float32Array(blockFrames), right = new Float32Array(blockFrames), buses = new Map(), tapBindings = new Array(LIVE_LANE_TAP_LIMIT).fill(null), enabled = new Uint8Array(LIVE_LANE_TAP_LIMIT);
  const taps = needTaps ? { routeMode: 'mask', routes: new Uint16Array(kernel.maxVoices), tokens: new Uint32Array(kernel.maxVoices), laneTokens: new Uint32Array(LIVE_LANE_TAP_LIMIT), channels: Array.from({ length: LIVE_LANE_TAP_LIMIT }, () => [new Float32Array(blockFrames), new Float32Array(blockFrames)]), preChannels: Array.from({ length: LIVE_LANE_TAP_LIMIT }, () => [new Float32Array(blockFrames), new Float32Array(blockFrames)]) } : null;
  const bindTap = event => {
    if (!Number.isInteger(event.index) || event.index < 0 || event.index >= LIVE_LANE_TAP_LIMIT || typeof event.enabled !== 'boolean' || !natural(event.laneToken) || event.laneToken > 4096) fail('The actual source tap inventory is invalid.');
    const key = event.sourceBinding ? capturedSourceBusKey(event.sourceBinding) : null;
    if (event.enabled && !key || event.enabled && key.startsWith('lane:') && !event.laneToken || event.enabled && key.startsWith('voices:') && event.laneToken) fail('The donor tap lost its exact lane/selection binding.');
    enabled[event.index] = Number(event.enabled); tapBindings[event.index] = key; taps.laneTokens[event.index] = event.enabled ? event.laneToken : 0;
    buses.clear(); for (let index = 0; index < LIVE_LANE_TAP_LIMIT; index++) if (enabled[index]) { if (buses.has(tapBindings[index])) fail('The actual source published duplicate donor tap identities.'); buses.set(tapBindings[index], index); }
  };
  if (needTaps) {
    if (started.tapInventoryVersion !== 1 || !Array.isArray(started.taps) || started.taps.length !== LIVE_LANE_TAP_LIMIT || new Set(started.taps.map(row => row?.index)).size !== LIVE_LANE_TAP_LIMIT || !Array.isArray(started.routes) || !Array.isArray(started.tokens) || started.routes.length !== kernel.maxVoices || started.tokens.length !== kernel.maxVoices || started.routes.some(value => !natural(value) || value >= 2 ** LIVE_LANE_TAP_LIMIT) || started.tokens.some(value => !natural(value) || value > 0xffffffff)) fail('This older take has no complete actual donor route fence. Choose dry output or capture a new owned-image take.');
    taps.routes.set(started.routes); taps.tokens.set(started.tokens); for (const tap of started.taps) bindTap(tap);
  }
  let cursor = 0, lastPacket = kernel.lastPacket, blockStart = -blockFrames, offset = 0, publicationGain = 0, leftSample = 0, rightSample = 0, complete = false;
  const applyBoundary = () => {
    const boundary = kernel.lastFrame;
    while (cursor < events.length && events[cursor].frame === boundary) {
      const event = events[cursor++];
      if (event.command === 'commands') {
        if (event.packetSequence !== lastPacket + 1 || !natural(event.count) || event.count > 512 || !Array.isArray(event.data) || event.data.length !== event.count * kernel.width || event.data.some(value => !Number.isFinite(value))) fail('The captured source packet payload, sequence or width differs.');
        kernel.accept(new Float64Array(event.data), event.count, event.packetSequence); lastPacket = event.packetSequence;
      } else if (event.command === 'panic') kernel.panicPending = true;
      else if (event.command === 'lane-tap') { if (taps) bindTap(event); }
      else { if (!kernel.setLaneIdentity(event.slot, event.token, event.laneToken) || !natural(event.route) || event.route >= 2 ** LIVE_LANE_TAP_LIMIT) fail('The captured source lane route could not apply at its original boundary.'); if (taps) { taps.routes[event.slot] = event.route; taps.tokens[event.slot] = event.token; } }
      kernel.receiptCount = 0;
    }
    if (cursor < events.length && events[cursor].frame < boundary) fail('A source advanced past a captured command boundary.');
  };
  const renderBlock = () => { applyBoundary(); if (kernel.lastFrame >= stopped.frame) fail('A source render passed its actual closing fence.'); blockStart = kernel.lastFrame - origin; kernel.render(left, right, kernel.lastFrame, taps); kernel.receiptCount = 0; };
  return Object.freeze({ sourceId: row.sourceId, buses,
    sample(frame) { if (!natural(frame) || complete || frame < blockStart || frame >= stopped.frame - origin) fail('The source sample lies outside its actual ordered coverage.'); while (frame >= blockStart + blockFrames) renderBlock(); offset = frame - blockStart; publicationGain = gain(frame); leftSample = Math.fround(left[offset] * publicationGain); rightSample = Math.fround(right[offset] * publicationGain); },
    donor(key, tap, destination, index) { const bus = buses.get(key); if (bus == null || !taps) return false; const pair = tap === 'pre-fader' ? taps.preChannels[bus] : taps.channels[bus], at = index * 2; destination[at] = Math.fround(destination[at] + Math.fround(pair[0][offset] * publicationGain)); destination[at + 1] = Math.fround(destination[at + 1] + Math.fround(pair[1][offset] * publicationGain)); return true; },
    async finish() { let work = 0; while (kernel.lastFrame < stopped.frame) { renderBlock(); work += blockFrames; if (work >= 16384) { work = 0; await options.yieldControl?.(); options.signal?.throwIfAborted(); } } applyBoundary(); if (kernel.lastFrame !== stopped.frame || cursor !== events.length || kernel.lastPacket !== stopped.lastPacket || kernel.nonfinite !== stopped.nonfinite || Array.from(kernel.counters).some((value, index) => value !== stopped.counters[index])) fail('The source differs from its actual closing processor frontier or containment counters.'); complete = true; return { sourceId: row.sourceId, engineRequirement: row.reference.engineRequirement, definitionHash: row.reference.definitionHash, initialSourceFrame: origin, finalSourceFrame: stopped.frame, blockFrames, commandPackets: lastPacket - row.metadata.host.packetSequence, observedEvents: events.length, counters: stopped.counters, donorRoutes: needTaps ? 'actual-processor-tap-fences-and-ingress-history' : 'not-requested', initialHeldVoices: row.metadata.host.voices.filter(voice => !voice.released).length, initialSourceVoices: row.metadata.host.voices.length }; },
    get leftSample() { return leftSample; }, get rightSample() { return rightSample; } });
}
