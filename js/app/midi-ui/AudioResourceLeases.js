import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

const MAX_BYTES = 512 * 1024 * 1024;
const KERNEL_TYPED_BYTES = 512 * 18 * 8 + 64 * 28 * 8 + 64 * 6 * 8 + 64 + 2048 * 6 * 8 + 64 * 6 * 8 + 8 * 4 +
  64 * 7 * 8 + 16 * 8 + 64 * 16 * 8 + 64 * 4 + 2 * 32 * 20 * 8 + 2 * 32 * 8;
const NATIVE_VOICE_ESTIMATE = 16 * 1024, WORKLET_HOST_ESTIMATE = 128 * 1024;

// This adapter reserves declared storage before its caller allocates. Browser
// node/host overhead remains an explicit estimate, separate from Float32 PCM.
export function createAudioResourceLeases({ resourceBudget = null, ownerPrefix = 'audio', maxReservations = 512 } = {}) {
  if (resourceBudget != null && (typeof resourceBudget.reserve !== 'function' || typeof resourceBudget.release !== 'function') ||
      typeof ownerPrefix !== 'string' || !ownerPrefix || !Number.isSafeInteger(maxReservations) || maxReservations < 1 || maxReservations > 65536) throw new TypeError('Invalid audio resource budget adapter.');
  const leases = new Map();
  const retirement = createProcgenRetirementScope();
  let disposed = false, exactBytes = 0, estimatedBytes = 0, peakDeclaredBytes = 0, denials = 0;
  const reserve = ({ kind, owner = null, generation = 0, bytes = 0, estimateBytes = 0, consumerOwned = false } = {}) => {
    if (disposed) throw new Error('Audio resource owner is disposed.');
    if (typeof kind !== 'string' || !kind || !Number.isSafeInteger(generation) || generation < 0 ||
        !Number.isSafeInteger(bytes) || bytes < 0 || !Number.isSafeInteger(estimateBytes) || estimateBytes < 0 ||
        bytes + estimateBytes > MAX_BYTES || leases.size >= maxReservations || typeof consumerOwned !== 'boolean') throw new RangeError('Invalid or excessive audio reservation.');
    const token = {}, budgetOwner = ownerPrefix + ':' + (owner ?? 'default');
    let receipt = null;
    try { receipt = resourceBudget?.reserve({ token, owner: budgetOwner, generation, category: 'audio', kind,
      bytes: bytes + estimateBytes, pinned: true, cache: false, reloadable: false }) || null; }
    catch (error) { denials++; throw error; }
    let acknowledge, rejectConsumer;
    const consumerCompletion = consumerOwned ? new Promise((resolve, reject) => { acknowledge = resolve; rejectConsumer = reject; }) : null;
    consumerCompletion?.catch(() => {});
    const lease = { owner, kind, budgetOwner, bytes, estimateBytes, receipt, consumerOwned, released: false, releaseError: null, releaseAttempted: false, blocked: null };
    lease.retire = () => {
      if (!consumerOwned) return release();
      if (lease.blocked || lease.releaseAttempted && !lease.released) throw lease.blocked || lease.releaseError;
      return consumerCompletion;
    };
    leases.set(token, lease); exactBytes += bytes; estimatedBytes += estimateBytes;
    peakDeclaredBytes = Math.max(peakDeclaredBytes, exactBytes + estimatedBytes);
    const release = () => {
      if (lease.released) return false;
      if (lease.blocked) throw lease.blocked;
      if (lease.releaseAttempted) throw lease.releaseError;
      lease.releaseAttempted = true;
      lease.releaseError = new Error('Audio reservation release is already retiring or failed.');
      try {
        const acknowledged = bytes + estimateBytes > 0 ? resourceBudget?.release({ token, owner: budgetOwner }) : true;
        if (acknowledged === false) throw new Error('Audio resource adapter did not acknowledge release.');
        if (acknowledged && typeof acknowledged.then === 'function') {
          Promise.resolve(acknowledged).catch(() => {});
          throw new Error('Audio resource adapter release must acknowledge synchronously.');
        }
      } catch (error) { lease.releaseError = error; rejectConsumer?.(error); throw error; }
      lease.released = true; lease.releaseError = null; leases.delete(token); exactBytes -= bytes; estimatedBytes -= estimateBytes;
      acknowledge?.(); return true;
    };
    lease.release = release;
    const retainUnknown = reason => {
      if (lease.released) return false;
      lease.blocked ||= reason instanceof Error ? reason : new Error('Native audio resource retirement is unknown.');
      rejectConsumer?.(lease.blocked);
      try { resourceBudget?.reserve({ token, owner: budgetOwner, generation, category: 'audio', kind,
        previousBytes: bytes + estimateBytes, bytes: bytes + estimateBytes, pinned: true, cache: false, reloadable: false, unreleased: true }); }
      catch { /* The existing reservation still covers this unknown resource. */ }
      return true;
    };
    lease.confirmRetirement = () => {
      if (!lease.blocked) return false;
      if (lease.releaseAttempted) throw lease.releaseError;
      lease.blocked = null; return release();
    };
    const shrink = nextBytes => {
      if (lease.releaseAttempted || lease.blocked || disposed || !Number.isSafeInteger(nextBytes) || nextBytes < 0 || nextBytes > bytes) throw new RangeError('Invalid audio reservation reconciliation.');
      const next = resourceBudget?.reserve({ token, owner: budgetOwner, generation, category: 'audio', kind,
        previousBytes: bytes + estimateBytes, bytes: nextBytes + estimateBytes, pinned: true, cache: false, reloadable: false }) || null;
      exactBytes += nextBytes - bytes; bytes = nextBytes; lease.bytes = bytes; receipt = next; return true;
    };
    return Object.freeze({ release, shrink, retainUnknown, isActive: () => !lease.releaseAttempted && !lease.blocked && !disposed,
      releaseState: () => lease.released ? 'released' : lease.releaseAttempted || lease.blocked ? 'failed-or-unknown' : 'reserved',
      get receipt() { return Object.freeze({ enabled: !!resourceBudget, kind, owner, generation,
        exactBytes: bytes, estimatedBytes: estimateBytes, accountedBytes: receipt?.accountedBytes ?? null }); } });
  };
  const reserveDecodedBuffer = ({ frames, channels, sampleRate = null, owner = null, generation = 0 } = {}) => {
    if (!Number.isSafeInteger(frames) || frames < 1 || !Number.isSafeInteger(channels) || channels < 1 || channels > 32 ||
        sampleRate != null && (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 384000) ||
        !Number.isSafeInteger(frames * channels * 4) || frames * channels * 4 > MAX_BYTES) throw new RangeError('Invalid decoded audio upper bound.');
    const lease = reserve({ kind: 'decoded-pcm-f32', owner, generation, bytes: frames * channels * 4 });
    const validate = buffer => {
      if (!lease.isActive()) throw new Error('Decoded audio resource lease is no longer active.');
      if (!Number.isSafeInteger(buffer?.length) || buffer.length < 1 || buffer.length > frames ||
          !Number.isSafeInteger(buffer.numberOfChannels) || buffer.numberOfChannels < 1 || buffer.numberOfChannels > channels ||
          sampleRate != null && buffer.sampleRate !== sampleRate) throw new RangeError('Decoded audio exceeds its admitted format or frame bound.');
      return true;
    };
    return Object.freeze({ ...lease, get receipt() { return lease.receipt; }, validate,
      reconcile: buffer => { validate(buffer); return lease.shrink(buffer.length * buffer.numberOfChannels * 4); }, frames, channels, sampleRate });
  };
  const retireOwner = owner => createProcgenRetirementScope().retire([...leases.values()].filter(lease => lease.owner === owner)
    .map((lease, index) => ({ name: `reservation-${index}`, run: lease.retire })));
  const releaseOwner = owner => {
    const receipt = retireOwner(owner), failed = receipt.resources.filter(resource => resource.status !== 'completed');
    if (failed.length || receipt.outcome !== 'complete') throw Object.assign(new Error('Audio owner has pending, failed or unknown reservation releases.'), { retirement: receipt });
    return receipt.resources.length;
  };
  const diagnostics = () => Object.freeze({ enabled: !!resourceBudget, reservations: leases.size, exactBytes, estimatedBytes,
    peakDeclaredBytes, denials, maxReservations, consumerOwnedReservations: [...leases.values()].filter(lease => lease.consumerOwned).length,
    unreconciledReservations: [...leases.values()].filter(lease => lease.releaseAttempted || lease.blocked).length,
    browserResidentBytes: null, evidenceClass: 'declared-storage-and-native-estimates' });
  const dispose = () => {
    disposed = true;
    return retirement.retire([...leases.values()].map((lease, index) => ({ name: `reservation-${index}`, run: lease.retire })));
  };
  const confirmClosedContext = () => createProcgenRetirementScope().retire([...leases.values()].filter(lease => lease.blocked &&
    ['native-voice', 'voice-lane-mix', 'native-source-lane-route', 'worklet-voice-host', 'worklet-runtime', 'pcm-capture-runtime', 'channel-graph', 'mix-graph', 'effects-graph', 'effect-route-arm', 'effect-host-metadata'].includes(lease.kind))
    .map((lease, index) => ({ name: 'closed-context-resource-' + index, run: lease.confirmRetirement })));
  return { reserve, reserveDecodedBuffer, releaseOwner, retireOwner, confirmClosedContext, diagnostics, dispose,
    reserveNativeVoice: (owner, generation = 0, sourceCost = 1) => {
      if (!Number.isSafeInteger(sourceCost) || sourceCost < 1 || sourceCost > 8) throw new RangeError('Invalid native source cost.');
      return reserve({ kind: 'native-voice', owner, generation, estimateBytes: NATIVE_VOICE_ESTIMATE * sourceCost });
    },
    reserveWorkletVoice: (owner, generation = 0, extraEstimateBytes = 0) => {
      if (!Number.isSafeInteger(extraEstimateBytes) || extraEstimateBytes < 0 || extraEstimateBytes > 65536) throw new RangeError('Invalid worklet voice state estimate.');
      return reserve({ kind: 'worklet-voice-host', owner, generation, estimateBytes: 1536 + extraEstimateBytes });
    },
    reserveWorkletRuntime: (owner, generation = 0, extraBytes = 0, extraEstimateBytes = 0, consumerOwned = false) => {
      if (![extraBytes, extraEstimateBytes].every(value => Number.isSafeInteger(value) && value >= 0 && value <= 32 * 1048576)) throw new RangeError('Invalid source storage inventory.');
      return reserve({ kind: 'worklet-runtime', owner, generation, bytes: KERNEL_TYPED_BYTES + extraBytes, estimateBytes: WORKLET_HOST_ESTIMATE + extraEstimateBytes, consumerOwned });
    } };
}

export function releaseAudioResourceAfterRetirement(lease, receipt) {
  const release = outcome => {
    if (outcome.outcome !== 'complete') {
      const error = Object.assign(new Error('Native audio resource retirement is incomplete.'), { retirement: outcome });
      lease?.retainUnknown?.(error); throw error;
    }
    return lease?.release();
  };
  return receipt.state === 'retired' ? release(receipt) : receipt.completion.then(release);
}

export { KERNEL_TYPED_BYTES, NATIVE_VOICE_ESTIMATE, WORKLET_HOST_ESTIMATE };
