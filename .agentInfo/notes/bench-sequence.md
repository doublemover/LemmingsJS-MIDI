# Bench sequence updates

tags: bench-sequence, bench-mode

`benchSequence` runs an automated performance loop. Recent changes add a safer random spawn algorithm and improved displays:

- `GameView.benchStart()` picks random X positions and scans downward for ground, skipping points blocked by hazards or solid tiles. Each spawn is offset up to 55 px upward and clamped inside the level.
- Lemmings face a random direction to stress both sides of the level.
- The timer starts with `benchStartupFrames = 600` and `benchStableFactor = 4`. `GameTimer.#benchSpeedAdjust()` scales its slow and recovery thresholds by `speedFactor` so speed stays high until stability falls off.
- `GameGui` shows "Spawn N" indicating how many lemmings have appeared so far.

`benchSequence` cycles through a list of spawn counts automatically to measure performance.
