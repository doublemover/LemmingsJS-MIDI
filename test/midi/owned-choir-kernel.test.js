import { fixedSourceBank } from './fixed-source-bank-fixture.js';
import { expect } from 'chai';
import { OwnedChoirKernel as RealChoirKernel, OwnedChoirSource as RealChoirSource, CHOIR_WIDTH, choirSourceBytes } from '../../js/app/midi-ui/worklet/OwnedChoirProcessor.js';
import { BEGIN, UPDATE, PANIC } from '../../js/app/midi-ui/worklet/OwnedSineProcessor.js';
import { CHOIR_EXCITER_HARMONICS, CHOIR_EXCITER_TABLE } from '../../js/app/midi-ui/worklet/ChoirExciterTable.js';

class OwnedChoirKernel extends RealChoirKernel { constructor(rate, voices) { super(rate, voices, fixedSourceBank('choir-v1')); } }
class OwnedChoirSource extends RealChoirSource { constructor(rate, voices) { super(rate, voices, fixedSourceBank('choir-v1')); } }

const begin = (rate = 48000, seed = 191) => {
  const command = new Float64Array(CHOIR_WIDTH);
  command.set([1, 0, 1, BEGIN, 0, 1, 220, 0.4, 1, 0, 0, 0, 1, rate * 0.005, 0, 0, rate * 62, 1, seed, 0, 0.2, 1, 0, 0, 0, 1]); return command;
};
const render = (seed, blockSize) => {
  const kernel = new OwnedChoirKernel(48000); kernel.accept(begin(48000, seed), 1, 1); const output = new Float32Array(4096);
  for (let frame = 0; frame < output.length; frame += blockSize) kernel.render(output.subarray(frame, Math.min(output.length, frame + blockSize)), null, frame);
  return { kernel, output };
};
describe('owned artificial formant choir', () => {
  it('retains phase-aligned closed table levels and selects bounded harmonics for fixed pitches', () => {
    expect(CHOIR_EXCITER_HARMONICS).to.deep.equal([1, 2, 4, 8, 16, 32, 64, 128]);
    expect(CHOIR_EXCITER_TABLE).to.have.length(2049 * 8);
    for (let level = 0; level < 8; level++) {
      expect(CHOIR_EXCITER_TABLE[level * 2049]).to.equal(0); expect(CHOIR_EXCITER_TABLE[level * 2049 + 2048]).to.equal(0);
    }
    for (const rate of [44100, 48000, 96000]) for (const frequency of [50, 220, 2000]) {
      const source = new OwnedChoirSource(rate), command = begin(rate); command[6] = frequency; command[22] = 12; command[23] = 12;
      expect(source.begin(0, frequency, command)).to.equal(1); source.sample(0, frequency);
      const limit = rate * 0.4 / (frequency * Math.max(1, source.state[30]) * Math.max(1, source.state[35]));
      expect(CHOIR_EXCITER_HARMONICS[source.state[36]]).to.be.at.most(limit); expect(source.state[37]).to.be.within(0, 1);
    }
  });
  it('keeps deterministic independent breath and oscillator state across render block sizes', () => {
    const a = render(191, 64), b = render(191, 257), other = render(192, 128);
    expect([...a.output]).to.deep.equal([...b.output]); expect([...other.output]).not.to.deep.equal([...a.output]);
    const source = new OwnedChoirSource(96000); expect(source.state.byteLength + source.table.byteLength + source.bands.byteLength).to.equal(choirSourceBytes(96000));
    expect(a.output.some(value => Math.abs(value) > 0.00001)).to.equal(true);
  });
  it('moves vowels and size independently of pitch without another onset or seed reset', () => {
    const { kernel } = render(191, 128), seedBefore = kernel.source.state[2], token = kernel.voice[2];
    const update = new Float64Array(CHOIR_WIDTH); update.set([1, 4096, 2, UPDATE, 0, 1]); update[14] = 480; update[15] = 8 | 32; update[19] = 1; update[21] = 2;
    kernel.accept(update, 1, 2); const buffer = new Float32Array(128);
    for (let frame = 4096; frame < 5120; frame += 128) kernel.render(buffer, null, frame);
    expect(kernel.voice[5]).to.equal(220); expect(kernel.voice[2]).to.equal(token); expect(kernel.source.state[2]).not.to.equal(seedBefore);
    expect(kernel.source.bands[6]).to.be.closeTo(150, 1e-9); expect(kernel.source.bands[14]).to.be.closeTo(1100, 1e-8);
    expect(kernel.active[0]).to.equal(1); expect(kernel.nonfinite).to.equal(0);
  });
  it('keeps a 60-second held voice finite through rapid controls at every supported sample rate, then silences every layer', function() {
    this.timeout(60000);
    for (const rate of [44100, 48000, 96000]) {
      const kernel = new OwnedChoirKernel(rate); kernel.accept(begin(rate), 1, 1); const output = new Float32Array(128); let serial = 1, next = 0, peak = 0;
      for (let frame = 0; frame < rate * 60; frame += 128) {
        if (frame >= next) {
          const update = new Float64Array(CHOIR_WIDTH), alternate = serial % 2; update.set([1, frame, ++serial, UPDATE, 0, 1]);
          update[14] = Math.ceil(rate * 0.008); update[15] = 8 | 16 | 32 | 256; update[19] = alternate; update[20] = alternate ? 0.7 : 0.05;
          update[21] = alternate ? 0.5 : 2; update[25] = alternate ? 2 : 0.5; kernel.accept(update, 1, serial); next += Math.ceil(rate / 5);
        }
        kernel.render(output, null, frame); kernel.receiptCount = 0;
        for (const sample of output) { if (!Number.isFinite(sample)) throw new Error('Nonfinite held choir output.'); peak = Math.max(peak, Math.abs(sample)); }
      }
      expect(peak).to.be.within(0.00001, 8); expect(kernel.nonfinite).to.equal(0);
      const frame = kernel.lastFrame, panic = new Float64Array(CHOIR_WIDTH); panic[2] = ++serial; panic[3] = PANIC; kernel.accept(panic, 1, serial);
      for (let offset = 0; offset < 1024; offset += 128) kernel.render(output, null, frame + offset);
      expect(output.every(value => value === 0)).to.equal(true);
    }
  });
});
