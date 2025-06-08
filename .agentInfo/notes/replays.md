tags: replays, commands, doc

Short overview of how replays are recorded and played back.
`CommandManager.queueCommand()` executes a command and logs it in
`loggedCommads` under the current tick. `serialize()` formats these
entries as `tick=type:values` joined with `&`. `GameResult` stores this
string on `replay` once the level ends. `GameView.loadReplay()` passes
the string to `CommandManager.loadReplay()` during `start`, rebuilding
commands in `runCommands` so they execute at the right ticks.
