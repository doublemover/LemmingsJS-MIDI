import { OwnedSineKernel, WIDTH, MAX_VOICES, RECEIPT_WIDTH, BEGIN, UPDATE, END, APPLIED, REJECTED, FAULTED, CANCELLED } from './worklet/OwnedSineProcessor.js';
import { NATIVE_WORKLET_FIELDS } from './NativeInstrumentSchema.js';
import { validateInstrumentPatchV2 } from '../../midi/content/InstrumentPatchV2.js';
import { canonicalDataText, hashData } from '../../core/CanonicalData.js';

const MAX_SECONDS = 120, MAX_INTENTS = 32768, MAX_OUTPUT_BYTES = 64 * 1048576;
const failure = (code, message, detail = {}) => Object.assign(new Error(message), { name: 'CausalRenderError', code, ...detail });
const text = (value, max = 512) => typeof value === 'string' && value.length > 0 && value.length <= max;
const natural = value => Number.isSafeInteger(value) && value >= 0;
const finite = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const identity = intent => JSON.stringify([intent.worldId ?? null, intent.generation, intent.voiceId]);
const expressionFor = expression => {
  if (!expression || typeof expression !== 'object' || Array.isArray(expression) || Object.keys(expression).some(key => !['pressure01', 'pitchOffsetCents', 'pan01'].includes(key)) ||
      expression.pressure01 != null && !finite(expression.pressure01, 0, 1) || expression.pitchOffsetCents != null && !finite(expression.pitchOffsetCents, -24000, 24000) ||
      expression.pan01 != null && !finite(expression.pan01, -1, 1)) throw failure('unsupported-expression', 'This sine realization supports only captured pitch offset, pressure and pan.');
  return expression;
};
const frequencyFor = (pitch, offset, rate) => {
  if (!finite(pitch?.cents, -24000, 24000) || !finite(pitch?.referenceHz ?? 440, 0.1, 20000)) throw failure('invalid-pitch', 'Captured onset pitch is unavailable.');
  const frequency = (pitch.referenceHz ?? 440) * 2 ** ((pitch.cents - 6900 + offset) / 1200);
  if (!finite(frequency, 0.1, rate / 2 - 1)) throw failure('unsupported-pitch', 'Captured pitch exceeds this renderer at the selected sample rate.'); return frequency;
};
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const ascii = (view, at, value) => { for (let index = 0; index < value.length; index++) view.setUint8(at + index, value.charCodeAt(index)); };
const encodeWav = (pcm, frames, rate, manifest) => {
  const metadata = canonicalDataText(manifest, { maxBytes: 262144, maxNodes: 32768 }).bytes, padded = metadata.length + metadata.length % 2;
  const length = 64 + pcm.byteLength + padded;
  if (!natural(length) || length - 8 > 0xffffffff || pcm.byteLength !== frames * 8) throw failure('wav-capacity', 'This render exceeds the classic stereo RIFF limit.');
  const bytes = new Uint8Array(length), view = new DataView(bytes.buffer);
  ascii(view, 0, 'RIFF'); view.setUint32(4, length - 8, true); ascii(view, 8, 'WAVE'); ascii(view, 12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 3, true); view.setUint16(22, 2, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 8, true); view.setUint16(32, 8, true); view.setUint16(34, 32, true);
  ascii(view, 36, 'fact'); view.setUint32(40, 4, true); view.setUint32(44, frames, true); ascii(view, 48, 'data'); view.setUint32(52, pcm.length, true); bytes.set(pcm, 56);
  const at = 56 + pcm.length; ascii(view, at, 'lmjs'); view.setUint32(at + 4, metadata.length, true); bytes.set(metadata, at + 8); return bytes;
};

export async function planCausalSineRender({ revoice, definition, descriptor, sampleRate = 48000, startSeconds = 0, endSeconds,
  tail = { mode: 'exact-crop' }, stemLaneIds = [], applicationBuildId = null } = {}) {
  if (revoice?.operation !== 'sound-only-revoice' || revoice.version !== 1 || !text(revoice.takeId, 256) || !hash(revoice.sourceCanonicalHash) ||
      !natural(revoice.takeRevision) || revoice.takeRevision < 1 || !['finalized', 'partial'].includes(revoice.sourceState) || revoice.nextSequence != null ||
      revoice.coverage?.status !== 'known-covered' || !Array.isArray(revoice.intents) || revoice.intents.length > MAX_INTENTS ||
      revoice.boundary?.status !== 'captured-initial-state' || !Array.isArray(revoice.boundary.state?.voices) || revoice.boundary.state.voices.length ||
      !finite(revoice.boundary.state.sourceTimeMs, 0, Number.MAX_SAFE_INTEGER) || !finite(revoice.finalBoundaryState?.sourceTimeMs, revoice.boundary.state.sourceTimeMs, Number.MAX_SAFE_INTEGER))
    throw failure('source-preflight', 'Rendering requires a finalized, covered intent history with an exact capture clock and an empty initial voice boundary. Missing held ancestry needs reconstruction.');
  if (![44100, 48000, 96000].includes(sampleRate) || descriptor?.engineId !== 'worklet-sine' || descriptor.engineVersion !== 1 || !hash(descriptor.artifactHash) ||
      applicationBuildId != null && !hash(applicationBuildId) || !finite(startSeconds, 0, MAX_SECONDS) || !finite(endSeconds, startSeconds, MAX_SECONDS) || endSeconds <= startSeconds ||
      !tail || !['exact-crop', 'bounded-natural', 'boundary-release'].includes(tail.mode) || Object.keys(tail).some(key => !['mode', 'maxSeconds'].includes(key)) ||
      !finite(tail.maxSeconds ?? 4, 0, 4) || !Array.isArray(stemLaneIds) || stemLaneIds.length > 16 || stemLaneIds.some(id => !text(id, 128)) || new Set(stemLaneIds).size !== stemLaneIds.length)
    throw failure('render-preflight', 'Choose a bounded sine render, supported sample rate, range, tail policy and at most sixteen captured lane stems.');
  const patch = validateInstrumentPatchV2(definition, descriptor);
  if (patch.sampleRefs.length || patch.modulations.length || patch.macros.length || patch.causalBindings.length || patch.voicePolicy.steal !== 'reject')
    throw failure('unsupported-patch', 'This render requires a realized asset-free sine patch with reject admission.');
  const parameters = Object.fromEntries(Object.entries(NATIVE_WORKLET_FIELDS).map(([key, spec]) => [key, patch.parameters[key] ?? spec[2]]));
  const sourceOriginMs = revoice.boundary.state.sourceTimeMs, sourceEndSeconds = (revoice.finalBoundaryState.sourceTimeMs - sourceOriginMs) / 1000;
  if (endSeconds > sourceEndSeconds + 0.5 / sampleRate) throw failure('uncovered-range', 'The requested render extends beyond the captured source-clock boundary.');
  const firstFrame = Math.round(startSeconds * sampleRate), endFrame = Math.round(endSeconds * sampleRate), releaseFrames = Math.max(1, Math.round(parameters.releaseSeconds * sampleRate));
  if (endFrame <= firstFrame) throw failure('empty-range', 'The selected range contains no output frames.');
  const sourceIds = new Set(), voices = new Map(), events = [], lanes = new Set(); let lastSourceMs = -Infinity, ordinal = 0, capturedBegins = 0, capturedUpdates = 0, capturedEnds = 0;
  for (const intent of revoice.intents) {
    if (intent?.version !== 1 || !['begin', 'update', 'end'].includes(intent.kind) || !text(intent.intentId) || !text(intent.voiceId) ||
        !natural(intent.generation) || !Array.isArray(intent.sourceEventIds) || intent.sourceEventIds.length > 8192 || intent.sourceEventIds.some(id => !text(id)) ||
        sourceIds.has(intent.intentId) || !finite(intent.scoreTime?.sourceTimeMs, sourceOriginMs, revoice.finalBoundaryState.sourceTimeMs) || intent.scoreTime.sourceTimeMs < lastSourceMs ||
        !finite(intent.scoreTime.subTick ?? 0, 0, 1) || (intent.scoreTime.subTick ?? 0) >= 1)
      throw failure('invalid-intent-history', 'Captured intent identity, ordering or source time is invalid.', { intentId: intent?.intentId ?? null });
    sourceIds.add(intent.intentId); lastSourceMs = intent.scoreTime.sourceTimeMs;
    if ((intent.scoreTime.subTick ?? 0) !== 0) throw failure('subtick-timeline-required', 'This source has fractional-tick intent timing and needs its qualified score-timeline adapter.');
    const frame = Math.round((intent.scoreTime.sourceTimeMs - sourceOriginMs) * sampleRate / 1000), order = ++ordinal;
    if (frame >= endFrame) continue;
    const key = identity(intent), expression = expressionFor(intent.expression || {}); let voice = voices.get(key);
    if (intent.kind === 'begin') {
      if (voice || !finite(intent.velocity01, 0, 1) || intent.laneId != null && !(natural(intent.laneId) || text(intent.laneId, 128)))
        throw failure('invalid-voice-history', 'Captured voice onsets are repeated or malformed.', { intentId: intent.intentId });
      const laneId = String(intent.laneId ?? 'unassigned'); lanes.add(laneId);
      const frequency = frequencyFor(intent.pitch, expression.pitchOffsetCents ?? 0, sampleRate);
      voice = { key, laneId, start: frame, releaseAt: null, end: null, slot: -1, token: 0, begin: intent, baseFrequency: frequency / 2 ** ((expression.pitchOffsetCents ?? 0) / 1200), events: [] };
      voices.set(key, voice); capturedBegins++;
      voice.events.push({ kind: 'begin', frame, order, intentId: intent.intentId, values: { 6: frequency, 7: intent.velocity01 * parameters.gain01 * patch.mix.gain01,
        8: expression.pressure01 ?? 1, 9: Math.max(-1, Math.min(1, (expression.pan01 ?? parameters.pan01) + patch.mix.pan01)),
        10: Math.round(parameters.attackSeconds * sampleRate), 11: Math.round(parameters.decaySeconds * sampleRate), 12: parameters.sustain01, 13: releaseFrames } });
    } else {
      if (!voice || voice.end != null) throw failure('missing-voice-history', 'A captured control or end has no still-owned original onset.', { intentId: intent.intentId });
      if (intent.kind === 'end') {
        const at = intent.terminationReason === 'one-shot' ? Math.max(frame, voice.start + Math.round(0.08 * sampleRate)) : frame;
        voice.releaseAt = at; voice.end = at + releaseFrames; capturedEnds++;
        voice.events.push({ kind: 'end', frame: at, order, intentId: intent.intentId, values: { 13: releaseFrames } });
      } else {
        let mask = 0; const values = { 14: Math.ceil(0.008 * sampleRate) };
        if (expression.pitchOffsetCents != null) { const frequency = voice.baseFrequency * 2 ** (expression.pitchOffsetCents / 1200);
          if (!finite(frequency, 0.1, sampleRate / 2 - 1)) throw failure('unsupported-pitch', 'Captured expression exceeds this rate.'); values[6] = frequency; mask |= 1; }
        if (expression.pressure01 != null) { values[8] = expression.pressure01; mask |= 2; }
        if (expression.pan01 != null) { values[9] = Math.max(-1, Math.min(1, expression.pan01 + patch.mix.pan01)); mask |= 4; }
        values[15] = mask; capturedUpdates++; voice.events.push({ kind: 'update', frame, order, intentId: intent.intentId, values });
      }
    }
  }
  let derivedReleases = 0, naturalEnd = endFrame;
  for (const voice of voices.values()) {
    if (voice.end == null) {
      if (tail.mode === 'bounded-natural') throw failure('unknown-natural-release', 'A held voice has no captured release before this boundary. Choose exact crop or an explicit derived boundary release.');
      if (tail.mode === 'boundary-release') { voice.releaseAt = endFrame; voice.end = endFrame + releaseFrames; derivedReleases++;
        voice.events.push({ kind: 'end', frame: endFrame, order: ++ordinal, intentId: null, values: { 13: releaseFrames } }); }
      else voice.end = endFrame + releaseFrames + 128;
    }
    if (tail.mode !== 'exact-crop') naturalEnd = Math.max(naturalEnd, voice.end);
    events.push(...voice.events.map(event => ({ ...event, voice })));
  }
  const outputEnd = tail.mode === 'exact-crop' ? endFrame : Math.min(naturalEnd, endFrame + Math.round((tail.maxSeconds ?? 4) * sampleRate));
  const outputFrames = outputEnd - firstFrame, pcmBytes = outputFrames * 8 * (stemLaneIds.length + 1);
  if (!natural(pcmBytes) || pcmBytes + 262208 * (stemLaneIds.length + 1) > MAX_OUTPUT_BYTES) throw failure('render-capacity', 'This render/stem set exceeds 64 MiB; choose a shorter range or fewer stems.');
  const slots = new Array(patch.voicePolicy.maxVoices).fill(null), tokens = new Uint32Array(MAX_VOICES); let peakVoices = 0;
  for (const voice of voices.values()) {
    let occupied = 0, selected = -1;
    for (let slot = 0; slot < slots.length; slot++) { if (slots[slot]?.end <= voice.start) slots[slot] = null; if (slots[slot]) occupied++; else if (selected < 0) selected = slot; }
    if (selected < 0) throw failure('intent-voice-capacity', 'The selected patch cannot realize every captured onset without dropping a voice.', { intentId: voice.begin.intentId });
    voice.slot = selected; voice.token = ++tokens[selected]; slots[selected] = voice; peakVoices = Math.max(peakVoices, occupied + 1);
  }
  events.sort((left, right) => left.frame - right.frame || left.order - right.order);
  return { patch, parameters, events, voices, source: revoice, descriptor, applicationBuildId, sampleRate, firstFrame, endFrame, outputEnd, outputFrames,
    sourceOriginMs, startSeconds, endSeconds, tail, releaseFrames, derivedReleases, capturedBegins, capturedUpdates, capturedEnds, peakVoices, stemLaneIds, lanes, pcmBytes,
    definitionHash: await hashData(definition), intentHash: await hashData(revoice.intents, { maxBytes: 8 * 1048576, maxNodes: 1000000 }) };
}

export async function renderCausalSineTake(input, { signal, yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)), onProgress = () => {}, maxWorkingBytes = 512 * 1048576 } = {}) {
  signal?.throwIfAborted(); const plan = await planCausalSineRender(input); signal?.throwIfAborted();
  const requiredBytes = plan.pcmBytes * 4 + plan.events.length * 512 + 8 * 1048576;
  if (!natural(maxWorkingBytes) || requiredBytes > maxWorkingBytes) throw failure('render-memory-capacity', 'PCM, encoding, command and transfer overlap exceed the admitted render workspace.');
  const { sampleRate, outputFrames, outputEnd, firstFrame, endFrame, events, stemLaneIds } = plan;
  const kernel = new OwnedSineKernel(sampleRate, plan.patch.voicePolicy.maxVoices), pcm = Array.from({ length: stemLaneIds.length + 1 }, () => new Uint8Array(outputFrames * 8));
  const views = pcm.map(bytes => new DataView(bytes.buffer)), left = new Float32Array(128), right = new Float32Array(128);
  const stemChannels = stemLaneIds.map(() => [new Float32Array(128), new Float32Array(128)]), routes = new Int8Array(MAX_VOICES); routes.fill(-1);
  const statistics = pcm.map(() => ({ peak: 0, squares: 0, overFullScaleSamples: 0 }));
  const packet = new Float64Array(WIDTH); let cursor = 0, sequence = 0, applied = 0, blocks = 0, packetSequence = 0;
  const checkReceipts = () => { for (let index = 0; index < kernel.receiptCount; index++) { const at = index * RECEIPT_WIDTH, code = kernel.receipts[at];
    if ([REJECTED, FAULTED, CANCELLED].includes(code)) throw failure('render-command-failed', 'The render kernel could not apply every requested command.', { sequence: kernel.receipts[at + 1], reasonCode: kernel.receipts[at + 5] });
    if (code === APPLIED) applied++;
  } kernel.receiptCount = 0; };
  for (let frame = 0; frame < outputEnd;) {
    signal?.throwIfAborted();
    while (cursor < events.length && events[cursor].frame <= frame) {
      const event = events[cursor++], voice = event.voice;
      if (event.frame >= outputEnd) break;
      if (event.kind === 'begin') routes[voice.slot] = stemLaneIds.indexOf(voice.laneId);
      packet.fill(0); packet[0] = 1; packet[1] = event.frame; packet[2] = ++sequence; packet[3] = event.kind === 'begin' ? BEGIN : event.kind === 'update' ? UPDATE : END;
      packet[4] = voice.slot; packet[5] = voice.token; packet[17] = 1;
      for (const [field, value] of Object.entries(event.values)) packet[Number(field)] = value;
      if (event.kind === 'begin') packet[16] = Math.max(voice.end + 128, outputEnd + plan.releaseFrames + 128);
      kernel.accept(packet, 1, ++packetSequence); checkReceipts();
    }
    const count = Math.min(128, outputEnd - frame, cursor < events.length ? events[cursor].frame - frame : Infinity);
    const a = count === 128 ? left : left.subarray(0, count), b = count === 128 ? right : right.subarray(0, count);
    const taps = stemChannels.length ? { routes, channels: count === 128 ? stemChannels : stemChannels.map(channels => channels.map(channel => channel.subarray(0, count))) } : null;
    kernel.render(a, b, frame, taps); checkReceipts();
    for (let index = Math.max(0, firstFrame - frame); index < count; index++) for (let file = 0; file < pcm.length; file++) for (let channel = 0; channel < 2; channel++) {
      const value = file === 0 ? channel ? b[index] : a[index] : stemChannels[file - 1][channel][index];
      if (!Number.isFinite(value)) throw failure('nonfinite-pcm', 'The render produced a nonfinite sample.');
      const stats = statistics[file]; stats.peak = Math.max(stats.peak, Math.abs(value)); stats.squares += value * value; if (Math.abs(value) > 1) stats.overFullScaleSamples++;
      views[file].setFloat32(((frame + index - firstFrame) * 2 + channel) * 4, value, true);
    }
    if (++blocks % 32 === 0) { onProgress({ phase: frame < firstFrame ? 'reconstructing-intent-history' : 'rendering-causal-take', completedUnits: frame + count, totalUnits: outputEnd }); await yieldControl(); }
    frame += count;
  }
  signal?.throwIfAborted();
  const common = { schema: 'lemmings-causal-audio-render/v1', mode: 'intent-render', operation: 'sound-only-revoice', takeId: plan.source.takeId,
    takeRevision: plan.source.takeRevision, sourceCanonicalHash: plan.source.sourceCanonicalHash, sourceVersions: plan.source.sourceVersions, intentHash: plan.intentHash,
    sourceEvidence: 'provided-covered-semantic-snapshot', sourceOriginMs: plan.sourceOriginMs, timeDomain: 'captured-source-time', inputRange: { startSeconds: plan.startSeconds, endSeconds: plan.endSeconds },
    sampleRate, channels: 2, sampleFormat: 'ieee-float32-le', frames: outputFrames, timelineZeroSourceFrame: firstFrame, exactEndSourceFrame: endFrame, renderedEndSourceFrame: outputEnd,
    restoration: { mode: 'deterministic-preroll', fromSourceFrame: 0, prerollFrames: firstFrame, initialVoices: 0, maxHistorySeconds: MAX_SECONDS },
    tail: { mode: plan.tail.mode, maxSeconds: plan.tail.maxSeconds ?? 4, derivedBoundaryReleases: plan.derivedReleases, truncated: kernel.active.some(Boolean) },
    definitionHash: plan.definitionHash, patchId: plan.patch.id, patchRevision: plan.patch.revision, engineRequirement: { engineId: plan.descriptor.engineId,
      engineVersion: plan.descriptor.engineVersion, artifactHash: plan.descriptor.artifactHash, parameterSchemaHash: plan.descriptor.parameterSchemaHash }, applicationBuildId: plan.applicationBuildId,
    commands: { capturedBegins: plan.capturedBegins, capturedUpdates: plan.capturedUpdates, capturedEnds: plan.capturedEnds, derivedReleases: plan.derivedReleases, submitted: sequence, applied, peakVoices: plan.peakVoices },
    realization: { scope: 'new-local-sine-realization-of-immutable-intents', liveAdmissionHistoryRecreated: false, historicalHardwareTimbreRecreated: false,
      smoothingSeconds: 0.008, oneShotHoldSeconds: 0.08, normalization: 'none', integerClipping: 'not-applicable', dither: 'none-float-output', sharedMasterAndLimiter: 'excluded' },
    stems: { mode: 'simultaneous-dry-lane-taps', laneIds: stemLaneIds, allCapturedLanesIncluded: [...plan.lanes].every(lane => stemLaneIds.includes(lane)),
      sharedReturns: 'none-in-selected-graph', recombination: 'linear-dry-sum-with-float32-rounding', nonlinearMaster: 'excluded' },
    acousticReceipt: false, qualification: 'rendered-pcm-not-listening-or-cross-browser-qualified', originalRecordMutated: false };
  const files = [];
  for (let index = 0; index < pcm.length; index++) {
    signal?.throwIfAborted(); const { squares, ...stats } = statistics[index], manifest = { ...common, tap: index ? 'captured-lane-dry' : 'complete-sine-graph-pre-master',
      laneId: index ? stemLaneIds[index - 1] : null, pcmHash: await digest(pcm[index]), statistics: { ...stats, rms: Math.sqrt(squares / (outputFrames * 2)) } };
    signal?.throwIfAborted(); files.push({ name: index ? 'lane-' + index : 'master', bytes: encodeWav(pcm[index], outputFrames, sampleRate, manifest), manifest });
  }
  return { manifest: common, files };
}
