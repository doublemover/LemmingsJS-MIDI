import { createOwnedEffectGraphKernel } from '../midi-ui/OwnedEffectGraphKernel.js';
import { cloneData, hashData } from '../../core/CanonicalData.js';
const fail = message => { throw Object.assign(new Error(message), { name: 'AudioRestoreError', code: 'incompatible-effect-continuation' }); };
export async function prepareOwnedEffectCut({ definition, metadata: rawMetadata, components } = {}, { signal, yieldControl = async () => {}, maxWorkingBytes = 384 * 1048576 } = {}) {
  const metadata = cloneData(rawMetadata, { maxBytes: 2 * 1048576, maxNodes: 131072 });
  if (metadata?.schema !== 'lemmings-live-effect-cut/v1' || !/^[a-f0-9]{64}$/.test(metadata.graphHash || '') || ![44100, 48000, 96000].includes(metadata.sampleRate) || !Number.isSafeInteger(metadata.audioFrame) || metadata.audioFrame < 0 || !Array.isArray(components) || components.length > 512 || components.some(row => !row || row.audioFrame !== metadata.audioFrame || !Number.isSafeInteger(row.logicalAudioFrame) || row.logicalAudioFrame < 0 || !(row.bytes instanceof Uint8Array) || !(row.bytes.buffer instanceof ArrayBuffer) || row.bytes.byteOffset || row.bytes.length !== row.bytes.buffer.byteLength) || metadata.hostState?.schema !== 'lemmings-native-effect-host-cut/v1' || metadata.hostState.audioFrame !== metadata.audioFrame || metadata.controlState?.graphHash !== metadata.graphHash || metadata.controlState?.sampleRate !== metadata.sampleRate || metadata.controlState?.frame !== metadata.audioFrame) fail('The complete DSP and automation image must share one declared native audio frame, graph and rate.');
  const bytes = components.reduce((sum, row) => sum + row.bytes.length, 0);
  if (!Number.isSafeInteger(bytes) || bytes > 48 * 1048576 || !Number.isSafeInteger(maxWorkingBytes) || bytes * 5 + 32 * 1048576 > maxWorkingBytes) fail('Effect component validation exceeds the admitted state workspace.');
  signal?.throwIfAborted();
  const graph = await createOwnedEffectGraphKernel({ definition, sampleRate: metadata.sampleRate });
  try {
    signal?.throwIfAborted(); if (graph.hash !== metadata.graphHash) fail('The live effect definition differs from its exact pinned kernel graph.');
    const validated = graph.validateDetachedComponentStates(components, metadata.hostState, metadata.audioFrame), source = new Map(components.map(row => [row.nodeId, row]));
    for (const row of validated) {
      row.audioFrame = metadata.audioFrame; row.logicalAudioFrame = source.get(row.nodeId).logicalAudioFrame; if (source.get(row.nodeId).blockFrames != null) { const frames = source.get(row.nodeId).blockFrames; if (!Number.isSafeInteger(frames) || frames < 1 || frames > 16384) fail('The original effect render quantum is invalid.'); row.blockFrames = frames; } row.hostState = cloneData(source.get(row.nodeId).hostState, { maxBytes: 4096, maxNodes: 128 });
      let checksum = 2166136261;
      for (let first = 0; first < row.bytes.length; first += 65536) {
        for (let index = first, end = Math.min(first + 65536, row.bytes.length); index < end; index++) checksum = Math.imul(checksum ^ row.bytes[index], 16777619);
        await yieldControl(); signal?.throwIfAborted();
      }
      row.transportChecksum32 = checksum >>> 0;
      row.stateHash = Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', row.bytes)), value => value.toString(16).padStart(2, '0')).join(''); signal?.throwIfAborted();
    }
    return { schema: 'lemmings-prepared-effect-cut/v1', definition: graph.plan.definition, metadata, components: validated, stateHash: await hashData({ metadata, components: validated.map(row => ({ nodeId: row.nodeId, kind: row.kind, sourceFrame: row.sourceFrame, logicalAudioFrame: row.logicalAudioFrame, stateHash: row.stateHash, transportChecksum32: row.transportChecksum32, bytes: row.bytes.length })) }, { maxBytes: 4 * 1048576, maxNodes: 262144 }), validation: 'worker-restored-pinned-effect-components', mutableState: 'independent-prepared-component-buffers' };
  } finally { graph.panic(); }
}
