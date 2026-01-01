# Tickstep Plan

## Intent
Design forward single-step, backward stepping, and continuous reverse playback with MIDI events flagged as reverse, while keeping forward-play performance unchanged.

## Goals
- Step forward one tick at a time while paused (preserve existing behavior).
- Step backward by any number of ticks while paused.
- Continuous reverse playback with adjustable speed.
- MIDI events emitted during reverse playback carry a reverse flag and invert attack behavior.
- Deterministic replay from any recorded tick without rerunning from level start.

## Non-goals
- Cross-level time travel or replay file formats.
- Perfect NeoLemmix parity.
- Reverse rendering without state reconstruction.

## Current behavior and constraints
- GameTimer.tick(steps) accepts negative steps while paused but still triggers forward logic on every tick; it does not reconstruct prior state.
- GameTimer.tickIndex only increments in the RAF loop.
- CommandManager already timestamps commands per tick and can replay them.
- SoundEventBus emits per-tick events used by MidiEventRouter.
- Some simulation paths use Math.random (entrance/extra spawn facing), so full determinism is deferred.
- HistoryStore captures keyframes/deltas and sound event history; serialization is still TBD.

## Useful existing pieces
- CommandManager tick log can be reused for deterministic replay or event reconstruction.
- GameTimer already exposes tick stepping and pause gating; it can be a thin controller delegate.
- SoundEventBus is a natural place to capture event history for reverse playback.
- MidiEventRouter and MidiScheduler already accept time metadata and can pass a reverse flag through mapping.

## Determinism baseline (deferred)
1) Seeded RNG is skipped for now because randomness is limited to spawn facing.
2) Store RNG seed in session state if more simulation paths use randomness later.
3) Ensure any time-based logic uses tickIndex, not wall time.

## State boundary (what must be reversible)
- GameTimer: tickIndex, speedFactor, frameTime.
- GameVictoryCondition: counters and state flags.
- LemmingManager: full lemming list state (position, direction, action, counters, flags, skill timers).
- Level mutable state: ground mask edits, steel updates, minimap buffers if derived.
- ObjectManager: animation frame indices, cooldown timers, and any per-object state.
- TriggerManager: cooldowns, disabled flags, arrow triggers.
- CommandManager: command log (not part of state but needed for replay).
- SoundEventBus: event history per tick for MIDI replay.

## History storage strategy
### Keyframes + deltas
- Keyframe every N ticks (e.g. 120 or 300) to bound seek time.
- Per-tick delta logs for the interval between keyframes.
- Deltas should be append-only and allocation-free per tick.

### Suggested data layouts
- Lemming state: struct-of-arrays typed buffers (x, y, dir, action, flags, timers).
- Ground mask: store delta spans (index, length, previous bytes) per tick.
- Object/Trigger state: small fixed-size arrays keyed by object id.
- Sound events: per-tick array of event payloads.

### Memory considerations
- History is uncapped by default (no rolling window yet).
- Optional cap/warn thresholds can prune oldest ticks when enabled.
- When resuming forward after rewinding, truncate future history to avoid branches.
- Preserve future history by setting `preserveFutureHistory` when replay capture needs it.
- Expose a `preserveHistory` (`ph`) URL flag that toggles `preserveFutureHistory`.

## Time travel controller
Create a TimeTravelController to own history, seek, and playback direction.

Responsibilities:
- track playbackDirection (+1, -1)
- stepForward(), stepBackward(n), seekToTick(t)
- pause forward RAF loop when reversing
- restore keyframes and apply deltas for seeks

Integration points:
- GameTimer delegates negative tick behavior to TimeTravelController.
- GameView and keyboard shortcuts call TimeTravelController for stepping.

## Reverse playback flow
1) Pause forward RAF loop.
2) Set playbackDirection = -1.
3) On each reverse tick:
   - Move target tick backward.
   - Apply the reverse of the delta for that tick.
   - Emit SoundEventBus events for that tick with reverse: true.
4) Stop at tick 0 (no wraparound).
5) When hitting a keyframe boundary, restore keyframe and reapply deltas as needed.

## MIDI handling in reverse
- SoundEventBus events should include reverse: true when emitted during reverse playback.
- MidiEventRouter passes reverse to the mapped spec.
- MidiScheduler inverts attack/release when spec.reverse is true:
  - use releaseVelocity as attack and velocity as release
  - optional duration adjustment if needed
- If event history is missing, skip MIDI for that tick (best-effort replay is acceptable).

## UI and controls
- Preserve existing step-forward key while paused.
- Add step-backward keybinds and a reverse playback toggle.
- Suppress gameplay input while reverse playback is active.
- Show playback direction indicator and current tick index in HUD.

## Bench reverse flag
- Add a `benchReverse` (`bR`) flag that behaves like bench mode but marks the session as reverse-enabled.
- If `bench`, `bench2`, or `benchSequence` is active, `benchReverse` is forced off.

## Tests
- RNG determinism: same seed yields identical tick hashes.
- Snapshot restore: keyframe + deltas reconstruct exact state at tick N.
- Step backward: forward N then backward N returns to initial state.
- Reverse playback: emits reverse MIDI events with swapped attack/release.
- Performance: history capture does not allocate per tick.

## Implementation phases
1) Determinism: RNG replacement + seed tracking.
2) HistoryStore and serializer: keyframes + deltas for core state.
3) TimeTravelController: step/seek + reverse playback loop.
4) Reverse MIDI: event log + reverse flag + attack inversion.
5) UI bindings and debug overlays.
6) Tests + perf guardrails.

## Risks and mitigations
- Memory growth: history is uncapped; add optional cap/warnings if it becomes an issue.
- Large ground deltas: batch spans and compress deltas.
- Non-deterministic inputs: disallow new commands during reverse playback.

## Open questions
- None.
