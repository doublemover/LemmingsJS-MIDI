# Roadmap

This roadmap consolidates outstanding items from the README (In Progress,
Roadmap, Bugs and Misc) plus the current workstreams. It is the single place to
track ongoing and future work. Keep this roadmap current as work lands.

## Phase 1: E2E harness adoption and baseline testing
- [x] Expand game E2E coverage using `window.__E2E__` (startup, navigation,
  saved-level ordering, time travel invariants, reverse playback).
- [x] Add harness-backed regression tests for input and view controls.
- [x] Add harness-backed MIDI UI tests once permission flows are stable.

Notes:
- "Ready" means the level is loaded, everything is visible and interactable, and
  the game can advance without error.
- Saved levels always follow default packs under a separate group label, sorted
  by name then time.
- Input/view regression should cover all controls.
- MIDI UI tests should be UI-only when reliable MIDI access is not available.
- Define and enforce invariants (state hash symmetry, lemming counts/positions,
  minimap state, command log, sound events).

## Phase 2: Editor testing and completion (multi-phase)
- [x] Phase 2.0: Fix editor page layout (game view too low, side panels too large, top of game should be at top of window just like the game page)
- [x] Phase 2.1: Verify core editor tools plus overlay/inspector coverage
  (palette, placement, selection, brush, triggers, steel).
- [x] Phase 2.2: Verify edit-mode toggle, input suppression, and level selection
  loads into the editor while editing; confirm playtest flow.
- [x] Phase 2.3: Cover editing workflows (multi-select, drag/resize,
  copy/paste/duplicate, undo/redo, snap/nudge, delete/duplicate).
- [x] Phase 2.4: Validate saved-level pipeline (saved dropdown, localStorage
  persistence, import/export for `.nxlv` and classic `.lvl`).
- [x] Phase 2.5: Evaluate brush/eraser feasibility (tileable assets + grid size)
  and style registry coverage for terrain/gadgets.
- [x] Phase 2.6: Ensure steel rectangle editing and resizable gadgets behave
  correctly; enforce classic limits.
- [x] Phase 2.7: Defer `.nxlv` round-trip tests/unknown section handling for now;
  focus on editor runtime mapping validation (blank level defaults, preview
  mapping, trigger behavior).
- [x] Phase 2.8: Fix editor view jumps (layout/canvas offsets, scale, event
  ordering).
- [x] Phase 2.9: Polish UI/UX and editor documentation.

Notes:
- Cover all tools and inspector fields.
- Show the saved-level selector only when saved levels exist; ordering/naming
  is not important.
- Brush grid sizes: 1/2/4/8/16/32; skip if assets are not tileable.
- Define edit-mode toggle expectations (pause state, HUD visibility, command
  suppression, playtest lock).
- Clarify steel behavior/limits (mask rules, overlap handling, limit enforcement).
- View-jump repro steps pending; do a brief exploration first.
- Keep editor docs brief.

## Phase 3: UX, input, and presentation
- [x] Add a shortcut overlay toggle (game/editor) that fades in/out and is easy
  to dismiss.
- [x] Fix keyboard view navigation acceleration (too fast at either speed).
- [x] Robust touch controls and ensure scaling on iPad.
- [x] Improve the website (summary metadata for social embeds).

Notes:
- Overlay fade duration is 250 ms; use F1 and ? if possible; separate overlays
  for game and editor.
- Keyboard view acceleration should be smooth with a low max speed cap; Shift
  should still feel useful for faster pan.
- Touch targets: landscape by default; portrait only on larger tablets; use
  sensible gesture mappings.

## Phase 4: Time travel and history coverage
- [x] Expand HistoryStore snapshots/deltas to cover mutable gameplay state
  (lemmings, manager, triggers, objects, ground, minimap deaths, victory,
  skills, timer, sound events).
- [x] Reverse playback (toggle + step) with input suppression and HUD direction
  indicator.
- [x] Reverse playback updates minimap deaths and emits reverse sound events.
- [x] Ignore game speed changes during reverse playback (speedFactor remains
  stable while rewinding).

Notes:
- Determinism is explicitly out of scope for this phase.

## Phase 5: MIDI sequencing and UI
- [x] Iterate on the MIDI UI and mapping UX.
- [x] Add MIDI debug display.
- [ ] [Deferred] Ability to place flags to trigger MIDI events.

## Phase 6: Performance and benchmarks
- [x] Ensure any bench-specific metrics are surfaced via the e2e harness, ideally through their own function
- [x] Evaluate bench modes (bench, bench2, benchSequence, benchReverse) for     
  effectiveness and necessity.
- [x] Standalone updated performance benchmark.
- [x] Standalone stress test for history memory (ticks at 30x/60x/120x until    
  exhaustion).
- [x] Investigate GameTimer catchup slowdown as a perf spike failsafe.

## Phase 7: Gameplay parity, packs, and assets
- [ ] Find external references that confirm these things before implementing
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

## Phase 9: Gamepad support (deferred)
- [ ] [Deferred] Add `joypad.js` as a dependency and implement full gamepad
  support (gameplay + editor bindings, navigation, remapping).

## Phase 10: MCP automation + in-memory resources
- [x] Build MCP server with `@modelcontextprotocol/sdk` (v1) and stdio transport,
  plus npm scripts for local runs.
- [x] Session management + Playwright boot for `https://localhost:8080/?e2e=1`
  with localhost cert handling and focus management.
- [x] Harness additions for MCP (notably `selectLemmingById`) and doc updates in
  `docs/e2e-state.md` and `docs/mcp/`.
- [x] Implement core tools: time control, `state.get`, lemmings summary, input
  actions/keys, lemming select, and skill apply.
- [x] In-memory resource store with LRU/TTL and `resources/read` (plus optional
  `resources/list`) for `lemmings://` URIs.
- [x] Vision capture tools (single + sequence) with manifest support.
- [x] Events queue, watch create/cancel, and events poll with per-call envelopes.
- [x] Spectator UI plus human input relay (opt-in).
- [x] Host setup notes and smoke tests for Codex CLI, Claude Code, and LM Studio.

Notes:
- Default to stdio; LM Studio can use HTTP if needed.
- Always include the events envelope when non-empty.

## Phase 11: MCP client compatibility checks
- [x] Add automated checks that capture Codex CLI/Claude Code/LM Studio versions,
  verify MCP config formats, and flag format updates we need to track.

## Phase 12: Broken tests
- [ ] None recorded (last run: `npm test`).

## Phase 13: Procedural endless mode (procgen)
- [x] Add `procgen.html` with full-viewport canvas, no HUD/minimap/cursor, no MIDI UI.
- [x] Use pack/style 2 assets for the procgen level bootstrap.
- [x] Define a basic procgen spec doc (fixed constants, endless spawning, safe landing platform, rightward ground extension).
- [x] Implement rightmost-lemming camera tracking with clamping and smooth follow.
- [x] Add minimal E2E smoke coverage for procgen readiness and endless spawning.

## Phase 14: MCP v2 compact defaults and tool ergonomics
- [x] Switch tool responses to compact JSON by default (no pretty printing) and
  omit excluded sections instead of returning null placeholders.
- [x] Make short tool names primary (dots mapped to underscores) and retain
  legacy aliases for compatibility.
- [x] Set default event envelopes to `minimal` and avoid auto-attaching agent
  echo events unless explicitly requested.
- [x] Shorten session/resource/watch/event IDs to reduce payload size and URI
  length in responses.

## Phase 15: MCP v2 deltas, summaries, and skill semantics
- [x] Expose HistoryStore deltas via the harness and implement `state.delta`
  with filtering defaults that suppress x/y motion churn.
- [x] Fix lemming summary counts and top-K selection heuristics; support both
  rect schemas and include selected lemming when requested.
- [x] Add protocol mappings on `session.create` (skill names + lemming field
  codes) and clamp non-finite skill counts to JSON-safe values.
- [x] Improve `skill.apply` verification with skill-specific checks and
  fast-fail when skills are unavailable.

## Phase 16: MCP v2 docs, examples, and compatibility checks
- [x] Document compact defaults, delta usage, and event modes in `docs/mcp/`.
- [x] Update client call examples/configs for the short tool names and default  
  compact preset.
- [x] Add smoke tests for `state.get`/`state.delta`/`skill.apply` using the new  
  defaults and update the compatibility matrix.

## Phase 17: MCP client compatibility + MCPB publishing readiness
- [x] Fold LM Studio into the MCP config examples and add Claude Desktop + VS
  Code examples.
- [x] Add MCPB bundle templates (manifest, server registry entry, mcpb ignore)
  and document the packaging steps.
- [x] Add a disabled-by-default CI workflow for MCPB validation (Windows/macOS).
- [x] Update MCP docs with publishing/registry checklist and compatibility notes.

## Phase 18: MCP editor.apply tool (editor mutation API)
- [x] Add stable UID support for editor entries and expose them in editor state.
- [x] Implement `editor.apply` in the E2E harness (ops, batching, history,
  preview refresh, validation, export).
- [x] Add `editor.apply` tool in MCP server + schema + docs and resources export.
- [x] Add tests for editor.apply flows (new/load/save/export, entry CRUD,
  selection, history, validate).

## Phase 19: Editor audit fixes + parity guardrails
  - [x] Load `terrainGroups` into editor preview/runtime or warn as unsupported.
  - [x] Preserve section-local comments in NXLV round-trips.
  - [x] Add validation caps for width/height/brush/steel sizes and unsafe header
    values; clarify INFINITE time handling.
  - [x] Hide/disable or implement unsupported inspector fields (rotate, flip H,
    resize, one-way) and add warnings for gadget-only props in classic mode.
  - [x] Add editor UX safety upgrades (history cap, dirty indicator, undo/redo
    buttons, preview refresh label coalescing).

## Phase 20: Procgen terrain stamping + assets
- [x] Add procgen asset manager (terrain/object categorization from packs).
- [x] Replace pixel writes with terrain-piece stamping and chunk streaming.
- [x] Add decoration and hazard placement with counterplay rules.

## Phase 21: Procgen AI director + solvability
- [ ] Add environment sensing primitives (drop/wall/gap/hazard scans).
- [ ] Implement skill-assist behaviors (builder, bash, mine, dig, floater,
  blocker coordination).
- [ ] Add pacing/budget controls plus debug overlay for AI decisions.
