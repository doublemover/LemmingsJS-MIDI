import { expect } from 'chai';
import { encodeNativeOfflineRender } from '../../js/app/resources/NativeOfflineEncoding.js';
import { createQuarryEcho } from '../../js/midi/content/DubQuarryRack.js';
import { prepareOwnedEffectGraphPlan } from '../../js/app/midi-ui/OwnedEffectGraphKernel.js';
import { effectGraphHash } from '../../js/midi/content/EffectGraphRevision.js';

const manifest = frames => ({ schema: 'lemmings-causal-audio-render/v1', sampleRate: 48000, frames, channels: 2, sampleFormat: 'ieee-float32-le' });
const immediate = async () => {};
describe('native simultaneous graph PCM encoding', () => {
  it('processes native master PCM once through the real owned effect kernels, including discarded excitation preroll', async () => {
    const definition = createQuarryEcho({ delaySeconds: 10 / 48000, send01: 0.5, return01: 0.2, feedback: 0 }), plan = prepareOwnedEffectGraphPlan(definition, 48000, ['return']);
    const input = { mode: 'causal-take', firstFrame: 5, endFrame: 32, stemLaneIds: ['actor-a'], planes: Array.from({ length: 4 }, () => new Float32Array(64)),
      manifest: { ...manifest(27), effectGraph: { definition: plan.definition, hash: await effectGraphHash(plan), processingRevisions: plan.processingRevisions,
        latencyFrames: plan.latencyFrames, maximumTailFrames: plan.maximumTailFrames, controls: 'explicit-authored-defaults-not-replayed-live-gestures', scope: 'one-full-shared-owner-sum' }, stems: { sharedReturns: ['return'] } } };
    input.planes[0][0] = 1; input.planes[1][7] = -1; input.planes[2][6] = 0.25; const original = input.planes.map(plane => plane.slice());
    const result = await encodeNativeOfflineRender(input, { yieldControl: immediate }); expect(result.files).to.have.length(3);
    const main = new DataView(result.files[0].bytes.buffer), lane = new DataView(result.files[1].bytes.buffer), shared = new DataView(result.files[2].bytes.buffer);
    expect(main.getFloat32(56 + 5 * 8, true)).to.be.closeTo(0.1, 1e-7); expect(shared.getFloat32(56 + 5 * 8, true)).to.be.closeTo(0.1, 1e-7);
    expect(main.getFloat32(56 + 2 * 8 + 4, true)).to.equal(-1); expect(shared.getFloat32(56 + 12 * 8 + 4, true)).to.be.closeTo(-0.1, 1e-7);
    expect(lane.getFloat32(56 + 8, true)).to.equal(0.25); expect(result.files[2].manifest).to.include({ returnNodeId: 'return', laneId: null, tap: 'shared-effect-node-output' });
    expect(result.manifest.effectGraph.realization).to.include({ frame: 32, graphScope: 'one-full-shared-owner-sum' }); expect(input.planes).to.deep.equal(original);
    const wrong = { ...input, manifest: { ...input.manifest, effectGraph: { ...input.manifest.effectGraph, hash: 'c'.repeat(64) } } };
    let mismatch, capacity; try { await encodeNativeOfflineRender(wrong, { yieldControl: immediate }); } catch (error) { mismatch = error; }
    try { await encodeNativeOfflineRender(input, { yieldControl: immediate, maxWorkingBytes: 16 * 1048576 }); } catch (error) { capacity = error; }
    expect(mismatch?.message).to.include('exact executing graph'); expect(capacity?.message).to.include('workspace');
  });
  it('crops every tap at the same frame and retains float headroom in stereo order', async () => {
    const result = await encodeNativeOfflineRender({ mode: 'causal-take', manifest: manifest(2), firstFrame: 1, endFrame: 3, stemLaneIds: ['actor-a'],
      planes: [new Float32Array([99, 2, -2]), new Float32Array([99, 0.25, -0.25]), new Float32Array([99, 1, -1]), new Float32Array([99, 0.125, -0.125])] }, { yieldControl: immediate });
    expect(result.files).to.have.length(2);
    const main = new DataView(result.files[0].bytes.buffer), lane = new DataView(result.files[1].bytes.buffer);
    expect(main.getUint16(20, true)).to.equal(3); expect(main.getUint32(44, true)).to.equal(2);
    expect([56, 60, 64, 68].map(at => main.getFloat32(at, true))).to.deep.equal([2, 0.25, -2, -0.25]);
    expect([56, 60, 64, 68].map(at => lane.getFloat32(at, true))).to.deep.equal([1, 0.125, -1, -0.125]);
    expect(result.files[0].manifest.statistics.overFullScaleSamples).to.equal(2);
    expect(result.files[1].manifest.laneId).to.equal('actor-a');
  });
  it('rejects nonfinite producer data even in the silently discarded preroll', async () => {
    let error;
    try { await encodeNativeOfflineRender({ mode: 'causal-take', manifest: manifest(1), firstFrame: 1, endFrame: 2,
      planes: [new Float32Array([NaN, 0]), new Float32Array(2)] }, { yieldControl: immediate }); } catch (value) { error = value; }
    expect(error?.message).to.include('nonfinite');
  });
  it('does not encode truncated channels or silently drop an excessive stem layout', async () => {
    for (const planes of [[new Float32Array(2), new Float32Array(1)], Array.from({ length: 34 }, () => new Float32Array(2))]) {
      let error;
      try { await encodeNativeOfflineRender({ mode: 'causal-take', manifest: manifest(2), firstFrame: 0, endFrame: 2, planes,
        stemLaneIds: planes.length === 34 ? Array.from({ length: 16 }, (_, index) => 'lane-' + index) : [] }, { yieldControl: immediate }); } catch (value) { error = value; }
      expect(error?.name).to.equal('NativeOfflineEncodingError');
    }
  });
});
