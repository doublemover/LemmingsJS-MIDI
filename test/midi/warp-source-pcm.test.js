import { expect } from 'chai';
import { prepareWarpSourcePcm } from '../../js/app/resources/WarpSourcePcm.js';
import { computeOwnedSourceBank } from '../../js/app/resources/OwnedSourceBankComputation.js';
import { bakeSeedWarp } from '../../js/app/resources/SeedWarpBake.js';
import { canonicalDataText } from '../../js/core/CanonicalData.js';
import { OWNED_STRETCH_CORE } from '../../js/midi/content/OwnedStretchCoreIdentity.js';

const fixture = (sampleRate = 48000, frames = 4096) => { const left = Float32Array.from({ length: frames }, (_, index) => Math.sin(2 * Math.PI * 440 * index / sampleRate) * 0.1), right = Float32Array.from(left, value => -value); let reads = 0; return { left, right, source: { frames, sampleRate, firstFrame: 100, endFrame: 100 + frames, sample(frame, channel) { if (frame < 0 || frame >= frames) throw new Error('Unselected parent material was read.'); reads++; return (channel ? right : left)[frame]; } }, reads: () => reads }; };
const refusal = async work => { try { await work(); } catch (error) { return error; } throw new Error('Expected refusal.'); };

describe('private prepared-rate warp PCM and worker bake admission (qualification deferred)', function() {
  this.timeout(120000); let bank;
  before(async () => { bank = await computeOwnedSourceBank('sample-read-v1', { yieldControl: async () => {} }); });
  it('keeps an equal-rate copy independent of the source cache and retains actual region coordinates', async () => {
    const f = fixture(), expected = f.left.slice(), result = await prepareWarpSourcePcm(f.source, { outputRate: 48000, bank: null }); expect(result.metadata).to.include({ originalRate: 48000, preparedRate: 48000, originalFrames: 4096, preparedFrames: 4096 }); expect(result.metadata.originalRegionFrames).to.deep.equal([100, 4196]); expect(result.metadata.passes).to.have.length(0); f.left.fill(0.8); expect(result.planes[0]).to.deep.equal(expected); expect(f.reads()).to.equal(8192); expect(result.metadata.planeHashes.every(hash => /^[a-f0-9]{64}$/.test(hash))).to.equal(true);
  });
  for (const [sourceRate, outputRate] of [[32000, 48000], [44100, 96000], [96000, 44100], [192000, 44100]]) it('uses bounded zero-boundary conversion without moving stereo at ' + sourceRate + '/' + outputRate, async () => {
    const f = fixture(sourceRate, 4096), before = f.left.slice(), result = await prepareWarpSourcePcm(f.source, { outputRate, bank, yieldControl: async () => {} }); expect(result.planes[0].length).to.equal(Math.ceil(4096 * outputRate / sourceRate)); expect(result.metadata.preparedFrames).to.equal(result.planes[0].length); expect(result.metadata.passes.every(pass => pass.derivative <= 4)).to.equal(true); if (sourceRate === 192000) expect(result.metadata.passes).to.have.length(2); expect(result.metadata.originalRegionFrames).to.deep.equal([100, 4196]); expect(f.left).to.deep.equal(before); expect(f.reads()).to.equal(8192);
    for (let index = 0; index < result.planes[0].length; index++) { expect(Number.isFinite(result.planes[0][index])).to.equal(true); expect(Math.abs(result.planes[0][index] + result.planes[1][index])).to.be.lessThan(1e-8); }
  });
  it('rejects stale/canceled conversion and inadequate prepared resolution before publication', async () => {
    const f = fixture(), controller = new AbortController(); expect(await refusal(() => prepareWarpSourcePcm(f.source, { outputRate: 96000, bank, signal: controller.signal, yieldControl: async () => controller.abort() }))).to.be.instanceOf(Error);
    let current = true; expect((await refusal(() => prepareWarpSourcePcm(f.source, { outputRate: 96000, bank, current: () => current, yieldControl: async () => { current = false; } }))).message).to.include('region changed'); const tiny = fixture(192000, 2); expect((await refusal(() => prepareWarpSourcePcm(tiny.source, { outputRate: 44100, bank }))).message).to.include('two prepared-rate frames');
  });
  it('requires the complete core and admitted bake workspace rather than silently running another renderer', async () => {
    expect((await refusal(() => bakeSeedWarp({}, { estimatedPeakBytes: 64 * 1048576 }))).message).to.include('128 MiB');
    const f = fixture(), pcm = new Uint8Array(f.source.frames * 8), view = new DataView(pcm.buffer); for (let frame = 0; frame < f.source.frames; frame++) { view.setFloat32(frame * 8, f.left[frame], true); view.setFloat32(frame * 8 + 4, f.right[frame], true); }
    const origin = { schema: 'lemmings-sound-seed/v1', frames: f.source.frames, sampleRate: 48000, ancestry: [{}], tap: 'fixture', bakedEffects: 'none-declared', bakedCausePolicy: 'baked-only', coverage: { status: 'known-material', gaps: [] } }, input = { pcm, originBytes: canonicalDataText(origin).bytes, source: { sampleRate: 48000, sourceFrames: f.source.frames, formatVersion: origin.schema, immutableSourceRef: 'a'.repeat(64) }, firstFrame: 0, endFrame: f.source.frames, sampleRate: 48000, generation: 1, options: { rateRatio: 1, pitchRatio: 1, outputRate: 48000 }, wasmBytes: new Uint8Array(OWNED_STRETCH_CORE.wasmBytes) };
    expect(await refusal(() => bakeSeedWarp({ ...input, options: { ...input.options, rateRatio: -1 } }, { estimatedPeakBytes: 128 * 1048576 }))).to.be.instanceOf(Error); expect(await refusal(() => bakeSeedWarp(input, { estimatedPeakBytes: 128 * 1048576 }))).to.be.instanceOf(Error);
  });
});
