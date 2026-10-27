import { createOwnedResourceReservation } from '../../resources/OwnedResourceReservation.js';

let nextOwner = 0;
const bounds = { sustain: [0, 127], bend: [-8192, 8191], pressure: [0, 127] };
export function createMidiParameterEvidence({ resourceBudget = null, maximumEntries = 64 } = {}) {
  if (!Number.isInteger(maximumEntries) || maximumEntries < 1 || maximumEntries > 256) throw new RangeError('Invalid MIDI parameter evidence bound.');
  const records = new Map(), owner = 'midi-parameter-evidence-' + (++nextOwner);
  let reservation = null, sequence = 0, disposed = false, evicted = 0;
  const valid = target => target && typeof target.key === 'string' && target.key.length > 0 && target.key.length <= 1024 && Object.hasOwn(bounds, target.parameter);
  const unknown = target => Object.freeze({ targetKey: target?.key || null, parameter: target?.parameter || null, requestedValue: null,
    submittedValue: null, receiverValue: null, delivery: 'unknown', revision: 0, requestedAt: null, submittedAt: null });
  const read = target => {
    const current = !disposed && valid(target) && records.get(target.key);
    return current && current.parameter === target.parameter ? current : unknown(target);
  };
  return Object.freeze({ read,
    request(target, value, timestamp) {
      if (disposed || !valid(target)) throw new Error('The MIDI expression target is unavailable.');
      const [minimum, maximum] = bounds[target.parameter];
      if (!Number.isInteger(value) || value < minimum || value > maximum || !Number.isFinite(timestamp) || timestamp < 0) throw new RangeError('Invalid MIDI parameter request.');
      if (records.has(target.key) && records.get(target.key).parameter !== target.parameter) throw new Error('MIDI parameter target identity collision.');
      if (!Number.isSafeInteger(sequence + 1)) throw new Error('MIDI parameter evidence revision exhausted.');
      reservation ||= createOwnedResourceReservation({ budget: resourceBudget, owner, kind: 'midi-parameter-evidence', category: 'checkpoint',
        bytes: maximumEntries * 4096, maxBytes: maximumEntries * 4096 });
      const previous = records.get(target.key), revision = ++sequence;
      const valueState = Object.freeze({ targetKey: target.key, parameter: target.parameter, requestedValue: value,
        submittedValue: previous?.submittedValue ?? null, receiverValue: null, delivery: 'requested', revision, requestedAt: timestamp, submittedAt: previous?.submittedAt ?? null });
      records.delete(target.key);
      if (records.size >= maximumEntries) { records.delete(records.keys().next().value); evicted++; }
      records.set(target.key, valueState); return Object.freeze({ targetKey: target.key, revision });
    },
    settle(ticket, submitted, timestamp) {
      const current = !disposed && records.get(ticket?.targetKey);
      if (!current || current.revision !== ticket.revision) return false;
      if (typeof submitted !== 'boolean' || !Number.isFinite(timestamp) || timestamp < current.requestedAt) throw new RangeError('Invalid MIDI submission evidence.');
      records.set(ticket.targetKey, Object.freeze({ ...current, delivery: submitted ? 'submitted' : 'unconfirmed',
        submittedValue: submitted ? current.requestedValue : current.submittedValue, submittedAt: submitted ? timestamp : current.submittedAt })); return true;
    },
    diagnostics: () => Object.freeze({ entries: records.size, maximumEntries, evicted, disposed, reservation: reservation?.receipt() || null }),
    dispose() {
      if (disposed) { const receipt = reservation?.receipt(); if (receipt && receipt.state !== 'released') throw new Error('MIDI evidence reservation retirement remains unconfirmed.'); return receipt; }
      disposed = true; records.clear(); return reservation?.release() || null;
    }
  });
}
