import { expect } from 'chai';
import { prepareBufferedWarpHistory } from '../../js/app/resources/BufferedWarpHistory.js';
import { hashData } from '../../js/core/CanonicalData.js';
import { OWNED_STRETCH_CORE } from '../../js/midi/content/OwnedStretchCoreIdentity.js';
import { WARP_SOURCE_PCM_REVISION } from '../../js/app/resources/WarpSourcePcm.js';
import { createHash } from 'node:crypto';

const assetHash = 'a'.repeat(64), sha = plane => createHash('sha256').update(new Uint8Array(plane.buffer)).digest('hex');
async function fixture() {
  const configuration = { schema: 'lemmings-owned-stretch-core-configuration/v1', abi: OWNED_STRETCH_CORE.abi, artifactHash: OWNED_STRETCH_CORE.wasmSha256, sampleRate: 48000, preparedRate: 48000, channels: 2, bufferFrames: 16, inputLatencyFrames: 4, outputLatencyFrames: 2, restoration: 'deterministicPreroll', formantPolicy: 'shift-with-pitch' }, configurationHash = await hashData(configuration), planes = [Float32Array.from({ length: 11 }, (_, i) => (i + 1) / 20), Float32Array.from({ length: 11 }, (_, i) => -(i + 1) / 30)],
    metadata = { schema: 'lemmings-prepared-warp-PCM/v1', revision: WARP_SOURCE_PCM_REVISION, originalRate: 44100, originalRegionFrames: [100, 110], originalFrames: 10, preparedRate: 48000, preparedFrames: 11, normalization: 'none', planeHashes: planes.map(sha) },
    plan = { schema: 'lemmings-buffered-warp-plan/v1', assetHash, sourceRate: 44100, sourceFrames: 200, sourceFrameRegion: [100, 110], outputRate: 48000, rootPitch: { cents: 6000, referenceHz: 440 }, rateRatio: 1, pitchRatio: 1, formantPolicy: 'shift-with-pitch', loop: null, seekPolicy: 'reset-and-deterministic-preroll', algorithm: { id: 'owned-stretch-fixture', revision: 'fixture-v1', artifactHashes: [OWNED_STRETCH_CORE.wasmSha256], configurationHash, preparedRate: 48000, inputLatencyFrames: 4, outputLatencyFrames: 2, requiredPreparationLeadFrames: 128, restoration: 'deterministicPreroll', qualification: 'unqualified' } };
  return { plan, parentAssetHash: assetHash, pcm: { metadata, planes }, configuration, configurationHash, estimatedPeakBytes: 1048576 };
}
const refused = async work => { try { await work(); } catch (error) { return error; } throw new Error('Expected refusal.'); };

describe('owned buffered warp history (authored unrun; scheduling and DSP qualification separate)', () => {
  it('uses original-rate source coordinates and the actual input/output latency, with zeros outside the selected region', async () => {
    const f = await fixture(), owner = await prepareBufferedWarpHistory(f), left = new Float32Array(8), right = new Float32Array(8);
    expect(owner.historyFrames).to.equal(6); expect(owner.copyHistory(100 + 1.25 * 44100 / 48000, left, right, 1)).to.equal(-1);
    expect([...left.slice(1, 7)]).to.deep.equal([0, ...f.pcm.planes[0].slice(0, 5)]); expect([...right.slice(1, 7)]).to.deep.equal([0, ...f.pcm.planes[1].slice(0, 5)]);
    owner.copyHistory(110, left, right, 0); expect([...left.slice(0, 6)]).to.deep.equal([...f.pcm.planes[0].slice(9, 11), 0, 0, 0, 0]); owner.dispose();
  });
  it('owns immutable private planes and consumes history through pitch, seek then zero-input buffered output', async () => {
    const f = await fixture(), owner = await prepareBufferedWarpHistory(f), original = f.pcm.planes[0].slice(), calls = [], left = new Float32Array(8), right = new Float32Array(8), core = {
      configuration: f.configuration, configurationHash: f.configurationHash,
      setPitch: pitch => calls.push(['pitch', pitch]), seek: (l, r, offset, count, rate) => calls.push(['seek', [...l], [...r], offset, count, rate]), processBuffered: (l, r, offset, count) => { calls.push(['buffered', offset, count]); l.fill(0.25, offset, offset + count); r.fill(-0.5, offset, offset + count); }
    };
    f.pcm.planes[0].fill(9); owner.process(core, 100, 0.75, 2, left, right, 1, 4); expect(calls[0]).to.deep.equal(['pitch', 2]); expect(calls[1][1]).to.deep.equal([0, 0, ...original.slice(0, 4)]); expect(calls[1].slice(3)).to.deep.equal([0, 6, 0.75]); expect(calls[2]).to.deep.equal(['buffered', 1, 4]); expect([...left]).to.deep.equal([0, 0.25, 0.25, 0.25, 0.25, 0, 0, 0]); expect(owner.diagnostics()).to.include({ renderedBlocks: 1, windows: 1 }); owner.dispose();
  });
  it('rejects changed hashes, parent region, clocks, incomplete artifacts and unreserved copy/hash overlap', async () => {
    const f = await fixture(); f.pcm.planes[0][0] += 0.1; expect((await refused(() => prepareBufferedWarpHistory(f))).message).to.include('immutable hash');
    for (const update of [{ parentAssetHash: 'b'.repeat(64) }, { estimatedPeakBytes: 1 }, { configuration: { ...f.configuration, sampleRate: 44100 } }, { pcm: { ...f.pcm, metadata: { ...f.pcm.metadata, originalRegionFrames: [101, 111] } } }, { plan: { ...f.plan, algorithm: { ...f.plan.algorithm, artifactHashes: ['c'.repeat(64)] } } }]) expect(await refused(() => prepareBufferedWarpHistory({ ...f, ...update }))).to.be.instanceOf(Error);
    const image = { ...f.configuration, heapImageAbi: { moduleArtifactHash: OWNED_STRETCH_CORE.imageModule.sha256 } }, configurationHash = await hashData(image); expect((await refused(() => prepareBufferedWarpHistory({ ...f, configuration: image, configurationHash, plan: { ...f.plan, algorithm: { ...f.plan.algorithm, configurationHash } } }))).message).to.include('complete artifact');
  });
  it('preserves unavailable producer state after DSP failure, rejects aliasing and separates reference disposal from retirement', async () => {
    const f = await fixture(), owner = await prepareBufferedWarpHistory(f), output = new Float32Array(16), right = new Float32Array(16), core = { configuration: f.configuration, configurationHash: f.configurationHash, setPitch() {}, seek() { throw new Error('DSP stopped'); }, processBuffered() {} };
    expect(() => owner.copyHistory(99, output, right)).to.throw('coordinate'); expect(() => owner.copyHistory(100, output, output)).to.throw('separate'); expect(() => owner.process(core, 100, -1, 1, output, right, 0, 8)).to.throw('positive'); output.fill(1); right.fill(1); expect(() => owner.process(core, 100, 1, 1, output, right, 0, 8)).to.throw('DSP stopped'); expect([...output.slice(0, 8)]).to.deep.equal(Array(8).fill(0)); expect(owner.diagnostics().faulted).to.equal(true); expect(() => owner.copyHistory(100, output, right)).to.throw('unavailable'); expect(owner.dispose().producerRetirement).to.include('not-established');
  });
  it('waits for admitted preparation hashes and honors cancellation and generation changes before publication', async () => {
    const f = await fixture(), controller = new AbortController(); controller.abort(); expect((await refused(() => prepareBufferedWarpHistory({ ...f, signal: controller.signal }))).name).to.equal('AbortError'); expect((await refused(() => prepareBufferedWarpHistory({ ...f, current: () => false }))).message).to.include('owner changed');
  });
});
