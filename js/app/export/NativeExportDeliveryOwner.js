const CAPACITY = 16, owners = new Set();
const errorFor = error => error instanceof Error ? error : new Error(String(error));

export const nativeExportDeliveryDiagnostics = () => Object.freeze({ activeOwners: owners.size, capacity: CAPACITY,
  pendingCalls: [...owners].reduce((sum, owner) => sum + owner.pending.size, 0),
  unknownRetirement: [...owners].filter(owner => owner.cleanup && !owner.released).length });

export function acquireNativeExportDeliveryOwner() {
  if (owners.size >= CAPACITY) return null;
  const owner = { pending: new Set(), cleanup: false, lease: null, writer: null, terminal: null, releaseAttempted: false, releaseError: null, error: null, released: false };
  owners.add(owner);
  const retire = () => {
    if (!owner.cleanup || owner.pending.size || owner.released || owner.writer && !owner.terminal || owner.releaseAttempted) return;
    owner.releaseAttempted = true;
    const acknowledge = () => { owner.lease = null; owner.writer = null; owner.released = true; owners.delete(owner); };
    try { const ack = owner.lease?.release();
      if (ack === false || ack && typeof ack.then === 'function') {
        if (ack?.then) Promise.resolve(ack).catch(() => {});
        throw new Error('Native export source release was not acknowledged synchronously.');
      }
      const sourceState = owner.lease?.releaseState?.();
      if (sourceState && sourceState !== 'released') {
        if (sourceState === 'failed-or-unknown' || !owner.lease.settlement?.then) throw new Error('Native export source retirement is unresolved.');
        const settlement = owner.lease.settlement; owner.pending.add(settlement);
        const fail = error => { owner.pending.delete(settlement); owner.releaseError = errorFor(error); };
        settlement.then(() => { try {
          if (owner.lease.releaseState() !== 'released') throw new Error('Native export source completion did not confirm retirement.');
          owner.pending.delete(settlement); acknowledge();
        } catch (error) { fail(error); } }, fail);
      } else acknowledge();
    } catch (error) { owner.releaseError = errorFor(error); }
  };
  const track = (work, { terminal = null } = {}) => {
    if (owner.released || typeof work !== 'function' || terminal != null && !['closed', 'aborted'].includes(terminal)) throw new TypeError('Invalid native export operation.');
    const promise = Promise.resolve().then(work).then(value => {
      if (terminal) {
        if (value === false) throw new Error('Native writable did not acknowledge ' + terminal + '.');
        if (terminal === 'closed' || !owner.terminal) owner.terminal = terminal;
      }
      return value;
    });
    owner.pending.add(promise);
    promise.then(() => { owner.pending.delete(promise); retire(); }, error => { owner.error = errorFor(error); owner.pending.delete(promise); retire(); });
    return promise;
  };
  return Object.freeze({ track,
    attachLease(lease) { if (owner.lease || owner.cleanup || !lease?.release) throw new TypeError('Invalid native export source lease.'); owner.lease = lease; },
    acquireWriter(writer) { if (!writer || typeof writer !== 'object' || owner.writer && owner.writer !== writer || owner.released) throw new TypeError('Invalid native writable ownership.'); owner.writer = writer; },
    unknown(error) { owner.error = errorFor(error); },
    close() { owner.cleanup = true; retire(); },
    inspect: () => Object.freeze({ state: owner.releaseError ? 'source-retirement-failed' : owner.released ? 'released' : owner.cleanup ?
      owner.pending.size ? 'pending-native-settlement' : owner.writer && !owner.terminal ? 'native-retirement-unknown' : 'retiring' : 'active',
    pendingCalls: owner.pending.size, terminal: owner.terminal, sourceLeaseHeld: !!owner.lease, error: owner.releaseError ? 'source-release-failed' : owner.error ? 'native-operation-failed' : null })
  });
}
