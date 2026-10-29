import { decodeUmpPacket } from '../../../midi/protocol/UmpPacketCodec.js';
import { createOwnedResourceReservation } from '../../resources/OwnedResourceReservation.js';

const MAX_BYTES = 32 * 1048576;
let ordinal = 0;
const idFields = ['intentId', 'onsetId', 'voiceId', 'eventId', 'batchId', 'worldId', 'actorId'];

export function createOriginalUmpCapture({ resourceBudget = null, maximumRecords = 100000 } = {}) {
  if (!Number.isSafeInteger(maximumRecords) || maximumRecords < 0 || maximumRecords > 262144) throw new RangeError('Invalid original UMP capture capacity.');
  const owner = 'original-ump-capture-' + (++ordinal);
  let reservation = null, records = 0, bytes = 0, dropped = 0, unmapped = 0, reason = null, closed = false;
  const refuse = why => { dropped++; reason ??= why; return false; };
  const state = () => Object.freeze({ protocol: 'ump', sourceLayer: 'authored-intent', publication: 'not-submitted', recorded: records,
    dropped, unmappedTimes: unmapped, complete: !reason && !unmapped, reason: reason || (unmapped ? 'source-clock-unmapped' : null),
    retainedEstimateBytes: bytes, maximumBytes: MAX_BYTES, maximumRecords, reservation: reservation?.receipt() || null });
  return Object.freeze({
    record(event, route, append) {
      if (closed) return false;
      if (records >= maximumRecords) return refuse('original-ump-record-capacity');
      let packet;
      /** @type {Record<string, unknown>} */
      let metadata;
      try {
        packet = decodeUmpPacket(event.umpWords);
        metadata = { outputId: route.outputId, connectionEpoch: route.connectionEpoch, routeRevision: route.routeRevision };
        if (typeof metadata.outputId !== 'string' || metadata.outputId.length > 4096 ||
            [metadata.connectionEpoch, metadata.routeRevision].some(value => value != null && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0))) throw new Error('Invalid original route identity.');
        for (const key of idFields) if (event[key] != null) {
          if (!(typeof event[key] === 'string' && event[key].length <= 256 || Number.isSafeInteger(event[key]) && event[key] >= 0)) throw new Error('Original attribution exceeds its identity bound.');
          metadata[key] = event[key];
        }
        if (event.sourceEventIds != null) {
          if (!Array.isArray(event.sourceEventIds) || event.sourceEventIds.length > 32 || event.sourceEventIds.some(id => typeof id !== 'string' || id.length > 256)) throw new Error('Original source identities exceed their bound.');
          metadata.sourceEventIds = Object.freeze([...event.sourceEventIds]);
        }
        for (const key of ['soundingPitch', 'controllerSequence', 'baselineRevision']) if (event[key] != null) {
          if (!Number.isFinite(event[key])) throw new Error('Invalid original control metadata.'); metadata[key] = event[key];
        }
      } catch { return refuse('invalid-original-ump-or-identity'); }
      const metadataBytes = new TextEncoder().encode(JSON.stringify(metadata)).byteLength;
      if (metadataBytes > 4096) return refuse('original-ump-metadata-capacity');
      const nextBytes = bytes + 512 + metadataBytes * 2 + packet.wordCount * 8;
      if (nextBytes > MAX_BYTES) return refuse('original-ump-byte-capacity');
      try {
        if (reservation) reservation.resize(Math.max(4096, nextBytes));
        else reservation = createOwnedResourceReservation({ budget: resourceBudget, owner, kind: 'original-ump-recording-metadata-estimate', bytes: Math.max(4096, nextBytes), maxBytes: MAX_BYTES });
      } catch { return refuse('original-ump-resource-capacity'); }
      const beat = Number.isFinite(event.beat) && event.beat >= 0 ? event.beat : null;
      let retained = false;
      try {
        retained = !!append({ ...metadata, type: 'umpIntent', direction: 'output', source: 'original-ump-intent', evidence: 'intent-render',
          protocol: 'ump', publication: 'authored-not-submitted', sourceProtocol: packet.protocol || 'ump', umpWords: packet.words, sourceUmp: packet.words,
          data: [], timestamp: event.timestamp ?? event.timeMs, beat, timeDomain: beat == null ? 'unmapped' : 'recorded-score-beat',
          ...(beat == null ? { timingUncertainty: 'source-clock-unmapped' } : {}) });
      } catch { reason ??= 'recording-source-append-failed'; }
      finally {
        if (!retained) { try { reservation.resize(Math.max(4096, bytes)); } catch { reason ??= 'original-ump-retirement-unknown'; } }
      }
      if (!retained) return refuse('recording-source-refused');
      bytes = nextBytes; records++; if (beat == null) unmapped++; return true;
    },
    state,
    clear() {
      if (closed) throw new Error('The original UMP capture owner retired.');
      reservation?.release(); reservation = null; records = bytes = dropped = unmapped = 0; reason = null;
    },
    dispose() { if (closed) return; closed = true; reservation?.release(); reservation = null; }
  });
}
