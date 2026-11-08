# Performance benchmarks

This project includes multiple bench modes intended for quick performance checks
inside the game runtime. These are best driven through the E2E harness so results
are recorded consistently and without UI timing variance.

## Bench modes

- `bench`: Spawns extra entrances and adjusts speed to hold a steady tick
  cadence. Useful for checking raw lemming throughput in a single level.
- `bench2`: Catchup-focused mode that slows down when RAF falls behind. Good for
  spotting perf spikes that trigger the failsafe in `GameTimer`.
- `benchSequence`: Runs a sequence of entrance counts and extra lemming loads.
  This is the default for broader performance sweeps.
- `benchReverse`: Bench mode with reverse playback. Useful for time-travel
  rendering costs and reverse history application.

## Recommended workflow

1. Use the E2E harness and run the benchmark script:
   - `npm run bench-performance -- --mode=sequence`
2. Review the JSON output for max TPS, max speed, and per-sample values.
3. If investigating reverse playback cost, run with `--profile=reverse` or
   `--mode=reverse`.

## History stress test

Use the history stress test to find when the history buffer becomes too large.
It runs at fixed speed factors and reports the history span and (if available)
heap usage.

- `npm run bench-history -- --target=60000 --duration=60000`

## E2E harness bench metrics

The E2E harness exposes bench metrics through `window.__E2E__.getBenchMetrics()`
so scripts and tests can inspect live performance data while running.

## GameTimer catchup slowdown

`GameTimer` includes a catchup slowdown path that lowers speed factor when the
RAF loop falls behind. Bench mode `bench2` is the best place to verify this
behaves as intended. If the slowdown triggers too aggressively or never
triggers, adjust thresholds in `GameTimer.#catchupSpeedAdjust()`.

## Smoke result admission

Performance, history and hotpath producers attach `lemmings-benchmark-result/v1`
receipts with workload/profile identities, requested scenario IDs, units and a
completed status. The smoke evaluator admits required finite numeric measurements
before comparing thresholds. Missing or unsupported receipts are measurement
failures, never synthetic zero-cost passes.

Raw performance observations and summaries gate tail latency and throughput;
filtered summaries remain diagnostic. Every requested history speed is required
exactly once and gates independently. Mandatory hotpaths declare positive work
counts and at least three observations. Producer failures remain failures even
when another scenario passes. JSON includes typed diagnostics distinguishing
invalid measurements from performance regressions. Source fixtures cover the
reported missing/NaN/filtered-tail/scenario defects; execution is deferred until
the implementation backlog is ready for validation.

### Long-session transport and work receipts

The classic-game long-session runner now owns a forward transport across each
replay transaction. A probe waits for 64–512 retained ticks, suspends forward
work, verifies both seeks and exact return tick/exposed physical projection,
then resumes only if it was originally running. Failed seeks/state/history or
resume invalidate the run and stop sampling. The projection excludes terrain
bytes; the retained-delta JSON hash is a noncryptographic diagnostic. This is
separate from the ProcGen workstation soak workload.

Smoke/default/soak require at least 2000/8000/12000 completed forward ticks,
85% observed running time after explicit replay time is removed, 80% progressing
forward time, and no sampled stall over 3 s. At least 85% of the configured
observation span and all requested successful replay transactions are required.
Existing history-span/memory/queue/drift gates remain. Default/soak also require
1/4 actual cold compactions; soak requires a cold block retirement. Cumulative
creation/thaw/empty-block retirement counters come from the history owner.
Missing/invalid required telemetry fails admission before display normalization
can replace it with zero.

Active/paused time is estimated from sample brackets minus recorded probe
overlap, not a CPU utilization or per-tick wall-time measurement. A terminal
sample closes the observation window before pause. These changes and controlled
transport/history fixtures await the consolidated execution pass; no new
throughput, timing or browser qualification result is published here.
