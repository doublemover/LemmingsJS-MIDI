import { expect } from 'chai';
import { planSoundSourceComparison } from '../../js/app/midi-ui/SoundSourceComparison.js';

const source = (frames = 64000) => {
  const ref = { kind: 'sample', contentHash: 'a'.repeat(64), bytes: 44 + frames * 2, frames, sourceSampleRate: 32000 };
  return { pin: { ref, isActive: () => true }, patch: { engineId: 'worklet-granular', sampleRefs: [{ id: 'source', sha256: ref.contentHash, bytes: ref.bytes, required: true }],
    parameters: { regionStart01: 0.25, regionEnd01: 0.5, reverse: 1, pitchRatio: 4 } } };
};
describe('dry original and permitted-region comparison plans', () => {
  it('keeps the original forward source rate independent of cloud pitch, reverse and grain settings', () => {
    const { pin, patch } = source(), original = planSoundSourceComparison(patch, pin, 'original'), region = planSoundSourceComparison(patch, pin, 'region');
    expect(original.source).to.include({ onsetFrame: 0, endFrame: 64000, rateRatio: 1, effects: 'dry', truncated: false });
    expect(region.source).to.include({ onsetFrame: 16000, endFrame: 32000, sourceSampleRate: 32000 });
    expect(region.seconds).to.equal(0.5); expect(original.seconds).to.equal(2);
    expect(region.region).to.include({ rootCents: 6000, playbackMode: 'forward' });
    expect(region.fixture.events[0].pitchCents).to.equal(region.region.rootCents);
    expect(region.resolution.patch.engineId).to.equal('native-sample'); expect(region.fixture.source).to.equal('authored-source-comparison');
  });
  it('bounds long sources, refuses stale pins and rejects inverted or absent source regions', () => {
    const { pin, patch } = source(960000), plan = planSoundSourceComparison(patch, pin, 'original');
    expect(plan.source).to.include({ truncated: true, endFrame: 256000, requestedEndFrame: 960000, maximumSeconds: 8 });
    expect(plan.fixture.events[1].seconds).to.equal(8);
    expect(() => planSoundSourceComparison(patch, { ...pin, isActive: () => false }, 'original')).to.throw();
    expect(() => planSoundSourceComparison({ ...patch, parameters: { regionStart01: 0.5, regionEnd01: 0.25 } }, pin, 'region')).to.throw();
    expect(() => planSoundSourceComparison({ ...patch, sampleRefs: [] }, pin, 'original')).to.throw();
  });
});
