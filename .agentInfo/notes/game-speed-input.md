<<<<<<< tmp_merge/ours_.agentInfo_notes_game-speed-input.md
=======
<<<<<<< tmp_merge/ours_.agentInfo_notes_game-speed-input.md
=======
# Game speed input rounding

tags: game-view, speed

`GameView.applyQuery` reads the `speed` URL parameter to set `gameSpeedFactor`. Values greater than `1` represent integer speed steps, so the query value is rounded to the nearest whole number. Fractional speeds at or below `1` are left untouched.
>>>>>>> tmp_merge/theirs_.agentInfo_notes_game-speed-input.md
>>>>>>> tmp_merge/theirs_.agentInfo_notes_game-speed-input.md
