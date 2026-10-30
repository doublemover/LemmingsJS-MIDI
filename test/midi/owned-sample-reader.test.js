import { expect } from 'chai';
import { computeOwnedSourceBank } from '../../js/app/resources/OwnedSourceBankComputation.js';
import { getOwnedSourceBankIdentity } from '../../js/app/midi-ui/OwnedSourceBank.js';
import { OwnedSampleReader } from '../../js/app/midi-ui/worklet/OwnedSampleReader.js';
import { SAMPLE_READ_BANK_ID, SAMPLE_READ_TAPS, SAMPLE_READ_PHASES, SAMPLE_READ_LEVELS } from '../../js/midi/content/SampleReadProfile.js';

describe('original prepared sample read filter', () => {
  let bank;
  before(async () => { bank = await computeOwnedSourceBank(SAMPLE_READ_BANK_ID, { yieldControl: async () => {} }); });
  it('pins the complete generated table, exact row DC and a conservative interpolated peak bound', () => {
    const reader = new OwnedSampleReader(bank), table = bank.planes[0]; let maximum = 0;
    for (let row = 0; row < (SAMPLE_READ_PHASES + 1) * SAMPLE_READ_LEVELS; row++) {
      let sum = 0, l1 = 0; for (let tap = 0; tap < SAMPLE_READ_TAPS; tap++) { const value = table[row * SAMPLE_READ_TAPS + tap]; sum += value; l1 += Math.abs(value); }
      expect(sum).to.equal(1); maximum = Math.max(maximum, l1);
    }
    expect(reader.maximumL1).to.equal(maximum); expect(bank.bytes).to.equal(getOwnedSourceBankIdentity(SAMPLE_READ_BANK_ID).bytes);
    const constant = new Float32Array(512).fill(0.75);
    for (const rate of [0, 0.5, 1, 1.2, 2, 3.5, 4]) for (const position of [0, 1.25, 127.5, 511.9]) { expect(reader.read(constant, null, position, rate, 0, 512)).to.equal(true); expect(reader.leftSample).to.be.closeTo(0.75, 1e-12); expect(reader.rightSample).to.equal(reader.leftSample); }
  });
  for (const sourceRate of [44100, 48000, 96000]) it('reads known fractional source phases and preserves opposing stereo channels at ' + sourceRate, () => {
    const reader = new OwnedSampleReader(bank), frequency = 640, left = Float32Array.from({ length: sourceRate }, (_, index) => Math.sin(2 * Math.PI * frequency * index / sourceRate)), right = Float32Array.from(left, value => -value);
    for (const derivative of [-4, -1.3, -0.5, 0, 0.75, 1, 2.7, 4]) for (let phase = 0; phase < 32; phase++) {
      const position = 1000 + phase / 32; expect(reader.read(left, right, position, derivative, 0, left.length)).to.equal(true);
      expect(reader.leftSample).to.be.closeTo(Math.sin(2 * Math.PI * frequency * position / sourceRate), 0.0002); expect(reader.rightSample).to.equal(-reader.leftSample);
    }
  });
  it('keeps region edge remapping explicit and never touches out-of-region guard samples', () => {
    const reader = new OwnedSampleReader(bank), pcm = new Float32Array(512).fill(NaN); pcm.fill(1, 100, 200);
    for (const mode of ['clamp', 'zero', 'wrap', 'reflect']) for (const position of [100, 100.25, 199.75]) { expect(reader.read(pcm, null, position, -3, 100, 200, mode)).to.equal(true); expect(Number.isFinite(reader.leftSample)).to.equal(true); }
    expect(reader.read(pcm, null, 200, 1, 100, 200)).to.equal(false); expect(reader.read(pcm, null, 150, 5, 100, 200)).to.equal(false); expect(reader.read(pcm, null, 150, 1, 100, 200, '__proto__')).to.equal(false);
  });
  it('attenuates a high source tone before its faster read folds into the output band', () => {
    const reader = new OwnedSampleReader(bank), rate = 48000, pcm = Float32Array.from({ length: rate }, (_, index) => Math.sin(2 * Math.PI * 18000 * index / rate));
    let squares = 0;
    for (let frame = 0; frame < 4096; frame++) { reader.read(pcm, null, 1000.37 + frame * 2, 2, 0, pcm.length); squares += reader.leftSample ** 2; }
    const relativeDb = 20 * Math.log10(Math.sqrt(squares / 4096) / Math.SQRT1_2); expect(relativeDb).to.be.lessThan(-60);
  });
});
