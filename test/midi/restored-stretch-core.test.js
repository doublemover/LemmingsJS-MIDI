import { expect } from 'chai';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { prepareOwnedStretchCore } from '../../js/app/resources/OwnedStretchCore.js';
import { instantiateStretchInitialImage } from '../../js/app/resources/RestoredStretchCore.js';
import { sealStretchImageMaterial } from '../../js/app/midi-ui/StretchImageMaterial.js';
import { validateStretchImageMetadata } from '../../js/midi/content/StretchImageProfile.js';
import { OWNED_STRETCH_CORE } from '../../js/midi/content/OwnedStretchCoreIdentity.js';

const build = 'a'.repeat(64), options = { applicationBuildId: build, sampleRate: 48000, estimatedPeakBytes: 192 * 1048576 }, sha = bytes => createHash('sha256').update(bytes).digest('hex'), copy = value => JSON.parse(JSON.stringify(value));
const refused = async work => { try { await work(); } catch (error) { return error; } throw new Error('Expected refusal.'); };

describe('sealed initial stretch image restoration (authored unrun; no listening/device qualification)', function() {
  this.timeout(120000); let bytes, original, raw, material;
  before(async function() {
    try { bytes = new Uint8Array(await fs.readFile(OWNED_STRETCH_CORE.cachePath)); } catch (error) { if (error.code === 'ENOENT') return this.skip(); throw error; }
    original = await prepareOwnedStretchCore(bytes, { captureInitialImage: true, estimatedPeakBytes: 192 * 1048576, yieldControl: async () => {} }); raw = { ...original.getInitialImage(), applicationBuildId: build }; material = await sealStretchImageMaterial(raw, options);
  });
  after(() => { material?.dispose(); original?.dispose(); });
  it('matches direct and restored buffered seek/output history and refuses stale or multiply consumed windows', async () => {
    const direct = await prepareOwnedStretchCore(bytes, { captureInitialImage: true, estimatedPeakBytes: options.estimatedPeakBytes, yieldControl: async () => {} }), restored = instantiateStretchInitialImage(material, options), count = direct.configuration.inputLatencyFrames + direct.configuration.outputLatencyFrames, left = new Float32Array(count), right = new Float32Array(count), a = [new Float32Array(128), new Float32Array(128)], b = [new Float32Array(128), new Float32Array(128)];
    try {
      expect(() => direct.processBuffered(a[0], a[1], 0, 128)).to.throw('unconsumed'); expect(() => restored.processBuffered(b[0], b[1], 0, 128)).to.throw('unconsumed');
      for (let block = 0; block < 27; block++) {
        const rate = [0.75, 1, 1.5][block % 3], pitch = [0.5, 1, 2][Math.floor(block / 3) % 3];
        for (let frame = 0; frame < count; frame++) { left[frame] = Math.sin((frame + block * 128 * rate) * 0.031) * 0.2; right[frame] = Math.sin((frame + block * 128 * rate) * 0.047) * 0.1; }
        direct.setPitch(pitch); restored.setPitch(pitch); direct.seek(left, right, 0, count, rate); restored.seek(left, right, 0, count, rate); direct.processBuffered(a[0], a[1], 0, 128); restored.processBuffered(b[0], b[1], 0, 128); expect(b).to.deep.equal(a); expect(() => restored.processBuffered(b[0], b[1], 0, 128)).to.throw('unconsumed');
      }
      for (const core of [direct, restored]) { core.seek(left, right, 0, count, 1); core.resetSpectralHistory(); expect(() => core.processBuffered(a[0], a[1], 0, 128)).to.throw('unconsumed'); core.seek(left, right, 0, count, 1); core.setPitch(0.5); expect(() => core.processBuffered(a[0], a[1], 0, 128)).to.throw('unconsumed'); expect(core.diagnostics()).to.include({ bufferedBlocks: 27, bufferedHistoryReady: false }); }
    } finally { direct.dispose(); restored.dispose(); }
  });
  it('restores the primed source without constructors/configuration and matches its subsequent matrix/control history in one runtime', () => {
    const restored = instantiateStretchInitialImage(material, options), left = new Float32Array(192), right = new Float32Array(192), a = [new Float32Array(128), new Float32Array(128)], b = [new Float32Array(128), new Float32Array(128)]; let sourceFrame = 0;
    try {
      for (let block = 0; block < 36; block++) {
        const rate = [0.75, 1, 1.5][block % 3], pitch = [1, 0.5, 2][Math.floor(block / 3) % 3], count = 128 * rate; original.setPitch(pitch); restored.setPitch(pitch);
        for (let frame = 0; frame < count; frame++) { left[frame] = Math.sin((sourceFrame + frame) * 0.067) * 0.15; right[frame] = Math.sin((sourceFrame + frame) * 0.041) * 0.12; }
        original.process(left, right, 0, count, a[0], a[1], 0, 128); restored.process(left, right, 0, count, b[0], b[1], 0, 128); expect(b).to.deep.equal(a); sourceFrame += count;
      }
      expect(restored.diagnostics().framesSupplied).to.equal(original.diagnostics().framesSupplied); expect(restored.diagnostics().framesProcessed).to.equal(original.diagnostics().framesProcessed); expect(restored.diagnostics().restoration).to.include('not-arbitrary-held-state');
    } finally { restored.dispose(); }
  });
  it('owns private immutable bank storage and independent runtime state while explicit forks are disposable copies', () => {
    expect(material).not.to.have.property('heapBytes'); const first = material.fork(options), second = material.fork(options); expect(first.heapBytes.buffer).not.to.equal(second.heapBytes.buffer); expect(first.moduleBytes.buffer).not.to.equal(second.moduleBytes.buffer); first.heapBytes.fill(0); first.moduleBytes.fill(0); expect(sha(second.heapBytes)).to.equal(material.metadata.heapSha256); expect(sha(second.moduleBytes)).to.equal(material.metadata.moduleArtifactHash);
    const a = instantiateStretchInitialImage(material, options), b = instantiateStretchInitialImage(material, options), zero = new Float32Array(128), output = [new Float32Array(128), new Float32Array(128)];
    try { a.setPitch(2); a.process(zero, zero, 0, 128, output[0], output[1], 0, 128); expect(b.diagnostics().framesProcessed).to.equal(0); expect(b.diagnostics().pitchRatio).to.equal(1); expect(material.diagnostics().disposed).to.equal(false); } finally { a.dispose(); b.dispose(); }
    expect(() => material.fork()).to.throw('Reserve'); expect(() => material.copyHeapInto(new Uint8Array(32))).to.throw('whole');
  });
  it('rejects changed module/heap/configuration bytes, clocks, build and workspace before publishing a replacement material', async () => {
    const heap = { ...raw, heapBytes: raw.heapBytes.slice() }; heap.heapBytes[0] ^= 1; expect((await refused(() => sealStretchImageMaterial(heap, options))).message).to.include('immutable hash');
    const module = { ...raw, moduleBytes: raw.moduleBytes.slice() }; module.moduleBytes[0] ^= 1; expect((await refused(() => sealStretchImageMaterial(module, options))).message).to.include('immutable hash');
    const config = { ...raw, metadata: copy(raw.metadata) }; config.metadata.configuration.randomSeed = 2; expect((await refused(() => sealStretchImageMaterial(config, options))).message).to.include('immutable hash');
    expect((await refused(() => sealStretchImageMaterial(raw, { ...options, sampleRate: 44100 }))).message).to.include('complete image'); expect((await refused(() => sealStretchImageMaterial(raw, { ...options, applicationBuildId: 'b'.repeat(64) }))).message).to.include('build'); expect((await refused(() => sealStretchImageMaterial(raw, { ...options, estimatedPeakBytes: 1048576 }))).message).to.include('overlap'); expect(material.diagnostics().disposed).to.equal(false);
  });
  it('does not accept arbitrary held snapshots, bad I/O coordinates or missing code reservations as an initial profile', () => {
    for (const update of [{ state: 'exact-held-snapshot' }, { bufferPointer: material.metadata.heapBytes - 4 }, { randomState: 0 }, { compiledModuleEstimateBytes: 0 }]) expect(() => validateStretchImageMetadata({ ...material.metadata, ...update })).to.throw();
    expect(() => instantiateStretchInitialImage(material, { ...options, applicationBuildId: 'b'.repeat(64) })).to.throw('current-build'); expect(() => instantiateStretchInitialImage(material, { ...options, estimatedPeakBytes: 1048576 })).to.throw('runtime heap');
  });
  it('keeps disposed runtime/material reference release distinct from producer retirement', async () => {
    const local = await sealStretchImageMaterial(raw, options), runtime = instantiateStretchInitialImage(local, options); const receipt = local.dispose(); expect(receipt.producerRetirement).to.include('not-established'); expect(() => local.fork(options)).to.throw('disposed'); expect(() => local.compiledModule).to.throw('disposed'); expect(runtime.diagnostics().disposed).to.equal(false); expect(runtime.dispose().producerRetirement).to.include('not-established'); expect(() => runtime.setPitch(1)).to.throw('not active');
  });
});
