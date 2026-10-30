# ProcGen physical timing domains

The physical event stream uses these clocks. A consumer must keep the domain and epoch with each timestamp; equal numeric values in different domains are not interchangeable. The live workstation routes committed physical batches through its causal engine. Complementary pattern lanes retain their separate transport scheduling.

| Value | Unit and owner | Meaning |
| --- | --- | --- |
| `simTick`, `subTick`, `precision` | integer tick, fractional tick, precision label; `ProcgenLaneWorld` | Committed physical order. Discrete action facts use `subTick: 0`; endpoint motion does not claim a measured fractional crossing. `causalSequence` remains authoritative when facts in one tick depend on earlier terrain edits. |
| `sourceTimeMs` | simulation milliseconds; completed physical batch | Each tick adds the base 60 ms simulation interval. Catch-up ticks have distinct source times even when the legacy event path uses one callback timestamp. This value does not claim wall-clock or audio-device time. |
| `tickDurationMs` | nominal host milliseconds per physical tick; completed physical batch | The effective game-speed interval at the tick. It can change between ticks. |
| `scoreTime.epoch`, `scoreTime.beat` | score beat; `SimScoreTimeline` | Piecewise mapping of committed ticks. Speed and tempo edits append segments at the first affected tick. A seek or generation change creates a new epoch; prior epochs remain in the saved timeline until its capacity is reached. |
| `hostMs` | monotonic performance milliseconds; transport/audio bridge | A host clock anchor. A transport pulse may run ahead of physics; it is never a physical event's source time. |
| `targetFrame` | integer frame at the current `AudioContext.sampleRate`; `AudioClockBridge` | The browser-audio scheduling target after score-to-host and host-to-context correlation. A context replacement, sample-rate change or execution-epoch change requires a new anchor. |

`AudioClockBridge` adds an explicit presentation delay to known, committed events. Its optional output timestamp and latency values are diagnostic correlations, not proof that the user heard a frame. The strict live delivery policy rejects an attack whose frame has already passed, rejects stale expression, and moves a release to the earliest current frame. Receipts retain both the original and repaired frame. The native oscillator backend also rejects late direct attacks instead of silently clamping them.

The worker timing driver sends at most one unacknowledged wake per epoch. Its `sourceTimeMs` is `performance.timeOrigin + performance.now()` in the worker, so it can be compared with the main thread's monotonic host clock. The transport's existing unsafe-gap stop remains responsible for suspending playback after a long delivery pause.
# Musical meter presentation

Transport time remains quarter-note time. The header converts it through the
accepted project's canonical meter and displays `bar : denominator-note beat`:
6/8 counts six eighth notes, and its bar spans three quarters. Clock-source
health has a separate label, including when MIDI clock is external. Display
updates, pause/resume and tempo changes do not move the quarter position.
Scheduling and presentation share the meter conversion in
`MidiMusicalPosition.js`. A changed meter keeps the current phrase origin and
recomputes an unlaunched phrase's next boundary on the next scheduling pulse.
Regression fixtures cover non-4/4 engine/display agreement; their runtime
execution is deferred during the backlog development pass.

## Recorded MIDI export input

Both direct SMF export and worker recording snapshots require an explicitly mapped,
finite, nonnegative numeric beat for every selected event. Missing/null/string,
negative and nonfinite values fail preparation; they are never assigned tick zero.
Explicit beat zero remains valid. Quantization must produce an exact safe integer
and each delta must fit the four-byte SMF representation.

These APIs consume already mapped recording beats. They do not lower raw physical
ticks or host milliseconds and do not reconstruct history from the current BPM.
A source exporter must first apply its retained epoch/segment map and crop origin.
Original source time and any live scheduling repair remain separate evidence.

Legacy speed controls publish requested values through the transport owner before
projecting their labels. The projection cannot overwrite the effective timer,
including a clamped linked BPM or paused clock. Native keyboard qualification
records real physical pump batches between keydown and keyup/controlled blur;
that ordering evidence is distinct from full take re-performance qualification.

## Paused steps and take-control admission

Transport state exposes `nominalSpeed` independently of `effectiveSpeed`. Pause or
external-clock waiting keeps effective speed zero. An explicit physical Step owns
one nominal-rate tick: admit a stopped transport observation with that nominal
speed, perform the real boundary, restore zero, and admit the restored clock.
The journal can replay these two clock inputs around the completed batch without
claiming that paused interpretation emitted musical output.

If an active take refuses a tempo/clock observation, the workstation halts before
its physical pump and refuses Play/Step until that take is saved or recovered.
This is an admission and recovery boundary, not a guarantee that a previously
accepted asynchronous storage write can never fail. The retained durable prefix
and coverage gaps continue to describe that failure.
