import { fixedSourceBank } from './fixed-source-bank-fixture.js';
import { expect } from 'chai';
import { OwnedSpectrumKernel as RealSpectrumKernel, OwnedSpectrumSource as RealSpectrumSource, SPECTRUM_WIDTH, spectrumSourceBytes } from '../../js/app/midi-ui/worklet/OwnedSpectrumProcessor.js';
import { SPECTRUM_TABLES, SPECTRUM_FRAME_GAINS, SPECTRUM_LEVELS } from '../../js/app/midi-ui/worklet/SpectrumSourceTables.js';
import { BEGIN, UPDATE, PANIC } from '../../js/app/midi-ui/worklet/OwnedSineProcessor.js';

class OwnedSpectrumKernel extends RealSpectrumKernel { constructor(rate, voices) { super(rate, voices, fixedSourceBank('spectrum-v1')); } }
class OwnedSpectrumSource extends RealSpectrumSource { constructor(rate, voices) { super(rate, voices, fixedSourceBank('spectrum-v1')); } }

const begin = (mode = 0, rate = 48000, seed = 193) => {
  const command = new Float64Array(SPECTRUM_WIDTH);
  command.set([1, 0, 1, BEGIN, 0, 1, 220, 0.5, 1, 0, 48, 240, 0.8, 240, 0, 0, rate * 8, 1, seed, mode, 16, 0.4, 0.5, 0.8, mode ? 2 : 0]);
  for (let index = 0; index < 16; index++) { command[25 + index] = index + 1; command[41 + index] = 1 / (index + 1); command[57 + index] = mode ? 1 / (1 + index * 0.2) : 1; } return command;
};
describe('owned spectral-frame and additive source', () => {
  it('retains 16 closed phase-aligned frames and exact typed allocation inventories', () => {
    expect(SPECTRUM_FRAME_GAINS).to.have.length(256); expect(SPECTRUM_LEVELS).to.deep.equal([1, 2, 4, 8, 16]); expect(SPECTRUM_TABLES).to.have.length(16 * 5 * 2049);
    for (let frame = 0; frame < 16; frame++) for (let level = 0; level < 5; level++) {
      const offset = (frame * 5 + level) * 2049; expect(SPECTRUM_TABLES[offset]).to.equal(0); expect(SPECTRUM_TABLES[offset + 2048]).to.equal(0);
    }
    const source = new OwnedSpectrumSource(48000); expect(source.state.byteLength + source.partials.byteLength + source.tables.byteLength + source.sine.byteLength + source.frames.byteLength).to.equal(spectrumSourceBytes(48000));
  });
  it('preserves deterministic owned phases through block-size changes, independent actor offsets and scan reversals', () => {
    for (const mode of [0, 1]) {
      const render = (size, seed = 193) => {
        const kernel = new OwnedSpectrumKernel(48000), command = begin(mode, 48000, seed); kernel.accept(command, 1, 1);
        const update = new Float64Array(SPECTRUM_WIDTH); update.set([1, 1024, 2, UPDATE, 0, 1]); update[14] = 480; update[15] = 8 | 16 | 32; update[21] = 1; update[22] = 0; update[23] = 0.2; kernel.accept(update, 1, 2);
        const reverse = update.slice(); reverse[1] = 2048; reverse[2] = 3; reverse[21] = 0; kernel.accept(reverse, 1, 3);
        const output = new Float32Array(4096); for (let frame = 0; frame < output.length; frame += size) kernel.render(output.subarray(frame, Math.min(frame + size, output.length)), null, frame);
        expect(kernel.nonfinite).to.equal(0); expect(kernel.voice[2]).to.equal(1); expect(kernel.source.state[8]).to.equal(0); return output;
      };
      const a = render(64); expect([...render(257)]).to.deep.equal([...a]); expect([...render(128, 194)]).not.to.deep.equal([...a]);
    }
  });
  it('tapers unrepresentable partials, rejects unsupported table layouts and silences every source layer on Panic', () => {
    for (const rate of [44100, 48000, 96000]) {
      const source = new OwnedSpectrumSource(rate), table = begin(0, rate); table[25] = 1.5; expect(source.begin(0, 220, table)).to.equal(0);
      const command = begin(1, rate); command[6] = 2000; const kernel = new OwnedSpectrumKernel(rate); kernel.accept(command, 1, 1);
      const output = new Float32Array(1024); kernel.render(output, null, 0); expect(kernel.source.state[20]).to.equal(Math.min(16, Math.ceil(rate * 0.4 / 2000) - 1)); expect(output.every(Number.isFinite)).to.equal(true);
      const panic = new Float64Array(SPECTRUM_WIDTH); panic[2] = 2; panic[3] = PANIC; kernel.accept(panic, 1, 2); kernel.render(output, null, 1024);
      expect(output.slice(-128).every(value => value === 0)).to.equal(true);
    }
  });
});
