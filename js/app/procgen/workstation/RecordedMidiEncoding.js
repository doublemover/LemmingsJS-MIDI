import { RECORDING_EXPORT_SCHEMA, recordingExportPeakBytes } from './MidiRecordingExportSnapshot.js';
import { smfVariable, smfTempo, smfHeader, smfBeatTick } from './ProcgenSmfBytes.js';

export async function encodeRecordedMidi({ snapshot, window, options = {} } = {}, { signal, current = () => true, estimatedPeakBytes,
  onProgress = () => {}, yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
  const count = snapshot?.count;
  if (!Number.isSafeInteger(estimatedPeakBytes) || estimatedPeakBytes < recordingExportPeakBytes(count) || snapshot.schema !== RECORDING_EXPORT_SCHEMA ||
      !(snapshot.timing instanceof Float64Array) || snapshot.timing.length !== count * 2 || !(snapshot.messages instanceof Uint8Array) || snapshot.messages.length !== count * 5 ||
      !(snapshot.routes instanceof Uint32Array) || snapshot.routes.length !== count || !Array.isArray(snapshot.outputIds) || snapshot.outputIds.length > 4096 ||
      [snapshot.timing, snapshot.messages, snapshot.routes].some(column => !(column.buffer instanceof ArrayBuffer)) || new Set(snapshot.outputIds).size !== snapshot.outputIds.length ||
      snapshot.outputIds.some(id => typeof id !== 'string' || id.length > 4096) || snapshot.outputIds.reduce((sum, id) => sum + id.length, 0) > 524288 || !window || typeof window.recordingComplete !== 'boolean')
    throw new TypeError('Recorded MIDI requires its complete bounded source columns and workspace.');
  const guard = () => { signal?.throwIfAborted(); if (!current()) throw new Error('Recorded MIDI source ownership changed.'); };
  const checkpoint = async (phase, done) => { guard(); onProgress({ phase, completedUnits: done, totalUnits: count }); await yieldControl(); guard(); };
  guard();
  const { timing, messages, routes } = snapshot, ppq = Math.max(24, Math.min(32767, Math.round(Number(options.ppq) || 480)));
  const keep = new Uint8Array(count), next = new Uint32Array(count), ticks = new Float64Array(count), pending = new Map();
  let submitted = false, omittedOnsets = 0, omittedReleases = 0, retained = 0;
  for (let index = 0; index < count; index++) { if (messages[index * 5 + 4] === 1) submitted = true; if (index % 4096 === 4095) await checkpoint('selecting-recording-evidence', index + 1); }
  const evidence = submitted ? 1 : 2;
  for (let index = 0; index < count; index++) {
    const m = index * 5, kind = messages[m + 4], status = messages[m], family = status & 0xf0, length = messages[m + 3];
    if (kind > 3 || !Number.isFinite(timing[index * 2])) throw new RangeError('Malformed recording column.');
    if (kind === 1 || kind === 2) {
      if (status < 0x80 || status >= 0xf0 || length !== ([0xc0, 0xd0].includes(family) ? 2 : 3) || messages[m + 1] > 127 || messages[m + 2] > 127 || routes[index] >= snapshot.outputIds.length)
        throw new TypeError('Malformed recorded MIDI message.');
    }
    if (kind === 3 || kind === evidence) {
      ticks[index] = smfBeatTick(timing[index * 2], ppq);
      const on = family === 0x90 && messages[m + 2] > 0, off = family === 0x80 || family === 0x90 && !messages[m + 2];
      if (kind === 3) { smfTempo(timing[index * 2 + 1]); keep[index] = 1; retained++; }
      else if (!on && !off) { keep[index] = 1; retained++; }
      else {
        const key = routes[index] * 2048 + (status & 15) * 128 + messages[m + 1], queue = pending.get(key);
        if (on) {
          if (queue) { next[queue.tail] = index + 1; queue.tail = index; queue.count++; }
          else pending.set(key, { head: index, tail: index, count: 1 });
        } else if (!queue) omittedReleases++;
        else { keep[queue.head] = keep[index] = 1; retained += 2; queue.head = next[queue.head] - 1; if (!--queue.count) pending.delete(key); }
      }
    }
    if (index % 4096 === 4095) await checkpoint('balancing-recording-notes', index + 1);
  }
  for (const queue of pending.values()) omittedOnsets += queue.count;
  pending.clear();
  const order = new Uint32Array(retained); let at = 0;
  for (let index = 0; index < count; index++) { if (keep[index]) order[at++] = index; if (index % 4096 === 4095) await checkpoint('ordering-recording', index + 1); }
  guard(); onProgress({ phase: 'sorting-recording', completedUnits: 0, totalUnits: retained }); order.sort((a, b) => ticks[a] - ticks[b] || a - b); guard();
  const complete = window.recordingComplete && !omittedOnsets && !omittedReleases, reason = window.incompleteReason || (complete ? null : 'unpaired-note-boundary');
  const manifest = { schema: 'procgen-recording-window/v1', complete, reason, reasons: window.incompleteReasons,
    evidence: submitted ? 'api-accepted' : 'intent-render', retainedRange: window.retainedRange, firstLostSequence: window.firstLostSequence,
    droppedRecords: window.droppedRecords, droppedCategories: window.droppedCategories, omittedOnsets, omittedReleases };
  const payload = new TextEncoder().encode(JSON.stringify(manifest)); if (payload.length > 4096) throw new RangeError('Recording manifest exceeds the 4 KiB export limit.');
  const denominator = [1, 2, 4, 8, 16, 32].includes(options.beatUnit) ? options.beatUnit : 4;
  const initial = [0, ...smfTempo(options.bpm ?? 120), 0, 0xff, 0x58, 4, Math.min(255, Math.max(1, Math.round(options.beatsPerBar) || 4)), Math.log2(denominator), 24, 8,
    0, 0xff, 0x01, ...smfVariable(payload.length), ...payload];
  let trackBytes = initial.length + 4, previous = 0;
  for (let index = 0; index < order.length; index++) {
    const row = order[index]; trackBytes += smfVariable(ticks[row] - previous).length + (messages[row * 5 + 4] === 3 ? 6 : messages[row * 5 + 3]); previous = ticks[row];
    if (trackBytes > 64 * 1048576) throw new RangeError('Recorded MIDI exceeds its bounded output.');
    if (index % 4096 === 4095) await checkpoint('sizing-recording-file', index + 1);
  }
  const bytes = new Uint8Array(22 + trackBytes); bytes.set(smfHeader(ppq, trackBytes)); bytes.set(initial, 22); at = 22 + initial.length; previous = 0;
  for (let index = 0; index < order.length; index++) {
    const row = order[index], m = row * 5, delta = smfVariable(ticks[row] - previous); bytes.set(delta, at); at += delta.length; previous = ticks[row];
    if (messages[m + 4] === 3) { const data = smfTempo(timing[row * 2 + 1]); bytes.set(data, at); at += data.length; }
    else { const length = messages[m + 3]; for (let byte = 0; byte < length; byte++) bytes[at++] = messages[m + byte]; }
    if (index % 4096 === 4095) await checkpoint('encoding-recording-file', index + 1);
  }
  bytes.set([0, 0xff, 0x2f, 0], at); guard();
  return { bytes, manifest };
}
