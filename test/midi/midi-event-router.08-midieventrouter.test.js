import { expect } from 'chai';
import { MidiEventRouter, MidiMapping, makeRouter } from '../helpers/midi-router-fixtures.js';

describe('MidiEventRouter 8', function() {
  it('applies repeat defaults when velocity and duration are missing', function() {
    const { router } = makeRouter();
    const baseSpec = { note: 60 };

    const velocity = router._applyRepeatTarget(
      baseSpec,
      [60],
      { amount: 0.5, target: 'velocity' },
      1
    ).spec.velocity;
    expect(velocity).to.equal(96);

    const duration = router._applyRepeatTarget(
      baseSpec,
      [60],
      { amount: 0.5, target: 'duration' },
      1
    ).spec.durationTicks;
    expect(duration).to.equal(2);

    const release = router._applyRepeatTarget(
      baseSpec,
      [60],
      { amount: 0.5, target: 'release' },
      1
    ).spec.releaseVelocity;
    expect(release).to.equal(96);
  });

  it('defaults repeat targets when ranges and velocity are missing', function() {
    const router = new MidiEventRouter(new MidiMapping({
      position: { timbreRange: null, panRange: null }
    }));
    const baseSpec = { note: 60, timbre: 10, pan: 0 };
    const notes = [60];

    const timbre = router._applyRepeatTarget(
      baseSpec,
      notes,
      { amount: 0.5, target: 'timbre' },
      1
    ).spec.timbre;
    expect(timbre).to.be.within(0, 127);
    expect(timbre).to.not.equal(10);

    const pan = router._applyRepeatTarget(
      baseSpec,
      notes,
      { amount: 0.5, target: 'pan' },
      1
    ).spec.pan;
    expect(pan).to.be.within(-127, 127);

    const attack = router._applyRepeatTarget(
      { note: 60 },
      notes,
      { amount: 0.5, target: 'attack' },
      1
    ).spec.velocity;
    expect(attack).to.equal(96);
  });

  it('replaces mappings when setMapping receives a plain object', function() {
    const { router } = makeRouter();
    router.setMapping({ enabled: true });
    expect(router.mapping).to.be.instanceOf(MidiMapping);
    expect(router.mapping.config.enabled).to.equal(true);
  });

  it('clamps notes to defaults when no note range is configured', function() {
    const { router } = makeRouter({ noteRange: null, position: {} });
    const adjusted = router._applyRepeatTarget(
      { note: 60 },
      [200],
      { amount: 1, target: 'note' },
      1
    );
    expect(adjusted.activeNotes[0]).to.equal(127);
  });

  it('reuses MidiMapping instances in setMapping', function() {
    const mapping = new MidiMapping({ enabled: false });
    const { router } = makeRouter();
    router.setMapping(mapping);
    expect(router.mapping).to.equal(mapping);
  });

  it('uses repeat fallbacks when window beats and max repeats are missing', function() {
    const { router } = makeRouter();
    const bpm = router._getBpm();
    const repeatCfg = { maxRepeats: 1, windowBeats: 1 };
    router._getRepeatFactor('sfx:1', 0, repeatCfg, bpm);
    const factor = router._getRepeatFactor('sfx:1', 100, repeatCfg, bpm);
    expect(factor).to.equal(1);

    const fallback = router._getRepeatFactor('sfx:2', 50, { spacingTicks: 2 }, bpm);
    expect(fallback).to.equal(0);

    const emptyWindow = router._getRepeatFactor('sfx:3', 60, { maxRepeats: 2 }, bpm);
    expect(emptyWindow).to.equal(0);
  });

  it('replaces null mappings with defaults', function() {
    const { router } = makeRouter();
    router.setMapping(null);
    expect(router.mapping).to.be.instanceOf(MidiMapping);
  });

  it('uses repeat spacing fallbacks and default targets', function() {
    const { router } = makeRouter({
      noteRange: { min: null, max: null },
      position: null
    });
    const bpm = router._getBpm();
    router._getRepeatFactor('sfx:1', 0, { maxRepeats: 2, spacingTicks: 2 }, bpm);
    const factor = router._getRepeatFactor('sfx:1', 100, { maxRepeats: 2, spacingTicks: 2 }, bpm);
    expect(factor).to.be.greaterThan(0);

    const baseSpec = { velocity: 50, note: 200 };
    const adjusted = router._applyRepeatTarget(baseSpec, [200], { amount: 0.5 }, 1);
    expect(adjusted.spec.velocity).to.be.greaterThan(50);
    expect(adjusted.activeNotes[0]).to.equal(200);

    const noteAdjusted = router._applyRepeatTarget(
      baseSpec,
      [200],
      { amount: 0.5, target: 'note' },
      1
    );
    expect(noteAdjusted.activeNotes[0]).to.equal(127);

    const timbreAdjusted = router._applyRepeatTarget(
      { ...baseSpec, timbre: 10 },
      [60],
      { amount: 0.5, target: 'timbre' },
      1
    );
    expect(timbreAdjusted.spec.timbre).to.be.within(0, 127);
  });
});
