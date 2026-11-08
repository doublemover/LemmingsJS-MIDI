import { createCausalOwnedSourceReplay } from './CausalOwnedSourceReplay.js';
import { createCausalOwnedRackHistory } from './CausalOwnedRackHistory.js';
import { decodeOwnedAudioImage } from '../resources/OwnedAudioImageCodec.js';
import { canonicalDataText, hashData } from '../../core/CanonicalData.js';
import { encodeCausalRenderWave } from './CausalOwnedRender.js';
const fail = message => { throw Object.assign(new Error(message), { name: 'CausalRenderError', code: 'owned-image-render' }); };
const natural = value => Number.isSafeInteger(value) && value >= 0;
const hash = value => /^[a-f0-9]{64}$/.test(value || '');
const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
const check = options => { options.signal?.throwIfAborted(); if (options.current?.() === false) fail('The captured image render source changed.'); };
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
  const { checkpoint, source, materials = [], startSeconds = 0, endSeconds, includeRack = false, includeStems = false, stemLaneIds = [], includeAllLaneStems = false } = input || {};
  if (source?.schema !== 'lemmings-owned-source-history/v1' || typeof source.takeId !== 'string' || !source.takeId || !natural(source.takeRevision) || source.takeRevision < 1 || !hash(source.sourceCanonicalHash) || source.coverage !== 'complete' || !Array.isArray(source.events) || source.events.length > 65536 ||
      !Number.isFinite(startSeconds) || startSeconds < 0 || !Number.isFinite(endSeconds) || endSeconds <= startSeconds || endSeconds > 120 || !Array.isArray(materials) || typeof includeRack !== 'boolean' || typeof includeStems !== 'boolean' || includeStems && !includeRack || !Array.isArray(stemLaneIds) || stemLaneIds.length > 8 || new Set(stemLaneIds).size !== stemLaneIds.length || stemLaneIds.some(id => typeof id !== 'string' || !id || id.length > 128) || typeof includeAllLaneStems !== 'boolean' || includeAllLaneStems && stemLaneIds.length || !hash(options.applicationBuildId)) fail('A faithful dry continuation needs one complete image-bound source command history and a bounded audio-clock crop.');
  const decoded = await decodeOwnedAudioImage({ mode: 'decode-checkpoint', image: checkpoint, materials }, options); check(options);
  const rate = decoded.metadata.sampleRate, first = Math.round(startSeconds * rate), end = Math.round(endSeconds * rate), frames = end - first, outputBytes = frames * 8; let fileCount = includeStems ? 4 : 1;
  if (!natural(frames) || frames < 1 || (outputBytes + 262208) * fileCount > 64 * 1048576 || decoded.sources.length < 1) fail('Choose a nonempty dry output within the admitted WAV profile.');
  const inventories = new Map(decoded.sources.map(row => [row.sourceId, { source: row, events: [], started: null, activation: null, stopped: null, next: 1, lastFrame: row.metadata.cut.frame }]));
  for (const row of source.events) {
    const inventory = inventories.get(row?.sourceId), event = row?.event;
    if (!inventory || row.schema !== 'lemmings-captured-source-transport/v1' || !event || typeof event !== 'object') fail('The command history contains an unrepresented source or invalid event.');
    if (event.type === 'source-transport-started') { if (inventory.started) fail('A source has duplicate ingress fences.'); inventory.started = event; }
    else if (event.type === 'source-transport-activation') { if (inventory.activation || !inventory.started) fail('A source has an ambiguous activation boundary.'); inventory.activation = event; }
    else if (event.type === 'source-transport-stopped') { if (inventory.stopped || event.overflow || event.sequence !== inventory.next - 1) fail('A source lost its complete closing command fence.'); inventory.stopped = event; }
    else if (event.type === 'source-transport-packet') {
      if (!inventory.started || inventory.stopped || event.captureId !== inventory.started.captureId || event.sequence !== inventory.next++ || !natural(event.frame) || event.frame < inventory.lastFrame || !['commands', 'lane-route', 'lane-tap', 'panic'].includes(event.command)) fail('Actual source command arrival history is incomplete or unordered.');
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
  const availableLaneIds = [...new Set([...inventories.values()].flatMap(row => row.activation.laneIdentities.map(pair => pair[0])))].sort(), laneIds = includeAllLaneStems ? availableLaneIds : [...stemLaneIds].sort();
  if (laneIds.length > 8 || laneIds.some(id => !availableLaneIds.includes(id))) fail('Choose up to eight dry lane stems from the take’s captured lane identity inventory.');
  fileCount += laneIds.length; if ((outputBytes + 262208) * fileCount > 64 * 1048576) fail('The aligned source/rack/lane file set exceeds 64 MiB; choose a shorter crop or fewer lanes.');
  for (const row of materials) { const pcm = row.pcm; for (const bank of Array.isArray(pcm?.banks) ? pcm.banks : pcm ? [pcm] : []) for (const plane of bank.planes || []) materialBytes += plane.byteLength; }
  const historyBytes = canonicalDataText(source, { maxBytes: 24 * 1048576, maxNodes: 2000000 }).bytes.byteLength;
  if (includeRack && !decoded.rack) fail('This take has no captured creative rack. Choose the explicit dry projection.');
  if (includeRack) stateBytes += decoded.rack.components.reduce((sum, row) => sum + row.bytes.byteLength, 0);
  const rackWorkspace = includeRack ? 32 * 1048576 : 0;
  const required = outputBytes * 4 * fileCount + rackWorkspace + stateBytes * 4 + materialBytes * 4 + historyBytes * 4 + 64 * 1048576;
  if (end > coveredFrames || !natural(required) || required > (options.maxWorkingBytes || 384 * 1048576)) fail('The crop exceeds complete captured audio-clock coverage or its admitted source/PCM workspace.');
  const activationFrames = [...inventories.values()].map(row => row.activation.audioFrame);
  if (includeRack && new Set(activationFrames).size !== 1) fail('The complete source/rack activation did not share one audio frame.');
  const output = new Float32Array(frames * 2), slots = [{ id: includeRack ? 'owned-rack' : 'owned-dry', role: 'complete-owner-output', pcm: output }];
  if (includeStems) for (const [id, role] of [['source-dry', 'raw-source-before-rack-routing'], ['owner-dry-route', 'recombinable-owner-dry-route'], ['shared-rack-return', 'recombinable-shared-rack-return']]) slots.push({ id, role, pcm: new Float32Array(output.length) });
  const laneSlots = laneIds.map((laneId, index) => ({ id: 'lane-' + index, laneId, role: 'captured-dry-lane-before-owner-rack', pcm: new Float32Array(output.length) })); slots.push(...laneSlots);
  const sourceReceipts = [], replays = []; let rackReceipt = null;
  const rack = includeRack ? await createCausalOwnedRackHistory({ rack: decoded.rack, sampleRate: rate, activationAudioFrame: activationFrames[0], endFrame: end, effectEvents: source.effectEvents, effectCoverage: source.effectCoverage }) : null;
  try {
    const routes = rack?.sourceRoutes || [], needTaps = routes.some(route => route.key !== null), sidechainSamples = new Float32Array(routes.length * 2), presence = new Uint8Array(routes.length);
    for (const inventory of inventories.values()) { check(options); replays.push(await createCausalOwnedSourceReplay({ inventory, rate, materials, options, remapLanes, needTaps, stemLaneIds: laneIds })); }
    for (let frame = 0; frame < end; frame++) {
      let left = 0, right = 0; for (const replay of replays) { replay.sample(frame); left = Math.fround(left + replay.leftSample); right = Math.fround(right + replay.rightSample); }
      if (rack) {
        if (frame >= rack.nextBoundary) { await rack.advance(frame); check(options); }
        sidechainSamples.fill(0); presence.fill(0);
        for (let index = 0; index < routes.length; index++) { const route = routes[index]; if (route.key === null) { sidechainSamples[index * 2] = left; sidechainSamples[index * 2 + 1] = right; presence[index] = 1; } else for (const replay of replays) if (replay.donor(route.key, route.tap, sidechainSamples, index)) presence[index] = 1; }
        rack.sample(left, right, sidechainSamples, presence);
      }
      if (frame >= first) { const at = (frame - first) * 2; for (let index = 0; index < laneSlots.length; index++) for (const replay of replays) replay.lane(index, laneSlots[index].pcm, at); output[at] = rack ? rack.leftSample : left; output[at + 1] = rack ? rack.rightSample : right;
        if (includeStems) { slots[1].pcm[at] = left; slots[1].pcm[at + 1] = right; slots[2].pcm[at] = rack.dryLeftSample; slots[2].pcm[at + 1] = rack.dryRightSample; slots[3].pcm[at] = rack.returnLeftSample; slots[3].pcm[at + 1] = rack.returnRightSample; }
      }
      if (frame % 16384 === 16383) { options.onProgress?.({ phase: rack ? 'continuing-sources-and-saved-creative-rack' : 'restoring-recorded-owned-sources', completedUnits: frame + 1, totalUnits: end }); await options.yieldControl?.(); check(options); }
    }
    if (rack) rackReceipt = rack.finish();
    for (const replay of replays) { check(options); sourceReceipts.push(await replay.finish()); options.onProgress?.({ phase: 'comparing-actual-source-closing-frontiers', completedUnits: sourceReceipts.length, totalUnits: replays.length }); }
  } finally { rack?.dispose(); }
  const historyHash = await hashData(source, { maxBytes: 24 * 1048576, maxNodes: 2000000 }); check(options);
  const base = { schema: 'lemmings-causal-audio-render/v1', version: 1, applicationBuildId: options.applicationBuildId, takeId: source.takeId, takeRevision: source.takeRevision, sourceCanonicalHash: source.sourceCanonicalHash,
    mode: 'captured-owned-source-image-and-actual-command-history', imageSha256: checkpoint.sha256, historyHash, sampleRate: rate, channels: 2, sampleFormat: 'ieee-float32-le', frames, timelineZeroSourceFrame: first, exactEndSourceFrame: end, availableAudioFrames: coveredFrames,
    clock: 'owned-source-render-frames-from-initial-image;independent-of-physical-score-speed', restoration: { mode: 'initial-owned-image', initialHeldVoices: sourceReceipts.reduce((sum, row) => sum + row.initialHeldVoices, 0), sourceOnsetsSynthesized: false, sources: sourceReceipts },
    realization: { scope: includeRack ? 'captured-owned-source-and-fixed-creative-rack-continuation' : 'complete-captured-owned-source-dry-sum-with-retained-publication-curves', creativeRack: rackReceipt || 'excluded-explicit-dry-source-projection', sourceOrder: sourceReceipts.map(row => row.sourceId), masterProtection: 'excluded', normalization: 'none' },
    stems: { mode: includeStems ? 'simultaneous-full-graph-source-dry-route-and-shared-return-taps' : 'complete-owner-output-only', laneIds, availableLaneIds, files: slots.map(slot => ({ id: slot.id, role: slot.role, ...(slot.laneId ? { laneId: slot.laneId } : {}) })), recombination: includeStems ? 'float32(owner-dry-route+shared-rack-return)=complete-owner-output;raw-source-is-an-alternative-upstream-tap' : 'not-requested', sharedReturns: 'one-interacting-graph;no-per-lane-solo-bounces', donorStorage: 'bounded-source-quantum-pools;no-full-history-donor-PCM' },
    tail: { mode: 'exact-crop', inventedRelease: false }, acousticReceipt: false, originalRecordMutated: false, qualification: 'source-frontiers-and-containment-counters-compared;PCM-equivalence-awaiting-consolidated-validation' };
  const files = [];
  for (const slot of slots) {
    const pcmBytes = new Uint8Array(slot.pcm.byteLength), view = new DataView(pcmBytes.buffer); let peak = 0, sum = 0;
    for (let firstSample = 0; firstSample < slot.pcm.length; firstSample += 65536) { for (let index = firstSample, stop = Math.min(slot.pcm.length, firstSample + 65536); index < stop; index++) { const value = slot.pcm[index]; if (!Number.isFinite(value)) fail('The reconstructed graph contains nonfinite output.'); peak = Math.max(peak, Math.abs(value)); sum += value * value; view.setFloat32(index * 4, value, true); } await options.yieldControl?.(); check(options); }
    const pcmHash = await digest(pcmBytes); check(options);
    const manifest = { ...base, fileId: slot.id, fileRole: slot.role, ...(slot.laneId ? { laneId: slot.laneId } : {}), pcmHash, realization: { ...base.realization, peak, rms: Math.sqrt(sum / slot.pcm.length) } };
    files.push({ id: slot.id, bytes: encodeCausalRenderWave(pcmBytes, frames, rate, manifest), manifest });
  }
  return { schema: base.schema, manifest: files[0].manifest, files };
}
