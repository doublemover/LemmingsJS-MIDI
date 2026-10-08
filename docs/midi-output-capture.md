# Bounded MIDI output capture

The existing MIDI Expert and procgen Details panels can start and stop a finite recording, export JSONL or CSV, and inspect a summary and piano roll on demand. Recording attaches observers to the current routers and local audio outputs; it does not enable MIDI, open devices, create notes, or change project settings. Stopped observers are detached. Replacement routers receive an active observer only.

## Evidence boundaries

- `request`: an enabled, output-bound game event or local audition requested a note or phrase. Disabled routes and unmapped spawn/land events are excluded.
- `scheduled`: the existing scheduler accepted a logical note and its planned lifecycle.
- `api-dispatch` / `api-failed`: the existing channel API returned or threw. Accepted calls are distinct from physical MIDI delivery. A method returning no value is treated as accepted.
- `synth-scheduled`, `synth-release`, `synth-end`: the existing local oscillator or buffer source was scheduled, released, or ended. A future schedule may subsequently be cancelled.
- `synth-render-sample`: demand inspection sampled the existing output graph through a cached analyser tap. RMS and peak describe rendered signal at that boundary, qualified by the actual localMasterGain multiplier at sampling time; acoustic playback and physical device receipt remain unverified.
- `drop`, `cancelled`, `coalesced`: bounded output admission, expiry, cancellation, and repeated-controller decisions, with reasons. Visual and simulation events continue independently.
- `context-change`: bounded settings changes recorded by the panel integration. Per-note scale and origin values retain the context captured when notes were planned.

Records include host monotonic dispatch time, intended and scheduled times where available, musical tick/beat, channel/program/pitch/velocity, note ownership IDs, matched release duration, controller values, and lane/lemming/event origin. `beatClock=simulation-base-ticks` uses the same base-tick/base-BPM domain as the bar transport; it remains stable across speed changes. Phrase cells use their actual dispatch tick. `audioTime` is seconds on the local AudioContext clock, not the host clock. Missing authored procgen level identity is left absent. Seed, generation, lane seed, recipe/theme, scale and bounded settings references qualify reproducibility without copying full projects.

## Limits and lifecycle

`createMidiOutputCapture({ capacity, maxDurationMs, nowMs })` exposes `start(metadata)`, `stop(reason)`, `isActive()`, `record(stage, fields)`, `getState()`, `snapshot()`, `toJSONL()` and `toCSV()`. Defaults are 4,096 records and two minutes; ceilings are 32,768 records and five minutes. Capture uses a fixed ring, at most 64 flat fields and 2,048 serialized field characters per record, 32 scalar array entries, and bounded metadata with at most 256 nodes and structural depth 5. Note-gate bookkeeping is capped at 512. `getState()` reports active status, counts, overwritten records, duration/stop reason and observed open gates. A dropped prefix makes lifecycle analysis explicitly partial. Starting mid-note can also produce unmatched releases whose note-on preceded the session; the summary qualifies this boundary. Stop freezes observation; it does not release musical notes. Use the existing Panic control to inspect note cleanup.

Demand analysis is limited to 32,768 retained records, 512 gate keys and 32 same-pitch gates per key. Lifecycle IDs are indexed by output and capture scope. Structured analysis retains at most 2,048 note details; the piano roll draws at most 1,024. It reports per-lane requested/accepted density and register, scheduled polyphony, pitch classes against each note's captured scale, interval/rhythm/repetition counts, dispatch-versus-schedule timing, admission fairness, active-channel program/pan/timbre changes, held/open gates and orphan releases. These measurements do not rate musical quality. Negative dispatch jitter denotes API scheduling ahead of playback time.

## Reproducible finite fixtures

From the checkout, run:

`node scripts/midi-capture-fixture.js --name=ensemble`

This deterministic fake-channel sample covers 64 busy lanes with chord expansion, wall-clock budgets, speed changes, held notes, ownership release and Panic. It writes ignored artifacts to `temp/midi-capture-fixture/`: JSONL, CSV, a readable summary, structured analysis and a standalone piano-roll HTML file. No physical sends occur. Inspect an exported capture offline with `--input=path/to/capture.jsonl --out-dir=temp/capture-inspection`; input is capped at 32 MiB and 32,768 records.

With the existing local server at port 8094 and cached Playwright/Edge available, run:

`node scripts/midi-capture-native.js --name=ensemble`

This fresh 1440×900 desktop context installs the repository Web MIDI stub, uses normal main Expert controls, captures actual level events, then captures a 16-cell local audition spaced over 14.4 seconds. It records a demand-render sample and verifies cancellation prevents later schedules. Browser audio is muted; the fixture asserts Web MIDI remains disabled and reports page errors. Artifacts are written to `temp/midi-capture-native/`. Unit fake-clock coverage follows cancellation beyond the complete audition horizon. These fixtures verify APIs, scheduling and rendered graph signal, without claiming acoustic assessment.
