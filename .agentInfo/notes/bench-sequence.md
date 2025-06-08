<<<<<<< tmp_merge/ours_.agentInfo_notes_bench-sequence.md
=======
<<<<<<< tmp_merge/ours_.agentInfo_notes_bench-sequence.md
=======
# Bench sequence updates

tags: bench-sequence, bench-mode

-`benchSequence` runs an automated performance loop. Recent changes replace the random spawn algorithm with deterministic offsets and improve displays:

- `GameView.benchStart()` now iterates outward from each original entrance in ±100 px steps. If no space is found the step decreases to 50, 25, 12 and 6 px. Candidates are skipped when blocked by hazards or solid tiles and clamped inside the level. Entrances are lowered if overhead terrain blocks the 28 px tall object.
- Lemmings still face random directions to stress both sides of the level.
- The timer starts with `benchStartupFrames = 600` and `benchStableFactor = 4`. `GameTimer.#benchSpeedAdjust()` scales its slow and recovery thresholds by `speedFactor` so speed stays high until stability falls off.
- `GameGui` shows "Spawn N" indicating how many lemmings have appeared so far.

`benchSequence` cycles through a list of spawn counts automatically to measure performance.
>>>>>>> tmp_merge/theirs_.agentInfo_notes_bench-sequence.md
>>>>>>> tmp_merge/theirs_.agentInfo_notes_bench-sequence.md
