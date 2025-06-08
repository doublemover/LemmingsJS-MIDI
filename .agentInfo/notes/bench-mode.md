<<<<<<< tmp_merge/ours_.agentInfo_notes_bench-mode.md
=======
<<<<<<< tmp_merge/ours_.agentInfo_notes_bench-mode.md
=======
<<<<<<< tmp_merge/ours_.agentInfo_notes_bench-mode.md
=======
# Bench mode

tags: bench-mode, speed-control

Bench mode enables performance testing by spawning lemmings without limit and automatically adjusting the game speed. `LemmingManager.addNewLemmings()` skips the remaining-count check so new lemmings always appear. `GameTimer.#benchSpeedAdjust()` modifies `speedFactor` whenever the game falls behind, slowing to 0.1 if more than 100 ticks are pending and gradually increasing again when caught up.
>>>>>>> tmp_merge/theirs_.agentInfo_notes_bench-mode.md
>>>>>>> tmp_merge/theirs_.agentInfo_notes_bench-mode.md
>>>>>>> tmp_merge/theirs_.agentInfo_notes_bench-mode.md
