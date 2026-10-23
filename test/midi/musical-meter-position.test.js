import { expect } from 'chai';
import { quarterMeterPosition, meterQuarterLength } from '../../js/midi/project/MidiMusicalPosition.js';

describe('quarter position and canonical meter', () => {
  for (const unit of [1, 2, 4, 8, 16]) for (const beats of [1, 3, 6, 7, 16]) it(`preserves exact ${beats}/${unit} boundaries and denominator-note beats`, () => {
    const meter = { beats, unit }, length = meterQuarterLength(meter);
    expect(quarterMeterPosition(length - 1e-8, meter).bar).to.equal(1);
    expect(quarterMeterPosition(length, meter)).to.include({ bar: 2, beat: 1, quarter: length });
    expect(quarterMeterPosition(length + 1e-8, meter)).to.include({ bar: 2, beat: 1 });
    expect(quarterMeterPosition(length * 2, meter).bar).to.equal(3);
    expect(quarterMeterPosition(length - 4 / unit, meter).beat).to.equal(beats);
  });
  it('keeps compound-meter pulses separate from denominator-note positions', () => {
    expect(quarterMeterPosition(1.5, { beats: 6, unit: 8 })).to.include({ bar: 1, beat: 4 });
    expect(quarterMeterPosition(NaN, { beats: 4, unit: 4 })).to.equal(null);
  });
});
