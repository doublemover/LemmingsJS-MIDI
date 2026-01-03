# Roadmap

This roadmap consolidates outstanding items from the README (In Progress,
Roadmap, Bugs and Misc) plus the current workstreams. It is the single place to
track ongoing and future work.

## Phase 1: E2E harness adoption and baseline testing
- [ ] Expand game E2E coverage using `window.__E2E__` (startup, navigation,
  saved-level ordering, time travel invariants, reverse playback).
- [ ] Add harness-backed regression tests for input and view controls.
- [ ] Add harness-backed MIDI UI tests once permission flows are stable.

## Phase 2: Editor testing and completion (multi-phase)
- [ ] Phase 2.1: Verify core editor tools plus overlay/inspector coverage
  (palette, placement, selection, brush, triggers, steel).
- [ ] Phase 2.2: Verify edit-mode toggle, input suppression, and level selection
  loads into the editor while editing; confirm playtest flow.
- [ ] Phase 2.3: Cover editing workflows (multi-select, drag/resize,
  copy/paste/duplicate, undo/redo, snap/nudge, delete/duplicate).
- [ ] Phase 2.4: Validate saved-level pipeline (saved dropdown, localStorage
  persistence, import/export for `.nxlv` and classic `.lvl`).
- [ ] Phase 2.5: Evaluate brush/eraser feasibility (tileable assets + grid size)
  and style registry coverage for terrain/gadgets.
- [ ] Phase 2.6: Ensure steel rectangle editing and resizable gadgets behave
  correctly; enforce classic limits.
- [ ] Phase 2.7: Add/extend `.nxlv` round-trip tests and editor runtime mapping
  validation (blank level defaults, preview mapping, trigger behavior).
- [ ] Phase 2.8: Fix editor view jumps (layout/canvas offsets, scale, event
  ordering).
- [ ] Phase 2.9: Polish UI/UX and editor documentation.

## Phase 3: UX, input, and presentation
- [ ] Add a shortcut overlay toggle (game/editor) that fades in/out (0.25 ms
  requested; confirm duration) and is easy to dismiss.
- [ ] Fix keyboard view navigation acceleration (too fast at either speed).
- [ ] Robust touch controls and ensure scaling on iPad.
- [ ] Improve the website (layout, responsiveness, onboarding, PWA polish).

## Phase 4: Time travel and reverse playback
- [ ] Finalize determinism baseline (seeded RNG + stored seed, tick-based timing).
- [ ] Complete HistoryStore capture (keyframes + per-tick deltas for lemmings,
  ground/steel, objects/triggers, sound events) with optional caps/warnings.
- [ ] Finish TimeTravelController integration (seek/step, reverse loop, preserve
  or truncate future history safely).
- [ ] Update the minimap during reverse playback and ignore game speed changes.
- [ ] Wire reverse MIDI replay (reverse flag + attack/release inversion; skip if
  event history is missing).
- [ ] Add UI indicators and controls (direction/tick HUD, input suppression,
  benchReverse flag).
- [ ] Add/extend tests (determinism hashes, snapshot restore, step-backward
  symmetry, reverse MIDI, perf guardrails).

## Phase 5: MIDI sequencing and UI
- [ ] Iterate on the MIDI UI and mapping UX.
- [ ] Add MIDI debug display.
- [ ] Ability to place flags to trigger MIDI events.

## Phase 6: Performance and benchmarks
- [ ] Evaluate bench modes (bench, bench2, benchSequence, benchReverse) for
  effectiveness and necessity.
- [ ] Standalone updated performance benchmark.
- [ ] Standalone stress test for history memory (ticks at 30x/60x/120x until
  exhaustion).
- [ ] Investigate GameTimer catchup slowdown as a perf spike failsafe.

## Phase 7: Gameplay parity, packs, and assets
- [ ] Arrow walls: confirm builder bounce behavior, fix 2-2-19 left arrows,
  consider built-stairs handling.
- [ ] Traps: add missing squish, fix generic trap using splat death.
- [ ] Bombs: remove ground overlapping steel to reveal it.
- [ ] Super lemmings act twice per tick.
- [ ] No palette-swapped frying animation (2-2-9, 1-4-30).
- [ ] Building stairs off horizontal edge causes wraparound steps.
- [ ] Pack navigation bugs: previous pack flashing/crash when navigating
  1 -> 2 then past 2-4-20; cannot go back to version 1 from version 2.
- [ ] Xmas 91/92 and Holiday 93/94 polish (steel sprite data, triggers,
  palettes).
- [ ] Pack decompression/patch/compression pipeline.
- [ ] Full support for pack-specific glitches.
- [ ] Support for other popular pack types.
- [ ] High resolution and 32-bit color sprite support.
- [ ] Procedural endless level generation.

## Phase 8: Documentation
- [ ] Improved documentation (usage, editor workflows, MIDI, performance).
- [ ] Keep this roadmap current as work lands.
