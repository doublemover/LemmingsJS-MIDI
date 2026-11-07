import { createOwnedResourceReservation } from '../resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
import { canonicalDataText, freezeData } from '../../core/CanonicalData.js';

export const SOUND_SEED_MAX_PCM_BYTES = 15 * 1048576;
export const SOUND_SEED_MAX_METADATA_BYTES = 262144;
const FORMATS = ['lemmings-master-pcm/v1', 'lemmings-causal-audio-render/v1', 'lemmings-sound-seed/v1'];
const integer = (value, low, high = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= low && value <= high;
const fail = message => Object.assign(new Error(message), { name: 'SoundSeedSourceError', code: 'sound-seed-source-unavailable' });
const ascii = (bytes, at, text) => [...text].every((char, index) => bytes[at + index] === char.charCodeAt(0));
let serial = 0;

export function inspectOwnedSoundSeedHeader(bytes, byteLength) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 56 || !integer(byteLength, 64, 512 * 1048576)) throw fail('An owned seed source requires its exact bounded stereo Float32 WAV header.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), frames = view.getUint32(44, true), rate = view.getUint32(24, true), dataBytes = view.getUint32(52, true);
  if (!ascii(bytes, 0, 'RIFF') || view.getUint32(4, true) + 8 !== byteLength || !ascii(bytes, 8, 'WAVE') || !ascii(bytes, 12, 'fmt ') || view.getUint32(16, true) !== 16 ||
      view.getUint16(20, true) !== 3 || view.getUint16(22, true) !== 2 || !integer(rate, 8000, 192000) || view.getUint32(28, true) !== rate * 8 || view.getUint16(32, true) !== 8 || view.getUint16(34, true) !== 32 ||
      !ascii(bytes, 36, 'fact') || view.getUint32(40, true) !== 4 || !ascii(bytes, 48, 'data') || !integer(frames, 1) || dataBytes !== frames * 8 ||
      56 + dataBytes + 8 > byteLength || byteLength - 56 - dataBytes > SOUND_SEED_MAX_METADATA_BYTES + 9) throw fail('This source is not a complete owned stereo Float32 WAV with bounded origin metadata.');
  return freezeData({ sampleRate: rate, channels: 2, frames, dataOffset: 56, dataBytes, metadataOffset: 56 + dataBytes, byteLength });
}

export function inspectOwnedSoundSeedOrigin(bytes, expected) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 8 || !ascii(bytes, 0, 'lmjs')) throw fail('The seed source omitted its original render/capture manifest.');
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
  if (!integer(length, 1, SOUND_SEED_MAX_METADATA_BYTES) || bytes.length !== 8 + length + length % 2 || length % 2 && bytes[bytes.length - 1] !== 0) throw fail('The source origin annotation is truncated or oversized.');
  let origin; try { origin = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(8, 8 + length))); } catch { throw fail('The source origin annotation is invalid UTF-8/JSON.'); }
  const actual = canonicalDataText(origin, { maxBytes: SOUND_SEED_MAX_METADATA_BYTES, maxNodes: 32768 });
  if (actual.text !== canonicalDataText(expected, { maxBytes: SOUND_SEED_MAX_METADATA_BYTES, maxNodes: 32768 }).text) throw fail('The source annotation differs from the immutable selected capture/render.');
  return actual.bytes;
}

// The original artifact owns its PCM. Every analysis receives an independently
// charged window, never a pointer into the capture buffer or a second recorder.
export function createOwnedSoundSeedSource({ artifact, manifest, resourceBudget } = {}) {
  const metadata = artifact?.metadata?.(), sourceFrames = manifest?.schema === 'lemmings-master-pcm/v1' ? manifest.timelineFrames : manifest?.frames;
  if (!metadata?.retained || !FORMATS.includes(metadata.formatVersion) || metadata.formatVersion !== manifest?.schema || metadata.mediaType !== 'audio/wav' ||
      typeof metadata.artifactId !== 'string' || !metadata.artifactId || metadata.artifactId.length > 128 || typeof metadata.immutableSourceRef !== 'string' || !metadata.immutableSourceRef || metadata.immutableSourceRef.length > 8192 ||
      !integer(metadata.byteLength, 64, 512 * 1048576) || manifest?.schema === 'lemmings-master-pcm/v1' && !integer(manifest.sourceStartFrame, 0) || !integer(sourceFrames, 1) || !integer(manifest.sampleRate, 8000, 192000) || typeof artifact.borrow !== 'function' ||
      !resourceBudget?.reserve || !resourceBudget?.release) throw fail('Select an immutable completed browser-master capture or causal audio render.');
  const owner = 'sound-seed-source-' + (++serial), reservation = createOwnedResourceReservation({ budget: resourceBudget, owner, category: 'candidate', kind: 'sound-seed-source-metadata', bytes: 4096 + 4 * 1048576 });
  let expected;
  try {
    const encoded = canonicalDataText(manifest, { maxBytes: SOUND_SEED_MAX_METADATA_BYTES, maxNodes: 32768 }); expected = freezeData(JSON.parse(encoded.text));
    reservation.resize(Math.max(4096, 4096 + encoded.bytes.length * 8 + encoded.nodes * 64));
  } catch (error) {
    const receipt = createProcgenRetirementScope().retire([{ name: 'seed-source-metadata', run: () => reservation.release() }]);
    throw Object.assign(error, { retirement: receipt, sourceReservation: reservation });
  }
  const pending = new Set(), windows = new Set(), unknown = new Set(), retirement = createProcgenRetirementScope(); let disposed = false, generation = 0;
  const source = freezeData({ artifactId: metadata.artifactId, immutableSourceRef: metadata.immutableSourceRef, formatVersion: metadata.formatVersion, sourceFrames, sampleRate: manifest.sampleRate,
    originKind: expected.schema === 'lemmings-master-pcm/v1' ? 'LIVE CAPTURE' : expected.schema === 'lemmings-sound-seed/v1' ? 'FROZEN SEED' : 'OFFLINE REVOICE', sourceTap: expected.tap ?? expected.renderTap ?? (expected.schema === 'lemmings-master-pcm/v1' ? 'shared-protected-browser-master' : 'unavailable-in-selected-manifest'),
    originalFrameDomain: 'artifact-local-output-frames-at-original-artifact-rate', parentTimelineOriginFrame: expected.schema === 'lemmings-master-pcm/v1' ? expected.sourceStartFrame : expected.schema === 'lemmings-sound-seed/v1' ? 0 : integer(expected.timelineZeroSourceFrame, 0) ? expected.timelineZeroSourceFrame : null,
    sourceDigest: metadata.digestState === 'ready' ? metadata.sha256 : null, digestEvidence: metadata.digestState === 'ready' ? 'complete-original-artifact-sha256' : 'immutable-owner-reference;complete-parent-file-hash-not-computed' });
  const readWindow = ({ firstFrame, endFrame, signal: externalSignal, isCurrent = () => true, onProgress = () => {} } = {}) => {
    externalSignal?.throwIfAborted();
    if (disposed || pending.size || windows.size >= 2 || !integer(firstFrame, 0, sourceFrames - 1) || !integer(endFrame, firstFrame + 1, sourceFrames) ||
        (endFrame - firstFrame) * 8 > SOUND_SEED_MAX_PCM_BYTES || typeof isCurrent !== 'function' || typeof onProgress !== 'function') return Promise.reject(fail('The selected seed range is empty, oversized or has unresolved readers.'));
    const operation = { controller: new AbortController(), generation: ++generation, promise: null }, signal = operation.controller.signal;
    const check = () => { signal.throwIfAborted(); if (disposed || !isCurrent()) throw fail('The sound-seed draft or source generation changed.'); };
    const cancel = () => operation.controller.abort(externalSignal.reason); externalSignal?.addEventListener('abort', cancel, { once: true });
    operation.promise = (async () => {
      let loan = null, memory = null, published = false, header = null, pcm = null, suffix = null;
      try {
        check(); loan = artifact.borrow();
        memory = createOwnedResourceReservation({ budget: resourceBudget, owner, category: 'candidate', kind: 'sound-seed-source-window', bytes: (endFrame - firstFrame) * 8 + 8 * SOUND_SEED_MAX_METADATA_BYTES + 4 * 1048576 });
        const acceptHeader = (bytes, allocate = true) => {
          header = inspectOwnedSoundSeedHeader(bytes, metadata.byteLength);
          if (header.frames !== sourceFrames || header.sampleRate !== expected.sampleRate) throw fail('The source frame/rate inventory differs from its admitted manifest.');
          if (allocate) pcm = new Uint8Array((endFrame - firstFrame) * 8); suffix = new Uint8Array(header.byteLength - header.metadataOffset);
        };
        if (loan.blob) {
          const blob = loan.blob; acceptHeader(new Uint8Array(await blob.slice(0, 56).arrayBuffer()), false); check();
          pcm = new Uint8Array(await blob.slice(56 + firstFrame * 8, 56 + endFrame * 8).arrayBuffer()); check();
          if (pcm.length !== (endFrame - firstFrame) * 8) throw fail('The immutable source window was truncated.');
          suffix.set(new Uint8Array(await blob.slice(header.metadataOffset).arrayBuffer())); check();
        } else {
          const prefix = new Uint8Array(56), iterator = loan.openChunks(); let offset = 0, copied = 0, sinceYield = 0;
          for await (const chunk of iterator) {
            check(); if (!(chunk instanceof Uint8Array) || !chunk.length || chunk.length > 262144 || offset + chunk.length > metadata.byteLength) throw fail('The replayable source returned an invalid bounded chunk.');
            if (offset < 56) prefix.set(chunk.subarray(0, Math.min(chunk.length, 56 - offset)), offset);
            if (!header && offset + chunk.length >= 56) acceptHeader(prefix);
            if (header) {
              const from = Math.max(offset, 56 + firstFrame * 8), to = Math.min(offset + chunk.length, 56 + endFrame * 8);
              if (to > from) { pcm.set(chunk.subarray(from - offset, to - offset), from - 56 - firstFrame * 8); copied += to - from; }
              const tailFrom = Math.max(offset, header.metadataOffset), tailTo = offset + chunk.length;
              if (tailTo > tailFrom) suffix.set(chunk.subarray(tailFrom - offset), tailFrom - header.metadataOffset);
            }
            offset += chunk.length; sinceYield += chunk.length;
            if (sinceYield >= 262144) { sinceYield = 0; await new Promise(resolve => setTimeout(resolve, 0)); check(); }
            try { onProgress({ phase: 'reading-immutable-source-window', completedUnits: offset, totalUnits: metadata.byteLength }); } catch {}
          }
          if (!header || offset !== metadata.byteLength || copied !== pcm.length) throw fail('The replayable source did not complete its exact original frame inventory.');
        }
        let originBytes = inspectOwnedSoundSeedOrigin(suffix, expected); check();
        loan.release(); await loan.settlement; if (loan.releaseState && loan.releaseState() !== 'released') throw fail('The original source reader did not acknowledge retirement.'); loan = null; check();
        let value = Object.freeze({ pcm, originBytes, source, firstFrame, endFrame, sampleRate: header.sampleRate, generation: operation.generation }), finish;
        pcm = suffix = originBytes = null;
        const completion = new Promise(resolve => { finish = resolve; }), entry = { completion }; windows.add(entry); published = true;
        const scope = createProcgenRetirementScope();
        return Object.freeze({ get value() { if (!value) throw fail('The source window was retired.'); return value; },
          release() {
            if (scope.getReceipt()) return scope.getReceipt();
            const receipt = scope.retire([{ name: 'owned-source-window', run: () => { memory.release(); value = null; windows.delete(entry); } }]);
            const settled = () => { if (receipt.outcome !== 'complete') unknown.add({ entry, memory, value, receipt }); finish(receipt); };
            if (receipt.state === 'retired') settled(); else receipt.completion.then(settled); return receipt;
          } });
      } finally {
        externalSignal?.removeEventListener('abort', cancel);
        if (loan) {
          try { loan.release(); await loan.settlement; if (loan.releaseState && loan.releaseState() !== 'released') throw fail('The accepted source reader has unresolved retirement.'); }
          catch (error) { unknown.add({ loan, memory, pcm, suffix, error }); memory = null; throw error; }
        }
        if (!published && memory) { try { memory.release(); } catch (error) { unknown.add({ memory, pcm, suffix, error }); throw error; } }
      }
    })(); pending.add(operation); operation.promise.finally(() => pending.delete(operation)).catch(() => {}); return operation.promise;
  };
  return Object.freeze({ metadata: () => Object.freeze({ ...source, retained: artifact.metadata().retained }), readWindow,
    diagnostics: () => Object.freeze({ disposed, generation, pendingReads: pending.size, retainedWindows: windows.size, unknownRetirement: unknown.size }),
    dispose() {
      if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true; for (const operation of pending) operation.controller.abort(fail('The sound-seed source owner retired.'));
      const readsFinished = Promise.allSettled([...pending].map(operation => operation.promise));
      const windowsFinished = readsFinished.then(() => Promise.all([...windows].map(entry => entry.completion)));
      return retirement.retire([{ name: 'accepted-source-reads', run: () => readsFinished },
        { name: 'leased-seed-windows', run: async () => { const receipts = await windowsFinished; if (receipts.some(receipt => receipt.outcome !== 'complete')) throw fail('A sound-seed window has unresolved retirement.'); } },
        { name: 'seed-source-metadata', run: async () => { const receipts = await windowsFinished; await readsFinished;
          if (unknown.size || receipts.some(receipt => receipt.outcome !== 'complete')) throw fail('Sound-seed source ownership remains unresolved.'); reservation.release(); expected = null;
        } }]);
    }
  });
}
