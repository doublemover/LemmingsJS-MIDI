import { validateStretchImageMetadata, inspectStretchCompiledModule } from '../../midi/content/StretchImageProfile.js';
import { acceptsWarpPitch, acceptsWarpRate } from '../../midi/content/BufferedWarpPlan.js';

const integer = (value, low, high) => Number.isSafeInteger(value) && value >= low && value <= high;
const plane = (value, first, count) => value instanceof Float32Array && value.buffer instanceof ArrayBuffer && integer(first, 0, value.length) && integer(count, 0, value.length - first);
const fail = message => { throw new TypeError('Restored stretch core: ' + message); };

// Only owned non-render preparation may instantiate/grow/copy this image. A
// future live adapter must establish a separate suspended-clock setup contract.
export function instantiateStretchInitialImage(material, { applicationBuildId, estimatedPeakBytes } = {}) {
  if (typeof document !== 'undefined' || typeof globalThis.registerProcessor === 'function') fail('Restore the initial image in a non-render worker.');
  const metadata = validateStretchImageMetadata(material?.metadata), verification = material?.verification, c = metadata.configuration;
  if (!/^[a-f0-9]{64}$/.test(applicationBuildId || '') || verification?.schema !== 'lemmings-sealed-stretch-image/v1' || verification.applicationBuildId !== applicationBuildId || verification.sampleRate !== c.sampleRate || verification.heapSha256 !== metadata.heapSha256 || verification.moduleArtifactHash !== metadata.moduleArtifactHash || verification.configurationHash !== metadata.configurationHash || !Number.isSafeInteger(estimatedPeakBytes) || estimatedPeakBytes < metadata.heapBytes + metadata.compiledModuleEstimateBytes + 8 * 1048576 || estimatedPeakBytes > 512 * 1048576 || typeof material.copyHeapInto !== 'function') fail('Use one sealed current-build image and its complete admitted runtime heap.');
  inspectStretchCompiledModule(material.compiledModule);
  let instance = null, core = null, memory = null, heap = null, leftIn = null, rightIn = null, leftOut = null, rightOut = null, random = metadata.randomState, disposed = false, faulted = false, pitchRatio = 1, framesSupplied = 0, framesProcessed = 0, bufferedHistoryReady = false, bufferedEver = false, bufferedBlocks = 0;
  const region = (pointer, length) => heap && integer(pointer, 0, heap.length) && integer(length, 0, heap.length - pointer);
  const imports = { a: {
    a(pointer, length) { if (!region(pointer, length)) { faulted = true; fail('Invalid random storage.'); } for (let at = pointer; at < pointer + length; at++) { random ^= random << 13; random ^= random >>> 17; random ^= random << 5; heap[at] = random & 255; } return 0; },
    b() { return 0; },
    c(destination, source, length) { if (!region(destination, length) || !region(source, length)) { faulted = true; fail('Invalid copy storage.'); } heap.copyWithin(destination, source, source + length); },
    d() { faulted = true; fail('The restored core aborted.'); }
  } };
  const drop = () => { instance = core = memory = heap = leftIn = rightIn = leftOut = rightOut = null; };
  const alive = () => { if (disposed || faulted || !core || memory.buffer !== heap.buffer) fail('The initial-image runtime is not active or its heap changed.'); };
  const frontier = () => { if (core[metadata.stackExport].value !== metadata.expectedQuiescentStack) { faulted = true; fail('The source did not return to its quiescent stack frontier.'); } };
  const outputs = (left, right, offset, count) => plane(left, offset, count) && plane(right, offset, count) && (left.buffer !== right.buffer || left.byteOffset + (offset + count) * 4 <= right.byteOffset + offset * 4 || right.byteOffset + (offset + count) * 4 <= left.byteOffset + offset * 4);
  const write = (left, right, offset, count) => { for (let frame = 0; frame < count; frame++) { const l = left[offset + frame], r = right[offset + frame]; if (!Number.isFinite(l) || !Number.isFinite(r) || Math.max(Math.abs(l), Math.abs(r)) > 16) fail('Input exceeds its finite immutable-source bound.'); leftIn[frame] = l; rightIn[frame] = r; } };
  const read = (left, right, offset, count) => { for (let frame = 0; frame < count; frame++) { const l = leftOut[frame], r = rightOut[frame]; if (!Number.isFinite(l) || !Number.isFinite(r) || Math.max(Math.abs(l), Math.abs(r)) > 32) { faulted = true; left.fill(0, offset, offset + count); right.fill(0, offset, offset + count); fail('Output exceeds its finite absolute bound.'); } left[offset + frame] = l; right[offset + frame] = r; } framesProcessed += count; };
  try {
    instance = new WebAssembly.Instance(material.compiledModule, imports); core = instance.exports; memory = core.e;
    const pages = (metadata.heapBytes - memory.buffer.byteLength) / 65536;
    if (!integer(pages, 0, 1024)) fail('The image heap does not contain the module initial memory.'); if (pages) memory.grow(pages);
    heap = new Uint8Array(memory.buffer); material.copyHeapInto(heap); const pointer = metadata.bufferPointer, frames = metadata.bufferFrames;
    leftIn = new Float32Array(memory.buffer, pointer, frames); rightIn = new Float32Array(memory.buffer, pointer + frames * 4, frames); leftOut = new Float32Array(memory.buffer, pointer + frames * 8, frames); rightOut = new Float32Array(memory.buffer, pointer + frames * 12, frames);
    frontier(); if (core.i() !== c.blockFrames || core.j() !== c.intervalFrames || core.k() !== c.inputLatencyFrames || core.l() !== c.outputLatencyFrames) fail('The restored heap configuration differs from its complete source receipt.'); frontier();
    return Object.freeze({ configuration: c, configurationHash: metadata.configurationHash,
      setPitch(value) { alive(); if (!acceptsWarpPitch(value)) fail('Choose a pitch in the explicit starting matrix.'); if (value !== pitchRatio) { try { bufferedHistoryReady = false; core.q(value, 8000 / c.sampleRate); frontier(); pitchRatio = value; } catch (error) { faulted = true; throw error; } } },
      resetSpectralHistory() { alive(); try { bufferedHistoryReady = false; core.m(); frontier(); } catch (error) { faulted = true; throw error; } },
      seek(left, right, offset, count, rateRatio) {
        alive(); if (!plane(left, offset, count) || !plane(right, offset, count) || !integer(count, 1, frames) || !acceptsWarpRate(rateRatio)) fail('Seek requires bounded actual prepared-rate history.'); write(left, right, offset, count); try { bufferedHistoryReady = false; core.v(count, rateRatio); frontier(); bufferedHistoryReady = bufferedEver = true; } catch (error) { faulted = true; throw error; }
      },
      process(left, right, inputOffset, inputFrames, outLeft, outRight, outputOffset, outputFrames) {
        alive(); if (!plane(left, inputOffset, inputFrames) || !plane(right, inputOffset, inputFrames) || !outputs(outLeft, outRight, outputOffset, outputFrames) || !integer(inputFrames, 1, frames) || !integer(outputFrames, 1, frames) || Math.abs(inputFrames - outputFrames * 0.75) > 1 && Math.abs(inputFrames - outputFrames) > 1 && Math.abs(inputFrames - outputFrames * 1.5) > 1 || left.buffer === outLeft.buffer || left.buffer === outRight.buffer || right.buffer === outLeft.buffer || right.buffer === outRight.buffer) fail('Process requires separate fixed buffers and the declared positive rate matrix.');
        write(left, right, inputOffset, inputFrames); try { bufferedHistoryReady = false; core.w(inputFrames, outputFrames); frontier(); framesSupplied += inputFrames; read(outLeft, outRight, outputOffset, outputFrames); } catch (error) { faulted = true; outLeft.fill(0, outputOffset, outputOffset + outputFrames); outRight.fill(0, outputOffset, outputOffset + outputFrames); throw error; }
      },
      flush(left, right, offset, count) { alive(); if (!outputs(left, right, offset, count) || !integer(count, 1, frames)) fail('Flush requires bounded separate output storage.'); try { bufferedHistoryReady = false; core.x(count); frontier(); read(left, right, offset, count); } catch (error) { faulted = true; left.fill(0, offset, offset + count); right.fill(0, offset, offset + count); throw error; } },
      processBuffered(left, right, offset, count) {
        alive(); if (!bufferedHistoryReady || !outputs(left, right, offset, count) || !integer(count, 1, frames)) fail('Buffered output requires one unconsumed history window and separate bounded outputs.');
        bufferedHistoryReady = false; try { core.w(0, count); frontier(); read(left, right, offset, count); bufferedBlocks++; } catch (error) { faulted = true; left.fill(0, offset, offset + count); right.fill(0, offset, offset + count); throw error; }
      },
      diagnostics: () => Object.freeze({ disposed, faulted, heapBytes: metadata.heapBytes, configurationHash: metadata.configurationHash, framesSupplied, framesProcessed, pitchRatio, ...(bufferedEver ? { bufferedHistoryReady, bufferedBlocks } : {}), randomState: random >>> 0, memoryGrowth: 'constructor-only;disabled-in-processing', internalAllocatorActivity: 'not-instrumented;initial-image-does-not-prove-zero-malloc', restoration: 'initial-image-plus-deterministic-preroll;not-arbitrary-held-state', producerRetirement: 'requires-caller-worker-or-node-retirement-acknowledgment' }),
      dispose() { disposed = true; drop(); return Object.freeze({ state: 'initial-image-runtime-references-released', producerRetirement: 'not-established;caller-must-retire-worker-or-node' }); }
    });
  } catch (error) { disposed = true; drop(); throw error; }
}
