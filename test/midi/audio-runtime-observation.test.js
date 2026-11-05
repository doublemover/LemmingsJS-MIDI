import { expect } from 'chai';
import { normalizeAudioRuntimeConfig, audioRuntimeContextOptions } from '../../js/app/midi-ui/AudioRuntimeConfig.js';
import { createAudioRuntimeObservation } from '../../js/app/midi-ui/AudioRuntimeObservation.js';
const events = value => Object.assign(value, { listeners: new Map(), addEventListener(type, listener) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(listener); },
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }, emit(type) { for (const listener of this.listeners.get(type) || []) listener(); },
  listenerCount() { return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0); } });
const fixture = () => {
  let host = 0, reads = 0, resets = 0;
  const document = events({ visibilityState: 'visible' });
  const stats = { underrunDuration: 0.1, underrunEvents: 2, totalDuration: 10, averageLatency: 0.02, minimumLatency: 0.01, maximumLatency: 0.03,
    resetLatency() { resets++; this.averageLatency = this.minimumLatency = this.maximumLatency = 0.025; } };
  const context = events({ state: 'running', sampleRate: 48000, baseLatency: 0.005, outputLatency: 0.02, sinkId: '', setSinkId() {} });
  Object.defineProperty(context, 'playbackStats', { configurable: true, get() { reads++; return stats; } });
  const owner = createAudioRuntimeObservation({ document, nowMs: () => host }), config = normalizeAudioRuntimeConfig();
  return { context, stats, document, owner, config, read: () => owner.read(context, 1, config), host: value => { host = value; }, reads: () => reads, resets: () => resets };
};
describe('main audio runtime configuration and observation', () => {
  it('requests profile hints and optional explicit rates without forcing a default rate', () => {
    expect(audioRuntimeContextOptions(normalizeAudioRuntimeConfig())).to.deep.equal({ latencyHint: 'interactive' });
    for (const [latencyProfile, latencyHint] of [['performance', 'interactive'], ['balanced', 'balanced'], ['robust', 'playback']]) for (const preferredSampleRate of [44100, 48000, 96000])
      expect(audioRuntimeContextOptions(normalizeAudioRuntimeConfig({ latencyProfile, preferredSampleRate, sinkPreference: 'chosen-device' }))).to.deep.equal({ latencyHint, sampleRate: preferredSampleRate, sinkId: 'chosen-device' });
    for (const value of [null, [], { extra: 1 }, { latencyProfile: '__proto__' }, { latencyProfile: {} }, { preferredSampleRate: 12345 }, { preferredSampleRate: NaN }, { sinkPreference: 'x'.repeat(257) }, { sinkPreference: 'bad\nroute' }])
      expect(() => normalizeAudioRuntimeConfig(value)).to.throw(TypeError);
  });
  it('keeps actual rate and non-additive estimates separate from requested configuration', () => {
    const f = fixture(), value = f.owner.read(f.context, 7, normalizeAudioRuntimeConfig({ preferredSampleRate: 44100, sinkPreference: 'unobserved-preference' }));
    expect(value).to.include({ actualSampleRate: 48000, baseLatencySeconds: 0.005, outputLatencySeconds: 0.02, estimatesAreAdditive: false, acousticMeasurement: false, contextEpoch: 7 });
    expect(value.config.preferredSampleRate).to.equal(44100); expect(value.outputSelection.preferenceObserved).to.equal(false);
    expect(value.playbackStats.metrics).to.include({ underrunEvents: 2, totalDuration: 10 }); f.owner.dispose();
  });
  it('reuses bounded immutable observations and reads at most once per second', () => {
    const f = fixture(), first = f.read();
    for (let time = 1; time < 1000; time++) { f.host(time); expect(f.read()).to.equal(first); }
    expect(f.reads()).to.equal(1); f.host(1000); const next = f.read(); expect(f.reads()).to.equal(2);
    expect(next.playbackStats.freshness).to.equal('unchanged-no-browser-timestamp'); expect(next.playbackStats.lastChangedAtHostMs).to.equal(0);
    f.stats.totalDuration++; f.host(2000); expect(f.read().playbackStats.lastChangedAtHostMs).to.equal(2000);
    expect(Object.isFrozen(first.playbackStats.metrics)).to.equal(true); f.owner.dispose();
  });
  it('marks hidden and suspended data stale without reading stats or asking for permissions', () => {
    const f = fixture(); f.read(); f.document.visibilityState = 'hidden'; f.document.emit('visibilitychange'); f.host(2000);
    expect(f.read().playbackStats.freshness).to.equal('stale-hidden-or-unknown'); expect(f.reads()).to.equal(1);
    f.document.visibilityState = 'visible'; f.document.emit('visibilitychange'); f.context.state = 'suspended'; f.context.emit('statechange');
    expect(f.read().playbackStats.freshness).to.equal('stale-context-not-running'); expect(f.reads()).to.equal(1);
    f.context.state = 'running'; f.context.emit('statechange'); expect(f.read().playbackStats.freshness).to.equal('unchanged-no-browser-timestamp'); expect(f.reads()).to.equal(2); f.owner.dispose();
  });
  it('starts distinct context, route and reset series and releases every listener', () => {
    const f = fixture(), first = f.read(); expect(f.document.listenerCount()).to.equal(1); expect(f.context.listenerCount()).to.equal(2);
    f.context.sinkId = 'next'; f.context.emit('sinkchange'); const routed = f.read();
    expect(routed.routeRevision).to.equal(1); expect(routed.series).to.equal(first.series + 1); expect(routed.playbackStats.metrics).to.equal(null);
    f.host(1000); const observed = f.read(); expect(observed.playbackStats.metrics.underrunEvents).to.equal(2);
    f.stats.underrunEvents = 0; f.stats.underrunDuration = 0; f.stats.totalDuration = 0; f.host(2000); expect(f.read().series).to.equal(observed.series + 1);
    const next = events({ state: 'running', sampleRate: 96000 }); const replaced = f.owner.read(next, 2, f.config);
    expect(replaced.contextEpoch).to.equal(2); expect(replaced.playbackStats.availability).to.equal('unavailable'); expect(f.context.listenerCount()).to.equal(0);
    f.owner.dispose(); expect(next.listenerCount()).to.equal(0); expect(f.document.listenerCount()).to.equal(0); expect(f.owner.read(next, 2, f.config)).to.equal(null);
  });
  it('keeps cumulative underruns and the old latency interval until reset is actually observed', () => {
    const f = fixture(), first = f.read(); expect(f.owner.resetLatency()).to.equal(true); expect(f.resets()).to.equal(1);
    const waiting = f.read(); expect(waiting.playbackStats).to.include({ latencyRevision: 1, metricsLatencyRevision: 0, latencyIntervalPending: true });
    expect(waiting.playbackStats.metrics).to.equal(first.playbackStats.metrics); f.host(1000); const refreshed = f.read();
    expect(refreshed.playbackStats).to.include({ latencyRevision: 1, metricsLatencyRevision: 1, latencyIntervalPending: false });
    expect(refreshed.playbackStats.metrics).to.include({ averageLatency: 0.025, underrunEvents: 2, totalDuration: 10 }); f.owner.dispose(); expect(f.owner.resetLatency()).to.equal(false);
  });
  it('refuses invalid clocks, replaces native statistics identity and contains reset failures', () => {
    const f = fixture(); f.host(1000); const first = f.read();
    f.host(500); expect(f.read().playbackStats.freshness).to.equal('stale-observation-clock-regressed'); expect(f.reads()).to.equal(1);
    f.host(NaN); expect(f.read().playbackStats.freshness).to.equal('invalid-observation-clock'); expect(f.reads()).to.equal(1);
    const replacement = { ...f.stats, resetLatency() { throw new Error('denied'); } };
    Object.defineProperty(f.context, 'playbackStats', { value: replacement }); f.host(2000);
    expect(f.read().series).to.equal(first.series + 1); expect(f.owner.resetLatency()).to.equal(false); f.owner.dispose();
  });
  it('reports missing, throwing, invalid and zero observations separately', () => {
    const f = fixture(); delete f.context.baseLatency; Object.defineProperty(f.context, 'outputLatency', { get() { throw new Error('denied'); } });
    Object.defineProperty(f.context, 'playbackStats', { configurable: true, get() { throw new Error('unavailable'); } });
    let value = f.read(); expect(value.baseLatencySeconds).to.equal(null); expect(value.outputLatencySeconds).to.equal(null); expect(value.playbackStats.availability).to.equal('unavailable');
    Object.defineProperty(f.context, 'playbackStats', { configurable: true, value: f.stats });
    for (const [field, bad] of [['underrunEvents', 0.5], ['averageLatency', NaN], ['totalDuration', -1], ['minimumLatency', 100], ['maximumLatency', 0]]) {
      const before = f.stats[field]; f.stats[field] = bad; f.host(value.playbackStats.sampledAtHostMs + 1000); value = f.read();
      expect(value.playbackStats.availability).to.equal('invalid'); expect(value.playbackStats.metrics).to.equal(null); expect(f.owner.resetLatency()).to.equal(false); f.stats[field] = before;
    }
    for (const key of ['underrunEvents', 'underrunDuration', 'totalDuration', 'averageLatency', 'minimumLatency', 'maximumLatency']) f.stats[key] = 0;
    f.host(value.playbackStats.sampledAtHostMs + 1000); expect(f.read().playbackStats).to.include({ availability: 'available' }); expect(f.read().playbackStats.metrics.underrunEvents).to.equal(0); f.owner.dispose();
  });
});
