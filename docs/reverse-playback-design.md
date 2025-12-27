# Reverse Playback and Time-Travel Design

## Overview
This document defines how to support forward single-step while paused, reverse stepping by any tick count, and continuous reverse playback with MIDI events flagged as reverse. The solution must be deterministic, preserve gameplay correctness, and record the full tick history for the current session with minimal overhead.

## Goals
- Step forward one tick at a time while paused (existing behavior, preserved).
- Step backward by any number of ticks while paused.
- Play the simulation backward at adjustable speed.
- Fire MIDI events during reverse playback, tagged as reverse, with inverted attack behavior.
- Avoid measurable overhead in normal forward play.

## Non-goals
- Real-time reverse rendering without state reconstruction.
- Perfect parity with NeoLemmix rewind features.
- Recording/exporting reverse playback as a new replay format.

## Current State (as of this design)
- `GameTimer.tick(steps)` supports negative steps when paused, but game logic still runs forward.
- `GameTimer` increments `tickIndex` in the RAF loop only in the forward direction.
- Game state is not snapshotted; there is no deterministic replay from mid-level without rerunning from tick 0.
- `CommandManager` logs commands by tick and can replay them.
- `LemmingManager` uses `Math.random()` for entrance facing direction, which breaks deterministic replay.
- `SoundEventBus` emits events with tick/time metadata; `MidiEventRouter` turns these into MIDI notes.

## Requirements
### Functional
- `stepForward(1)` while paused must keep existing behavior and should remain O(1).
- `stepBackward(n)` while paused must land on the exact historical state at tick `current - n`.
- Reverse playback must support sustained reverse motion with user-controlled speed.
- Reverse MIDI events must include a flag (e.g., `reverse: true`) in the event payload.
- Reverse MIDI must invert note attack behavior (see MIDI section).

### Performance
- No additional per-tick allocations or cloning during standard forward play.
- Per-tick history capture runs for the current session and must avoid per-tick allocations.
- History grows with session length; provide memory tracking and guardrails.

## Proposed Architecture

### 1. TimeTravelController (new module)
A controller that manages time-travel actions and owns snapshotting and replay.

Responsibilities:
- Track `playbackDirection` (+1 forward, -1 reverse).
- Maintain `targetTick` and a `historyMode` flag.
- Provide `stepForward()`, `stepBackward(n)`, `seekToTick(t)` APIs.
- Integrate with `GameTimer` to pause the forward RAF loop when rewinding.
- Manage history store and deterministic replay.

### 2. HistoryStore (new module)
An append-only history tape that records every tick for the current session.

Key features:
- Record per-tick deltas for mutable state (lemmings, terrain edits, timers).
- Periodically store keyframes to allow fast seeking without replaying from tick 0.
- `getNearestKeyframe(tick)` returns the closest keyframe <= target.
- History recording starts when the level session starts and clears on reload.

### 3. GameStateSerializer (new module)
Serialize/restore only the runtime state that affects simulation.

Initial snapshot scope:
- `GameTimer.tickIndex`.
- `GameVictoryCondition` counters (in/out/survivors/time).
- `LemmingManager` state (lemming list, action state, positions, timers).
- `ObjectManager` state (object animation frames and cooldowns).
- `TriggerManager` state (trigger cooldowns, arrow triggers if needed).
- `Level` mutable layers: ground mask, steel mask changes from skills, minimap state if derived.
- `CommandManager` logged commands (for replay only, not part of snapshot).

**Note:** Ground/steel masks are large; use typed arrays and delta compression to keep per-tick history manageable.

### 4. Deterministic RNG
Replace `Math.random()` in simulation paths with a seeded RNG.

- Add `Random` utility with `seed` and `next()`.
- Store RNG seed in snapshots and in `Game`.
- Update `LemmingManager` spawn direction to use RNG.

### 5. Replay + Resimulation
When seeking backward:
1. Pause `GameTimer` RAF loop.
2. Find nearest keyframe <= target tick.
3. Restore keyframe into `Game`.
4. Apply per-tick deltas to reach target tick without resimulation.
5. Render and emit events for the final tick only (see MIDI handling).

For reverse playback:
- Use a dedicated RAF loop that decrements `targetTick` and applies tick deltas in reverse order.
- When crossing a keyframe boundary, restore the keyframe and reapply deltas as needed.

## MIDI Event Handling

### Event flagging
- Extend `SoundEventBus.emit` to accept `reverse` (boolean) and include it in payload.
- When time-travel emits events for reverse playback, set `reverse: true`.

### Inverting attack
- Extend `MidiEventRouter` to pass a `reverse` flag into the mapped spec or meta.
- In `MidiScheduler.sendNote`, when `spec.reverse === true`:
  - Swap attack and release velocities (use `releaseVelocity` as `rawAttack`, and `velocity` as `rawRelease`).
  - Optionally reduce duration for reverse notes if configured in mapping.

### Event sources in reverse
- Prefer replaying stored SoundEventBus events for each tick over re-simulating MIDI directly.
- If event history is missing, re-simulate forward from snapshot to fill the event log for the target range, then emit in reverse order with `reverse: true`.

## API/UX Changes

### GameTimer
- Add `playbackDirection` (+1/-1) and expose `setDirection(dir)`.
- Provide `stepForward()`/`stepBackward(n)` wrappers that delegate to `TimeTravelController`.

### GameView and Keyboard
- Preserve existing step keys for paused forward step.
- Add reverse playback toggle and reverse stepping controls (exact bindings TBD).
- When reversing, show UI indicator for direction and tick position.

## Data Model and Snapshot Format

Keyframe fields (initial proposal):
- `tickIndex`, `rngSeed`.
- `lemmings`: array of lemming state (position, action, counters, flags).
- `levelState`: ground mask buffer + any terrain erosion state.
- `objects`: animation frame and cooldown state.
- `triggers`: cooldown and enable flags.
- `victory`: counts and state flags.

Snapshots should be compact and use typed arrays where possible.

## Performance Considerations
- History capture is always on for the current session; avoid per-tick allocations.
- Use chunked typed arrays for lemming state and terrain deltas to minimize GC pressure.
- Keyframes allow fast seeks without replaying from tick 0.
- Memory grows with session duration; track size and surface warnings in debug UI.

## Testing Strategy
- Unit tests for RNG determinism and keyframe restore equivalence.
- Integration tests: forward simulation to tick N, keyframe restore to tick N yields identical state hashes.
- Reverse tests: step forward N, step backward N returns to exact initial state.
- MIDI tests: reverse playback emits events with `reverse: true` and swapped attack/release values.
- Performance tests: ensure per-tick history capture stays within acceptable overhead.

## Open Questions
- Which state changes should be excluded or delta-compressed to reduce memory without breaking determinism?
- What memory budget or warning threshold should we surface to users?
- Do we require reverse playback across level reloads or only within a single session?
- Should reverse playback suppress gameplay input or allow command undo?
