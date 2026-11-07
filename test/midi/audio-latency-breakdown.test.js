import { expect } from 'chai';
import { createAudioLatencyBreakdown } from '../../js/app/midi-ui/AudioLatencyBreakdown.js';
import { createAudioRuntimeObservation } from '../../js/app/midi-ui/AudioRuntimeObservation.js';
import { normalizeAudioRuntimeConfig } from '../../js/app/midi-ui/AudioRuntimeConfig.js';
const input = () => {
  const observer = createAudioRuntimeObservation({ nowMs: () => 1000, document: { visibilityState: 'visible' } });
  const observation = observer.read({ state: 'running', sampleRate: 48000, baseLatency: 0.005, outputLatency: 0.02 }, 7, normalizeAudioRuntimeConfig()); observer.dispose();
  return { observation, observedAtHostMs: 1000, paused: false, tickDurationMs: 60, speed: 3, masterLookaheadMs: 6,
    physical: { contextEpoch: 7, sampleRate: 48000, presentationDelayMs: 24, effects: { latencyFrames: 480, routes: 2, unresolved: false },
      correlation: { presentationMs: 980, uncertaintyMs: 0.5, method: 'output-timestamp' } } };
};
describe('separate desktop latency components', () => {
  it('keeps a 20ms tick, 24ms presentation hold, 6ms mix and 10ms parallel effect maximum separate from browser estimates', () => {
    const value = createAudioLatencyBreakdown(input());
    expect(value.simulation).to.include({ quantizationMs: 20, state: 'advancing' }); expect(value.queue.configuredLeadMs).to.equal(24);
    expect(value.dsp).to.include({ masterLookaheadMs: 6, effectLatencyMs: 10, retainedEffectRoutes: 2, effectState: 'declared' });
    expect(value.correlation).to.include({ ageMs: 20, uncertaintyMs: 0.5, freshness: 'available', method: 'output-timestamp' });
    expect(value).to.include({ estimatesAreAdditive: false, acousticMeasurement: false, contextEpoch: 7 }); expect(Object.isFrozen(value.dsp)).to.equal(true);
  });
  it('distinguishes unknown, no rack, and actual zero declared effect latency', () => {
    const f = input(); f.physical.effects = null; expect(createAudioLatencyBreakdown(f).dsp.effectLatencyMs).to.equal(null);
    f.physical.effects = { latencyFrames: 0, routes: 0, unresolved: false }; expect(createAudioLatencyBreakdown(f).dsp).to.include({ effectLatencyMs: 0, effectState: 'no-effect-route' });
    f.physical.effects.routes = 1; expect(createAudioLatencyBreakdown(f).dsp.effectState).to.equal('declared');
    f.physical.effects.unresolved = true; expect(createAudioLatencyBreakdown(f).dsp.effectLatencyMs).to.equal(null);
  });
  for (const age of [-1, 2001, NaN, Infinity]) it('refuses an invalid, future or stale correlation age ' + age, () => {
    const f = input(); f.physical.correlation.presentationMs = 1000 - age;
    expect(createAudioLatencyBreakdown(f).correlation).to.include({ freshness: 'stale-or-invalid', method: null, ageMs: null });
  });
  it('drops retired-context effect/correlation evidence without dropping the configured presentation hold', () => {
    const f = input(); f.physical.contextEpoch = 6; const value = createAudioLatencyBreakdown(f);
    expect(value.correlation.freshness).to.equal('context-changed-or-unavailable'); expect(value.dsp.effectLatencyMs).to.equal(null); expect(value.queue.configuredLeadMs).to.equal(24);
    f.observation = { ...f.observation, visibility: 'unknown-or-hidden' }; expect(createAudioLatencyBreakdown(f).correlation.freshness).to.equal('hidden-or-unknown');
    f.observation = { ...f.observation, contextState: 'suspended' }; expect(createAudioLatencyBreakdown(f).correlation.freshness).to.equal('context-not-running');
  });
  it('preserves unavailable/paused simulation and absent context components instead of inventing zero', () => {
    const f = input(); f.paused = true; f.speed = 0; f.physical = null; f.masterLookaheadMs = null; f.observation = null;
    const value = createAudioLatencyBreakdown(f); expect(value.simulation).to.include({ state: 'paused', quantizationMs: null });
    expect(value.queue.configuredLeadMs).to.equal(null); expect(value.dsp.masterLookaheadMs).to.equal(null); expect(value.dsp.effectLatencyMs).to.equal(null);
    f.paused = false; expect(createAudioLatencyBreakdown(f).simulation.state).to.equal('unavailable');
    f.tickDurationMs = Number.MAX_VALUE; f.speed = Number.MIN_VALUE; expect(createAudioLatencyBreakdown(f).simulation.quantizationMs).to.equal(null);
  });
});
