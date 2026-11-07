import { createCausalOwnedImageRack } from './CausalOwnedImageRack.js';
import { decodeOwnedAudioImage } from '../resources/OwnedAudioImageCodec.js';
import { createOwnedControlKernel } from '../resources/OwnedControlKernel.js';
import { getOwnedSourceProfile } from './OwnedSourceProfiles.js';
import { verifyOwnedPcmPayload } from '../resources/OwnedPcmVerification.js';
import { verifyOwnedPcmSetPayload } from '../resources/OwnedPcmSetVerification.js';
import { canonicalDataText, hashData } from '../../core/CanonicalData.js';
import { encodeCausalRenderWave } from './CausalOwnedRender.js';
const fail = message => { throw Object.assign(new Error(message), { name: 'CausalRenderError', code: 'owned-image-render' }); };
const natural = value => Number.isSafeInteger(value) && value >= 0;
const hash = value => /^[a-f0-9]{64}$/.test(value || '');
const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
const check = options => { options.signal?.throwIfAborted(); if (options.current?.() === false) fail('The captured image render source changed.'); };
const publicationCurve = (state, audioFrame, rate) => {
  const curve = state?.curve;
  if (state?.schema !== 'lemmings-renderer-publication-cut/v1' || state.audioFrame !== audioFrame || state.sampleRate !== rate || curve?.schema !== 'lemmings-smoothed-parameter-cut/v1' || curve.sourceTimeSeconds !== audioFrame / rate || ![curve.value, curve.target].every(value => Number.isFinite(value) && value >= 0 && value <= 1) || !Number.isFinite(curve.remainingSeconds) || curve.remainingSeconds < 0 || !Array.isArray(curve.future) || curve.future.length > 64) fail('The initial source publication curve is unavailable.');
  let at = 0, value = curve.value, target = curve.target, end = curve.remainingSeconds * rate, cursor = 0;
  const interpolate = frame => end <= at || frame >= end ? target : value + (target - value) * Math.max(0, frame - at) / (end - at);
  return frame => {
    while (cursor < curve.future.length && curve.future[cursor].afterSeconds * rate <= frame) {
      const event = curve.future[cursor++], next = event.afterSeconds * rate;
      if (!Number.isFinite(next) || next <= at || !Number.isFinite(event.durationSeconds) || event.durationSeconds < 0 || !Number.isFinite(event.value) || event.value < 0 || event.value > 1) fail('Invalid retained source publication automation.');
      value = interpolate(next); at = next; target = event.value; end = next + event.durationSeconds * rate;
    }
    return interpolate(frame);
  };
};
const remapLanes = (kernel, previous, current) => {
  if (!Array.isArray(current) || current.length > 4096 || new Set(current.map(row => row?.[0])).size !== current.length || new Set(current.map(row => row?.[1])).size !== current.length) fail('The restored source lane identity inventory differs.');
  const names = new Map(current), mapping = new Map([[0, 0]]);
  for (const [name, token] of previous) { const next = names.get(name); if (!natural(next) || next < 1 || next > 4096) fail('A captured lane lost its exact activation binding.'); mapping.set(token, next); }
  const mapped = token => { if (!mapping.has(token)) fail('A pending source lane has no activation binding.'); return mapping.get(token); };
  for (let slot = 0; slot < kernel.maxVoices; slot++) { kernel.laneRoutes[slot * 5] = mapped(kernel.laneRoutes[slot * 5]); kernel.laneRoutes[slot * 5 + 1] = mapped(kernel.laneRoutes[slot * 5 + 1]); kernel.pendingLanes[slot * 2 + 1] = mapped(kernel.pendingLanes[slot * 2 + 1]); }
  for (let index = 0; index < kernel.queueLength; index++) { const at = index * kernel.width; if (kernel.queue[at + 3] === 7) kernel.queue[at + 6] = mapped(kernel.queue[at + 6]); }
};

export async function renderCausalOwnedImage(input, options = {}) {
  check(options);
  const { checkpoint, source, materials = [], startSeconds = 0, endSeconds, includeRack = false } = input || {};
  if (source?.schema !== 'lemmings-owned-source-history/v1' || typeof source.takeId !== 'string' || !source.takeId || !natural(source.takeRevision) || source.takeRevision < 1 || !hash(source.sourceCanonicalHash) || source.coverage !== 'complete' || !Array.isArray(source.events) || source.events.length > 65536 ||
      !Number.isFinite(startSeconds) || startSeconds < 0 || !Number.isFinite(endSeconds) || endSeconds <= startSeconds || endSeconds > 120 || !Array.isArray(materials) || typeof includeRack !== 'boolean' || !hash(options.applicationBuildId)) fail('A faithful dry continuation needs one complete image-bound source command history and a bounded audio-clock crop.');
  const decoded = await decodeOwnedAudioImage({ mode: 'decode-checkpoint', image: checkpoint, materials }, options); check(options);
  const rate = decoded.metadata.sampleRate, first = Math.round(startSeconds * rate), end = Math.round(endSeconds * rate), frames = end - first, outputBytes = frames * 8;
  if (!natural(frames) || frames < 1 || outputBytes + 262208 > 64 * 1048576 || decoded.sources.length < 1) fail('Choose a nonempty dry output within the admitted WAV profile.');
  const inventories = new Map(decoded.sources.map(row => [row.sourceId, { source: row, events: [], started: null, activation: null, stopped: null, next: 1, lastFrame: row.metadata.cut.frame }]));
  for (const row of source.events) {
    const inventory = inventories.get(row?.sourceId), event = row?.event;
    if (!inventory || row.schema !== 'lemmings-captured-source-transport/v1' || !event || typeof event !== 'object') fail('The command history contains an unrepresented source or invalid event.');
    if (event.type === 'source-transport-started') { if (inventory.started) fail('A source has duplicate ingress fences.'); inventory.started = event; }
    else if (event.type === 'source-transport-activation') { if (inventory.activation || !inventory.started) fail('A source has an ambiguous activation boundary.'); inventory.activation = event; }
    else if (event.type === 'source-transport-stopped') { if (inventory.stopped || event.overflow || event.sequence !== inventory.next - 1) fail('A source lost its complete closing command fence.'); inventory.stopped = event; }
    else if (event.type === 'source-transport-packet') {
      if (!inventory.started || inventory.stopped || event.captureId !== inventory.started.captureId || event.sequence !== inventory.next++ || !natural(event.frame) || event.frame < inventory.lastFrame || !['commands', 'lane-route', 'panic'].includes(event.command)) fail('Actual source command arrival history is incomplete or unordered.');
      inventory.lastFrame = event.frame; inventory.events.push(event);
    } else fail('The command history contains a capture failure or unknown transport event.');
  }
  let coveredFrames = Infinity, stateBytes = 0, materialBytes = 0;
  for (const inventory of inventories.values()) {
    const { source: row, started, activation, stopped, lastFrame } = inventory, origin = row.metadata.cut.frame;
    if (!started || !activation || !stopped || started.frame !== origin || started.lastPacket !== row.metadata.host.packetSequence || started.startAudioFrame !== activation.audioFrame || activation.sourceFrame !== origin || activation.sampleRate !== rate || !natural(started.blockFrames) || started.blockFrames < 1 || started.blockFrames > 16384 || stopped.blockFrames !== started.blockFrames ||
        !natural(stopped.frame) || stopped.frame < lastFrame || stopped.frame - origin > rate * 120 || (stopped.frame - origin) % started.blockFrames || !Array.isArray(stopped.counters) || stopped.counters.length !== 8 || stopped.counters.some(value => !natural(value)) || !natural(stopped.nonfinite)) fail('The complete actual source execution and fixed quantum profile are unavailable.');
    if (inventory.events.some(event => (event.frame - origin) % started.blockFrames)) fail('A recorded command arrived outside its actual fixed render quantum.');
    coveredFrames = Math.min(coveredFrames, stopped.frame - origin); stateBytes += row.bytes.byteLength;
  }
  for (const row of materials) { const pcm = row.pcm; for (const bank of Array.isArray(pcm?.banks) ? pcm.banks : pcm ? [pcm] : []) for (const plane of bank.planes || []) materialBytes += plane.byteLength; }
  const historyBytes = canonicalDataText(source, { maxBytes: 24 * 1048576, maxNodes: 2000000 }).bytes.byteLength;
  if (includeRack && !decoded.rack) fail('This take has no captured creative rack. Choose the explicit dry projection.');
  if (includeRack) stateBytes += decoded.rack.components.reduce((sum, row) => sum + row.bytes.byteLength, 0);
  const rackWorkspace = includeRack ? end * 8 + 32 * 1048576 : 0;
  const required = outputBytes * 4 + rackWorkspace + stateBytes * 4 + materialBytes * 4 + historyBytes * 4 + 64 * 1048576;
  if (end > coveredFrames || !natural(required) || required > (options.maxWorkingBytes || 384 * 1048576)) fail('The crop exceeds complete captured audio-clock coverage or its admitted source/PCM workspace.');
  const output = new Float32Array(frames * 2), bus = includeRack ? new Float32Array(end * 2) : output, busFirst = includeRack ? 0 : first, sourceReceipts = []; let sourceIndex = 0;
  for (const inventory of inventories.values()) {
    check(options); const { source: row, activation, started, stopped, events } = inventory, profile = getOwnedSourceProfile(row.reference.engineRequirement.engineId), descriptor = options.descriptors.find(value => value.engineId === profile.id && value.engineVersion === row.reference.engineRequirement.engineVersion);
    const pcm = materials.find(value => value.sourceId === row.sourceId)?.pcm ?? null;
    const verified = profile.requiresPCM ? await (profile.requiresPCMSet ? verifyOwnedPcmSetPayload : verifyOwnedPcmPayload)(pcm, profile.requiresPCMSet ? row.reference.definition.sampleRefs : row.reference.definition.sampleRefs[0], options) : null;
    const kernel = await createOwnedControlKernel(profile, rate, row.metadata.cut.maxVoices, { ...options, pcm: verified, patch: row.reference.definition }); check(options);
    kernel.restoreFrom(row.bytes, { engineArtifactHash: descriptor.artifactHash, patchDefinitionHash: row.reference.definitionHash, graphRevision: row.metadata.cut.graphRevision });
    remapLanes(kernel, row.metadata.host.laneIdentities, activation.laneIdentities);
    const gain = publicationCurve(row.metadata.host.publication, row.metadata.audioFrame, rate), origin = row.metadata.cut.frame, blockFrames = started.blockFrames;
    const left = new Float32Array(blockFrames), right = new Float32Array(blockFrames); let cursor = 0, rendered = 0, lastPacket = kernel.lastPacket;
    while (kernel.lastFrame <= stopped.frame) {
      const boundary = kernel.lastFrame;
      while (cursor < events.length && events[cursor].frame === boundary) {
        const event = events[cursor++];
        if (event.command === 'commands') {
          if (event.packetSequence !== lastPacket + 1 || !natural(event.count) || event.count > 512 || !Array.isArray(event.data) || event.data.length !== event.count * kernel.width || event.data.some(value => !Number.isFinite(value))) fail('The captured source packet payload, sequence or width differs.');
          kernel.accept(new Float64Array(event.data), event.count, event.packetSequence); lastPacket = event.packetSequence;
        } else if (event.command === 'panic') kernel.panicPending = true;
        else if (!kernel.setLaneIdentity(event.slot, event.token, event.laneToken)) fail('The recorded source lane routing could not apply at its original boundary.');
        kernel.receiptCount = 0;
      }
      if (boundary === stopped.frame) break;
      if (boundary > stopped.frame || cursor < events.length && events[cursor].frame < boundary) fail('A source render advanced beyond a recorded processor boundary.');
      kernel.render(left, right, boundary); kernel.receiptCount = 0;
      const offset = boundary - origin;
      for (let index = 0; index < blockFrames; index++) { const frame = offset + index; if (frame < busFirst || frame >= end) continue; const publication = gain(frame);
        const at = (frame - busFirst) * 2; bus[at] = Math.fround(bus[at] + Math.fround(left[index] * publication)); bus[at + 1] = Math.fround(bus[at + 1] + Math.fround(right[index] * publication)); }
      rendered += blockFrames;
      if (rendered >= 16384) { rendered = 0; options.onProgress?.({ phase: 'restoring-recorded-owned-sources', completedUnits: sourceIndex * coveredFrames + Math.min(offset, coveredFrames), totalUnits: inventories.size * coveredFrames }); await options.yieldControl?.(); check(options); }
    }
    if (cursor !== events.length || kernel.lastPacket !== stopped.lastPacket || kernel.nonfinite !== stopped.nonfinite || Array.from(kernel.counters).some((value, index) => value !== stopped.counters[index])) fail('The reconstructed source differs from its actual closing processor frontier or containment counters.');
    sourceReceipts.push({ sourceId: row.sourceId, engineRequirement: row.reference.engineRequirement, definitionHash: row.reference.definitionHash, initialSourceFrame: origin, finalSourceFrame: stopped.frame, blockFrames, commandPackets: lastPacket - row.metadata.host.packetSequence, observedEvents: events.length, counters: stopped.counters, initialHeldVoices: row.metadata.host.voices.filter(voice => !voice.released).length, initialSourceVoices: row.metadata.host.voices.length }); sourceIndex++;
  }
  let rackReceipt = null;
  if (includeRack) {
    const activationFrames = [...inventories.values()].map(row => row.activation.audioFrame);
    if (new Set(activationFrames).size !== 1) fail('The complete source/rack activation did not share one audio frame.');
    const rack = await createCausalOwnedImageRack({ rack: decoded.rack, sampleRate: rate, activationAudioFrame: activationFrames[0], endFrame: end, effectEvents: source.effectEvents, effectCoverage: source.effectCoverage });
    try {
      for (let frame = 0; frame < end; frame++) {
        rack.sample(bus[frame * 2], bus[frame * 2 + 1]); if (frame >= first) { const at = (frame - first) * 2; output[at] = rack.leftSample; output[at + 1] = rack.rightSample; }
        if (frame % 16384 === 16383) { options.onProgress?.({ phase: 'continuing-saved-creative-rack', completedUnits: frame + 1, totalUnits: end }); await options.yieldControl?.(); check(options); }
      }
      rackReceipt = rack.finish();
    } finally { rack.dispose(); }
  }
  const pcmBytes = new Uint8Array(output.byteLength), view = new DataView(pcmBytes.buffer); let peak = 0, sum = 0;
  for (let firstSample = 0; firstSample < output.length; firstSample += 65536) { for (let index = firstSample, stop = Math.min(output.length, firstSample + 65536); index < stop; index++) { const value = output[index]; if (!Number.isFinite(value)) fail('The owned source sum contains nonfinite output.'); peak = Math.max(peak, Math.abs(value)); sum += value * value; view.setFloat32(index * 4, value, true); } await options.yieldControl?.(); check(options); }
  const pcmHash = await digest(pcmBytes), historyHash = await hashData(source, { maxBytes: 24 * 1048576, maxNodes: 2000000 }); check(options);
  const manifest = { schema: 'lemmings-causal-audio-render/v1', version: 1, applicationBuildId: options.applicationBuildId, takeId: source.takeId, takeRevision: source.takeRevision, sourceCanonicalHash: source.sourceCanonicalHash,
    mode: 'captured-owned-source-image-and-actual-command-history', imageSha256: checkpoint.sha256, historyHash, sampleRate: rate, channels: 2, frames, timelineZeroSourceFrame: first, exactEndSourceFrame: end, availableAudioFrames: coveredFrames,
    clock: 'owned-source-render-frames-from-initial-image;independent-of-physical-score-speed', restoration: { mode: 'initial-owned-image', initialHeldVoices: sourceReceipts.reduce((sum, row) => sum + row.initialHeldVoices, 0), sourceOnsetsSynthesized: false, sources: sourceReceipts },
    realization: { scope: includeRack ? 'captured-owned-source-and-fixed-creative-rack-continuation' : 'complete-captured-owned-source-dry-sum-with-retained-publication-curves', creativeRack: rackReceipt || 'excluded-explicit-dry-source-projection', sourceOrder: sourceReceipts.map(row => row.sourceId), masterProtection: 'excluded', normalization: 'none', peak, rms: Math.sqrt(sum / output.length) },
    tail: { mode: 'exact-crop', inventedRelease: false }, pcmHash, acousticReceipt: false, originalRecordMutated: false, qualification: 'source-frontiers-and-containment-counters-compared;PCM-equivalence-awaiting-consolidated-validation' };
  const bytes = encodeCausalRenderWave(pcmBytes, frames, rate, manifest); return { schema: manifest.schema, manifest, files: [{ id: includeRack ? 'owned-rack' : 'owned-dry', bytes, manifest }] };
}
