import { encodeMidiClipFile } from '../protocol/MidiClipFile.js';
import { decodeUmpPacket } from '../protocol/UmpPacketCodec.js';
import { encodeFlexScoreValue } from '../protocol/UmpFlexData.js';

const safe = value => Number.isSafeInteger(value) && value >= 0;
const rowAt = (snapshot, index) => { const page = snapshot.pages[Math.floor(index / snapshot.pageSize)], at = index % snapshot.pageSize; return { page, at }; };
export async function encodeNativeSubmittedClip(snapshot, options = {}, controls = {}) {
  const { sourceLayer, timeProjection, metadataPolicy, scope, group, initialTempoBpm, ppq = 48000, allowIncomplete = false, allowBaselineDependentRelative = false } = options;
  if (snapshot?.schema !== 'lemmings-native-SDK-output-capture/v1' || !Number.isInteger(snapshot.count) || snapshot.count < 1 || snapshot.count > 65536 || snapshot.pageSize !== 512 ||
      !Array.isArray(snapshot.pages) || snapshot.pages.length !== Math.ceil(snapshot.count / 512) || sourceLayer !== 'driver-submitted' || timeProjection !== 'native-SDK-call-start' ||
      !['fixed-seconds-omit-tempo-meter', 'strict-original-context'].includes(metadataPolicy) || !['single-captured-grant', 'selected-group'].includes(scope) ||
      scope === 'selected-group' && (!Number.isInteger(group) || group < 0 || group > 15) || metadataPolicy === 'strict-original-context' && scope !== 'selected-group' ||
      !Number.isInteger(ppq) || ppq < 24 || ppq > 65535 || !safe(snapshot.dropped) || !safe(snapshot.unconfirmed)) throw new Error('Choose one native submitted source, explicit SDK time projection, group scope and metadata policy');
  const current = controls.current || (() => true), yieldControl = controls.yieldControl || (() => new Promise(resolve => setTimeout(resolve, 0)));
  const guard = () => { controls.signal?.throwIfAborted(); if (!current()) throw new Error('Native output export source was retired'); };
  const pulse = async count => { guard(); controls.onProgress?.({ phase: 'projecting-native-submitted-output', completedUnits: count, totalUnits: snapshot.count }); await yieldControl(); guard(); };
  const selected = new Uint32Array(snapshot.count), ticks = new Float64Array(snapshot.count), notes = new Map(), textStreams = new Map(), omittedScoreContext = [];
  const exclusions = { unconfirmedPackets: 0, transportPackets: 0, setupOrUnsupportedPackets: 0, otherGroupPackets: 0, tempoPackets: 0, meterPackets: 0 };
  let count = 0, words = 0, originUs = null, previousUs = null, previousSequence = -1, beat = 0, quarterUs = null, barStartBeat = 0, barLength = null;
  let renderedUs = 0, renderedQuarterUs = null, previousRenderedTick = 0, pinnedTextPackets = 0, maximumTextShiftUs = 0;
  let maximumTimingErrorUs = 0, collapsedDistinctTimes = 0, priorTime = null, priorTick = null, relativeControllers = 0, unmatchedReleases = 0, firstTempoWords = null;
  if (metadataPolicy === 'fixed-seconds-omit-tempo-meter') { quarterUs = 1000000; firstTempoWords = encodeFlexScoreValue('tempo', { bpm: 60 }, { group: 0, address: 'group' }); }
  else if (initialTempoBpm != null) { firstTempoWords = encodeFlexScoreValue('tempo', { bpm: initialTempoBpm }, { group, address: 'group' }); quarterUs = firstTempoWords[1] / 100; }
  for (let index = 0; index < snapshot.count; index++) {
    if (index % 1024 === 1023) await pulse(index + 1);
    guard(); const { page, at } = rowAt(snapshot, index), length = page?.lengths?.[at], begin = page?.beginMonoUs?.[at], end = page?.endMonoUs?.[at], sequence = page?.sequences?.[at], flag = page?.flags?.[at];
    if (!Number.isInteger(length) || length < 1 || length > 4 || !safe(begin) || !safe(end) || end < begin || !safe(sequence) || sequence <= previousSequence || ![1, 2].includes(flag)) throw new Error('Malformed or reordered native capture columns');
    previousSequence = sequence;
    const packet = decodeUmpPacket(Array.from(page.words.subarray(at * 4, at * 4 + length)));
    if (flag === 2) { exclusions.unconfirmedPackets++; continue; }
    if (packet.kind === 'utility' || packet.kind === 'system') { exclusions.transportPackets++; continue; }
    if (!packet.known || !['midi1-channel-voice', 'midi2-channel-voice', 'flex-data'].includes(packet.kind)) { exclusions.setupOrUnsupportedPackets++; continue; }
    if (scope === 'selected-group' && packet.group !== group) { exclusions.otherGroupPackets++; continue; }
    const kind = packet.scoreContext?.kind, value = packet.scoreContext?.value;
    if (metadataPolicy === 'fixed-seconds-omit-tempo-meter' && (kind === 'tempo' || kind === 'meter')) { exclusions[kind + 'Packets']++; omittedScoreContext.push({ sourceIndex: index, driverSequence: sequence, beginMonoUs: begin, kind, value, words: packet.words }); continue; }
    if (originUs == null) {
      originUs = previousUs = begin;
      if (quarterUs == null && kind === 'tempo') { quarterUs = value.tenNanosecondsPerQuarter / 100; firstTempoWords = packet.words; }
      if (quarterUs == null) throw new Error('Retained context requires the captured initial Flex tempo or an explicitly supplied initial tempo');
    }
    if (begin < previousUs) throw new Error('Native SDK call time regressed; separate the capture epochs');
    beat += (begin - previousUs) / quarterUs; previousUs = begin;
    const exact = beat * ppq; let tick = Math.round(exact);
    if (packet.kind === 'flex-data' && [1, 2].includes(packet.bank)) {
      const key = [packet.group, packet.address, packet.channel ?? '-', packet.bank, packet.status].join(':'), stream = textStreams.get(key);
      if (packet.format === 1) { if (stream) throw new Error('Overlapping native Flex text messages'); textStreams.set(key, { tick, begin }); }
      else if (packet.format === 2 || packet.format === 3) { if (!stream) throw new Error('The native capture begins inside a multipart Flex message'); if (priorTick != null && stream.tick < priorTick) throw new Error('Multipart Flex interleaving cannot preserve this SDK-time source order'); tick = stream.tick; pinnedTextPackets++; maximumTextShiftUs = Math.max(maximumTextShiftUs, begin - stream.begin); if (packet.format === 3) textStreams.delete(key); }
      else if (stream) throw new Error('A complete native Flex message interrupted an unfinished message');
    }
    if (!Number.isSafeInteger(tick) || tick < 0) throw new Error('Native output exceeds the selected Clip time domain');
    renderedQuarterUs ??= quarterUs; renderedUs += (tick - previousRenderedTick) / ppq * renderedQuarterUs; previousRenderedTick = tick;
    maximumTimingErrorUs = Math.max(maximumTimingErrorUs, Math.abs(renderedUs - (begin - originUs)));
    if (priorTime != null && priorTime !== begin && tick === priorTick) collapsedDistinctTimes++;
    if (kind === 'tempo') {
      if (BigInt(tick) * 24n % BigInt(ppq) !== 0n) throw new Error('A captured tempo change is off the Clip clock boundary; select the explicit fixed-seconds metadata omission plan');
      quarterUs = renderedQuarterUs = value.tenNanosecondsPerQuarter / 100;
    } else if (kind === 'meter') {
      if (tick !== 0 && (barLength == null || Math.abs((beat - barStartBeat) / barLength - Math.round((beat - barStartBeat) / barLength)) > 0.5 / ppq)) throw new Error('A captured meter change lacks a qualified bar boundary; select the explicit fixed-seconds metadata omission plan');
      if (!value.denominatorExponent || value.denominatorExponent > 30) throw new Error('This meter has no qualified standard bar duration');
      barStartBeat = beat; barLength = value.numerator * 32 / (2 ** value.denominatorExponent * value.thirtySecondsPerQuarter);
    }
    const midi1 = packet.kind === 'midi1-channel-voice', status = packet.status, data = packet.data;
    if (['relativeRegisteredController', 'relativeAssignableController'].includes(status) || midi1 && status === 'controlChange' && [96, 97].includes(data[0])) relativeControllers++;
    const noteOn = status === 'noteOn' && !(midi1 && data[1] === 0), noteOff = status === 'noteOff' || midi1 && status === 'noteOn' && data[1] === 0;
    if (noteOn || noteOff) {
      const key = [packet.kind, packet.group, packet.channel, midi1 ? data[0] : packet.note, page.executions[at]].join(':'), active = notes.get(key) || 0;
      if (noteOn) notes.set(key, active + 1); else if (active > 1) notes.set(key, active - 1); else if (active === 1) notes.delete(key); else unmatchedReleases++;
    }
    selected[count] = index; ticks[count++] = tick; words += length; priorTime = begin; priorTick = tick;
  }
  if (textStreams.size) throw new Error('The native capture ends inside a multipart Flex message');
  if (!count || !firstTempoWords) throw new Error('No accepted channel/score packets exist in this selected capture scope');
  const openNotes = [...notes.values()].reduce((total, value) => total + value, 0), knownStart = snapshot.initialOwnedNotes === 'empty-at-quiescent-boundary';
  const incomplete = snapshot.dropped > 0 || snapshot.unconfirmed > 0 || unmatchedReleases > 0 || openNotes > 0 || !knownStart;
  if (incomplete && allowIncomplete !== true) throw new Error('This accepted-output range has unknown/open note boundaries or missing/unconfirmed data; explicitly select incomplete export');
  if (relativeControllers && allowBaselineDependentRelative !== true) throw new Error('Actual relative controller output is baseline-dependent; explicitly select raw relative replay');
  const first = rowAt(snapshot, selected[0]), firstPacket = decodeUmpPacket(Array.from(first.page.words.subarray(first.at * 4, first.at * 4 + first.page.lengths[first.at])));
  const initialTempoAdded = firstPacket.scoreContext?.kind === 'tempo' && ticks[0] === 0 && firstPacket.words[1] === firstTempoWords[1] ? 0 : 1;
  const sequence = { ticks: new Float64Array(count + initialTempoAdded), offsets: new Uint32Array(count + initialTempoAdded + 1), words: new Uint32Array(words + initialTempoAdded * 4) };
  sequence.ticks.set(ticks.subarray(0, count), initialTempoAdded);
  const attribution = []; let offset = 0;
  if (initialTempoAdded) { sequence.words.set(firstTempoWords); offset = 4; sequence.offsets[1] = 4; attribution.push({ sequenceIndex: 0, derived: 'explicit-initial-Clip-tempo-for-selected-time-projection' }); }
  for (let index = 0; index < count; index++) {
    const sourceIndex = selected[index], { page, at } = rowAt(snapshot, sourceIndex), length = page.lengths[at];
    sequence.offsets[index + initialTempoAdded] = offset; sequence.words.set(page.words.subarray(at * 4, at * 4 + length), offset); offset += length; sequence.offsets[index + initialTempoAdded + 1] = offset;
    attribution.push({ sequenceIndex: index + initialTempoAdded, sourceIndex, driverSequence: page.sequences[at], execution: page.executions[at], nativeBatchId: page.batchIds[at], beginMonoUs: page.beginMonoUs[at], endMonoUs: page.endMonoUs[at], kind: snapshot.kinds[page.kinds[at]] });
    if (index % 1024 === 1023) await pulse(snapshot.count);
  }
  const configuration = { ticks: new Float64Array([0]), offsets: new Uint32Array([0, 4]), words: Uint32Array.from(firstTempoWords) };
  const result = await encodeMidiClipFile({ ppq, configurationEndTick: 0, endTick: sequence.ticks.at(-1), configuration, sequence }, { ...controls, maximumEvents: 262144, estimatedPeakBytes: 128 * 1048576, coalesceEqualClockstamps: true, yieldControl });
  guard(); const digest = Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', result.bytes)), byte => byte.toString(16).padStart(2, '0')).join(''); guard();
  const report = Object.freeze({ schema: 'lemmings-native-submitted-clip/v1', captureId: snapshot.captureId, session: snapshot.session, grant: snapshot.grant, sourceLayer, timeProjection,
    originMonoUs: originUs, placement: 'rebased-first-included-SDK-call', metadataPolicy, scope, group: scope === 'selected-group' ? group : null, ppq, packets: count,
    sourcePackets: snapshot.count, exclusions: Object.freeze(exclusions), incomplete, omittedCapturePackets: snapshot.dropped, unconfirmedCapturePackets: snapshot.unconfirmed,
    noteBoundaries: Object.freeze({ initial: snapshot.initialOwnedNotes, final: snapshot.latest?.finalOwnedNotes || 'unknown', unmatchedReleases, openNotes, repair: 'none' }),
    relativeReplay: relativeControllers ? 'explicit-baseline-dependent-original-words' : 'none', relativeControllers, initialReceiverState: 'unknown-control-plane-setup-excluded',
    multipartText: Object.freeze({ pinnedTextPackets, maximumTextShiftUs, policy: 'one-event-time-for-complete-multipart-text-original-call-times-in-attribution' }),
    quantization: Object.freeze({ maximumTimingErrorUs, collapsedDistinctTimes, policy: 'nearest-integer-Clip-tick-preserving-source-order' }),
    claim: 'accepted-native-SDK-observation-projection-not-physical-render-receiver-or-acoustic-time', clipSha256: digest, derivedConfiguration: 'explicit-Clip-time-projection', initialTempoAdded: !!initialTempoAdded, clip: result.report });
  const manifestBytes = new TextEncoder().encode(JSON.stringify({ ...report, omittedScoreContext, attribution }));
  if (manifestBytes.length > 32 * 1048576) throw new Error('Native Clip attribution capacity');
  guard(); return Object.freeze({ bytes: result.bytes, manifestBytes, report });
}
