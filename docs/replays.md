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

## Captured causal build compatibility

New causal takes include bounded scalar `applicationExecution` provenance in
`sourceVersions`, captured from the executing immutable application generation.
It contains the build, dependency closure, code and asset digests, harness/schema,
capability profile and recording realm. Recorded metadata cannot replace the
active identity read from the executing module. Realm identifiers identify the
owners; changing realms alone does not change build compatibility.

Preflight and replay receipts expose a separate version1 `executionBinding` with
the required and active identities, field-specific mismatches and explicit
missing, legacy or invalid-recording reasons. Protocol compatibility excludes
only this optional provenance field: old takes and a different recorded build
can still be compared against the current runtime. Simulation, mapping, codec
and asset incompatibilities continue to refuse replay. Original take bytes and
branch prefix provenance remain unchanged.

The take panel retains a readable compatibility explanation. A bound active
build and matching continuation hashes qualify only the named current-runtime
comparison. Exact causal replay still refuses before world allocation with
`causal-exact-realm-unqualified`; this service has no qualified isolated causal
replay realm. The independently owned immutable survey replay worker has its
own execution contract. Neither service attests hardware or listening output.

Recorded controls use explicit supported payload schemas. Replay refuses unknown
fields, invalid byte/timestamp observations, unsupported clock versions, stale
mapping revisions and invalid nested performance/feedback data. Observation-only
external data never queries a device. Semantic input failures retain the exact
chunk ID, sequence, source tick and record kind, plus the last accepted prefix.
A valid storage hash proves retained bytes; it does not qualify their meaning.
Inspection preserves the original take and remains silent on refusal.

The authored durable-tape corpus exercises accepted skill/release/cancel inputs,
tempo/speed/mapping/performance changes, paused physical stepping and recorded
external observations in the actual world and semantic engine. Playwright uses
real IndexedDB at128and10,000ticks, then replays, seeks, branches and reopens the
unchanged parent. This controlled world is sparse after early interactions;
its elapsed time is not a dense generated-world or audio-performance budget.
