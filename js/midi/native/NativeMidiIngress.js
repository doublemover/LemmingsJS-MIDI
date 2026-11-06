import { decodeUmpPacket, UMP_WORD_COUNTS } from '../protocol/UmpPacketCodec.js';
import { createUmpPayloadCollector } from '../protocol/UmpPayloadCollector.js';

const safe = value => Number.isSafeInteger(value) && value >= 0;
const signedTimestamp = value => {
  if (typeof value !== 'string' || !/^-?(0|[1-9][0-9]{0,18})$/.test(value)) throw new Error('Invalid native signed timestamp');
  const integer = BigInt(value); if (integer < -9223372036854775808n || integer > 9223372036854775807n) throw new Error('Native timestamp exceeds int64'); return value;
};
const classification = packet => {
  if (packet.kind === 'sysex7' || packet.kind === 'sysex8') return 'control-plane';
  if (packet.kind === 'stream' || packet.kind === 'utility') return 'endpoint-control';
  if (packet.kind === 'flex-data') return 'metadata';
  if (packet.kind === 'system') return packet.status === 'activeSense' ? 'sensing' : ['clock', 'start', 'continue', 'stop', 'songPosition'].includes(packet.status) ? 'timing' : 'system';
  if (packet.kind === 'midi1-channel-voice' || packet.kind === 'midi2-channel-voice') return 'channel-observation';
  return 'framing-only';
};
const permitted = (packet, owner) => {
  const type = packet.words[0] >>> 28;
  if (type === 0 || type === 15) return !!(owner.permissions & 8);
  if (!(owner.groupMask & 1 << (packet.words[0] >>> 24 & 15))) return false;
  if (packet.kind === 'sysex7' || packet.kind === 'sysex8') return !!(owner.permissions & 1);
  if (packet.kind === 'system') { if (packet.status === 'activeSense') return !!(owner.permissions & 4); if (['clock', 'start', 'continue', 'stop'].includes(packet.status)) return !!(owner.permissions & 2); }
  return true;
};
export function createNativeMidiIngress({ now = () => performance.now(), maximumGrants = 64, maximumTraceWords = 8192 } = {}) {
  const grants = new Map(), listeners = new Set(), history = [];
  let traceWords = 0, received = 0, losses = 0, omitted = 0, retired = false, lastObservation = null;
  const emit = value => { for (const listener of listeners) { try { listener(Object.freeze(value)); } catch {} } };
  const loss = (owner, reason) => { owner.collector.reset(); owner.epoch++; owner.claim = null; losses++; emit({ event: 'ingress-loss', session: owner.session, grant: owner.grant, ingressEpoch: owner.epoch, reason }); };
  const retain = event => {
    history.push(event); traceWords += event.packet.wordCount;
    while (history.length > 1024 || traceWords > maximumTraceWords) { const old = history.shift(); traceWords -= old.packet.wordCount; omitted++; }
  };
  return Object.freeze({
    register(receipt) {
      if (retired || receipt.direction !== 'input' || !safe(receipt.grant) || !receipt.grant || !safe(receipt.session) || !receipt.session || !Number.isInteger(receipt.groupMask) || receipt.groupMask < 0 || receipt.groupMask > 65535 || !Number.isInteger(receipt.permissions) || receipt.permissions < 0 || receipt.permissions > 15 || grants.size >= maximumGrants || grants.has(receipt.grant)) throw new Error('Invalid native ingress grant');
      const owner = { session: receipt.session, grant: receipt.grant, groupMask: receipt.groupMask, permissions: receipt.permissions, timestampMode: receipt.timestampMode,
        epoch: 1, nextSequence: null, claim: null, collector: createUmpPayloadCollector({ maximumStreams: 8, maximumMessageBytes: 65536, maximumTotalBytes: 131072, maximumPackets: 2048, timeoutMs: 5000, now }) };
      grants.set(receipt.grant, owner);
    },
    revoke(grant, reason = 'input-grant-retired') { const owner = grants.get(grant); if (!owner) return; loss(owner, reason); grants.delete(grant); },
    clearGrants(reason = 'native-connection-retired') { for (const owner of grants.values()) loss(owner, reason); grants.clear(); },
    markLoss({ grant, session, reason = 'native-input-loss' }) { const owner = grants.get(grant); if (owner && owner.session === session) { owner.nextSequence = null; loss(owner, reason); } },
    acceptColumns(row) {
      const owner = grants.get(row.grant); if (retired || !owner || row.session !== owner.session) return false;
      let prepared;
      try {
        const count = row.sourceTimestampNs?.length;
        if (!Array.isArray(row.sourceTimestampNs) || !safe(row.firstSequence) || !Number.isInteger(count) || count < 1 || count > 64 || !Array.isArray(row.words) || row.words.length > 256 ||
            !Array.isArray(row.offsets) || row.offsets.length !== count + 1 || row.offsets[0] !== 0 || row.offsets[count] !== row.words.length ||
            !Array.isArray(row.arrivalMonoUs) || row.arrivalMonoUs.length !== count || !Array.isArray(row.dispatchable) || row.dispatchable.length !== count) throw new Error('Native ingress column capacity or shape');
        prepared = [];
        for (let index = 0; index < count; index++) {
          const start = row.offsets[index], end = row.offsets[index + 1];
          if (!safe(start) || !safe(end) || end <= start || end - start !== UMP_WORD_COUNTS[row.words[start] >>> 28] || !safe(row.arrivalMonoUs[index]) || ![0, 1].includes(row.dispatchable[index])) throw new Error('Native ingress packet boundary');
          const packet = decodeUmpPacket(row.words.slice(start, end)); if (!permitted(packet, owner)) throw new Error('Native packet exceeds input grant');
          prepared.push({ packet, sourceTimestampNs: signedTimestamp(row.sourceTimestampNs[index]), arrivalMonoUs: row.arrivalMonoUs[index], dispatchable: !!row.dispatchable[index] && packet.dispatchable });
        }
      } catch (error) { owner.nextSequence = null; loss(owner, error.message); return false; }
      if (owner.nextSequence != null && row.firstSequence !== owner.nextSequence) loss(owner, 'native-packet-sequence-gap');
      owner.nextSequence = row.firstSequence + prepared.length;
      for (let index = 0; index < prepared.length; index++) {
        if (retired || grants.get(row.grant) !== owner) break;
        const entry = prepared[index], category = entry.dispatchable ? classification(entry.packet) : 'framing-only';
        const event = Object.freeze({ event: 'native-packet', session: owner.session, grant: owner.grant, ingressEpoch: owner.epoch, sequence: row.firstSequence + index, packet: entry.packet,
          category, dispatchable: entry.dispatchable, playable: false, sourcePrecision: 'unknown', backendConversion: 'not-proven-unmodified',
          sourceTimestampNs: entry.sourceTimestampNs, sourceClockDomain: owner.timestampMode || 'backend-unqualified', arrivalMonoUs: entry.arrivalMonoUs,
          arrivalClockDomain: 'companion-steady-microseconds', observedHostMs: now() });
        received++; lastObservation = Object.freeze({ grant: owner.grant, sequence: event.sequence, category, sourceTimestampNs: event.sourceTimestampNs, sourceClockDomain: event.sourceClockDomain }); retain(event);
        if (entry.dispatchable && (category === 'control-plane' || entry.packet.kind === 'flex-data' && [1, 2].includes(entry.packet.bank) || entry.packet.kind === 'stream' && [3, 4, 18].includes(entry.packet.status))) {
          try {
            const complete = owner.collector.accept(entry.packet);
            if (complete.status === 'complete') emit({ event: 'native-payload', session: owner.session, grant: owner.grant, ingressEpoch: owner.epoch, category,
              sourceTimestampNs: event.sourceTimestampNs, arrivalMonoUs: event.arrivalMonoUs, message: Object.freeze({ ...complete, payload: Object.freeze(Array.from(complete.payload)) }), playable: false });
          } catch (error) { loss(owner, error.message); }
        }
        if (owner.epoch !== event.ingressEpoch) continue;
        if (category === 'channel-observation' && owner.claim) {
          const claim = owner.claim; if (now() > claim.deadline || ++claim.packets > claim.maximumPackets) loss(owner, 'isolated-observation-capacity-or-timeout');
          else { try { claim.consume(Object.freeze({ ...event, category: 'isolated-state-observation', observationToken: claim.token })); } catch { loss(owner, 'isolated-observation-consumer-failed'); } }
        } else emit(event);
      }
      return true;
    },
    claimObservations(grant, { token, consume, quiescent, timeoutMs = 2000, maximumPackets = 1024 }) {
      const owner = grants.get(grant);
      if (!owner || owner.claim || quiescent !== true || typeof token !== 'string' || !token || token.length > 128 || typeof consume !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000 || !Number.isSafeInteger(maximumPackets) || maximumPackets < 1 || maximumPackets > 4096) throw new Error('An explicit quiescent observation scope is required');
      owner.claim = { token, consume, deadline: now() + timeoutMs, maximumPackets, packets: 0 }; return Object.freeze({ grant, session: owner.session, ingressEpoch: owner.epoch, token });
    },
    releaseObservations(scope) { const owner = grants.get(scope?.grant); if (!owner || owner.session !== scope.session || owner.epoch !== scope.ingressEpoch || owner.claim?.token !== scope.token) return false; owner.claim = null; return true; },
    poll() {
      for (const owner of grants.values()) {
        if (owner.claim && now() > owner.claim.deadline) loss(owner, 'isolated-observation-timeout');
        if (owner.collector.sweep()) loss(owner, 'multipart-input-timeout');
      }
    },
    subscribe(listener) { if (retired || typeof listener !== 'function' || listeners.size >= 16) throw new Error('Native input listener capacity'); listeners.add(listener); return () => listeners.delete(listener); },
    state: () => Object.freeze({ grants: grants.size, receivedPackets: received, losses, traceWords, omittedRecords: omitted, lastObservation }),
    trace: () => Object.freeze({ schema: 'lemmings-native-input-trace/v1', sourcePrecision: 'unknown', timeMapping: 'original-native-domains-unmapped-to-score', omittedRecords: omitted, records: Object.freeze([...history]) }),
    dispose() { if (retired) return; retired = true; for (const owner of grants.values()) loss(owner, 'native-input-owner-retired'); grants.clear(); listeners.clear(); history.length = traceWords = 0; }
  });
}
