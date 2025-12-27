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
- Some simulation paths use Math.random (entrance direction), breaking determinism.
- No history store or serialization exists today.

## Useful existing pieces
- CommandManager tick log can be reused for deterministic replay or event reconstruction.
- GameTimer already exposes tick stepping and pause gating; it can be a thin controller delegate.
- SoundEventBus is a natural place to capture event history for reverse playback.
- MidiEventRouter and MidiScheduler already accept time metadata and can pass a reverse flag through mapping.

## Determinism baseline
1) Replace Math.random usage in simulation with a seeded RNG.
2) Store RNG seed in game session state and in snapshots.
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
- Keep a rolling time-based cap (configurable window) for history length.
- Trim keyframes/deltas older than the window and expose current history span/size.

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
- If event history is missing, re-simulate forward from keyframe to rebuild per-tick event log, then emit in reverse order.

## UI and controls
- Preserve existing step-forward key while paused.
- Add step-backward keybinds (TBD) and a reverse playback toggle.
- Suppress gameplay input while reverse playback is active.
- Show playback direction indicator and current tick index in HUD.

## Bench reverse flag
- Add a `benchReverse` (`bR`) flag that behaves like bench mode but marks the session as reverse-enabled.
- If `bench` or `bench2` is active, `benchReverse` is forced off.

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
- Memory growth: cap history length, add warnings, allow trimming.
- Large ground deltas: batch spans and compress deltas.
- Non-deterministic inputs: disallow new commands during reverse playback.

## Open questions
- What should the default history window be (seconds)?
- Should benchReverse allow benchSequence, or should they be mutually exclusive?
