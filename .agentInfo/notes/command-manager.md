<<<<<<< tmp_merge/ours_.agentInfo_notes_command-manager.md
=======
<<<<<<< tmp_merge/ours_.agentInfo_notes_command-manager.md
=======
<<<<<<< tmp_merge/ours_.agentInfo_notes_command-manager.md
=======
<<<<<<< tmp_merge/ours_.agentInfo_notes_command-manager.md
=======
# CommandManager overview

tags: commands, replay

`js/CommandManager.js` manages player commands and replay data. It registers a listener on `gameTimer.onBeforeGameTick` that runs once per tick. When the tick fires, the manager looks up the command stored for that tick in `runCommands`. If present, it calls `queueCommand`, which immediately executes the command via its `execute()` method and stores it in `loggedCommads` when execution succeeds.

Replay strings are loaded with `loadReplay()`. They consist of `tick=command` pairs separated by `&`. Each pair is parsed by `parseCommand` and kept in `runCommands` keyed by tick. During gameplay, `serialize()` produces the same format by iterating over `loggedCommads` and combining the command key with its serialized values.
>>>>>>> tmp_merge/theirs_.agentInfo_notes_command-manager.md
>>>>>>> tmp_merge/theirs_.agentInfo_notes_command-manager.md
>>>>>>> tmp_merge/theirs_.agentInfo_notes_command-manager.md
>>>>>>> tmp_merge/theirs_.agentInfo_notes_command-manager.md
