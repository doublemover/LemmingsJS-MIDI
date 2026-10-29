import { yieldBackgroundTask } from '../../resources/BackgroundTaskYield.js';
import { smfBeat } from './ProcgenSmfBytes.js';

export const RECORDING_EXPORT_SCHEMA = 'procgen-recording-columns/v1';
export const recordingExportPeakBytes = count => {
  if (!Number.isSafeInteger(count) || count < 0 || count > 2000000 || count * 320 + 16 * 1048576 > 511 * 1048576) throw new RangeError('The retained recording exceeds the bounded MIDI export workspace.');
  return count * 320 + 16 * 1048576;
};
export async function snapshotMidiRecording({ records, count, signal, isCurrent, onProgress = () => {}, yieldTask = yieldBackgroundTask,
  now = () => performance.now() }) {
  recordingExportPeakBytes(count);
  const guard = () => { signal?.throwIfAborted(); if (!isCurrent()) throw new Error('The recording changed during MIDI export preparation.'); };
  guard();
  const timing = new Float64Array(count * 2), messages = new Uint8Array(count * 5), routes = new Uint32Array(count), outputIds = [], ids = new Map(), counts = [];
  let textUnits = 0, sliceStart = now();
  for (let index = 0; index < count; index++) {
    const event = records[index], t = index * 2, m = index * 5;
    if (!event.cancelled && (event.type === 'tempo' || event.direction === 'output' && ['api-accepted', 'intent-render'].includes(event.evidence))) {
      timing[t] = smfBeat(event.beat);
      if (event.type === 'tempo') { timing[t + 1] = event.bpm; messages[m + 4] = 3; }
      else {
        const data = event.data, outputId = String(event.outputId ?? '');
        if (!ids.has(outputId)) {
          if (outputIds.length >= 4096 || outputId.length > 4096 || (textUnits += outputId.length) > 524288) throw new RangeError('Recording route identities exceed the bounded export table.');
          ids.set(outputId, outputIds.length); outputIds.push(outputId); counts.push(0, 0);
        }
        routes[index] = ids.get(outputId); messages[m] = data[0]; messages[m + 1] = data[1]; messages[m + 2] = data[2] ?? 0;
        messages[m + 3] = data.length; messages[m + 4] = event.evidence === 'api-accepted' ? 1 : 2;
        counts[routes[index] * 2 + messages[m + 4] - 1]++;
      }
    }
    if ((index + 1) % 128 === 0 && (now() - sliceStart >= 3 || (index + 1) % 4096 === 0)) {
      guard(); onProgress({ phase: 'snapshotting-recording', completedUnits: index + 1, totalUnits: count }); await yieldTask({ signal }); guard(); sliceStart = now();
    }
  }
  guard(); onProgress({ phase: 'snapshotting-recording', completedUnits: count, totalUnits: count });
  return { schema: RECORDING_EXPORT_SCHEMA, count, timing, messages, routes, outputIds, routeCounts: new Uint32Array(counts) };
}
