# Bench sequence updates

tags: bench-sequence, bench-mode

`benchSequence` runs automated spawn tests. `GameView.benchStart()` now searches for safe entrance positions: it picks random X coordinates, scans downward for ground and skips points blocked by hazards or ground tiles. Spawns are offset upward up to 55px and clamped inside the level. Each lemming faces a random direction in bench mode. The timer begins with `benchStartupFrames = 600` and `benchStableFactor = 4`, so `benchSpeedAdjust()` keeps speed high until stability drops, using thresholds scaled by `speedFactor`. `GameGui` displays `Spawn N` to show total lemmings spawned during the sequence.
