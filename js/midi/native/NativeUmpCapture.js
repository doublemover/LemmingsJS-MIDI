import { createOwnedResourceReservation } from '../../app/resources/OwnedResourceReservation.js';
import { UMP_WORD_COUNTS } from '../protocol/UmpPacketCodec.js';

const PAGE_SIZE = 512, MAX_RECORDS = 65536, MAX_BYTES = 16 * 1048576;
const KINDS = Object.freeze(['batch-packet', 'owned-note-cleanup', 'owned-controller-cleanup', 'jr-clock', 'jr-timestamp']);
const columns = () => ({ words: new Uint32Array(PAGE_SIZE * 4), lengths: new Uint8Array(PAGE_SIZE), beginMonoUs: new Float64Array(PAGE_SIZE), endMonoUs: new Float64Array(PAGE_SIZE),
  sequences: new Float64Array(PAGE_SIZE), executions: new Uint32Array(PAGE_SIZE), batchIds: new Float64Array(PAGE_SIZE), flags: new Uint8Array(PAGE_SIZE), kinds: new Uint8Array(PAGE_SIZE) });
const PAGE_BYTES = Object.values(columns()).reduce((sum, column) => sum + column.byteLength, 0) + 1024;
const safe = value => Number.isSafeInteger(value) && value >= 0;
export function createNativeUmpCapture({ resourceBudget = null } = {}) {
  const pages = [], listeners = new Set(), owner = 'native-ump-capture-' + globalThis.crypto.randomUUID();
  let reservation = null, active = null, latest = null, count = 0, dropped = 0, unconfirmed = 0, lastSequence = null, accepting = false, disposed = false, retained = 0, generation = 0, pendingNotification = false;
  const emit = () => { if (pendingNotification) return; pendingNotification = true; queueMicrotask(() => { pendingNotification = false; if (disposed) return; for (const listener of listeners) { try { listener(); } catch {} } }); };
  const reserve = bytes => {
    if (reservation) reservation.resize(Math.max(4096, bytes));
    else reservation = createOwnedResourceReservation({ budget: resourceBudget, owner, kind: 'native-ump-capture-columns', bytes: Math.max(4096, bytes), maxBytes: MAX_BYTES });
  };
  const releaseIfDisposed = () => { if (disposed && !retained) { pages.length = 0; reservation?.release(); reservation = null; } };
  const api = Object.freeze({
    start({ session, grant, outputId, groupMask, initialOwnedNotes, hostTimeMs }) {
      if (disposed || accepting || retained || count || !safe(session) || !session || !safe(grant) || !grant || typeof outputId !== 'string' || !outputId || outputId.length > 256 ||
          !Number.isInteger(groupMask) || groupMask < 0 || groupMask > 65535 || !['empty-at-quiescent-boundary', 'unknown-at-capture-start'].includes(initialOwnedNotes) || !Number.isFinite(hostTimeMs)) throw new Error('Choose a current native output and clear the previous capture before starting');
      reserve(4096); generation++; active = Object.freeze({ captureId: globalThis.crypto.randomUUID(), session, grant, outputId, groupMask, initialOwnedNotes, startedHostMs: hostTimeMs }); accepting = true; latest = null; lastSequence = null; emit(); return active;
    },
    record({ session, grant, execution, nativeBatchId, driverSequence, kind, words, accepted, beginMonoUs, endMonoUs }) {
      if (!accepting || disposed || session !== active.session || grant !== active.grant) return false;
      if (!KINDS.includes(kind) || !Array.isArray(words) || !words.length || words.length > 4 || words.length !== UMP_WORD_COUNTS[words[0] >>> 28] || words.some(word => !Number.isInteger(word) || word < 0 || word > 0xffffffff) ||
          !safe(execution) || execution > 0xffffffff || !safe(nativeBatchId) || !safe(driverSequence) || !safe(beginMonoUs) || !safe(endMonoUs) || endMonoUs < beginMonoUs || typeof accepted !== 'boolean' || lastSequence != null && driverSequence <= lastSequence) {
        dropped++; latest = Object.freeze({ status: 'incomplete', reason: 'invalid-or-reordered-native-SDK-observation' }); emit(); return false;
      }
      if (count >= MAX_RECORDS) { dropped++; accepting = false; latest = Object.freeze({ status: 'capacity', reason: 'Native output recording reached65536 observed packets' }); emit(); return false; }
      const pageIndex = Math.floor(count / PAGE_SIZE), index = count % PAGE_SIZE;
      if (!pages[pageIndex]) {
        const before = pages.length * PAGE_BYTES + retained * pages.length * PAGE_BYTES + 4096;
        try { reserve(before + PAGE_BYTES); pages.push(columns()); }
        catch (error) { try { reservation?.resize(Math.max(4096, before)); } catch {} dropped++; accepting = false; latest = Object.freeze({ status: 'capacity', reason: error.message }); emit(); return false; }
      }
      const page = pages[pageIndex]; page.words.set(words, index * 4); page.lengths[index] = words.length; page.beginMonoUs[index] = beginMonoUs; page.endMonoUs[index] = endMonoUs;
      page.sequences[index] = driverSequence; page.executions[index] = execution; page.batchIds[index] = nativeBatchId; page.flags[index] = accepted ? 1 : 2; page.kinds[index] = KINDS.indexOf(kind);
      count++; if (!accepted) unconfirmed++; lastSequence = driverSequence; emit(); return true;
    },
    stop({ reason = 'explicit-stop', finalOwnedNotes = 'unknown-at-capture-stop', hostTimeMs = null } = {}) {
      if (!active || !accepting) return api.state(); accepting = false; generation++;
      latest = Object.freeze({ status: dropped || unconfirmed ? 'incomplete' : 'stopped', reason, finalOwnedNotes, stoppedHostMs: hostTimeMs, stopBoundary: 'host-observation-stop-not-native-dispatch-barrier' }); emit(); return api.state();
    },
    async snapshot({ signal, isCurrent = () => true, yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
      if (disposed || accepting || !active || retained >= 1 || !count) throw new Error('Stop the native output recording before preparing its immutable snapshot');
      const selected = generation, bytes = pages.length * PAGE_BYTES + 4096, copied = []; reserve(bytes * 3); retained++;
      const check = () => { signal?.throwIfAborted(); if (disposed || generation !== selected || !isCurrent()) throw new Error('Native output recording changed during snapshot'); };
      let released = false;
      const release = () => { if (released) return false; released = true; retained--; if (disposed) releaseIfDisposed(); else reservation?.resize(Math.max(4096, pages.length * PAGE_BYTES + 4096)); emit(); return true; };
      try {
        for (let index = 0; index < pages.length; index++) { check(); copied.push(Object.freeze(Object.fromEntries(Object.entries(pages[index]).map(([name, value]) => [name, value.slice()])))); if (index % 8 === 7) { await yieldControl(); check(); } }
        check(); return Object.freeze({ snapshot: Object.freeze({ schema: 'lemmings-native-SDK-output-capture/v1', sourceLayer: 'native-SDK-call-observations', clockDomain: 'companion-steady-microseconds',
          claim: 'accepted-and-unconfirmed-SDK-calls-not-receiver-wire-or-acoustic-proof', ...active, count, dropped, unconfirmed, latest, pageSize: PAGE_SIZE, kinds: KINDS, pages: Object.freeze(copied) }), release });
      } catch (error) { release(); throw error; }
    },
    clear() { if (accepting || retained) throw new Error('Stop recording and finish its export before clearing native output'); generation++; pages.length = 0; active = latest = null; count = dropped = unconfirmed = 0; lastSequence = null; reservation?.release(); reservation = null; emit(); },
    state: () => Object.freeze({ disposed, accepting, capture: active, count, dropped, unconfirmed, latest, retainedSnapshots: retained, retainedBytes: reservation?.receipt().declaredBytes || 0, reservation: reservation?.receipt() || null, maximumRecords: MAX_RECORDS }),
    subscribe(listener) { if (disposed || typeof listener !== 'function' || listeners.size >= 8) throw new Error('Native output capture observer capacity'); listeners.add(listener); return () => listeners.delete(listener); },
    dispose() { if (disposed) return; api.stop({ reason: 'native-output-owner-retired' }); disposed = true; generation++; listeners.clear(); releaseIfDisposed(); }
  }); return api;
}

export function nativeUmpCaptureBlob(snapshot) {
  if (snapshot?.schema !== 'lemmings-native-SDK-output-capture/v1' || !Number.isInteger(snapshot.count) || snapshot.count < 1 || snapshot.count > MAX_RECORDS ||
      snapshot.pageSize !== PAGE_SIZE || !Array.isArray(snapshot.pages) || snapshot.pages.length !== Math.ceil(snapshot.count / PAGE_SIZE)) throw new Error('Choose a bounded immutable native output snapshot');
  const layout = Object.entries(columns()).map(([name, column]) => ({ name, elements: column.length, type: column instanceof Float64Array ? 'float64' : column instanceof Uint32Array ? 'uint32' : 'uint8', byteLength: column.byteLength }));
  const { pages, ...metadata } = snapshot, header = new TextEncoder().encode(JSON.stringify({ ...metadata, columnEncoding: 'little-endian', layout }));
  if (header.length > 16384) throw new Error('Native output capture header capacity');
  const prefix = new Uint8Array(12); prefix.set(new TextEncoder().encode('LMUMPSDK')); new DataView(prefix.buffer).setUint32(8, header.length, false);
  const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1, parts = [prefix, header];
  for (const page of pages) for (const field of layout) {
    const column = page[field.name];
    if (!ArrayBuffer.isView(column) || column.length !== field.elements || column.byteLength !== field.byteLength || typeof SharedArrayBuffer === 'function' && column.buffer instanceof SharedArrayBuffer) throw new Error('Malformed native output capture columns');
    if (littleEndian || field.type === 'uint8') parts.push(column);
    else {
      const bytes = new Uint8Array(column.byteLength), view = new DataView(bytes.buffer);
      for (let index = 0; index < column.length; index++) if (field.type === 'float64') view.setFloat64(index * 8, column[index], true); else view.setUint32(index * 4, column[index], true);
      parts.push(bytes);
    }
  }
  return new Blob(parts, { type: 'application/octet-stream' });
}
