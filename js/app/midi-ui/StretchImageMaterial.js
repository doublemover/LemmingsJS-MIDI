import { validateStretchImageMetadata, inspectStretchCompiledModule } from '../../midi/content/StretchImageProfile.js';
import { hashData, canonicalDataText, freezeData } from '../../core/CanonicalData.js';

const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fail = message => { throw new TypeError('Stretch image material: ' + message); };

// The caller owns its worker receipt and capture/hash/copy reservation. This
// seals data identities; it cannot attest worker retirement or execute a source.
export async function sealStretchImageMaterial(raw, { applicationBuildId, sampleRate, estimatedPeakBytes, signal, current = () => true } = {}) {
  const check = () => { signal?.throwIfAborted(); if (!current()) fail('The prepared source owner changed.'); }; check();
  if (typeof globalThis.registerProcessor === 'function') fail('Hash and copy image material outside the render thread.');
  if (!hash(applicationBuildId) || raw?.applicationBuildId !== applicationBuildId || ![44100, 48000, 96000].includes(sampleRate)) fail('The executing build and prepared source rate must match.');
  const metadata = validateStretchImageMetadata(raw.metadata); let compiledModule = raw.compiledModule; inspectStretchCompiledModule(compiledModule);
  if (metadata.configuration.sampleRate !== sampleRate || !Number.isSafeInteger(estimatedPeakBytes) || estimatedPeakBytes < metadata.heapBytes * 3 + metadata.compiledModuleEstimateBytes + 1048576 || estimatedPeakBytes > 512 * 1048576 || !(raw.moduleBytes instanceof Uint8Array) || !(raw.moduleBytes.buffer instanceof ArrayBuffer) || raw.moduleBytes.byteLength !== metadata.moduleBytes || !(raw.heapBytes instanceof Uint8Array) || !(raw.heapBytes.buffer instanceof ArrayBuffer) || raw.heapBytes.byteLength !== metadata.heapBytes) fail('The complete image and admitted copy/hash overlap are required.');
  let heapBytes = raw.heapBytes.slice(), moduleBytes = raw.moduleBytes.slice(), disposed = false;
  const [heapSha256, moduleArtifactHash, configurationHash] = await Promise.all([digest(heapBytes), digest(moduleBytes), hashData(metadata.configuration)]); check();
  if (heapSha256 !== metadata.heapSha256 || moduleArtifactHash !== metadata.moduleArtifactHash || configurationHash !== metadata.configurationHash) fail('The image, module bytes or complete configuration failed its immutable hash.');
  const metadataBytes = canonicalDataText(metadata, { maxBytes: 65536, maxNodes: 4096 }).bytes.length;
  const alive = () => { if (disposed) fail('The private image material was disposed.'); };
  return Object.freeze({ get compiledModule() { alive(); return compiledModule; }, metadata,
    verification: freezeData({ schema: 'lemmings-sealed-stretch-image/v1', applicationBuildId, sampleRate, heapSha256, moduleArtifactHash, configurationHash, compilation: 'owned-worker-module;receiver-does-not-compile', evidence: 'sealed-byte-and-configuration-hashes;actual-worker-receipt-and-retirement-owned-by-caller' }),
    footprint: freezeData({ heapBytes: heapBytes.length, moduleBytes: moduleBytes.length, compiledModuleEstimateBytes: metadata.compiledModuleEstimateBytes, retainedBytes: heapBytes.length + moduleBytes.length + metadata.compiledModuleEstimateBytes + metadataBytes * 8 + 65536, qualification: 'declared-code-estimate;not-measured-device-memory' }),
    copyHeapInto(destination) { alive(); if (!(destination instanceof Uint8Array) || !(destination.buffer instanceof ArrayBuffer) || destination.byteOffset || destination.byteLength !== metadata.heapBytes || destination.buffer.byteLength !== metadata.heapBytes) fail('Copy into one private whole nonshared destination heap.'); destination.set(heapBytes); },
    fork({ estimatedPeakBytes = 0 } = {}) { alive(); if (!Number.isSafeInteger(estimatedPeakBytes) || estimatedPeakBytes < metadata.heapBytes + metadata.moduleBytes + 65536 || estimatedPeakBytes > 512 * 1048576) fail('Reserve the complete owned image fork before copying.'); return Object.freeze({ compiledModule, heapBytes: heapBytes.slice(), moduleBytes: moduleBytes.slice(), metadata, applicationBuildId }); },
    diagnostics: () => Object.freeze({ disposed, heapBytes: metadata.heapBytes, compiledModuleEstimateBytes: metadata.compiledModuleEstimateBytes, source: 'private-sealed-initial-image;no-source-cache-buffer-exposure' }),
    dispose() { disposed = true; heapBytes = moduleBytes = compiledModule = null; return Object.freeze({ state: 'private-image-references-released', producerRetirement: 'not-established;caller-owns-worker-and-consumer-frontiers' }); } });
}
