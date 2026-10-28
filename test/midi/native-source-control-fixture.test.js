import { expect } from 'chai';
import { SOUND_CONTENT_CONTROL_FIXTURE, nativeSourceControlFixture } from '../../js/midi/content/SoundContentControlFixture.js';

describe('resolved native source control auditions', () => {
  it('retains pressure/pan and explicitly holds a fixed-tuning fitted body at zero bend', () => {
    const patch = { engineId: 'native-modal', parameters: { maxBendCents: 0 } }, before = structuredClone(patch), result = nativeSourceControlFixture(patch);
    expect(result.bendProfile).to.deep.equal({ requestedCents: 100, effectiveCents: 0, maximumCents: 0, policy: 'resolved-source-maxBendCents' });
    expect(result.events[2].expression).to.deep.equal({ pressure01: 0.5, pan01: 0.5, pitchOffsetCents: 0 });
    expect(result.events.map(event => [event.kind, event.seconds])).to.deep.equal(SOUND_CONTENT_CONTROL_FIXTURE.events.map(event => [event.kind, event.seconds]));
    expect(patch).to.deep.equal(before); expect(SOUND_CONTENT_CONTROL_FIXTURE.events[2].expression.pitchOffsetCents).to.equal(100); expect(result.physicalTakeEvidence).to.equal(false);
  });
  it('uses the resolved smaller bend or the authored100-cent gesture without expanding the source capability', () => {
    for (const engineId of ['native-fm', 'native-modal']) for (const maximumCents of [25, 100, 1200]) {
      const result = nativeSourceControlFixture({ engineId, parameters: { maxBendCents: maximumCents } });
      expect(result.id).to.equal(engineId + '-pressure-pan-bounded-bend-v1'); expect(result.events[2].expression.pitchOffsetCents).to.equal(Math.min(100, maximumCents));
      expect(Object.isFrozen(result.events[2].expression)).to.equal(true);
    }
  });
  it('refuses missing, invalid or unrelated capability data rather than guessing an audition profile', () => {
    for (const patch of [null, { engineId: 'worklet-sample', parameters: { maxBendCents: 100 } }, ...[undefined, NaN, -1, 1201].map(maxBendCents => ({ engineId: 'native-modal', parameters: { maxBendCents } }))])
      expect(() => nativeSourceControlFixture(patch)).to.throw('resolved bend profile');
  });
});
