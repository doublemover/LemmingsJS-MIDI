# Replay format

This document explains how game sessions are recorded and played back.

## Recording commands

Every action taken by the player results in a Command object. When
`CommandManager.queueCommand()` executes a command successfully it
stores the instance in `loggedCommads` keyed by the current game tick.
The manager listens to `GameTimer.onBeforeGameTick` so queued commands
run just before each frame is processed.

## CommandManager.serialize()

`serialize()` converts `loggedCommads` into a compact string. Each entry
is saved as `tick=type:values` where `tick` is the game tick, `type` is
`command.getCommandKey()` and `values` are the numbers returned from
`command.save()`. The pairs are joined with `&`.

### Example

```
5=s0
12=n
20=l10:100
```

This becomes `5=s0&12=n&20=l10:100`.

## GameResult

When a game ends `GameResult` captures the current state. The serialized
string is stored on its `replay` property so it can be saved or shared.

## Loading replays

`GameView.loadReplay(replayString)` simply calls `start(replayString)`.
During `start` the level is loaded and the string is fed into
`CommandManager.loadReplay()`. This method parses the
`tick=type:values` pairs and rebuilds each command in `runCommands`.
The manager then executes them at the appropriate ticks while the game
runs, faithfully reproducing the original session.

## ProcGen checkpoint comparison scopes

The workstation's component checkpoints use a separate format from classic
command replay. `projectProcgenPhysicsCheckpoint` keeps the existing version2
simulation comparison for display and sound-isolation checks. Its hash omits
authoring, crew prerequisite and topology owners and cannot qualify continuation
or checkpoint reuse by itself.

`projectProcgenContinuationCheckpoint` uses the version1 continuation domain. It
also retains those behavior owners and valid assistance state, while excluding
inactive assistance scratch, presentation, legacy delivery counters, topology
rejection counters and crew diagnostic counts. Missing required owner components
refuse qualification. Pending topology publications cannot enter synchronous or
cooperative checkpoints.

Version2 re-performance receipts expose `continuationStateSchema` and
`actualContinuationHash`; component comparisons and checkpoint reuse use this
domain. `actualPhysicsHash` remains the version2 simulation hash for its original
purpose. Physical branch boundary receipts carry both scopes. Matching remains
current-runtime compatibility: neither hash attests archived executing code,
cryptographic asset authenticity, receiver processing or sound.
