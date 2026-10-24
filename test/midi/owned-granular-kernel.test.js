import { fixedSourceBank } from './fixed-source-bank-fixture.js';
import { expect } from 'chai';
import { OwnedGranularKernel as RealGranularKernel, OwnedGranularSource as RealGranularSource, GRANULAR_WIDTH, granularSourceBytes } from '../../js/app/midi-ui/worklet/OwnedGranularProcessor.js';
import { BEGIN, UPDATE, PANIC, MAX_VOICES } from '../../js/app/midi-ui/worklet/OwnedSineProcessor.js';

class OwnedGranularKernel extends RealGranularKernel { constructor(rate, pcm, voices) { super(rate, pcm, voices, fixedSourceBank('grain-window-v1')); } }
class OwnedGranularSource extends RealGranularSource { constructor(rate, pcm, voices) { super(rate, pcm, voices, fixedSourceBank('grain-window-v1')); } }

const pcm = (rate = 48000, channels = 1) => {
  const frames = rate, left = Float32Array.from({ length: frames }, (_, frame) => Math.sin(frame / rate * Math.PI * 440) * 0.5);
  return { descriptor: { schema: 'lemmings-owned-pcm-bank/v1', assetHash: 'a'.repeat(64), pcmHash: 'b'.repeat(64), bankHash: 'c'.repeat(64), format: 'float32-planar-le',
    sampleRate: rate, sourceSampleRate: rate, sourceFrames: frames, frames, channels, bytes: frames * channels * 4, peak: 0.5 },
  planes: channels === 1 ? [left] : [left, Float32Array.from(left, value => -value)] };
};
const begin = (rate = 48000, seed = 193, spread = 0.2) => {
  const command = new Float64Array(GRANULAR_WIDTH);
  command.set([1, 0, 1, BEGIN, 0, 1, 220, 0.5, 1, 0, 0, 0, 1, 240, 0, 0, rate * 4, 1, seed, 0.2, 48, 100, 1, spread, 0, rate, 0, 0, 1, 0, 0, 220, 1]); return command;
};
describe('owned deterministic granular source', () => {
  it('keeps grain selection and PCM invariant across render block sizes with bounded preallocated storage', () => {
    const render = size => {
      const kernel = new OwnedGranularKernel(48000, pcm()), command = begin(); kernel.accept(command, 1, 1); const output = new Float32Array(12000);
      for (let frame = 0; frame < output.length; frame += size) kernel.render(output.subarray(frame, Math.min(output.length, frame + size)), null, frame);
      expect(kernel.nonfinite).to.equal(0); expect(kernel.source.inspect().activeGrains).to.be.at.most(128); return { kernel, output };
    };
    const a = render(64), b = render(257); expect([...a.output]).to.deep.equal([...b.output]); expect(a.kernel.source.inspect()).to.deep.equal(b.kernel.source.inspect());
    const source = a.kernel.source; expect(source.state.byteLength + source.grains.byteLength + source.window.byteLength).to.equal(granularSourceBytes(48000));
    expect(source.inspect().clouds[0].admittedGrains).to.be.greaterThan(1); expect(a.output.some(value => Math.abs(value) > 1e-5)).to.equal(true);
  });
  it('preserves antiphase stereo and measures pre-pan energy without reducing it to an inaudible mono sum', () => {
    const kernel = new OwnedGranularKernel(48000, pcm(48000, 2)), command = begin(48000, 193, 0), tokens = new Uint32Array(MAX_VOICES); tokens[0] = 1;
    expect(kernel.configureDisplay(tokens, 2048, 1)).to.equal(true); kernel.accept(command, 1, 1);
    const left = new Float32Array(8192), right = new Float32Array(8192); kernel.render(left, right, 0);
    expect(left.some(value => Math.abs(value) > 1e-5)).to.equal(true); expect(right.every((value, index) => value === -left[index])).to.equal(true);
    expect(kernel.displayData[8]).to.be.greaterThan(0); expect(kernel.displayData[9]).to.be.greaterThan(0);
  });
  it('holds source position explicitly, resumes its pending scan and retires every child on Panic at all profile rates', () => {
    for (const rate of [44100, 48000, 96000]) {
      const kernel = new OwnedGranularKernel(rate, pcm(rate)), output = new Float32Array(2048); kernel.accept(begin(rate), 1, 1); kernel.render(output, null, 0);
      const freeze = new Float64Array(GRANULAR_WIDTH); freeze.set([1, 2048, 2, UPDATE, 0, 1]); freeze[14] = 100; freeze[15] = 8 | 128; freeze[19] = 1; freeze[26] = 1;
      kernel.accept(freeze, 1, 2); kernel.render(output, null, 2048); expect(kernel.source.inspect().clouds[0]).to.include({ sourcePosition01: 0.2, freezeMode: 'source-position-hold' });
      freeze[1] = 4096; freeze[2] = 3; freeze[15] = 128; freeze[26] = 0; kernel.accept(freeze, 1, 3); kernel.render(output, null, 4096);
      expect(kernel.source.inspect().clouds[0]).to.include({ sourcePosition01: 1, freezeMode: 'none' }); expect(kernel.voice[2]).to.equal(1);
      const panic = new Float64Array(GRANULAR_WIDTH); panic[2] = 4; panic[3] = PANIC; kernel.accept(panic, 1, 4); kernel.render(output, null, 6144);
      expect(output.slice(-256).every(value => value === 0)).to.equal(true); expect(kernel.source.inspect().activeGrains).to.equal(0); expect(kernel.source.grains.every((value, index) => index % 14 || value === 0)).to.equal(true);
    }
  });
  it('does not replenish a motion-gated stationary cloud and reports rejected births without allocating beyond its pool', () => {
    const source = new OwnedGranularSource(48000, pcm()), command = begin(); command[27] = 1; command[28] = 0; expect(source.begin(0, 220, command, 0)).to.equal(1);
    for (let frame = 0; frame < 2000; frame++) source.sample(0, 220, frame); expect(source.inspect().clouds[0].requestedGrains).to.equal(0);
    for (let index = 0; index < 100; index++) source.spawn(0, 220, 2048);
    expect(source.inspect().clouds[0]).to.include({ activeGrains: 16, requestedGrains: 100, admittedGrains: 16, rejectedGrains: 84 });
    source.retire(0); expect(source.inspect().activeGrains).to.equal(0);
  });
});
