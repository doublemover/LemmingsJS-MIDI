import { expect } from 'chai';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { prepareOwnedStretchCore } from '../../js/app/resources/OwnedStretchCore.js';
import { runBackgroundJobKernel } from '../../js/app/resources/BackgroundJobKernels.js';
import { BACKGROUND_JOB_KINDS, BACKGROUND_WORKER_ONLY_JOB_KINDS } from '../../js/app/resources/BackgroundJobKinds.js';
import { OWNED_STRETCH_CORE } from '../../js/midi/content/OwnedStretchCoreIdentity.js';

const refused = async promise => { try { await promise; } catch (error) { return error; } throw new Error('Expected refusal.'); }, sha = bytes => createHash('sha256').update(bytes).digest('hex');
describe('initial stretch image admission (execution and transport fixtures authored, unrun)', () => {
  it('requires complete capture/hash/transfer overlap before compiling any core', async () => {
    expect((await refused(prepareOwnedStretchCore(new Uint8Array(OWNED_STRETCH_CORE.wasmBytes), { captureInitialImage: true, estimatedPeakBytes: 128 * 1048576 }))).message).to.include('capture/hash/transfer');
    expect((await refused(prepareOwnedStretchCore(new Uint8Array(OWNED_STRETCH_CORE.wasmBytes), { captureInitialImage: true, maximumHeapBytes: 64 * 1048576, estimatedPeakBytes: 192 * 1048576 }))).message).to.include('capture/hash/transfer');
    expect((await refused(prepareOwnedStretchCore(new Uint8Array(OWNED_STRETCH_CORE.wasmBytes), { captureInitialImage: 'true', estimatedPeakBytes: 192 * 1048576 }))).message).to.include('capture/hash/transfer');
  });
  it('uses worker-only admission and refuses unbound/wrong-build requests before preparation', async () => {
    expect(BACKGROUND_JOB_KINDS).to.include('prepare-stretch-core-image'); expect(BACKGROUND_WORKER_ONLY_JOB_KINDS).to.include('prepare-stretch-core-image');
    const error = await refused(runBackgroundJobKernel('prepare-stretch-core-image', { applicationBuildId: 'not-a-build', wasmBytes: new Uint8Array(OWNED_STRETCH_CORE.wasmBytes) }, { maxBytes: 131072, estimatedPeakBytes: 192 * 1048576 })); expect(error.message).to.include('actual worker build');
  });
});

describe('pinned primed empty stretch heap image (DSP qualification deferred)', function() {
  this.timeout(120000); let bytes;
  before(async function() { try { bytes = new Uint8Array(await fs.readFile(OWNED_STRETCH_CORE.cachePath)); } catch (error) { if (error.code === 'ENOENT') return this.skip(); throw error; } });
  it('captures the quiescent stack, private whole heap, exact I/O coordinates and complete source/configuration hashes', async () => {
    const core = await prepareOwnedStretchCore(bytes, { captureInitialImage: true, estimatedPeakBytes: 192 * 1048576, yieldControl: async () => {} });
    try {
      const image = core.getInitialImage(), metadata = image.metadata, initialHash = sha(image.heapBytes);
      expect(metadata.schema).to.equal('lemmings-stretch-initial-heap-image/v1'); expect(metadata.originalArtifactHash).to.equal(OWNED_STRETCH_CORE.wasmSha256); expect(metadata.moduleArtifactHash).to.equal(OWNED_STRETCH_CORE.imageModule.sha256); expect(sha(image.moduleBytes)).to.equal(metadata.moduleArtifactHash); expect(initialHash).to.equal(metadata.heapSha256); expect(image.heapBytes.length).to.equal(metadata.heapBytes); expect(image.heapBytes.length % 65536).to.equal(0); expect(image.heapBytes.length).to.be.at.most(32 * 1048576);
      expect(metadata.configurationHash).to.equal(core.configurationHash); expect(metadata.configuration.heapImageAbi.expectedQuiescentStack).to.equal(72800); expect(metadata.bufferPointer + metadata.bufferFrames * 16).to.be.at.most(metadata.heapBytes); expect(metadata.randomState).to.equal(metadata.configuration.randomStateAfterPreparation); expect(metadata.state).to.include('initial-primed-empty'); expect(metadata.producerRetirement).to.include('requires-worker'); expect(metadata.qualification).to.include('unqualified');
      expect(core.diagnostics().framesProcessed).to.equal(0); expect(core.diagnostics().framesSupplied).to.equal(0); expect(image.heapBytes.buffer).not.to.equal(bytes.buffer); expect(image.moduleBytes.buffer).not.to.equal(bytes.buffer); expect(image.heapBytes.buffer).not.to.equal(image.moduleBytes.buffer);
      core.setPitch(0.5); expect(core.getInitialImage()).to.equal(image); expect(sha(image.heapBytes)).to.equal(initialHash);
    } finally { core.dispose(); }
    expect(() => core.getInitialImage()).to.throw('prepared active');
  });
  it('retains the original configuration/behavior contract when image capture was not requested', async () => {
    const core = await prepareOwnedStretchCore(bytes, { estimatedPeakBytes: 64 * 1048576, yieldControl: async () => {} }); try { expect(core.configuration).not.to.have.property('heapImageAbi'); expect(() => core.getInitialImage()).to.throw('no prepared initial'); } finally { core.dispose(); }
  });
});
