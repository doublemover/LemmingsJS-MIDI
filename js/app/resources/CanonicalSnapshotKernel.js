import { canonicalDataText } from '../../core/CanonicalData.js';
import { inspectValue } from './BackgroundValueInspector.js';
import { backgroundJobError as problem, checkBackgroundJob as guard } from './BackgroundJsonInspector.js';
import { yieldBackgroundTask } from './BackgroundTaskYield.js';

const MAX_BYTES = 64 * 1048576, MAX_NODES = 4000000;
export async function runCanonicalSnapshotKernel(kind, input, { signal, current, maxBytes = MAX_BYTES, estimatedPeakBytes,
  maxNodes = MAX_NODES, maxStringBytes = MAX_BYTES, onProgress = () => {}, yieldControl = yieldBackgroundTask, expectedInputHash = null } = {}) {
  if (kind !== 'snapshot-canonical-data' || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_BYTES ||
      !Number.isSafeInteger(estimatedPeakBytes) || estimatedPeakBytes < 4096 || estimatedPeakBytes > 512 * 1048576 ||
      !Number.isSafeInteger(maxNodes) || maxNodes < 1 || maxNodes > MAX_NODES ||
      !Number.isSafeInteger(maxStringBytes) || maxStringBytes < 1 || maxStringBytes > MAX_BYTES ||
      expectedInputHash != null && !/^[a-f0-9]{64}$/.test(expectedInputHash)) throw problem('invalid-contract', 'Unsupported background job kernel contract.');
  guard(signal, current);
  const metadata = await inspectValue(input, { signal, current, maxBytes, estimatedPeakBytes, maxNodes, maxStringBytes, onProgress, yieldControl });

  const encoded = canonicalDataText(input, { maxBytes, maxNodes }); guard(signal, current);
  if (encoded.bytes.byteLength * 8 + encoded.nodes * 192 > estimatedPeakBytes) throw problem('memory-capacity', 'Snapshot source exceeds its declared clone overlap.');
  const value = JSON.parse(encoded.text); guard(signal, current);
  return { value, inputBytes: metadata.bytes, nodes: encoded.nodes, retainedBytes: encoded.bytes.byteLength * 2 + encoded.nodes * 64 + 4096 };
}
