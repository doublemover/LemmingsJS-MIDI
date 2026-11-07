import { expect } from 'chai';
import { admitPcmChannels, admitPcmBuffer, measurePcmWindow, comparePcmChannels, admitPcmMetrics } from '../../js/app/midi-ui/PcmEvidence.js';

describe('Fail-closed PCM evidence admission', () => {
  const fixture = () => [new Float32Array([0, 0.25, -0.5, 0]), new Float32Array([0, -0.25, 0.5, 0]), new Float32Array(4)];
  it('admits finite required channels, positive windows and exact comparison controls', () => {
    const data = fixture(); expect(admitPcmChannels(data)).to.include({ channels: 3, frames: 4, samples: 12 });
    expect(measurePcmWindow(data, 8000, 0, 4 / 8000)).to.include({ peak: 0.5, nonfinite: 0, samples: 12 });
    expect(comparePcmChannels(data, fixture())).to.equal(0);
    expect(admitPcmMetrics({ full: { peak: 0.5 } }, ['full.peak'])).to.equal(true);
  });
  for (const bad of [NaN, Infinity, -Infinity]) for (const channel of [0, 1, 2]) for (const frame of [0, 3])
    it('rejects ' + bad + ' in required channel ' + channel + ' frame ' + frame + ', including a shuffled-only defect', () => {
      const badRun = fixture(); badRun[channel][frame] = bad;
      expect(() => admitPcmChannels(badRun)).to.throw(/Nonfinite PCM/);
      expect(() => comparePcmChannels(fixture(), badRun)).to.throw(/Nonfinite PCM/);
      expect(() => admitPcmBuffer({ sampleRate: 8000, numberOfChannels: 3, length: 4, getChannelData: index => badRun[index] }, 3)).to.throw(/Nonfinite PCM/);
    });
  it('rejects empty, mismatched, out-of-range and overflowing numerical evidence', () => {
    expect(() => admitPcmChannels([])).to.throw(); expect(() => comparePcmChannels(fixture(), [new Float32Array(4)])).to.throw();
    for (const window of [[0, 0], [0, 0.00001], [-1, 1], [0, 1]]) expect(() => measurePcmWindow(fixture(), 8000, ...window)).to.throw();
    expect(() => measurePcmWindow([new Float64Array([1e308, -1e308])], 8000, 0, 2 / 8000)).to.throw(/Nonfinite/);
    for (const value of [undefined, null, NaN, Infinity, '0']) expect(() => admitPcmMetrics({ peak: value }, ['peak'])).to.throw();
  });
});
