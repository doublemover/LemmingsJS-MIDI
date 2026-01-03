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
3. If investigating reverse playback cost, run with `--mode=reverse` once the
   bench-reverse entry point is wired for that mode.

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
