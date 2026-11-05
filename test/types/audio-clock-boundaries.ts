import { createAudioClockBridge } from '../../js/app/procgen/workstation/AudioClockBridge.js';
import type { AudioFrame, AudioSeconds, DurationMilliseconds, ExecutionEpoch, HostMilliseconds, ScoreBeats, ScoreEpoch, TempoBpm } from '../../js/app/procgen/workstation/AudioClockContracts.js';

declare const hostMs: HostMilliseconds;
declare const audioSeconds: AudioSeconds;
declare const frame: AudioFrame;
declare const beat: ScoreBeats;
declare const delay: DurationMilliseconds;
declare const bpm: TempoBpm;
declare const executionEpoch: ExecutionEpoch;
declare const scoreEpoch: ScoreEpoch;
const bridge = createAudioClockBridge({ getContext: () => ({ state: 'running', currentTime: 1, sampleRate: 48000 }), nowMs: () => hostMs, presentationDelayMs: delay });
const anchor = bridge.rebase({ executionEpoch, scoreEpoch, beat, hostMs, bpm });
const target: AudioFrame | null = bridge.toTargetFrame({ epoch: scoreEpoch, beat }, executionEpoch);
void target;
// @ts-expect-error Native audio seconds cannot be a host monotonic millisecond provider.
createAudioClockBridge({ getContext: () => null, nowMs: () => audioSeconds });
// @ts-expect-error A valid bridge requires its actual native context provider.
createAudioClockBridge({ nowMs: () => hostMs });
// @ts-expect-error Render frames cannot become host milliseconds by assignment.
bridge.rebase({ executionEpoch, scoreEpoch, beat, hostMs: frame, bpm });
// @ts-expect-error A duration is not a monotonic host timestamp.
bridge.rebase({ executionEpoch, scoreEpoch, beat, hostMs: delay, bpm });
// @ts-expect-error A render-frame index is not a musical beat.
bridge.toTargetFrame({ epoch: scoreEpoch, beat: frame }, executionEpoch);
// @ts-expect-error Score and physical execution epochs remain distinct identities.
bridge.toTargetFrame({ epoch: executionEpoch, beat }, executionEpoch);
// @ts-expect-error Tempo cannot be supplied as a musical position.
bridge.rebase({ executionEpoch, scoreEpoch, beat: bpm, hostMs, bpm });
// @ts-expect-error Published correlations are immutable.
anchor.beat = beat;
// @ts-expect-error The context is a synchronous native clock capability.
createAudioClockBridge({ getContext: async () => null, nowMs: () => hostMs });


import { createProcgenPhysicalPlayback } from '../../js/app/procgen/workstation/ProcgenPhysicalPlayback.js';
import { createProcgenPhysicalScoreClock } from '../../js/app/procgen/workstation/ProcgenPhysicalScoreClock.js';
import type { PhysicalBatchSource, IntentProvenance, PhysicalPlaybackOptions } from '../../js/app/procgen/workstation/PhysicalPlaybackContracts.js';

declare const batch: PhysicalBatchSource;
declare const options: PhysicalPlaybackOptions;
const timeline = createProcgenPhysicalScoreClock();
const score = timeline.observe(batch, { bpm: 120 });
const scoreBeat: ScoreBeats = score.beat;
const mappedEpoch: ScoreEpoch = score.epoch;
const playback = createProcgenPhysicalPlayback({ ...options, scoreTimeline: timeline });
playback.processBatch(batch, { bpm: 120, position: score });
void scoreBeat; void mappedEpoch;
// @ts-expect-error Native audio seconds cannot provide physical playback's host clock.
createProcgenPhysicalPlayback({ ...options, now: () => audioSeconds });
// @ts-expect-error The playback owner needs its actual graph provider.
createProcgenPhysicalPlayback({ audio: null, scoreTimeline: timeline, now: () => hostMs });
// @ts-expect-error A render frame is not a score position even at the playback boundary.
playback.processBatch(batch, { bpm: 120, position: { epoch: scoreEpoch, beat: frame } });
// @ts-expect-error A physical execution epoch cannot select a score timeline epoch.
timeline.map({ simTick: 1, epoch: executionEpoch });
// @ts-expect-error The published score position cannot mutate the committed time.
score.beat = beat;
// @ts-expect-error Opaque physical facts require their owning validator before property access.
batch.facts[0].eventId;
// @ts-expect-error An omitted provenance count is numeric.
const invalidProvenance: IntentProvenance = { version: 1, kind: 'omitted', batchId: 'batch', generation: 1, count: 'one' };
void invalidProvenance;

// @ts-expect-error Only physical batch version one is supported by this clock.
timeline.observe({ ...batch, version: 2 }, { bpm: 120 });
// @ts-expect-error Every additional output requires its own retirement contract.
createProcgenPhysicalPlayback({ ...options, additionalOutputs: [{ sinks: [], enabled: () => true, observe() {} }] });
