import { normalizeAudioRuntimeConfig, audioRuntimeContextOptions, audioRuntimeSinkMatches } from '../../js/app/midi-ui/AudioRuntimeConfig.js';
import { createAudioRuntimeObservation } from '../../js/app/midi-ui/AudioRuntimeObservation.js';
import { createAudioRuntimeTransition } from '../../js/app/midi-ui/AudioRuntimeTransition.js';
import { createAudioLatencyBreakdown } from '../../js/app/midi-ui/AudioLatencyBreakdown.js';
import { createAudioOutputWatch } from '../../js/app/midi-ui/AudioOutputWatch.js';
import type { AudioRuntimeSnapshot } from '../../js/app/midi-ui/AudioRuntimeContracts.js';
const config = normalizeAudioRuntimeConfig({ latencyProfile: 'balanced', preferredSampleRate: 44100 });
const request: AudioContextOptions = audioRuntimeContextOptions(config);
const observer = createAudioRuntimeObservation({ nowMs: () => performance.now(), document });
declare const context: AudioContext;
const snapshot = observer.read(context, 3, config);
const reset: boolean = observer.resetLatency();
void request; void reset;
// @ts-expect-error Runtime profiles use the authored supported names.
normalizeAudioRuntimeConfig({ latencyProfile: 'fastest' });
// @ts-expect-error Preferred rates are the supported authored literal values.
normalizeAudioRuntimeConfig({ preferredSampleRate: 22050 });
// @ts-expect-error Device preferences are identifiers, not arbitrary option objects.
normalizeAudioRuntimeConfig({ sinkPreference: { type: 'none' } });
// @ts-expect-error Runtime context options require a normalized complete configuration.
audioRuntimeContextOptions({ latencyProfile: 'performance' });
// @ts-expect-error Context epochs are numeric ownership revisions.
observer.read(context, 'old-context', config);
// @ts-expect-error Clock observations must report numeric milliseconds.
createAudioRuntimeObservation({ nowMs: () => 'today' });
// @ts-expect-error Saved normalized configuration is immutable.
config.preferredSampleRate = 48000;
if (snapshot) {
  const schema: 'lemmings-audio-runtime-observation/v1' = snapshot.schema;
  const units: 'seconds-except-underrun-event-count' = snapshot.playbackStats.units;
  void schema; void units;
  // @ts-expect-error Snapshot ownership is immutable.
  snapshot.contextEpoch = 0;
  // @ts-expect-error Nested requested preferences are immutable.
  snapshot.config.latencyProfile = 'robust';
  // @ts-expect-error Nested statistic revisions are immutable.
  snapshot.playbackStats.metricsLatencyRevision++;
  if (snapshot.playbackStats.metrics) {
    // @ts-expect-error Native observed counters are immutable.
    snapshot.playbackStats.metrics.underrunEvents++;
  }
  // @ts-expect-error Availability is an explicit supported classification.
  const invalidAvailability: AudioRuntimeSnapshot = { ...snapshot, playbackStats: { ...snapshot.playbackStats, availability: 'supported' } };
  // @ts-expect-error Millisecond latency fields cannot replace declared seconds fields.
  const wrongUnits: AudioRuntimeSnapshot = { ...snapshot, playbackStats: { ...snapshot.playbackStats, units: 'milliseconds' } };
  // @ts-expect-error Schema versions cannot be silently widened.
  const invalidSchema: AudioRuntimeSnapshot = { ...snapshot, schema: 'lemmings-audio-runtime-observation/v2' };
  void invalidAvailability; void wrongUnits; void invalidSchema;
}
observer.dispose();
const transitions = createAudioRuntimeTransition({ getConfig: () => config, getContext: () => context, isRetired: () => false,
  quiesce: async () => true, retireContext: async () => true, commit: () => {} });
const transitionPending: boolean = transitions.isPending(); void transitionPending;
// @ts-expect-error A native transition must acknowledge output retirement asynchronously.
createAudioRuntimeTransition({ getConfig: () => config, getContext: () => context, isRetired: () => false, quiesce: () => true, retireContext: async () => true, commit: () => {} });
// @ts-expect-error Closure acknowledgment is required before replacing a context.
createAudioRuntimeTransition({ getConfig: () => config, getContext: () => context, isRetired: () => false, quiesce: async () => true, commit: () => {} });
// @ts-expect-error Runtime transition profiles use the same canonical configuration contract.
transitions.request({ latencyProfile: 'fastest' });
const outputMatch: boolean | null = audioRuntimeSinkMatches({ type: 'none' }, ''); void outputMatch;
// @ts-expect-error Output preferences remain identifiers, not booleans.
audioRuntimeSinkMatches('', false);
const latency = createAudioLatencyBreakdown({ observation: snapshot, observedAtHostMs: performance.now(), paused: false, physical: null, masterLookaheadMs: 6 });
// @ts-expect-error Latency observations retain numeric units.
createAudioLatencyBreakdown({ observation: snapshot, observedAtHostMs: 'now', paused: false, physical: null, masterLookaheadMs: 6 });
// @ts-expect-error Nested latency observations are immutable.
latency.dsp.effectLatencyMs = 0;
// @ts-expect-error Digital estimates do not establish an acoustic measurement.
const acoustic: true = latency.acousticMeasurement;
void acoustic;
const outputWatch = createAudioOutputWatch({ mediaDevices: navigator.mediaDevices, permissions: navigator.permissions, watchPermission: true, onChange: reason => { const change: 'devices-changed' | 'speaker-permission-revoked' = reason; void change; } });
// @ts-expect-error An output watch requires an owned change callback.
createAudioOutputWatch({});
// @ts-expect-error Observer state is immutable.
outputWatch.state().devicesListening = true;
outputWatch.dispose();
