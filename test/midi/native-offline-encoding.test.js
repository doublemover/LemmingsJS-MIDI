import { expect } from 'chai';
import { encodeNativeOfflineRender } from '../../js/app/resources/NativeOfflineEncoding.js';

const manifest = frames => ({ schema: 'lemmings-causal-audio-render/v1', sampleRate: 48000, frames, channels: 2, sampleFormat: 'ieee-float32-le' });
const immediate = async () => {};
describe('native simultaneous graph PCM encoding', () => {
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
