import { encodeBackgroundSnapshotPages, createBackgroundSnapshotReceiver } from '../../resources/BackgroundSnapshotPages.js';
import { yieldBackgroundTask } from '../../resources/BackgroundTaskYield.js';

export const continuationCaptureStale = () => Object.assign(new Error('Continuation changed while recovery copied its completed boundary. The prior durable checkpoint is preserved.'), { code: 'continuation-source-changed' });
export async function copyContinuationCooperative(value, { signal, isCurrent = () => true, yieldTask = yieldBackgroundTask,
  onSlice = () => {}, maxBytes = 32 * 1048576, estimatedPeakBytes = 128 * 1048576, now = () => performance.now() } = {}) {
  const check = () => { signal?.throwIfAborted(); if (!isCurrent()) throw continuationCaptureStale(); };
  check(); const receiver = createBackgroundSnapshotReceiver({ maxBytes, maxNodes: 2000000, estimatedPeakBytes }); let sequence = 0;
  try {
    for await (const packet of encodeBackgroundSnapshotPages(value, { maxBytes, maxNodes: 2000000, estimatedPeakBytes, signal, isCurrent, yieldTask, now, onSlice })) {
      check(); const started = now(); receiver.push(packet); sequence = packet.sequence;
      onSlice({ phase: 'continuation-page-copy', durationMs: Math.max(0, now() - started), bytes: packet.bytes }); await yieldTask(); check();
    }
    const result = receiver.finish(sequence), frame = value => {
        if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) throw new TypeError('Semantic continuation uses canonical data; binary world pages have a separate codec.');
        const array = Array.isArray(value), keys = array ? null : Object.keys(value);
        if (keys && keys.length > 4096) throw new RangeError('Large semantic dictionaries require paged entries.');
        return { value, array, keys, index: 0, length: array ? value.length : keys.length };
      }, stack = result && typeof result === 'object' ? [frame(result)] : [];
    while (stack.length) {
      const started = now(); let visited = 0;
      while (stack.length && visited < 128 && now() - started < 3) {
        const current = stack[stack.length - 1];
        if (current.index === current.length) { Object.freeze(current.value); stack.pop(); visited++; continue; }
        const key = current.array ? current.index++ : current.keys[current.index++], child = current.value[key]; visited++;
        if (child === undefined) { if (current.array) current.value[key] = null; else delete current.value[key]; }
        else if (child && typeof child === 'object' && !Object.isFrozen(child)) stack.push(frame(child));
      }
      onSlice({ phase: 'continuation-seal', durationMs: Math.max(0, now() - started), nodes: visited }); if (stack.length) { await yieldTask(); check(); }
    }
    check(); return result;
  } catch (error) { receiver.dispose(); if (!isCurrent() && !signal?.aborted) throw continuationCaptureStale(); throw error; }
}
export async function collectContinuationEntries(entries, { check, yieldTask = yieldBackgroundTask, onSlice = () => {}, now = () => performance.now() } = {}) {
  const result = []; let started = now(), count = 0;
  for (const entry of entries) {
    check(); result.push(entry); count++;
    if (count % 64 === 0 || now() - started >= 3) { onSlice({ phase: 'continuation-collection', durationMs: Math.max(0, now() - started), nodes: count }); await yieldTask(); check(); started = now(); }
  }
  onSlice({ phase: 'continuation-collection', durationMs: Math.max(0, now() - started), nodes: count }); return result;
}
export async function captureContinuationRecord(fields, collections, options) {
  if (typeof options?.check !== 'function') throw new TypeError('A component continuation needs its enclosing version/boundary guard.');
  options.check(); const source = { ...fields };
  for (const [key, entries] of Object.entries(collections)) source[key] = await collectContinuationEntries(entries, options);
  options.check(); return copyContinuationCooperative(source, options);
}
