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

Notes:
- Deferred implementation details now tracked under Phase 29.

## Phase 6: Performance and benchmarks
- [x] Ensure any bench-specific metrics are surfaced via the e2e harness, ideally through their own function
- [x] Evaluate bench modes (bench, bench2, benchSequence, benchReverse) for     
  effectiveness and necessity.
- [x] Standalone updated performance benchmark.
- [x] Standalone stress test for history memory (ticks at 30x/60x/120x until    
  exhaustion).
- [x] Investigate GameTimer catchup slowdown as a perf spike failsafe.

## Phase 7: Gameplay parity, packs, and assets
- [x] Build reproducible parity repro cases and fix behavior directly in runtime
  logic (no research/documentation gate before implementation).
- [x] Arrow walls: confirm builder bounce behavior, fix 2-2-19 left arrows,
  consider built-stairs handling.
- [x] Traps: add missing squish, fix generic trap using splat death.
- [x] Bombs: remove ground overlapping steel to reveal it.
- [x] Super lemmings act twice per tick.
- [x] No palette-swapped frying animation (2-2-9, 1-4-30).
- [x] Building stairs off horizontal edge causes wraparound steps.
- [x] Pack navigation bugs: previous pack flashing/crash when navigating
  1 -> 2 then past 2-4-20; cannot go back to version 1 from version 2.
- [x] Xmas 91/92 and Holiday 93/94 polish (steel sprite data, triggers,
  palettes).
- [x] Pack decompression/patch/compression pipeline.
- [x] Full support for pack-specific glitches (pack mechanics now gate pause,
  nuke-doubleclick, and right-click glitch behavior).
- [x] Support for other popular pack types (`.nxp` archive reads in tooling).
- [x] High resolution and 32-bit color sprite support (renderer/object paths now
  accept RGBA frames and optional sourceScale downsampling for hi-res assets).
- [x] Procgen production hardening and long-run stability/perf at high entity
  counts (bounded tracking-state pruning, indexed hazard scans, and lower-allocation
  terrain/asset hot paths).

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
- [x] None recorded (latest run: `npm test` on February 22, 2026, no errors).

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
- [x] Add environment sensing primitives (drop/wall/gap/hazard scans).
- [x] Implement skill-assist behaviors (builder, bash, mine, dig, floater,
  blocker coordination).
- [x] Add pacing/budget controls plus debug overlay for AI decisions.

## Phase 22: Implementation-First Backlog + Touchpoint Map

This phase folds in outstanding work from:
`01_codebase_bug_audit.md`, `02_mcp_split_plan.md`,
`03_agent_prompt_for_mcp_servers.md`, `04_midi_ui_enhancements.md`,
`05_history_compression_plan.md`, `06_rendering_blitting_optimizations.md`,
and `08_other_improvements.md`.

### 22.1 Engine correctness hardening
- [x] Replace Stage color parsing with a strict parser that accepts practical
  `rgb/rgba` input variants and clamps channels before packing.
  Touchpoints: `js/render/Stage.js`, `test/render/stage.test.js`.
- [x] Apply explicit radix (`10`) to runtime numeric parsing and normalize
  parse/validation helpers shared by app/game/render modules.
  Touchpoints: `js/app/*`, `js/game/*`, `js/render/*`.
- [x] Remove non-intentional loose equality in gameplay hot paths to avoid
  coercion bugs under high-frequency simulation.
  Touchpoints: `js/actions/*`, `js/lemmings/*`, `js/game/*`.
- [x] Replace ad-hoc DOM querying with explicit required/optional resolution
  helpers and fail-fast initialization for required UI nodes.
  Touchpoints: `js/app/boot.js`, `js/app/bootstrap.js`.
- [x] Route app/runtime/midi access through explicit dependency/context flows
  instead of broad `globalThis` reads in hot paths.
  Touchpoints: `js/core/dependencies.js`, `js/app/*`, `js/game/GameTimer.js`.
- [x] Enable bounded history defaults and make retention policy explicit in
  runtime config so long sessions do not silently overgrow memory.
  Touchpoints: `js/game/HistoryStore.js`, `js/game/TimeTravelController.js`.

### 22.2 MCP implementation split and runtime behavior
- [x] Split MCP tool registration into composable modules (`game`, `editor`,
  `interact`) backed by shared session/state infrastructure.
  Touchpoints: `mcp/server.js`, `mcp/`.
- [x] Publish separate MCPB package manifests for each tool surface while
  keeping shared code in one implementation core.
  Touchpoints: `mcpb/manifest.json`, `mcpb/package.json`, `MCP_COMPAT_PUBLISHING/*`.
- [x] Implement strict runtime routing per surface (tool namespace ownership,
  shared session IDs, no accidental cross-surface handler leakage).
  Touchpoints: `mcp/server.js`, `scripts/mcp-smoke.js`.
- [x] Update MCP docs/prompts to exact shipped tool names and call flows after
  split lands (no speculative docs before implementation).
  Touchpoints: `docs/mcp/README.md`, `docs/mcp/call-examples.md`.

### 22.3 MIDI UI runtime modernization
- [x] Introduce a unified `MidiIntent` state model with reducer-style updates
  and persistence bridge, then rewire existing control handlers to it.
  Touchpoints: `js/app/midi-ui/*`, `js/app/midiUiController.js`.
- [x] Replace dropdown-first note/chord/arp editing with direct controls
  (keyboard/grid/pattern interactions) while preserving existing mappings.
  Touchpoints: `js/app/midiUiController.js`, `css/game.css`.
- [x] Expand MIDI-learn to a generalized arm/disarm workflow for all editable
  controls (notes, CC, chord, arp, transport mappings).
  Touchpoints: `js/midi/input/MidiInputController.js`, `js/app/midiUiController.js`.
- [x] Add deterministic automation hooks to keep E2E coverage robust as UI
  complexity grows.
  Touchpoints: `e2e/midi-ui.spec.js`, `e2e/tools/midiUiSnippets.js`.

### 22.4 History compression and rewind storage
- [x] Add fixed-size delta block containers over per-tick deltas to reduce
  metadata overhead and speed seek/index operations.
  Touchpoints: `js/game/HistoryStore.js`.
- [x] Add canonical binary encoding for blocks and optional cold-block
  compression in storage paths.
  Touchpoints: `js/game/HistoryStore.js`, `scripts/bench-history-stress.js`.
- [x] Add hash-based chunk dedupe for repeated cold blocks to cap growth in
  repetitive scenarios.
  Touchpoints: `js/game/HistoryStore.js`.
- [x] Add no-op span tokenization/RLE to compress idle periods without
  affecting replay determinism.
  Touchpoints: `js/game/HistoryStore.js`.
- [x] Add replay-hash validation runs during test flows to guard deterministic
  seek/replay behavior through compression changes.
  Touchpoints: `test/history-store.test.js`, `test/time-travel-controller.test.js`.

### 22.5 Canvas2D maximum-performance program
- [x] Keep rendering on Canvas2D only; all optimizations target Canvas2D
  compositing, caching, and memory locality (no WebGL/WebGPU migration).
  Touchpoints: `js/render/*`, `js/game/GameView.js`.
- [x] Add an opt-in in-game perf overlay fed by render/tick timing probes to
  expose hot stages and frame spikes during play and bench runs.
  Touchpoints: `js/game/GameView.js`, `js/render/Stage.js`.
- [x] Replace full-frame update tendencies with damage-region accumulation and
  region-scoped layer flushes in Stage + GroundRenderer.
  Touchpoints: `js/render/Stage.js`, `js/render/GroundRenderer.js`.
- [x] Move expensive pixel work out of per-frame paths by precomputing
  palette-expanded/static assets and reusing typed-array/image buffers.
  Touchpoints: `js/render/Frame.js`, `js/render/DisplayImage.js`, `js/render/StageImageProperties.js`.
- [x] Reduce Canvas2D state churn by batching sprite/text draws, minimizing
  context property flips, and avoiding unnecessary clear/repaint cycles.
  Touchpoints: `js/render/*`, `js/game/GameGui.js`.
- [x] Add aggressive allocation reduction in hot loops (object reuse, scratch
  buffers, stable arrays) for render, lemming update, and history flows.
  Touchpoints: `js/render/*`, `js/lemmings/LemmingManager.js`, `js/game/HistoryStore.js`.
- [x] Add level-scale stress profiles focused on sustained high-entity runs and
  reverse playback to tune for worst-case practical performance.
  Touchpoints: `scripts/bench-performance.js`, `test/gameview.benchreverse.test.js`.

### 22.6 Editor and workflow throughput improvements
- [x] Add runtime startup profiles (`gameplay`, `editor`, `perf`) that preload
  relevant settings and disable unnecessary subsystems per mode.
  Touchpoints: `js/app/boot.js`, `js/game/GameView.js`, `docs/config.md`.
- [x] Expand editor batch operations (replace selected, align/distribute,
  randomize-with-rules) as first-class controller actions.
  Touchpoints: `js/editor/EditorController.js`, `js/app/editorUiController.js`.
- [x] Harden offline tooling pipeline performance for large pack processing with
  streaming I/O and reduced intermediate allocations.
  Touchpoints: `tools/*`, `scripts/*`.
- [x] Add focused architecture docs that explain how renderer/time-travel/MCP
  internals are intended to behave for fast implementation onboarding.
  Touchpoints: `docs/`.

### 22.7 Execution order (performance-first)
- [x] Wave 1: correctness + low-risk hot-path cleanup (`22.1`, parser/equality/
  DOM/global cleanup, bounded history defaults).
- [x] Wave 2: Canvas2D frame-time reduction (`22.5` damage regions, buffer
  reuse, draw batching, perf overlay instrumentation).
- [x] Wave 3: history storage compaction (`22.4` blocks/encoding/dedupe/no-op
  tokenization with replay-hash safeguards).
- [x] Wave 4: MCP split and MIDI/editor modernization (`22.2`, `22.3`, `22.6`)
  after core runtime perf characteristics are stable.

### 22.8 Validation matrix for active work
- [x] Baseline: `npm run lint`, `npm run check-undefined`, `npm test`.
- [x] Performance: `npm run bench-performance -- --mode=sequence`,
  `npm run bench-history`.
- [x] MCP: `npm run check-mcp-clients`, `npm run test-mcp-smoke`.
- [x] Editor/MIDI: `npm run test-editor`, `npx mocha \"test/midi/*.test.js\"`.

Notes:
- Performance matrix runs on February 22, 2026 used shortened local durations
  (`BENCH_DURATION_MS=5000`, `HISTORY_DURATION_MS=5000`) while preserving the
  same scripts and runtime paths.

## Phase 23: Runtime hard-cutover and dependency cleanup
- [x] Remove remaining gameplay/render/action hot-path `globalThis.lemmings`
  reads and route through explicit runtime dependencies/context.
  Touchpoints: `js/actions/*`, `js/level/Level.js`, `js/level/Trigger*.js`,
  `js/render/MiniMap.js`, `js/game/GameDisplay.js`, `js/game/SoundEvents.js`.
- [x] Remove `globalThis` MIDI override bridge variables and replace with
  explicit state handoff between boot, `GameView`, and MIDI UI controller.
  Touchpoints: `js/game/GameView.js`, `js/app/boot.js`,
  `js/app/midiUiController.js`.
- [x] Remove magic world-width assumptions in zoom/input flow and derive zoom
  eligibility from stage/image metadata.
  Touchpoints: `js/input/UserInputManager.js`, `js/render/Stage.js`.
- [x] Add explicit app-context injection for MCP helpers currently reading the
  singleton directly.
  Touchpoints: `mcp/server.js`, `js/app/e2eHarness.js`.

## Phase 24: Canvas2D performance tier 3 (no WebGL/WebGPU)
- [x] Stop full background upload on every frame; only push ground updates when
  terrain changed and keep cached background state otherwise.
  Touchpoints: `js/game/Game.js`, `js/level/Level.js`,
  `js/render/DisplayImage.js`.
- [x] Add a bulk terrain-write API so high-volume generators can update spans/
  chunks without per-pixel history/minimap callbacks.
  Touchpoints: `js/level/Level.js`, `js/app/procgenController.js`,
  `js/app/procgenTerrainStamper.js`.
- [x] Replace dirty-rect array copies with zero-copy handoff/reuse buffers to
  reduce per-frame allocations.
  Touchpoints: `js/render/DisplayImage.js`, `js/render/Stage.js`.
- [x] Upgrade scaled-frame variant cache to true LRU semantics so hot scale
  variants stay resident and expensive recalculation is avoided.
  Touchpoints: `js/render/DisplayImage.js`.
- [x] Reduce marching-ants and dashed-outline cost via cached edge spans and
  throttled offset updates at low movement.
  Touchpoints: `js/render/DisplayImage.js`, `js/game/GameGui.js`.
- [x] Optimize Stage overlay fallback path to avoid repeated
  `getImageData/putImageData` churn on browsers without line-dash support.
  Touchpoints: `js/render/Stage.js`.
- [x] Skip redundant resize-triggered redraw work when canvas dimensions are
  unchanged and displays have no pending dirty state.
  Touchpoints: `js/render/Stage.js`.
- [x] Add CPU-only render hotpath benchmark (no browser launch) for dirty-rect,
  marching-ants, and GUI overlay paths.
  Touchpoints: `scripts/bench-hotpaths.js`, `js/render/*`, `js/game/GameGui.js`.

## Phase 25: Procgen production tier 3
- [ ] Add deterministic seeded RNG for procgen generation/AI so scenarios can be
  replayed and benchmarked exactly.
  Touchpoints: `js/app/procgenBoot.js`, `js/app/procgenController.js`,
  `docs/procgen.md`.
- [ ] Replace full gap-array scans with cursored/partitioned processing so cost
  scales with nearby gaps instead of total historical gaps.
  Touchpoints: `js/app/procgenController.js`.
- [ ] Ensure procgen stage adapter has full listener lifecycle cleanup so repeat
  start/stop cycles do not leak wheel/resize handlers.
  Touchpoints: `js/app/procgenStageAdapter.js`, `js/app/procgenBoot.js`.
- [ ] Add scan-cache strategy for repeated environment queries
  (gap/wall/drop/hazard) during the same AI decision window.
  Touchpoints: `js/app/procgenController.js`, `js/render/SolidLayer.js`.
- [ ] Add entity pooling/reuse path for long bench/procgen runs to reduce GC
  churn from repeated lemming object allocation.
  Touchpoints: `js/lemmings/LemmingManager.js`, `js/lemmings/Lemming.js`.
- [ ] Add long-run headless soak benchmark for procgen (entity growth + memory
  ceilings + frame-time summary) with strict cleanup.
  Touchpoints: `scripts/bench-procgen-soak.js`, `test/procgen*.test.js`.
- [ ] Expand procgen coverage for bootstrap/style selection/stage adapter
  branches and shutdown behavior.
  Touchpoints: `js/app/procgenBoot.js`, `js/app/procgenStageAdapter.js`,
  `test/*procgen*.test.js`.

## Phase 26: MCP throughput and lifecycle hardening
- [ ] Replace `EventQueue` shift/filter behavior with a ring-buffer cursor model
  to eliminate O(n) drains and head removals.
  Touchpoints: `mcp/server.js`.
- [ ] Add adaptive watch polling cadence/backoff and on-demand polling hooks so
  idle sessions do less work.
  Touchpoints: `mcp/server.js`.
- [ ] Add spectator backpressure controls (frame skip policy, configurable
  cadence/quality) for multi-client sessions.
  Touchpoints: `mcp/server.js`, `mcp/spectator.html`.
- [ ] Split `mcp/server.js` transport/session/resource/watch/event logic into
  dedicated modules while preserving tool contracts.
  Touchpoints: `mcp/server.js`, `mcp/tools/*`, `scripts/mcp-smoke.js`.
- [ ] Add shutdown/leak tests to ensure intervals, sockets, and browser
  resources are always reclaimed.
  Touchpoints: `mcp/server.js`, `scripts/mcp-smoke.js`, `test/mcp*.test.js`.

## Phase 27: Test and benchmark throughput
- [ ] Add changed-file targeted test selection with stable category mapping and
  fallback to full-suite safety.
  Touchpoints: `scripts/runTests.js`, `package.json`.
- [ ] Add short performance smoke gates (<2 min) for CI/PR and keep long soak
  suites for explicit/nightly runs.
  Touchpoints: `scripts/bench-performance.js`, `scripts/bench-history-stress.js`,
  `scripts/bench-hotpaths.js`.
- [ ] Add branch-coverage tests for large remaining bootstrap/input modules that
  still rely mostly on integration coverage.
  Touchpoints: `js/app/boot.js`, `js/input/UserInputManager.js`,
  `js/app/procgenBoot.js`, `js/app/procgenStageAdapter.js`.
- [ ] Remove expected-error console noise in tests by scoped stubbing so real
  regressions stay visible in output.
  Touchpoints: `test/midi/midi-ui-controller.test.js`, `test/helpers/*`.

## Phase 28: Editor runtime throughput and data integrity
- [ ] Add indexed lookup tables for selected entries/UIDs in editor hot paths to
  avoid repeated linear scans on large maps.
  Touchpoints: `js/editor/EditorController.js`, `js/editor/EditorEntryFactory.js`.
- [ ] Add parser/writer fuzz/property tests for NXLV comment/unknown-section
  round trips and malformed payload recovery.
  Touchpoints: `js/editor/NxlvParser.js`, `js/editor/NxlvWriter.js`,
  `test/editor/*.test.js`.
- [ ] Add palette/search filtering with cached preview invalidation policies for
  large style sets.
  Touchpoints: `js/app/editorUiController.js`, `js/app/editorPreviewCache.js`,
  `css/editor.css`.
- [ ] Add explicit undo/redo transaction grouping for batch operations so
  generated edits remain predictable and reversible.
  Touchpoints: `js/editor/EditorHistory.js`, `js/editor/EditorController.js`.

## Phase 29: MIDI runtime scalability and modularity
- [ ] Implement end-to-end MIDI flag trigger workflow (editor placement,
  runtime trigger registration, and mapping UI integration) and retire the
  deferred Phase 5 flag item.
  Touchpoints: `js/editor/EditorTools.js`, `js/editor/EditorController.js`,
  `js/app/midiUiController.js`, `js/game/GameView.js`, `test/midi/*.test.js`.
- [ ] Split `midiUiController` into smaller feature modules (state, binding,
  rendering sections, learn flow) behind a stable facade.
  Touchpoints: `js/app/midiUiController.js`, `js/app/midi-ui/*`.
- [ ] Coalesce high-frequency UI refresh paths to avoid full-section rebuilds on
  single-control changes.
  Touchpoints: `js/app/midiUiController.js`, `js/app/midi-ui/midiUiDomain.js`.
- [ ] Add strict intent payload validation and migration guards for persisted
  overrides/state.
  Touchpoints: `js/app/midi-ui/midiUiIntent.js`, `js/app/midi-ui/midiUiStorage.js`.
- [ ] Add focused bench coverage for MIDI routing/scheduler throughput under high
  event density.
  Touchpoints: `js/midi/MidiEventRouter.js`, `js/midi/MidiScheduler.js`,
  `scripts/bench-hotpaths.js`.

## Phase 30: Platform and dev-loop reliability
- [ ] Ensure service worker is disabled or bypassed in `dev/e2e/perf` profiles
  and add explicit cache-busting for static assets/config changes.
  Touchpoints: `js/app/registerServiceWorker.js`, `js/app/boot.js`,
  `js/game/GameFactory.js`.
- [ ] Audit pointer/touch listener passive flags and latency-sensitive handlers
  for mobile responsiveness.
  Touchpoints: `js/input/*`, `js/render/Stage.js`, `js/game/GameView.js`.
- [ ] Add deterministic environment diagnostics endpoint for runtime profile,
  feature flags, and active caches to simplify bug triage.
  Touchpoints: `js/app/e2eHarness.js`, `js/game/GameView.js`, `docs/e2e-state.md`.
