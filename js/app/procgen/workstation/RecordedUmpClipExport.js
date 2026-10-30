import { encodeMidiClipFile } from '../../../midi/protocol/MidiClipFile.js';
import { decodeUmpPacket } from '../../../midi/protocol/UmpPacketCodec.js';
import { ORIGINAL_UMP_RECORDING_SCHEMA, ORIGINAL_UMP_METADATA_LIMIT, originalUmpAttribution, originalUmpExportPeakBytes, planOriginalUmpClip } from './OriginalUmpRecordingSnapshot.js';

const owned = (column, Type, length) => column instanceof Type && column.length === length && column.buffer instanceof ArrayBuffer && !column.buffer.resizable;
const tempoWord = bpm => {
  const value = Math.round(6000000000 / bpm);
  if (!Number.isFinite(bpm) || bpm <= 0 || !Number.isSafeInteger(value) || value < 1 || value > 0xffffffff) throw new RangeError('Captured tempo cannot be represented by a Clip Flex tempo value.');
  return value;
};
/** @param {{snapshot?: import('./OriginalUmpRecordingSnapshot.js').OriginalUmpSnapshot, window?: Record<string, any>, options?: import('./OriginalUmpRecordingSnapshot.js').OriginalClipOptions}} input
 * @param {{signal?: AbortSignal, current?: () => boolean, estimatedPeakBytes?: number, maxBytes?: number, crypto?: Crypto, onProgress?: (progress: any) => void, yieldControl?: () => Promise<unknown>}} [controls] */
export async function encodeRecordedUmpClip({ snapshot, window, options = {} } = {}, controls = {}) {
  const { signal, current = () => true, estimatedPeakBytes, crypto = globalThis.crypto, onProgress = () => {}, yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)) } = controls;
  const n = snapshot?.count, t = snapshot?.tempoBeats?.length, ppq = options.ppq ?? 960;
  if (snapshot?.schema !== ORIGINAL_UMP_RECORDING_SCHEMA || !Number.isSafeInteger(n) || n < 1 || n > 100000 || !Number.isSafeInteger(t) || n + t > 262144 ||
      !Number.isSafeInteger(snapshot.sourceCount) || snapshot.sourceCount < n + t || snapshot.sourceCount > 2000000 || !Number.isSafeInteger(ppq) || ppq < 1 || ppq > 65535 ||
      !owned(snapshot.beats, Float64Array, n) || !owned(snapshot.offsets, Uint32Array, n + 1) || !owned(snapshot.routes, Uint32Array, n) || !owned(snapshot.sourceIndices, Uint32Array, n) ||
      !owned(snapshot.tempoBpms, Float64Array, t) || !owned(snapshot.tempoBeats, Float64Array, t) || !owned(snapshot.tempoIndices, Uint32Array, t) ||
      !(snapshot.words instanceof Uint32Array) || !owned(snapshot.words, Uint32Array, snapshot.words.length) || snapshot.words.length > n * 4 ||
      snapshot.offsets[0] !== 0 || snapshot.offsets[n] !== snapshot.words.length || !Array.isArray(snapshot.attribution) || snapshot.attribution.length !== n ||
      !Array.isArray(snapshot.outputIds) || snapshot.outputIds.length > 4096 || !owned(snapshot.outputEpochs, Float64Array, snapshot.outputIds.length * 2) ||
      !window || typeof window.recordingComplete !== 'boolean' || typeof window.originalComplete !== 'boolean') throw new TypeError('Clip export requires bounded original UMP source columns and coverage.');
  if (!Number.isSafeInteger(snapshot.metadataBytes) || !Number.isSafeInteger(estimatedPeakBytes) || estimatedPeakBytes < originalUmpExportPeakBytes(snapshot.metadataBytes)) throw new RangeError('Original Clip export exceeds its admitted workspace.');
  const guard = () => { signal?.throwIfAborted(); if (!current()) throw new Error('The original Clip source changed.'); };
  const pulse = async (phase, completedUnits) => { guard(); onProgress({ phase, completedUnits, totalUnits: n + t }); await yieldControl(); guard(); };
  guard();
  const coverage = clipCoverage(window);
  const counts = new Uint32Array(snapshot.outputIds?.length * 2 || 0), encoder = new TextEncoder();
  let metadataBytes = 0, firstTempoBeat = null, firstTempoIndex = -1;
  for (let index = 0; index < n; index++) {
    const start = snapshot.offsets[index], end = snapshot.offsets[index + 1], source = snapshot.sourceIndices[index];
    if (end <= start || end - start > 4 || end > snapshot.words.length || snapshot.routes[index] >= counts.length / 2 ||
        !Number.isFinite(snapshot.beats[index]) || snapshot.beats[index] < 0 || source >= snapshot.sourceCount || index && source <= snapshot.sourceIndices[index - 1]) throw new TypeError('Malformed original UMP source row.');
    decodeUmpPacket(snapshot.words.subarray(start, end));
    const meta = originalUmpAttribution(snapshot.attribution[index]);
    if (Object.keys(snapshot.attribution[index]).some(key => !Object.hasOwn(meta, key))) throw new TypeError('Unknown original UMP attribution field.');
    const size = encoder.encode(JSON.stringify(meta)).length;
    if (size > 4096 || (metadataBytes += size + 512) > ORIGINAL_UMP_METADATA_LIMIT) throw new RangeError('Original Clip attribution exceeds its sidecar bound.');
    counts[snapshot.routes[index] * 2 + 1]++;
    if (index % 4096 === 4095) await pulse('validating-original-ump', index + 1);
  }
  if (metadataBytes !== snapshot.metadataBytes) throw new TypeError('Original attribution estimate does not match its source.');
  for (let index = 0; index < t; index++) {
    const beat = snapshot.tempoBeats[index], source = snapshot.tempoIndices[index];
    if (!Number.isFinite(beat) || beat < 0 || source >= snapshot.sourceCount || index && source <= snapshot.tempoIndices[index - 1]) throw new TypeError('Malformed captured transport boundary.');
    if (!Number.isFinite(snapshot.tempoBpms[index]) || snapshot.tempoBpms[index] <= 0) throw new TypeError('Malformed captured tempo value.');
    if (firstTempoBeat == null || beat < firstTempoBeat) { firstTempoBeat = beat; firstTempoIndex = index; }
    if (index % 4096 === 4095) await pulse('validating-captured-tempo', n + index + 1);
  }
  let originalAt = 0, tempoAt = 0, previousBeat = -1;
  while (originalAt < n || tempoAt < t) {
    if (originalAt < n && tempoAt < t && snapshot.sourceIndices[originalAt] === snapshot.tempoIndices[tempoAt]) throw new TypeError('Original UMP and tempo rows cannot share a source index.');
    const takeOriginal = originalAt < n && (tempoAt === t || snapshot.sourceIndices[originalAt] < snapshot.tempoIndices[tempoAt]);
    const beat = takeOriginal ? snapshot.beats[originalAt++] : snapshot.tempoBeats[tempoAt++];
    if (beat < previousBeat) throw new Error('The recorded score clock moved backwards; select a single clock segment before Clip export.'); previousBeat = beat;
    if ((originalAt + tempoAt) % 4096 === 0) await pulse('validating-score-clock', originalAt + tempoAt);
  }
  const plan = planOriginalUmpClip(snapshot, options, counts, firstTempoBeat), transportTempo = plan.tempoSource === 'captured-transport';
  if (transportTempo && firstTempoIndex < 0) throw new Error('Captured transport tempo is unavailable; current UI tempo cannot replace it.');
  const tickAt = beat => {
    const value = (beat - plan.originBeat) * ppq, tick = Math.round(value);
    if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(tick)) throw new RangeError('Original UMP time lies outside the selected Clip tick domain.');
    return tick;
  };
  const selected = [], tempos = [], ticks = new Float64Array(n + t);
  let wordCount = 0, originalTempoAtStart = false, quantizedEvents = 0, maximumBeatError = 0;
  for (let index = 0; index < n; index++) {
    if (snapshot.routes[index] === plan.routeIndex) {
      const tick = ticks[index] = tickAt(snapshot.beats[index]), packet = decodeUmpPacket(snapshot.words.subarray(snapshot.offsets[index], snapshot.offsets[index + 1]));
      if (packet.kind === 'flex-data' && packet.bank === 0 && packet.status === 0) {
        if (transportTempo) throw Object.assign(new Error('Original Flex tempo is retained. Select original Flex tempo instead of overlaying captured transport tempo.'), { code: 'clip-tempo-source-conflict' });
        if (tick === 0) originalTempoAtStart = true;
      }
      const error = Math.abs((snapshot.beats[index] - plan.originBeat) - tick / ppq); if (error) quantizedEvents++; maximumBeatError = Math.max(maximumBeatError, error);
      selected.push(index); wordCount += snapshot.offsets[index + 1] - snapshot.offsets[index];
    }
    if (index % 4096 === 4095) await pulse('projecting-original-ump', index + 1);
  }
  if (!transportTempo && !originalTempoAtStart) throw new Error('Original Flex tempo requires a retained tempo packet at the selected Clip origin.');
  if (transportTempo) for (let index = 0; index < t; index++) if (index !== firstTempoIndex) {
    ticks[n + index] = tickAt(snapshot.tempoBeats[index]); tempos.push(n + index); wordCount += 4;
  }
  const order = new Uint32Array([...selected, ...tempos]);
  const sourceIndex = index => index < n ? snapshot.sourceIndices[index] : snapshot.tempoIndices[index - n];
  order.sort((a, b) => ticks[a] - ticks[b] || sourceIndex(a) - sourceIndex(b));
  const sequence = { ticks: new Float64Array(order.length), offsets: new Uint32Array(order.length + 1), words: new Uint32Array(wordCount) }, attribution = [];
  let at = 0;
  for (let index = 0; index < order.length; index++) {
    const row = order[index]; sequence.ticks[index] = ticks[row]; sequence.offsets[index] = at;
    if (row < n) {
      const start = snapshot.offsets[row], end = snapshot.offsets[row + 1]; sequence.words.set(snapshot.words.subarray(start, end), at); at += end - start;
      attribution.push({ sequenceIndex: index, sourceRecordIndex: sourceIndex(row), sourceBeat: snapshot.beats[row], tick: ticks[row], attribution: snapshot.attribution[row] });
    } else { sequence.words.set([0xd0100000, tempoWord(snapshot.tempoBpms[row - n]), 0, 0], at); at += 4; }
    sequence.offsets[index + 1] = at;
    if (index % 4096 === 4095) await pulse('building-original-clip', index + 1);
  }
  const configuration = transportTempo ? { ticks: new Float64Array([0]), offsets: new Uint32Array([0, 4]), words: new Uint32Array([0xd0100000, tempoWord(snapshot.tempoBpms[firstTempoIndex]), 0, 0]) } : undefined;
  const result = await encodeMidiClipFile({ ppq, configurationEndTick: 0, endTick: sequence.ticks.at(-1) ?? 0, configuration, sequence }, controls); guard();
  if (!crypto?.subtle) throw new Error('Clip attribution requires SHA-256 to bind its sidecar to the exact file.');
  onProgress({ phase: 'binding-clip-sidecar', completedUnits: n, totalUnits: n });
  const clipSha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', result.bytes)), byte => byte.toString(16).padStart(2, '0')).join(''); guard();
  const complete = window.recordingComplete && window.originalComplete;
  const summary = { schema: 'procgen-original-ump-sidecar/v1', complete, clipSha256, clipBytes: result.bytes.byteLength, sourcePrefixRows: snapshot.sourceCount, sourceLayer: 'authored-intent', publication: 'not-submitted',
    noteBoundaryCoverage: 'unverified-original-packets-preserved-no-derived-releases', timeAuthority: 'explicit-authored-score-beats-not-physical-take-projection',
    exportPlan: { ...plan, ppq, initialTempo: transportTempo ? { source: 'captured-transport', bpm: snapshot.tempoBpms[firstTempoIndex], firstCapturedBeat: firstTempoBeat,
      unobservedPrefixBeats: plan.originBeat ? 0 : firstTempoBeat } : { source: 'original-flex-at-origin' } },
    outputIdentity: { outputId: snapshot.outputIds[plan.routeIndex], connectionEpoch: plan.connectionEpoch ?? null, routeRevision: plan.routeRevision ?? null },
    initialMeter: 'unobserved-unless-present-in-original-flex',
    quantization: { policy: 'nearest-tick', quantizedEvents, maximumBeatError }, originalPackets: selected.length, derivedTempoPackets: tempos.length + (transportTempo ? 1 : 0),
    endPolicy: 'last-retained-event-no-inferred-trailing-duration', setupDisposition: 'data-only-never-submitted', recordingIncomplete: !window.recordingComplete, originalCaptureIncomplete: !window.originalComplete,
    coverage };
  const manifestBytes = encoder.encode(JSON.stringify({ ...summary, attribution }));
  if (manifestBytes.byteLength > ORIGINAL_UMP_METADATA_LIMIT) throw new RangeError('Original Clip sidecar exceeds its byte limit.');
  guard(); return { bytes: result.bytes, manifestBytes, report: { ...summary, clip: result.report } };
}
function clipCoverage(window) {
  const result = {};
  for (const key of ['incompleteReason', 'originalReason', 'recordingId']) if (window[key] != null) {
    if (typeof window[key] !== 'string' || window[key].length > 256) throw new TypeError('Invalid original Clip coverage reason.'); result[key] = window[key];
  }
  for (const key of ['firstLostSequence', 'droppedRecords', 'originalDropped', 'originalUnmappedTimes', 'recordingRevision']) if (window[key] != null) {
    if (!Number.isSafeInteger(window[key]) || window[key] < 0) throw new TypeError('Invalid original Clip coverage count.'); result[key] = window[key];
  }
  if (window.incompleteReasons != null) {
    if (!Array.isArray(window.incompleteReasons) || window.incompleteReasons.length > 64 || window.incompleteReasons.some(reason => typeof reason !== 'string' || reason.length > 256)) throw new TypeError('Invalid original Clip coverage reasons.'); result.incompleteReasons = [...window.incompleteReasons];
  }
  return result;
}
