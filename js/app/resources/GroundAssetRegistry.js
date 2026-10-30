import { BinaryReader } from '../../data/BinaryReader.js';
import { getApplicationBuild } from '../../runtime/ActiveExecutionIdentity.js';
import { GROUND_DECODE_VERSION, hydrateGroundAssets } from './GroundAssetDecode.js';
import { sharedContentJobs } from './SharedContentJobs.js';

export async function acquireSharedGroundAssets({ ground, vgagr, steelIds, signal, budgetAdapter, contentJobs = sharedContentJobs, onProgress } = {}) {
  signal?.throwIfAborted();
  const identity = JSON.stringify({ version: GROUND_DECODE_VERSION, build: getApplicationBuild()?.closureDigest || 'source-realm',
    ground: ground.source, vgagr: vgagr.source, steelIds });
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
  const contentHash = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
  signal?.throwIfAborted();
  const groundPin = new BinaryReader(ground.reader), vgaPin = new BinaryReader(vgagr.reader);
  let pinsReleased = false;
  const releasePins = () => {
    if (pinsReleased) return; pinsReleased = true;
    const failures = [];
    for (const reader of [groundPin, vgaPin]) try { reader.release(); } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, 'Ground source pin retirement failed.');
  };
  let pending;
  try {
    pending = contentJobs.acquire({ kind: 'asset-decode', contentHash, decoderVersion: GROUND_DECODE_VERSION,
      inputBytes: groundPin.length + vgaPin.length, estimatedPeakBytes: 64 * 1048576, maxBytes: 16 * 1048576, priority: 'interactive',
      signal, budgetAdapter, onProgress, releasePreparedInput: releasePins,
      prepareInput() {
        try { return { version: GROUND_DECODE_VERSION, ground: { ...ground.source, bytes: groundPin.copyBytes() },
          vgagr: { ...vgagr.source, bytes: vgaPin.copyBytes() }, steelIds: steelIds.slice() }; }
        finally { releasePins(); }
      } });
  } catch (error) { releasePins(); throw error; }
  const job = await pending;
  try {
    let assets = hydrateGroundAssets(job.value);
    return Object.freeze({ get value() { job.value; return assets; }, receipt: job.receipt, signal: job.signal, release() { assets = null; return job.release(); }, retirementState: job.retirementState });
  } catch (error) { job.release(); throw error; }
}
