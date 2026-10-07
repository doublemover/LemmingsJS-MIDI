# Procgen cloud measurements, 2026-10-07

These are bounded, rendering-free Node v24.19.0 Linux runs with seed 42,
OHNO brick art, the checked-in mined recipes, and real Lemming/action/mask code.
They are measurements from one cloud machine, not browser smoothness claims.
The headless probe passes no sprite provider, so it also excludes cosmetic
appearance/transition work, sprite-frame decoding and audio synthesis.

| Lanes | Workload | Ticks | Spawned / alive | Time | Actor steps/s | Shared recipe cache | Sparse edits |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | Repeated cohorts | 5,000 | 93 / 89 | 0.20 s | 1.12 million | 1.43 MB | 0.16 MB |
| 32 | Repeated cohorts | 3,000 | 1,792 / 1,775 | 2.22 s | 1.21 million | 1.43 MB | 2.80 MB |
| 1,024 | Repeated cohorts | 600 | 11,776 / 11,776 | 2.92 s | 1.25 million | 1.43 MB | 14.15 MB |
| 1,024 | First cohort only | 5,000 | 1,024 / 1,024 | 3.56 s | 1.44 million | 1.43 MB | 9.33 MB |

A later bounded challenge-cache/empty-cascade-scan optimization reproduced the
1,024-lane/600-tick state exactly in 2.70 s (1.35 million actor steps/s), with
2,048 cached challenges. This is one rerun, not a statistically controlled speedup.

No stalls occurred in these probes. Minimum lane-frontier distances were 3,690,
2,074, 359, and 2,669 pixels respectively. Traffic runs are not casualty-free:
the one-lane case had four out-of-world deaths, and the 32-lane case had 17 unsafe
falls. The short 1,024-lane repeated-cohort probe is not long-run survival proof.
RSS ranged from about 75 MB to 175 MB across this process sequence; garbage
collection and retained resources make this different from incremental cost.

All ten available art families additionally passed 32 independent actors ×
5,000 fixed ticks at seed 42, with every actor alive, no stalls, and minimum
forward distance above 2,000 pixels. Every one of the 96 admitted recipes also
passed 5,000 real-action ticks with a single isolated actor at seed 42, all alive
and progressing. Source recipe screening is still local;
this is not a universal solvability claim for every seed, cohort or future edit.

## Policy comparison

The original AI from commit 059a4cab is preserved unchanged (apart from its import
path) in the test fixture. Both policies run on the same real Level,
LemmingManager, original action classes, pack masks and bounded geometry:

- Retired blocker: original remains blocking for 600 ticks. Revised policy makes
  one safe builder reassignment and reaches the 155-pixel goal in 382 ticks.
- Shallow-step/left-edge loop: original remains blocked for 600 ticks. Revised
  policy reaches the goal alive after reassessment.
- Pit: original repeatedly bashes before reaching the wall, then digs and dies
  at tick 166. Revised policy waits for useful proximity, bashes once, and
  reaches the goal alive at tick 182.

## Limits and reproducibility

Use the commands in [procgen.md](procgen.md). CLI default is the repeated-cohort,
real-art workload; first-cohort and analytic comparators require explicit flags.
The harness reports admitted spawns and failures instead of silently calling
removed actors survivors. The bounded renderer test verifies a 300×150 visible
buffer and two visible actors in a 1,024-lane world, but uses a mocked canvas.

Live Chromium/Playwright QA was blocked by cloud execution restrictions, and the
available cloud browser rejected loopback navigation. No restrictions were
bypassed. The updated E2E and capture targets still need a permitted preview
run; screenshots, audible listening and live frame times remain unverified.
