<<<<<<< tmp_merge/ours_.agentInfo_notes_bench-speed-adjust.md
=======
<<<<<<< tmp_merge/ours_.agentInfo_notes_bench-speed-adjust.md
=======
<<<<<<< tmp_merge/ours_.agentInfo_notes_bench-speed-adjust.md
=======
<<<<<<< tmp_merge/ours_.agentInfo_notes_bench-speed-adjust.md
=======
# Bench speed thresholds

tags: game-timer, bench-mode

`GameTimer.#benchSpeedAdjust()` now scales its slow and recovery thresholds by the current `speedFactor`. The game slows down when pending frames exceed `16 / speedFactor` (clamped to at least 10) and speeds back up when the backlog drops below `4 / speedFactor`. This keeps bench mode responsive at different speeds.
>>>>>>> tmp_merge/theirs_.agentInfo_notes_bench-speed-adjust.md
>>>>>>> tmp_merge/theirs_.agentInfo_notes_bench-speed-adjust.md
>>>>>>> tmp_merge/theirs_.agentInfo_notes_bench-speed-adjust.md
>>>>>>> tmp_merge/theirs_.agentInfo_notes_bench-speed-adjust.md
