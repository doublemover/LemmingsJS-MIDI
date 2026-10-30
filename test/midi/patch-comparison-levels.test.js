import { expect } from 'chai';
import { planPatchComparisonLevels } from '../../js/midi/content/PatchComparisonLevels.js';

const manifest = statistics => ({ takeId: 'actual-take', takeRevision: 3, sourceCanonicalHash: 'a'.repeat(64), laneId: 'lane',
  frames: 48000, sampleRate: 48000, timelineZeroSourceFrame: 0, exactEndSourceFrame: 48000, statistics });
describe('same-take comparison attenuation', () => {
  it('matches measured crop RMS by attenuation while bounding both resulting peaks', () => {
    const parent = manifest({ rms: 0.2, peak: 0.5 }), candidate = manifest({ rms: 0.4, peak: 0.6 }), before = JSON.stringify([parent, candidate]);
    const result = planPatchComparisonLevels(parent, candidate);
    expect(result.levels).to.deep.equal([1, 0.5]); expect(result.targetRms).to.equal(0.2); expect(result.measuredSimilarity).to.equal(null); expect(result.perceptualQuality).to.equal(null);
    expect(JSON.stringify([parent, candidate])).to.equal(before);
    const hot = planPatchComparisonLevels(manifest({ rms: 0.5, peak: 5 }), candidate);
    for (let index = 0; index < 2; index++) { expect(hot.levels[index]).to.be.within(0, 1); expect(hot.levels[index] * hot.sourcePeaks[index]).to.be.at.most(0.8000000001); expect(hot.levels[index] * hot.sourceRms[index]).to.be.closeTo(hot.targetRms, 1e-15); }
  });
  it('rejects a changed take, lane, revision, crop, rate or source clock', () => {
    const parent = manifest({ rms: 0.1, peak: 0.4 });
    for (const [key, value] of [['takeId', 'other'], ['takeRevision', 4], ['sourceCanonicalHash', 'b'.repeat(64)], ['laneId', 'other'],
      ['frames', 24000], ['sampleRate', 44100], ['timelineZeroSourceFrame', 1], ['exactEndSourceFrame', 24000]])
      expect(() => planPatchComparisonLevels(parent, { ...parent, [key]: value }), key).to.throw('same immutable');
  });
  it('rejects silent, nonfinite and inconsistent measured evidence instead of inventing a match', () => {
    const parent = manifest({ rms: 0.1, peak: 0.4 });
    for (const statistics of [null, { rms: 0, peak: 0 }, { rms: 1e-10, peak: 1e-9 }, { rms: NaN, peak: 1 }, { rms: 0.1, peak: Infinity }, { rms: 0.5, peak: 0.1 }])
      expect(() => planPatchComparisonLevels(parent, manifest(statistics))).to.throw('silent or');
  });
});
