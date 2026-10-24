import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

const MAX_BYTES = 16 * 1048576, COPY_SAMPLES = 16384;
const integer = (value, low, high) => Number.isSafeInteger(value) && value >= low && value <= high;
const fail = message => Object.assign(new Error(message), { name: 'OwnedPcmError' });
const defaultDigest = async data => [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', data))].map(value => value.toString(16).padStart(2, '0')).join('');
const defaultYield = () => new Promise(resolve => setTimeout(resolve, 0));
const monotonicNow = () => globalThis.performance.now();
const releaseKnown = resource => { if (resource && resource.release() !== true) throw fail('PCM reservation release was not acknowledged.'); };
const copyPlanes = async (source, destination, check, yieldTask) => {
  let peak = 0;
  for (let channel = 0; channel < source.length; channel++) for (let first = 0; first < source[channel].length; first += COPY_SAMPLES) {
    check(); const end = Math.min(source[channel].length, first + COPY_SAMPLES);
    for (let frame = first; frame < end; frame++) {
      const value = source[channel][frame], magnitude = Math.abs(value); if (!Number.isFinite(value) || magnitude > 16) throw fail('PCM contains nonfinite or out-of-profile samples.');
      peak = Math.max(peak, magnitude); destination[channel][frame] = value;
    }
    if (end < source[channel].length || channel + 1 < source.length) { await yieldTask(); check(); }
  }
  return peak;
};

export async function prepareOwnedPcmBank(pin, { resources, owner, generation = 0, signal, isCurrent = () => true,
  maxBytes = MAX_BYTES, maxPrepareMs = 15000, now = monotonicNow, yieldTask = defaultYield, digest = defaultDigest } = {}) {
  if (!resources?.reserve || typeof owner !== 'string' || !owner || !integer(generation, 0, Number.MAX_SAFE_INTEGER) || !integer(maxBytes, 4, MAX_BYTES) ||
      !integer(maxPrepareMs, 1, 60000) || typeof now !== 'function' || typeof yieldTask !== 'function' || typeof digest !== 'function' || typeof isCurrent !== 'function') throw fail('Invalid PCM preparation owner.');
  const started = now(); if (!Number.isFinite(started)) throw fail('PCM preparation clock is unavailable.'); let previousTime = started;
  const check = () => {
    signal?.throwIfAborted(); if (!isCurrent()) throw fail('PCM preparation source changed.');
    const time = now(); if (!Number.isFinite(time) || time < previousTime) throw fail('PCM preparation clock is invalid.'); previousTime = time;
    if (time - started >= maxPrepareMs) throw fail('PCM preparation deadline exceeded.');
  };
  check();
  if (!pin?.isActive?.() || typeof pin.retain !== 'function' || !/^[a-f0-9]{64}$/.test(pin.ref?.contentHash) || pin.ref.kind !== 'sample') throw fail('PCM preparation requires an active decoded sample pin.');
  let retained = null, storage = null, workspace = null, data = null, pendingDigest = null, decodedRetirement = null;
  const releaseDecoded = () => {
    if (!retained) return decodedRetirement;
    return decodedRetirement ||= createProcgenRetirementScope().retire([{ name: 'decoded-pin', run: () => {
      if (retained.release() !== true) throw fail('Decoded PCM pin release was not acknowledged.'); retained = null;
    } }]);
  };
  try {
    const buffer = pin.buffer, channels = buffer?.numberOfChannels, frames = buffer?.length, rate = buffer?.sampleRate;
    if (!integer(channels, 1, 2) || !integer(frames, 1, Math.floor(maxBytes / (channels * 4))) || !integer(rate, 8000, 192000) ||
        pin.variant?.contentHash !== pin.ref.contentHash || pin.variant?.frames !== frames || pin.variant?.channels !== channels || pin.variant?.targetSampleRate !== rate ||
        typeof pin.variant?.decoderVersion !== 'string' || !pin.variant.decoderVersion || pin.variant.decoderVersion.length > 128 ||
        !integer(pin.ref.frames, 1, 8000000) || !integer(pin.ref.sourceSampleRate, 8000, 192000)) throw fail('Unsupported PCM bank format or source metadata.');
    if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) throw fail('This PCM bank profile requires a little-endian host.');
    const bytes = channels * frames * 4;
    storage = resources.reserve({ kind: 'owned-pcm-bank', owner, generation, bytes, estimateBytes: 4096, consumerOwned: true });
    workspace = resources.reserve({ kind: 'pcm-digest-workspace', owner, generation, estimateBytes: bytes + 16384, consumerOwned: true });
    check(); retained = pin.retain({ owner, generation });
    if (!retained?.isActive?.() || typeof retained.release !== 'function' || retained.buffer !== buffer) throw fail('Decoded PCM ownership changed.');
    const inputs = [];
    for (let channel = 0; channel < channels; channel++) {
      const samples = buffer.getChannelData(channel); if (!(samples instanceof Float32Array) || samples.length !== frames) throw fail('Decoded channel length changed.'); inputs.push(samples);
    }
    check(); data = new ArrayBuffer(bytes); const planes = Array.from({ length: channels }, (_, channel) => new Float32Array(data, channel * frames * 4, frames));
    const peak = await copyPlanes(inputs, planes, () => { check(); if (!retained.isActive() || retained.buffer !== buffer) throw fail('Decoded PCM source retired during copy.'); }, yieldTask);
    check(); pendingDigest = Promise.resolve(digest(new Uint8Array(data))); const pcmHash = await pendingDigest; check();
    if (!/^[a-f0-9]{64}$/.test(pcmHash)) throw fail('PCM digest is invalid.');
    if (pin.variant.pcmHash != null && pcmHash !== pin.variant.pcmHash) throw fail('Decoded PCM differs from its verified source variant.');
    const metadata = { schema: 'lemmings-owned-pcm-bank/v1', assetHash: pin.ref.contentHash, pcmHash, format: 'float32-planar-le',
      sourceFrames: pin.ref.frames, sourceSampleRate: pin.ref.sourceSampleRate, frames, sampleRate: rate, channels, bytes, decoderVersion: pin.variant.decoderVersion,
      peak, sampleMagnitudeLimit: 16, evidence: 'copied-decoded-pcm-not-acoustic-qualification' };
    check(); pendingDigest = Promise.resolve(digest(new TextEncoder().encode(JSON.stringify(metadata)))); const bankHash = await pendingDigest; check();
    if (!/^[a-f0-9]{64}$/.test(bankHash)) throw fail('PCM bank identity digest is invalid.');
    const sourceRetirement = createProcgenRetirementScope().retire([{ name: 'decoded-pin', run: releaseDecoded },
      { name: 'digest-workspace', run: () => { releaseKnown(workspace); workspace = null; } }]);
    await sourceRetirement.completion;
    if (sourceRetirement.outcome !== 'complete') throw Object.assign(fail('PCM source retirement is unresolved.'), { retirement: sourceRetirement });
    const descriptor = Object.freeze({ ...metadata, bankHash });
    const bank = createBank(descriptor, data, storage, { resources, owner, generation, yieldTask, now }); data = null; storage = null; return bank;
  } catch (error) {
    const cleanup = createProcgenRetirementScope().retire([{ name: 'digest-completion', run: () => pendingDigest?.catch(() => {}) },
      { name: 'decoded-pin', run: releaseDecoded },
      { name: 'digest-workspace', run: async () => { await pendingDigest?.catch(() => {}); releaseKnown(workspace); workspace = null; } },
      { name: 'pcm-bank', run: async () => { await pendingDigest?.catch(() => {}); releaseKnown(storage); storage = null; data = null; } }]);
    await cleanup.completion; const failure = error instanceof Error ? error : fail(String(error ?? 'PCM preparation failed.'));
    if (cleanup.outcome !== 'complete') failure.retirement = cleanup; throw failure;
  }
}

function createBank(descriptor, initialData, resource, { resources, owner, generation, yieldTask, now }) {
  let data = initialData, discarded = false, acknowledge;
  initialData = null;
  const readers = new Set(), retirement = createProcgenRetirementScope(), quiescent = new Promise(resolve => { acknowledge = resolve; });
  const settle = () => { if (discarded && !readers.size) acknowledge(); };
  return Object.freeze({ descriptor,
    state: () => Object.freeze({ retained: data !== null, discarded, readers: readers.size, retirement: retirement.getReceipt()?.outcome || null }),
    async copyForProcessor({ signal, isCurrent = () => true, maxCopyMs = 15000 } = {}) {
      if (discarded || !data || readers.size >= 2 || typeof isCurrent !== 'function' || !integer(maxCopyMs, 1, 60000)) throw fail('PCM bank copy is unavailable.');
      const controller = new AbortController(), cancel = () => controller.abort(signal.reason), started = now(); let previousTime = started;
      if (!Number.isFinite(started)) throw fail('PCM processor copy clock is unavailable.');
      const check = () => {
        signal?.throwIfAborted(); controller.signal.throwIfAborted();
        const time = now(); if (!Number.isFinite(time) || time < previousTime || time - started >= maxCopyMs) throw fail('PCM processor copy deadline exceeded.'); previousTime = time;
        if (discarded || !data || !isCurrent()) throw fail('PCM processor source changed.');
      };
      check(); const copyResource = resources.reserve({ kind: 'pcm-processor-input', owner, generation, bytes: descriptor.bytes, estimateBytes: 2048, consumerOwned: true });
      const record = { controller, ready: false }, close = createProcgenRetirementScope(); let payload = null;
      readers.add(record); signal?.addEventListener('abort', cancel, { once: true });
      const release = () => close.retire([{ name: 'processor-input', run: () => {
        releaseKnown(copyResource); payload = null; readers.delete(record); signal?.removeEventListener('abort', cancel); settle();
      } }]);
      try {
        const copied = new ArrayBuffer(descriptor.bytes), inputs = [], outputs = [];
        for (let channel = 0; channel < descriptor.channels; channel++) {
          inputs.push(new Float32Array(data, channel * descriptor.frames * 4, descriptor.frames)); outputs.push(new Float32Array(copied, channel * descriptor.frames * 4, descriptor.frames));
        }
        await copyPlanes(inputs, outputs, check, yieldTask); check(); payload = Object.freeze({ descriptor, planes: Object.freeze(outputs) }); record.ready = true;
        return Object.freeze({ get payload() { signal?.throwIfAborted(); controller.signal.throwIfAborted(); if (!payload) throw fail('PCM processor input retired.'); return payload; }, release, descriptor });
      } catch (error) { const receipt = release(); await receipt.completion; const failure = error instanceof Error ? error : fail(String(error ?? 'PCM processor copy failed.'));
        if (receipt.outcome !== 'complete') failure.retirement = receipt; throw failure; }
    },
    discard() {
      if (retirement.getReceipt()) return retirement.getReceipt(); discarded = true;
      for (const record of readers) if (!record.ready) record.controller.abort(fail('PCM bank retired during processor preparation.'));
      settle(); return retirement.retire([{ name: 'pcm-bank-readers', run: async () => { await quiescent; releaseKnown(resource); data = null; } }]);
    }
  });
}
