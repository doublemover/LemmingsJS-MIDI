import { createOwnedResourceReservation } from '../../resources/OwnedResourceReservation.js';

const CHUNK = 128, POSITION = Symbol('recording-range-position');
const EMPTY = Object.freeze({ firstSequence: null, lastSequence: null, firstTimestamp: null, lastTimestamp: null });
let ordinal = 0;

export function createMidiRecordingRangeIndex({ getRecords, capacity, resourceBudget = null } = {}) {
  if (typeof getRecords !== 'function' || !Number.isSafeInteger(capacity) || capacity < 0 || capacity > 2000000) throw new RangeError('Recording ranges require a bounded event capacity.');
  let leaves = 1; while (leaves < Math.ceil(capacity / CHUNK)) leaves *= 2;
  const nodes = leaves * 2, typedBytes = nodes * 36, metadataEstimate = capacity * 64, owner = 'midi-recording-range-' + (++ordinal), dirty = new Set();
  let storage = null, closed = false, stale = false, cached = EMPTY, appended = 0, canceled = 0, scannedEvents = 0, refreshedChunks = 0, treeUpdates = 0, generation = 0;
  const prepare = () => {
    if (closed) throw new Error('The recording range owner retired.');
    if (storage) { if (!storage.reservation.isActive()) throw new Error('Recording range ownership is unresolved.'); return; }
    const reservation = createOwnedResourceReservation({ budget: resourceBudget, owner, kind: 'recording-range-index-and-object-metadata-estimate', category: 'checkpoint', bytes: 4096 + typedBytes + metadataEstimate });
    storage = { reservation, minimumTime: null, maximumTime: null, firstSequence: null, lastSequence: null, counts: null };
    try {
      storage.minimumTime = new Float64Array(nodes).fill(Infinity); storage.maximumTime = new Float64Array(nodes).fill(-Infinity);
      storage.firstSequence = new Float64Array(nodes).fill(Infinity); storage.lastSequence = new Float64Array(nodes).fill(-Infinity); storage.counts = new Uint32Array(nodes);
    } catch (error) { try { reservation.release(); storage = null; } catch {} throw error; }
  };
  const update = leaf => {
    const s = storage;
    for (let at = Math.floor(leaf / 2); at; at = Math.floor(at / 2)) {
      const left = at * 2, right = left + 1; s.counts[at] = s.counts[left] + s.counts[right];
      s.minimumTime[at] = Math.min(s.minimumTime[left], s.minimumTime[right]); s.maximumTime[at] = Math.max(s.maximumTime[left], s.maximumTime[right]);
      s.firstSequence[at] = Math.min(s.firstSequence[left], s.firstSequence[right]); s.lastSequence[at] = Math.max(s.lastSequence[left], s.lastSequence[right]); treeUpdates++;
    }
  };
  const append = event => {
    if (!event || !Number.isSafeInteger(event.sequence) || event.sequence < 1 || !Number.isFinite(event.timestamp) || event.cancelled) throw new TypeError('Index only retained finite recording events.');
    const position = getRecords().length; if (position >= capacity) throw new RangeError('Recording range capacity exceeded.'); prepare();
    Object.defineProperty(event, POSITION, { value: position }); const s = storage, leaf = leaves + Math.floor(position / CHUNK);
    s.counts[leaf]++; s.minimumTime[leaf] = Math.min(s.minimumTime[leaf], event.timestamp); s.maximumTime[leaf] = Math.max(s.maximumTime[leaf], event.timestamp);
    s.firstSequence[leaf] = Math.min(s.firstSequence[leaf], event.sequence); s.lastSequence[leaf] = Math.max(s.lastSequence[leaf], event.sequence);
    update(leaf); appended++; stale = true;
  };
  const cancel = event => {
    const position = event?.[POSITION];
    if (closed || !storage || !Number.isSafeInteger(position) || getRecords()[position] !== event || event.cancelled) return false;
    event.cancelled = true; dirty.add(Math.floor(position / CHUNK)); canceled++; stale = true; return true;
  };
  const snapshot = () => {
    if (!stale || closed) return cached;
    const s = storage, records = getRecords();
    for (const chunk of dirty) {
      const leaf = leaves + chunk, first = chunk * CHUNK, end = Math.min(records.length, first + CHUNK);
      s.minimumTime[leaf] = s.firstSequence[leaf] = Infinity; s.maximumTime[leaf] = s.lastSequence[leaf] = -Infinity; s.counts[leaf] = 0;
      for (let at = first; at < end; at++) {
        const event = records[at]; scannedEvents++; if (event.cancelled) continue; s.counts[leaf]++;
        s.minimumTime[leaf] = Math.min(s.minimumTime[leaf], event.timestamp); s.maximumTime[leaf] = Math.max(s.maximumTime[leaf], event.timestamp);
        s.firstSequence[leaf] = Math.min(s.firstSequence[leaf], event.sequence); s.lastSequence[leaf] = Math.max(s.lastSequence[leaf], event.sequence);
      }
      update(leaf); refreshedChunks++;
    }
    dirty.clear(); stale = false;
    cached = s.counts[1] ? Object.freeze({ firstSequence: s.firstSequence[1], lastSequence: s.lastSequence[1], firstTimestamp: s.minimumTime[1], lastTimestamp: s.maximumTime[1] }) : EMPTY;
    return cached;
  };
  const clear = ({ release = false } = {}) => {
    dirty.clear(); cached = EMPTY; stale = false; appended = canceled = scannedEvents = refreshedChunks = treeUpdates = 0; generation++;
    if (!storage) return;
    if (release) { storage.reservation.release(); storage = null; return; }
    if (!storage.reservation.isActive()) throw new Error('Recording range ownership is unresolved.');
    storage.minimumTime.fill(Infinity); storage.firstSequence.fill(Infinity); storage.maximumTime.fill(-Infinity); storage.lastSequence.fill(-Infinity); storage.counts.fill(0);
  };
  return Object.freeze({ prepare, append, cancel, snapshot, clear,
    diagnostics: () => Object.freeze({ generation, capacity, chunkSize: CHUNK, appended, canceled, scannedEvents, refreshedChunks, treeUpdates, pendingChunks: dirty.size,
      typedBytes: storage ? typedBytes : 0, metadataEstimate: storage ? metadataEstimate : 0, closed, reservation: storage?.reservation.receipt() || null,
      recordingEventObjects: 'owned-by-recording;index-metadata-overhead-is-estimated' }),
    dispose() { if (closed) return; snapshot(); closed = true; if (storage) { try { storage.reservation.release(); storage = null; } catch {} } }
  });
}
