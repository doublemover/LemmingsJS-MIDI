# ProcGen physical timing domains

The physical event stream uses these clocks. A consumer must keep the domain and epoch with each timestamp; equal numeric values in different domains are not interchangeable. The causal output path is still being integrated with the live workstation, which currently retains its legacy pattern engine.

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
