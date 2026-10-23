const MAX_BYTES = 512 * 1024 * 1024;
const KERNEL_TYPED_BYTES = 512 * 18 * 8 + 64 * 28 * 8 + 64 + 2048 * 6 * 8 + 64 * 6 * 8 + 8 * 4 +
  64 * 16 * 8 + 64 * 4 + 2 * 32 * 20 * 8;
const NATIVE_VOICE_ESTIMATE = 16 * 1024, WORKLET_HOST_ESTIMATE = 128 * 1024;

// This adapter reserves declared storage before its caller allocates. Browser
// node/host overhead remains an explicit estimate, separate from Float32 PCM.
export function createAudioResourceLeases({ resourceBudget = null, ownerPrefix = 'audio', maxReservations = 512 } = {}) {
  if (resourceBudget != null && (typeof resourceBudget.reserve !== 'function' || typeof resourceBudget.release !== 'function') ||
      typeof ownerPrefix !== 'string' || !ownerPrefix || !Number.isSafeInteger(maxReservations) || maxReservations < 1 || maxReservations > 65536) throw new TypeError('Invalid audio resource budget adapter.');
  const leases = new Map();
  let disposed = false, exactBytes = 0, estimatedBytes = 0, peakDeclaredBytes = 0, denials = 0;
  const reserve = ({ kind, owner = null, generation = 0, bytes = 0, estimateBytes = 0 } = {}) => {
    if (disposed) throw new Error('Audio resource owner is disposed.');
    if (typeof kind !== 'string' || !kind || !Number.isSafeInteger(generation) || generation < 0 ||
        !Number.isSafeInteger(bytes) || bytes < 0 || !Number.isSafeInteger(estimateBytes) || estimateBytes < 0 ||
        bytes + estimateBytes > MAX_BYTES || leases.size >= maxReservations) throw new RangeError('Invalid or excessive audio reservation.');
    const token = {}, budgetOwner = ownerPrefix + ':' + (owner ?? 'default');
    let receipt = null;
    try { receipt = resourceBudget?.reserve({ token, owner: budgetOwner, generation, category: 'audio', kind,
      bytes: bytes + estimateBytes, pinned: true, cache: false, reloadable: false }) || null; }
    catch (error) { denials++; throw error; }
    const lease = { owner, budgetOwner, bytes, estimateBytes, receipt, released: false };
    leases.set(token, lease); exactBytes += bytes; estimatedBytes += estimateBytes;
    peakDeclaredBytes = Math.max(peakDeclaredBytes, exactBytes + estimatedBytes);
    const release = () => {
      if (lease.released) return false;
      lease.released = true; leases.delete(token); exactBytes -= bytes; estimatedBytes -= estimateBytes;
      resourceBudget?.release({ token, owner: budgetOwner }); return true;
    };
    lease.release = release;
    const shrink = nextBytes => {
      if (lease.released || disposed || !Number.isSafeInteger(nextBytes) || nextBytes < 0 || nextBytes > bytes) throw new RangeError('Invalid audio reservation reconciliation.');
      const next = resourceBudget?.reserve({ token, owner: budgetOwner, generation, category: 'audio', kind,
        previousBytes: bytes + estimateBytes, bytes: nextBytes + estimateBytes, pinned: true, cache: false, reloadable: false }) || null;
      exactBytes += nextBytes - bytes; bytes = nextBytes; lease.bytes = bytes; receipt = next; return true;
    };
    return Object.freeze({ release, shrink, isActive: () => !lease.released && !disposed,
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
  const releaseOwner = owner => { let count = 0; for (const lease of leases.values()) if (lease.owner === owner) { lease.release(); count++; } return count; };
  const diagnostics = () => Object.freeze({ enabled: !!resourceBudget, reservations: leases.size, exactBytes, estimatedBytes,
    peakDeclaredBytes, denials, maxReservations, browserResidentBytes: null, evidenceClass: 'declared-storage-and-native-estimates' });
  const dispose = () => { if (disposed) return; for (const lease of leases.values()) lease.release(); disposed = true; };
  return { reserve, reserveDecodedBuffer, releaseOwner, diagnostics, dispose,
    reserveNativeVoice: (owner, generation = 0) => reserve({ kind: 'native-voice', owner, generation, estimateBytes: NATIVE_VOICE_ESTIMATE }),
    reserveWorkletVoice: (owner, generation = 0) => reserve({ kind: 'worklet-voice-host', owner, generation, estimateBytes: 1536 }),
    reserveWorkletRuntime: (owner, generation = 0) => reserve({ kind: 'worklet-runtime', owner, generation,
      bytes: KERNEL_TYPED_BYTES, estimateBytes: WORKLET_HOST_ESTIMATE }) };
}

export { KERNEL_TYPED_BYTES, NATIVE_VOICE_ESTIMATE, WORKLET_HOST_ESTIMATE };
