<<<<<<< tmp_merge/ours_.agentInfo_notes_replays.md
=======
<<<<<<< tmp_merge/ours_.agentInfo_notes_replays.md
=======
# Replay notes

tags: replays, commands, doc

The new document `docs/replays.md` explains the flow of replay data.
`CommandManager.serialize()` builds a string like `tick=type:values` for
each command and joins them with `&`. `GameResult` saves this string in
the `replay` field when the game ends. `GameView.loadReplay()` passes a
replay string to `start()` which loads the level and feeds it to the
command manager for playback.
>>>>>>> tmp_merge/theirs_.agentInfo_notes_replays.md
>>>>>>> tmp_merge/theirs_.agentInfo_notes_replays.md
