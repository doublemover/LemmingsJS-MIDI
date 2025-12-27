# Reverse Playback Evaluation Plan

## Intent
Assess and implement tick stepping (forward/backward) and reverse playback with MIDI event tagging and inverted attack behavior, while recording the full per-tick history for the current session.

## Scope
- In: step-forward while paused, step-backward by any count, continuous reverse playback, reverse MIDI tagging/attack inversion.
- Out: new replay file formats or cross-level reverse support.

## Action items
1. Audit simulation determinism
   - Identify all `Math.random()` use in gameplay code.
   - Replace with seeded RNG and store seed in snapshots.
2. Define reversible state boundary
   - Enumerate mutable runtime state: lemmings, objects, triggers, ground masks, victory counts.
   - Decide which data must be stored as keyframes vs per-tick deltas.
3. Prototype history serializer
   - Implement minimal keyframe + delta capture for a short tick range.
   - Validate by hashing state after restore + delta replay.
4. Design time-travel controller
   - Define APIs for seek/step and reverse playback loop.
   - Integrate with `GameTimer` and `GameView` without altering default loop.
5. MIDI reverse handling
   - Add `reverse` flag to `SoundEventBus` payloads.
   - Pass flag through `MidiEventRouter` and invert attack in `MidiScheduler`.
6. Performance and memory controls
   - Keep per-tick history capture allocation-free and low overhead.
   - Define memory tracking and warning thresholds for long sessions.
7. Test plan
   - Unit tests for RNG determinism and snapshot correctness.
   - Integration tests for step-forward/backward and reverse MIDI.

## Deliverables
- `docs/reverse-playback-design.md` (design)
- New time-travel modules and tests
- Updated controls and HUD indicators
