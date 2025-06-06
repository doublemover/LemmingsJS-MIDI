# Replay format

This document explains how game sessions are recorded and played back.

## CommandManager.serialize()

`js/CommandManager.js` logs executed commands in `loggedCommads`. The
`serialize()` method iterates over these entries and joins them into a
single replay string. Each command is stored as `tick=type:values` where
`type` is the command key returned by `getCommandKey()` and `values` are
numbers from `save()`. All pairs are concatenated with `&`.

## GameResult

When a game ends `js/Game.js` creates a `GameResult` instance. The
constructor stores the serialized replay on `gameResult.replay` so it can
be saved or inspected later.

## GameView.loadReplay()

`js/GameView.js` exposes `loadReplay(replayString)` which calls
`start(replayString)`. The `start` method loads the requested level and,
if a replay string is provided, passes it to
`game.getCommandManager().loadReplay()` before starting the game. This
allows playback of the recorded session.
