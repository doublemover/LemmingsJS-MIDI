import { prepareStretchImageModuleBytes, STRETCH_STACK_EXPORT } from './StretchCoreImageAbi.js';
import { OWNED_STRETCH_CORE } from '../../midi/content/OwnedStretchCoreIdentity.js';
import { acceptsWarpPitch, acceptsWarpRate } from '../../midi/content/BufferedWarpPlan.js';
import { canonicalDataText, freezeData, hashData } from '../../core/CanonicalData.js';

const PAGE = 65536, integer = (value, low, high) => Number.isSafeInteger(value) && value >= low && value <= high;
const fail = message => { throw Object.assign(new Error('Owned stretch core: ' + message), { code: 'owned-stretch-core-unavailable' }); };
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
const plane = (value, first, count) => value instanceof Float32Array && value.buffer instanceof ArrayBuffer && integer(first, 0, value.length) && integer(count, 0, value.length - first);

const separateOutputs = (left, right, offset, count) => left.buffer !== right.buffer || left.byteOffset + (offset + count) * 4 <= right.byteOffset + offset * 4 || right.byteOffset + (offset + count) * 4 <= left.byteOffset + offset * 4;

// A direct owner of the pinned core, without the upstream web scheduler/loader.
// Compilation, configuration and capacity priming belong in a bounded worker.
// This low-level primitive is not yet an installed or quality-qualified voice.
export async function prepareOwnedStretchCore(wasmBytes, { sampleRate = 48000, blockFrames = 2048, intervalFrames = 512, randomSeed = 1, maximumHeapBytes = 32 * 1048576,
  estimatedPeakBytes = 0, captureInitialImage = false, signal, current = () => true, yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
  const check = () => { signal?.throwIfAborted(); if (!current()) fail('The preparation owner changed.'); }; check();
  if (typeof document !== 'undefined' || typeof globalThis.registerProcessor === 'function') fail('Compile/configure this core in an admitted non-render worker.');
  if (!(wasmBytes instanceof Uint8Array) || !(wasmBytes.buffer instanceof ArrayBuffer) || wasmBytes.byteLength !== OWNED_STRETCH_CORE.wasmBytes || ![44100, 48000, 96000].includes(sampleRate) || ![1024, 2048, 4096, 8192].includes(blockFrames) || intervalFrames !== blockFrames / 4 || !integer(randomSeed, 1, 0xffffffff) || !integer(maximumHeapBytes, 4 * 1048576, 64 * 1048576) || maximumHeapBytes % PAGE || !Number.isSafeInteger(estimatedPeakBytes) || estimatedPeakBytes < maximumHeapBytes + 16 * 1048576) fail('Choose exact pinned bytes, a reserved heap and an explicit supported configuration.');
  if (typeof captureInitialImage !== 'boolean' || captureInitialImage && estimatedPeakBytes < Math.max(192 * 1048576, maximumHeapBytes * 3 + 32 * 1048576)) fail('An initial heap image requires its complete admitted capture/hash/transfer overlap.');
  // Seal before asynchronous hashing; never detach or retain a caller's cache.
  const bytes = wasmBytes.slice(); if (await digest(bytes) !== OWNED_STRETCH_CORE.wasmSha256) fail('The compiled core bytes differ from the pinned artifact.'); check();
  let imageModule = captureInitialImage ? await prepareStretchImageModuleBytes(bytes, { signal, current }) : null, initialImage = null; check();
  let module = await WebAssembly.compile(imageModule?.bytes || bytes); check();
  const imports = WebAssembly.Module.imports(module), expected = ['a:a:function', 'a:b:function', 'a:c:function', 'a:d:function'];
  if (imports.length !== expected.length || imports.some((value, index) => [value.module, value.name, value.kind].join(':') !== expected[index])) fail('The pinned core import ABI changed.');
  const exported = new Map(WebAssembly.Module.exports(module).map(value => [value.name, value.kind]));
  if (exported.get('e') !== 'memory' || exported.get('f') !== 'function' || exported.get('g') !== 'table' || !'hijklmnopqrstuvwx'.split('').every(name => exported.get(name) === 'function')) fail('The pinned core buffer, state and processing ABI changed.');
  if (captureInitialImage && exported.get(STRETCH_STACK_EXPORT) !== 'global') fail('The prepared image module lacks its pinned stack guard.');
  let instance = null, core = null, memory = null, heap = null, inputs = null, outputs = null, disposed = false, faulted = false, preparing = true, random = randomSeed >>> 0, bufferPointer = 0, heapPeak = 0, framesProcessed = 0, framesSupplied = 0, pitchRatio = 1;
  const bufferFrames = blockFrames * 2;
  const refresh = () => { if (!memory || heap?.buffer === memory.buffer) return; heap = new Uint8Array(memory.buffer); heapPeak = Math.max(heapPeak, heap.byteLength); if (heap.byteLength > maximumHeapBytes) fail('The core exceeded its admitted heap.'); if (bufferPointer) { inputs = [new Float32Array(memory.buffer, bufferPointer, bufferFrames), new Float32Array(memory.buffer, bufferPointer + bufferFrames * 4, bufferFrames)]; outputs = [new Float32Array(memory.buffer, bufferPointer + bufferFrames * 8, bufferFrames), new Float32Array(memory.buffer, bufferPointer + bufferFrames * 12, bufferFrames)]; } };
  const alive = () => { if (disposed || faulted || !core || preparing) fail('The core is not in its prepared active state.'); };
  const ownedImports = { a: {
    a(pointer, length) { refresh(); if (!heap || !integer(pointer, 0, heap.length) || !integer(length, 0, heap.length - pointer)) fail('The core requested invalid random storage.'); for (let index = pointer; index < pointer + length; index++) { random ^= random << 13; random ^= random >>> 17; random ^= random << 5; heap[index] = random & 255; } return 0; },
    b(requested) { if (!preparing || !memory || !integer(requested, 0, maximumHeapBytes)) return 0; try { const pages = Math.ceil((requested - memory.buffer.byteLength) / PAGE); if (pages > 0) memory.grow(pages); refresh(); return 1; } catch { return 0; } },
    c(destination, source, count) { refresh(); if (!heap || !integer(destination, 0, heap.length) || !integer(source, 0, heap.length) || !integer(count, 0, Math.min(heap.length - destination, heap.length - source))) fail('The core requested invalid copy storage.'); heap.copyWithin(destination, source, source + count); },
    d() { faulted = true; fail('The pinned core aborted.'); }
  } };
  try {
    instance = await WebAssembly.instantiate(module, ownedImports); check(); core = instance.exports; memory = core.e; refresh(); core.f(); refresh(); core.p(2, blockFrames, intervalFrames, 0); refresh();
    bufferPointer = core.h(2, bufferFrames); if (!integer(bufferPointer, 4, memory.buffer.byteLength - bufferFrames * 16) || bufferPointer % 4) fail('The configured buffers exceed the pinned memory ABI.');
    // Rebind once after the final allocation, and again only if preparation grows.
    heap = null; refresh(); core.s(1, 0);
    const inputLatencyFrames = core.k(), outputLatencyFrames = core.l();
    if (core.i() !== blockFrames || core.j() !== intervalFrames || !integer(inputLatencyFrames, 0, blockFrames * 2) || !integer(outputLatencyFrames, 0, blockFrames * 2)) fail('The resolved core configuration or separate latency reports changed.');
    for (const pitch of [0.5, 1, 2]) for (const rate of [0.75, 1, 1.5]) {
      check(); core.m(); core.q(pitch, 8000 / sampleRate); for (let frame = 0; frame < bufferFrames; frame++) { inputs[0][frame] = ((frame % 31) - 15) / 1024; inputs[1][frame] = ((frame % 47) - 23) / 1024; } core.v(bufferFrames, rate); refresh(); const outputFrames = blockFrames, inputFrames = Math.round(outputFrames * rate); core.w(inputFrames, outputFrames); refresh(); core.x(blockFrames); refresh(); await yieldControl();
    }
    core.m(); core.q(1, 8000 / sampleRate); inputs[0].fill(0); inputs[1].fill(0); outputs[0].fill(0); outputs[1].fill(0); preparing = false;
    const configuration = freezeData({ schema: 'lemmings-owned-stretch-core-configuration/v1', abi: OWNED_STRETCH_CORE.abi, artifactHash: OWNED_STRETCH_CORE.wasmSha256, ...(captureInitialImage ? { heapImageAbi: { revision: imageModule.metadata.revision, moduleArtifactHash: imageModule.metadata.derivedModuleHash, stackExport: STRETCH_STACK_EXPORT, expectedQuiescentStack: imageModule.metadata.expectedQuiescentStack } } : {}), sampleRate, preparedRate: sampleRate, channels: 2, blockFrames, intervalFrames, splitComputation: false, bufferFrames, maximumHeapBytes, randomSeed, randomStateAfterPreparation: random >>> 0,
      formantPolicy: 'shift-with-pitch', tonalityLimitHz: 8000, primingRevision: 'bounded-nonzero-seek-process-flush-all-nine-matrix-points-v1', inputLatencyFrames, outputLatencyFrames, restoration: 'deterministicPreroll', qualification: 'unqualified;capacity-priming-is-not-allocation-cost-or-spectral-proof' });
    const configurationHash = await hashData(configuration); check();
    if (captureInitialImage) {
      const expectedStack = imageModule.metadata.expectedQuiescentStack;
      if (core[STRETCH_STACK_EXPORT].value !== expectedStack) fail('The worker core is not at its quiescent stack frontier.');
      const image = heap.slice(), heapSha256 = await digest(image); check();
      if (core[STRETCH_STACK_EXPORT].value !== expectedStack) fail('The worker stack changed during image capture.');
      initialImage = Object.freeze({ moduleBytes: imageModule.bytes, heapBytes: image, metadata: freezeData({ schema: 'lemmings-stretch-initial-heap-image/v1', originalArtifactHash: OWNED_STRETCH_CORE.wasmSha256, moduleArtifactHash: imageModule.metadata.derivedModuleHash, moduleBytes: imageModule.bytes.length, heapSha256, heapBytes: image.length, configuration, configurationHash, bufferPointer, bufferFrames, randomState: random >>> 0, stackExport: STRETCH_STACK_EXPORT, expectedQuiescentStack: expectedStack, state: 'initial-primed-empty-source;not-an-arbitrary-held-DSP-snapshot', producerRetirement: 'requires-worker-acknowledgment;not-established-by-copy', qualification: 'transport-preparation-only;restoration-DSP-and-device-cost-unqualified' }) });
    }
    const copyOut = (left, right, offset, count) => { for (let frame = 0; frame < count; frame++) { const l = outputs[0][frame], r = outputs[1][frame]; if (!Number.isFinite(l) || !Number.isFinite(r) || Math.max(Math.abs(l), Math.abs(r)) > 32) { faulted = true; left.fill(0, offset, offset + count); right.fill(0, offset, offset + count); fail('The core output exceeded its finite absolute contract.'); } left[offset + frame] = l; right[offset + frame] = r; } framesProcessed += count; };
    const write = (left, right, offset, count) => { for (let frame = 0; frame < count; frame++) { const l = left[offset + frame], r = right[offset + frame]; if (!Number.isFinite(l) || !Number.isFinite(r) || Math.max(Math.abs(l), Math.abs(r)) > 16) fail('The immutable input exceeds its finite magnitude bound.'); inputs[0][frame] = l; inputs[1][frame] = r; } };
    return Object.freeze({ configuration, configurationHash,
      getInitialImage() { alive(); if (!initialImage) fail('This core has no prepared initial heap image.'); return initialImage; },
      setPitch(value) { alive(); if (!acceptsWarpPitch(value)) fail('Only the explicit octave starting matrix is admitted.'); if (value !== pitchRatio) { try { core.q(value, 8000 / sampleRate); pitchRatio = value; } catch (error) { faulted = true; throw error; } } },
      resetSpectralHistory() { alive(); try { core.m(); } catch (error) { faulted = true; throw error; } /* RNG history is retained. Exact restart reconstructs this core from the pinned seed/configuration. */ },
      seek(left, right, offset, count, rateRatio) { alive(); if (!plane(left, offset, count) || !plane(right, offset, count) || !integer(count, 1, bufferFrames) || !acceptsWarpRate(rateRatio)) fail('A seek needs bounded actual preroll at the prepared PCM rate.'); write(left, right, offset, count); try { core.v(count, rateRatio); } catch (error) { faulted = true; throw error; } },
      process(left, right, inputOffset, inputFrames, outLeft, outRight, outputOffset, outputFrames) {
        alive(); if (!plane(left, inputOffset, inputFrames) || !plane(right, inputOffset, inputFrames) || !plane(outLeft, outputOffset, outputFrames) || !plane(outRight, outputOffset, outputFrames) || !integer(inputFrames, 1, bufferFrames) || !integer(outputFrames, 1, bufferFrames) || (Math.abs(inputFrames - outputFrames * 0.75) > 1 && Math.abs(inputFrames - outputFrames) > 1 && Math.abs(inputFrames - outputFrames * 1.5) > 1) || left.buffer === outLeft.buffer || left.buffer === outRight.buffer || right.buffer === outLeft.buffer || right.buffer === outRight.buffer || !separateOutputs(outLeft, outRight, outputOffset, outputFrames) || !Number.isSafeInteger(framesProcessed + outputFrames) || !Number.isSafeInteger(framesSupplied + inputFrames)) fail('A processing block exceeds its fixed buffers or positive rate domain.');
        write(left, right, inputOffset, inputFrames); try { core.w(inputFrames, outputFrames); copyOut(outLeft, outRight, outputOffset, outputFrames); framesSupplied += inputFrames; } catch (error) { faulted = true; outLeft.fill(0, outputOffset, outputOffset + outputFrames); outRight.fill(0, outputOffset, outputOffset + outputFrames); throw error; }
      },
      flush(left, right, offset, count) { alive(); if (!plane(left, offset, count) || !plane(right, offset, count) || !integer(count, 1, bufferFrames) || !separateOutputs(left, right, offset, count) || !Number.isSafeInteger(framesProcessed + count)) fail('A flush exceeds its admitted output buffer.'); try { core.x(count); copyOut(left, right, offset, count); } catch (error) { faulted = true; left.fill(0, offset, offset + count); right.fill(0, offset, offset + count); throw error; } },
      diagnostics() { return Object.freeze({ artifactHash: OWNED_STRETCH_CORE.wasmSha256, configurationHash, disposed, faulted, heapPeakBytes: heapPeak, maximumHeapBytes, framesProcessed, framesSupplied, pitchRatio, memoryGrowth: 'disabled-after-worker-preparation', internalAllocatorActivity: 'not-instrumented;capacity-priming-does-not-prove-zero-malloc', restoration: 'deterministicPreroll', producerRetirement: 'requires-caller-worker-or-node-retirement-acknowledgment' }); },
      dispose() { disposed = true; module = instance = core = memory = heap = inputs = outputs = imageModule = initialImage = null; return Object.freeze({ state: 'owned-core-references-released', heapPeakBytes: heapPeak, producerRetirement: 'not-established;caller-must-retire-its-worker-or-node' }); }
    });
  } catch (error) { disposed = true; module = instance = core = memory = heap = inputs = outputs = imageModule = initialImage = null; throw error; }
}

export function ownedStretchCoreConfigurationBytes(configuration) { return canonicalDataText(configuration, { maxBytes: 16384, maxNodes: 2048 }).bytes.length; }
