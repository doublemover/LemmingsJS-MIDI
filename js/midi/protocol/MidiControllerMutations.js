import { decodeUmpPacket } from './UmpPacketCodec.js';

const UINT32_MAX = 0xffffffff;
const uint = (value, maximum) => Number.isSafeInteger(value) && value >= 0 && value <= maximum;
const refused = reason => Object.freeze({ ok: false, reason });
const addressKey = address => {
  if (!address || typeof address.endpointId !== 'string' || !address.endpointId || address.endpointId.length > 256 ||
      !uint(address.connectionEpoch, Number.MAX_SAFE_INTEGER) || !uint(address.group, 15) || !Number.isInteger(address.channel) || address.channel < 1 || address.channel > 16 ||
      !['registered', 'assignable'].includes(address.kind) || !uint(address.bank, 127) || !uint(address.index, 127)) throw new RangeError('Invalid controller address.');
  return JSON.stringify([address.endpointId, address.connectionEpoch, address.group, address.channel, address.kind, address.bank, address.index]);
};
const descriptorOf = descriptor => {
  const { significantBits, absolute, relative, minimumRaw = 0, maximumRaw = UINT32_MAX, step = 1, quantization = 'floor', enumValues = null } = descriptor || {};
  const maximum = 2 ** significantBits - 1;
  if (!Number.isInteger(significantBits) || significantBits < 1 || significantBits > 32 || typeof absolute !== 'boolean' || typeof relative !== 'boolean' ||
      !uint(minimumRaw, UINT32_MAX) || !uint(maximumRaw, UINT32_MAX) || maximumRaw < minimumRaw || !Number.isInteger(step) || step < 1 || step > maximum ||
      !['floor', 'nearest'].includes(quantization) || enumValues !== null && (!Array.isArray(enumValues) || !enumValues.length || enumValues.length > 128 ||
        Array.from(enumValues).some((value, index) => !uint(value, maximum) || index && value <= enumValues[index - 1]))) throw new RangeError('Invalid controller descriptor.');
  return Object.freeze({ significantBits, absolute, relative, minimumRaw, maximumRaw, step, quantization, enumValues: enumValues ? Object.freeze([...enumValues]) : null });
};
const resolvedValue = (raw, descriptor) => {
  const divisor = 2 ** (32 - descriptor.significantBits), maximum = 2 ** descriptor.significantBits - 1, value = raw / divisor;
  let parameterValue = Math.min(maximum, (descriptor.quantization === 'nearest' ? Math.round(value / descriptor.step) : Math.floor(value / descriptor.step)) * descriptor.step);
  if (descriptor.enumValues) {
    parameterValue = descriptor.enumValues[0];
    for (const candidate of descriptor.enumValues) {
      if (descriptor.quantization === 'floor' ? candidate <= value : Math.abs(candidate - value) < Math.abs(parameterValue - value)) parameterValue = candidate;
    }
  }
  return { parameterValue, rawRemainder: raw - parameterValue * divisor };
};

export function createMidiControllerMutations({ maximumEntries = 256 } = {}) {
  if (!Number.isInteger(maximumEntries) || maximumEntries < 1 || maximumEntries > 1024) throw new RangeError('Invalid controller-state capacity.');
  const entries = new Map(), tickets = new WeakMap(); let revision = 0, disposed = false, rejected = 0;
  const reject = reason => { rejected++; return refused(reason); };
  const read = address => {
    const key = addressKey(address), current = !disposed && entries.get(key);
    return current ? Object.freeze({ known: true, revision: current.revision, rawValue: current.rawValue, ...resolvedValue(current.rawValue, current.descriptor),
      authority: current.authority, sourceRef: current.sourceRef, receiverValue: null, sequence: current.sequence, timestamp: current.timestamp }) : Object.freeze({ known: false, rawValue: null, receiverValue: null, revision: null });
  };
  return Object.freeze({ read,
    bind({ address, descriptor, rawValue, authority, sourceRef, expectedRevision = null }) {
      const key = addressKey(address), current = entries.get(key), normalized = descriptorOf(descriptor);
      if (disposed) return reject('controller-owner-disposed');
      if (!['local-authored', 'device-report'].includes(authority) || typeof sourceRef !== 'string' || !sourceRef || sourceRef.length > 256 ||
          !uint(rawValue, UINT32_MAX) || rawValue < normalized.minimumRaw || rawValue > normalized.maximumRaw) throw new RangeError('A controller baseline requires explicit authoritative provenance and a valid raw value.');
      if ((current?.revision ?? null) !== expectedRevision) return reject('stale-controller-baseline');
      if (!current && entries.size >= maximumEntries) return reject('controller-state-capacity');
      if (!uint(revision + 1, Number.MAX_SAFE_INTEGER)) return reject('controller-revision-exhausted');
      const { endpointId, connectionEpoch, group, channel, kind, bank, index } = address;
      entries.set(key, { address: Object.freeze({ endpointId, connectionEpoch, group, channel, kind, bank, index }), descriptor: normalized, rawValue, authority, sourceRef, revision: ++revision,
        sequence: current?.sequence ?? 0, timestamp: current?.timestamp ?? 0 });
      return Object.freeze({ ok: true, ...read(address) });
    },
    prepare(words, { endpointId, connectionEpoch, sequence, timestamp = 0, baselineRevision = null } = {}) {
      if (disposed) return reject('controller-owner-disposed');
      let packet;
      try { packet = decodeUmpPacket(words, { preserveUnknown: false }); } catch { return reject('invalid-controller-packet'); }
      const relative = ['relativeRegisteredController', 'relativeAssignableController'].includes(packet.status);
      if (!relative && !['registeredController', 'assignableController'].includes(packet.status)) return reject('not-a-controller-mutation');
      const address = { endpointId, connectionEpoch, group: packet.group, channel: packet.channel + 1, kind: ['registeredController', 'relativeRegisteredController'].includes(packet.status) ? 'registered' : 'assignable', bank: packet.bank, index: packet.index };
      let key; try { key = addressKey(address); } catch { return reject('invalid-controller-address'); }
      const current = entries.get(key);
      if (!current) return reject('unknown-controller-baseline');
      if (!(relative ? current.descriptor.relative : current.descriptor.absolute)) return reject('controller-operation-unsupported');
      if (baselineRevision != null && baselineRevision !== current.revision) return reject('stale-controller-baseline');
      sequence ??= current.sequence + 1;
      if (!uint(sequence, Number.MAX_SAFE_INTEGER) || sequence <= current.sequence || !Number.isFinite(timestamp) || timestamp < current.timestamp) return reject('out-of-order-controller-mutation');
      if (!uint(revision + 1, Number.MAX_SAFE_INTEGER)) return reject('controller-revision-exhausted');
      const rawValue = Math.min(current.descriptor.maximumRaw, Math.max(current.descriptor.minimumRaw, relative ? current.rawValue + packet.controllerValue.value : packet.controllerValue.value));
      const absoluteWords = Object.freeze([relative ? (packet.words[0] & ~0x00f00000 | (address.kind === 'registered' ? 2 : 3) << 20) >>> 0 : packet.words[0], rawValue]);
      const plan = Object.freeze({ ok: true, operation: 'set', rawValue, ...resolvedValue(rawValue, current.descriptor), absoluteWords,
        rawGestureWords: relative ? packet.words : null, sourceOperation: relative ? 'relative' : 'set', baselineRevision: current.revision, sequence, timestamp,
        address: Object.freeze(address), receiverValue: null, authority: current.authority, sourceRef: current.sourceRef });
      tickets.set(plan, { key, current }); return plan;
    },
    commit(plan) {
      const ticket = plan && tickets.get(plan); if (!ticket) return reject('unknown-controller-mutation'); tickets.delete(plan);
      if (disposed || entries.get(ticket.key) !== ticket.current || !uint(revision + 1, Number.MAX_SAFE_INTEGER)) return reject('stale-controller-mutation');
      entries.set(ticket.key, { ...ticket.current, rawValue: plan.rawValue, revision: ++revision, sequence: plan.sequence, timestamp: plan.timestamp });
      return Object.freeze({ ok: true, operation: 'set', ...read(plan.address), absoluteWords: plan.absoluteWords, rawGestureWords: plan.rawGestureWords });
    },
    invalidate(address) { return entries.delete(addressKey(address)); },
    invalidateEndpoint(endpointId) { let removed = 0; for (const [key, value] of entries) if (value.address.endpointId === endpointId) { entries.delete(key); removed++; } return removed; },
    clear() { entries.clear(); },
    diagnostics: () => Object.freeze({ entries: entries.size, maximumEntries, revision, rejected, disposed }),
    dispose() { disposed = true; entries.clear(); }
  });
}
