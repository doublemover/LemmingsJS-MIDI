# Roadmap

This roadmap consolidates outstanding items from the README (In Progress,
Roadmap, Bugs and Misc) plus the current workstreams. It is the single place to
track ongoing and future work. Keep this roadmap current as work lands.

## Current branch readiness: PR #896 (2026-05-05)
- [x] Fix MCPB surface bundle packaging so `npm run mcpb:build` outputs a
  runnable server artifact with the split MCP import graph included.
  GitHub: #897. Touchpoints: `scripts/build-mcpb-bundle.js`,
  `test/build-mcpb-bundle.test.js`, `docs/mcp/publishing.md`.
- [x] Align Playwright specs with the supported `window.__E2E__` contract:
  remove remaining `window.lemmings` reads and require `?e2e=1` anywhere a
  spec waits on the harness. GitHub: #906. Touchpoints: `e2e/*.spec.js`,
  `e2e/helpers/*`, `js/app/e2eHarness.js`.
- [x] Preserve MIDI flag and other non-lemming dynamic triggers across history,
  rewind, seek, and replay by adding explicit replay-managed trigger metadata
  and rehydration. GitHub: #899. Touchpoints: `js/game/Game.js`,
  `js/game/GameView.js`, `js/game/HistoryStore.js`.
- [x] Make MCP protocol/session metadata truthful and recoverable: normalize
  event cursors, derive accepted tool-name forms from rollout state, and either
  implement or explicitly deprecate `spectator.openBrowser`. GitHub: #898.
  Touchpoints: `mcp/server.js`, `mcp/eventQueue.js`, `mcp/toolRouting.js`.
- [x] Layer gamepad binding sources so hardcoded defaults, file defaults,
  persisted user overrides, and in-session remaps compose deterministically.
  Persist only user override intent. GitHub: #907. Touchpoints:
  `js/input/GamepadInputController.js`, `docs/gamepad-bindings.md`,
  `test/input/gamepad-input-controller.test.js`.
- [x] Clarify render capability vocabulary so the Canvas2D staging +
  `drawImage` present path is not confused with browser `OffscreenCanvas`
  support. GitHub: #908. Touchpoints: `js/core/capabilityMatrix.js`,
  `docs/TESTING.md`, `test/capability-matrix.test.js`.
- [x] Finish singleton cleanup and guardrails in app/render/editor slices:
  remove or isolate remaining raw global defaults and expand lint/test coverage
  beyond the current runtime-only paths. GitHub: #902. Touchpoints:
  `js/render/Stage.js`, `js/app/canvasFocusBlur.js`,
  `js/editor/EditorStorage.js`, `eslint.config.js`, `scripts/runTests.js`.
- [x] Replace the custom text-hygiene baseline with changed-line
  `git diff --check` CI coverage and keep the PR diff clean. GitHub: #904.
  Touchpoints:
  `test/midi/midi-input-controller.coverage.test.js`,
  `test/midi/midi-scheduler.coverage.test.js`, `.github/workflows/test.yml`.
- [x] Rebase or merge the latest `origin/master` change (`11c0880 Create
  FUNDING.yml`) before merging PR #896.
- [x] Finish Playwright service-worker validation with explicit local opt-in,
  same-origin scope checks, and lifecycle cleanup. GitHub: #905. Touchpoints:
  `e2e/service-worker.spec.js`, `js/app/registerServiceWorker.js`,
  `playwright.config.js`, `test/register-service-worker.test.js`.
- [x] Correct trigger rectangle coordinate semantics and level-dimension
  indexing so half-open bounds are used consistently. GitHub: #909.
  Touchpoints: `js/level/Trigger.js`, `js/level/TriggerManager.js`,
  `js/game/Game.js`, `test/triggermanager.test.js`.
- [x] Make `GameTimer` cadence deterministic and injectable for headless and
  multi-runtime tests. GitHub: #910. Touchpoints: `js/game/GameTimer.js`,
  `test/game-timer.test.js`.
- [x] Add editor UI lifecycle ownership, idempotent binding, and stale async
  cancellation for imports/style reloads. GitHub: #911. Touchpoints:
  `js/app/editorUiController.js`, `js/editor/EditorController.js`,
  `test/editor/editor-ui-controller.lifecycle.test.js`.
- [x] Remove browser Node fallbacks and add cache lifecycle/coalescing for
  asset loading. GitHub: #912. Touchpoints: `js/data/FileProvider.js`,
  `js/level/GroundReader.js`, `js/steelSpritesData.js`.
- [x] Clarify `BinaryReader` endian naming and enforce logical-window offset
  bounds. GitHub: #913. Touchpoints: `js/data/BinaryReader.js`,
  `test/binaryreader.test.js`.
- [x] Reduce MIDI hot-path allocations by indexing note actions and reusing
  scheduler/router scratch buffers. GitHub: #914. Touchpoints:
  `js/midi/input/MidiInputController.js`, `js/midi/MidiScheduler.js`,
  `js/midi/MidiEventRouter.js`.
- [x] Bound editor history memory, expose history/cache stats, and make preview
  cache identity palette-aware. GitHub: #915. Touchpoints:
  `js/editor/EditorHistory.js`, `js/app/editorPreviewCache.js`,
  `test/editor/editor-history.test.js`.
- [x] Harden event/performance lifecycle behavior: mutation-safe event dispatch,
  shared-listener disposal, and bounded performance measurements. GitHub: #916.
  Touchpoints: `js/util/EventHandler.js`, `js/commands/CommandManager.js`,
  `js/util/performanceInstrumentation.js`.
- [x] Add service-worker, MIDI UI, procgen boot, and editor controller cleanup
  paths for long-running sessions. GitHub: #917. Touchpoints:
  `js/app/registerServiceWorker.js`, `js/app/midiUiController.js`,
  `js/app/procgenBoot.js`.
- [x] Harden offline asset tooling with metadata path validation, bounded
  archive caches, and safe CSS inlining. GitHub: #918. Touchpoints:
  `tools/packPipeline.js`, `tools/NodeFileProvider.js`,
  `scripts/processHtmlFile.js`, `docs/offline-tools.md`.
- [x] Changed-file test selection now resolves a meaningful base by default and
  has category coverage for editor/offline tooling. GitHub: #900.
- [x] Maintained Mocha npm scripts now route through `scripts/runTests.js`.
  GitHub: #901.
- [x] Stage overlay visibility transitions now invalidate composition and have
  regression coverage. GitHub: #903.

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
- [x] Ability to place flags to trigger MIDI events.

Notes:
- MIDI flag workflow now lands via Phase 29 (editor placement, runtime trigger
  registration, and mapping UI integration).

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
- [x] Add `joypad.js` as a dependency and implement full gamepad
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
- [x] Make shipped underscore tool names the only MCP call names.
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
- [x] Add deterministic seeded RNG for procgen generation/AI so scenarios can be
  replayed and benchmarked exactly.
  Touchpoints: `js/app/procgenBoot.js`, `js/app/procgenController.js`,
  `docs/procgen.md`.
- [x] Replace full gap-array scans with cursored/partitioned processing so cost
  scales with nearby gaps instead of total historical gaps.
  Touchpoints: `js/app/procgenController.js`.
- [x] Ensure procgen stage adapter has full listener lifecycle cleanup so repeat
  start/stop cycles do not leak wheel/resize handlers.
  Touchpoints: `js/app/procgenStageAdapter.js`, `js/app/procgenBoot.js`.
- [x] Add scan-cache strategy for repeated environment queries
  (gap/wall/drop/hazard) during the same AI decision window.
  Touchpoints: `js/app/procgenController.js`, `js/render/SolidLayer.js`.
- [x] Add entity pooling/reuse path for long bench/procgen runs to reduce GC
  churn from repeated lemming object allocation.
  Touchpoints: `js/lemmings/LemmingManager.js`, `js/lemmings/Lemming.js`.
- [x] Add long-run headless soak benchmark for procgen (entity growth + memory
  ceilings + frame-time summary) with strict cleanup.
  Touchpoints: `scripts/bench-procgen-soak.js`, `test/procgen*.test.js`.
- [x] Expand procgen coverage for bootstrap/style selection/stage adapter
  branches and shutdown behavior.
  Touchpoints: `js/app/procgenBoot.js`, `js/app/procgenStageAdapter.js`,
  `test/*procgen*.test.js`.

## Phase 26: MCP throughput and lifecycle hardening
- [x] Replace `EventQueue` shift/filter behavior with a ring-buffer cursor model
  to eliminate O(n) drains and head removals.
  Touchpoints: `mcp/server.js`.
- [x] Add adaptive watch polling cadence/backoff and on-demand polling hooks so
  idle sessions do less work.
  Touchpoints: `mcp/server.js`, `mcp/watchPolling.js`.
- [x] Add spectator backpressure controls (frame skip policy, configurable
  cadence/quality) for multi-client sessions.
  Touchpoints: `mcp/server.js`, `mcp/spectator.html`,
  `mcp/spectatorBroadcaster.js`.
- [x] Split `mcp/server.js` transport/session/resource/watch/event logic into
  dedicated modules while preserving tool contracts.
  Touchpoints: `mcp/server.js`, `mcp/eventEnvelope.js`, `mcp/resourceStore.js`,
  `mcp/sessionStore.js`, `mcp/tools/*`, `scripts/mcp-smoke.js`.
- [x] Add shutdown/leak tests to ensure intervals, sockets, and browser
  resources are always reclaimed.
  Touchpoints: `mcp/server.js`, `mcp/sessionLifecycle.js`,
  `scripts/mcp-smoke.js`, `test/mcp*.test.js`.

## Phase 27: Test and benchmark throughput
- [x] Add changed-file targeted test selection with stable category mapping and
  fallback to full-suite safety.
  Touchpoints: `scripts/runTests.js`, `package.json`.
- [x] Add short performance smoke gates (<2 min) for CI/PR and keep long soak
  suites for explicit/nightly runs.
  Touchpoints: `scripts/bench-performance.js`, `scripts/bench-history-stress.js`,
  `scripts/bench-hotpaths.js`.
- [x] Add branch-coverage tests for large remaining bootstrap/input modules that
  still rely mostly on integration coverage.
  Touchpoints: `js/app/boot.js`, `js/input/UserInputManager.js`,
  `js/app/procgenBoot.js`, `js/app/procgenStageAdapter.js`.
- [x] Remove expected-error console noise in tests by scoped stubbing so real
  regressions stay visible in output.
  Touchpoints: `test/midi/midi-ui-controller.test.js`, `test/helpers/*`.

## Phase 28: Editor runtime throughput and data integrity
- [x] Add indexed lookup tables for selected entries/UIDs in editor hot paths to
  avoid repeated linear scans on large maps.
  Touchpoints: `js/editor/EditorController.js`, `js/editor/EditorEntryFactory.js`.
- [x] Add parser/writer fuzz/property tests for NXLV comment/unknown-section
  round trips and malformed payload recovery.
  Touchpoints: `js/editor/NxlvParser.js`, `js/editor/NxlvWriter.js`,
  `test/editor/*.test.js`.
- [x] Add palette/search filtering with cached preview invalidation policies for
  large style sets.
  Touchpoints: `js/app/editorUiController.js`, `js/app/editorPreviewCache.js`,
  `css/editor.css`.
- [x] Add explicit undo/redo transaction grouping for batch operations so
  generated edits remain predictable and reversible.
  Touchpoints: `js/editor/EditorHistory.js`, `js/editor/EditorController.js`.

## Phase 29: MIDI runtime scalability and modularity
- [x] Implement end-to-end MIDI flag trigger workflow (editor placement,
  runtime trigger registration, and mapping UI integration) and retire the
  deferred Phase 5 flag item.
  Touchpoints: `js/editor/EditorTools.js`, `js/editor/EditorController.js`,
  `js/app/midiUiController.js`, `js/game/GameView.js`, `test/midi/*.test.js`.
- [x] Split `midiUiController` into smaller feature modules (state, binding,
  rendering sections, learn flow) behind a stable facade.
  Touchpoints: `js/app/midiUiController.js`, `js/app/midi-ui/*`.
- [x] Coalesce high-frequency UI refresh paths to avoid full-section rebuilds on
  single-control changes.
  Touchpoints: `js/app/midiUiController.js`, `js/app/midi-ui/midiUiDomain.js`.
- [x] Add strict intent payload validation and migration guards for persisted
  overrides/state.
  Touchpoints: `js/app/midi-ui/midiUiIntent.js`, `js/app/midi-ui/midiUiStorage.js`.
- [x] Add focused bench coverage for MIDI routing/scheduler throughput under high
  event density.
  Touchpoints: `js/midi/MidiEventRouter.js`, `js/midi/MidiScheduler.js`,
  `scripts/bench-hotpaths.js`.

## Phase 30: Platform and dev-loop reliability
- [x] Ensure service worker is disabled or bypassed in `dev/e2e/perf` profiles
  and add explicit cache-busting for static assets/config changes.
  Touchpoints: `js/app/registerServiceWorker.js`, `js/app/boot.js`,
  `js/game/GameFactory.js`.
- [x] Audit pointer/touch listener passive flags and latency-sensitive handlers
  for mobile responsiveness.
  Touchpoints: `js/input/*`, `js/render/Stage.js`, `js/game/GameView.js`.
- [x] Add deterministic environment diagnostics endpoint for runtime profile,
  feature flags, and active caches to simplify bug triage.
  Touchpoints: `js/app/e2eHarness.js`, `js/game/GameView.js`, `docs/e2e-state.md`.

## Phase 31: Runtime hard cutover (no global singleton fallback)
- [x] Remove remaining runtime reads of implicit `lemmings` globals in gameplay,
  render, MIDI, and logging paths; route all runtime flags/state through
  explicit context objects.
  Touchpoints: `js/game/Game.js`, `js/game/GameTimer.js`,
  `js/lemmings/LemmingManager.js`, `js/midi/MidiScheduler.js`,
  `js/midi/MidiEventRouter.js`, `js/util/LogHandler.js`, `js/lemmings/Lemming.js`.
- [x] Replace `globalThis.onEnabled` / `globalThis.onMidiError` callback bridge
  with explicit event wiring between boot, `GameView`, and MIDI UI controller.
  Touchpoints: `js/app/boot.js`, `js/game/GameView.js`,
  `js/app/midiUiController.js`.
- [x] Remove compatibility fallbacks to `globalThis.lemmings` / bare `lemmings`
  in remaining runtime helpers and factories.
  Touchpoints: `js/game/GameFactory.js`, `js/game/GameGui.js`,
  `js/game/GameVictoryCondition.js`, `js/game/HistoryStore.js`.
- [x] Enforce hard-cutover guardrails in lint/tests so new global fallback usage
  cannot regress.
  Touchpoints: `eslint.config.js`, `test/*`, `scripts/runTests.js`.

## Phase 32: Replay data layout tier 2 (binary-first cold path)
- [x] Replace JSON clone/serialize cold-block paths with binary codecs to avoid
  `JSON.parse(JSON.stringify(...))` in history compaction.
  Touchpoints: `js/game/HistoryStore.js`, `docs/compression-format.md`.
- [x] Store cold-block lemming mutation streams in typed-array sections
  (field-packed) instead of object arrays to reduce memory and decode cost.
  Touchpoints: `js/game/HistoryStore.js`.
- [x] Remove `Lemming` constructor global fallbacks during keyframe/delta apply
  and require explicit ctor wiring from manager/runtime context.
  Touchpoints: `js/game/HistoryStore.js`, `js/lemmings/LemmingManager.js`.
- [x] Add seek/replay perf gates and long-session parity checks for the new
  binary layout.
  Touchpoints: `scripts/bench-history-stress.js`, `test/history-store.test.js`,
  `test/time-travel-controller.test.js`.

## Phase 33: Canvas2D render composition tier 4
- [x] Move terrain presentation to a tile/chunk compositing model so stage draws
  update dirty tiles rather than repeatedly uploading large regions.
  Touchpoints: `js/render/GroundRenderer.js`, `js/level/Level.js`,
  `js/render/DisplayImage.js`, `js/render/Stage.js`.
- [x] Add a dedicated overlay plane for marching ants/selection/hover so
  high-frequency HUD outlines avoid unnecessary main-layer invalidation.
  Touchpoints: `js/render/DisplayImage.js`, `js/game/GameGui.js`,
  `js/game/GameDisplay.js`, `js/render/Stage.js`.
- [x] Optimize scaled blit paths with precomputed source-coordinate maps and
  branch-reduced inner loops.
  Touchpoints: `js/render/DisplayImage.js`.
- [x] Extend CPU hotpath benchmarks to isolate tile-composition, overlay, and
  scaled-blit regressions.
  Touchpoints: `scripts/bench-hotpaths.js`, `scripts/bench-smoke.js`,
  `test/bench-hotpaths.test.js`.

## Phase 34: MCP throughput tier 2 + API cutover
- [x] Keep short canonical MCP tool names only.
  Touchpoints: `mcp/server.js`, `docs/mcp/README.md`, `docs/mcp/protocol-v2.md`.
- [x] Split remaining heavy state/delta/spectator logic from `mcp/server.js`
  into dedicated modules to reduce hot-path branching and improve testability.
  Touchpoints: `mcp/server.js`, `mcp/tools/*`, `mcp/sessionLifecycle.js`.
- [x] Replace watch `onChange` JSON-stringify comparisons with pointer-aware
  comparators/hashes to reduce poll overhead.
  Touchpoints: `mcp/server.js`, `mcp/watchPolling.js`.
- [x] Rework lemming summary extraction to single-pass accumulation with bounded
  top-K selection (no full candidate sort unless requested).
  Touchpoints: `mcp/server.js`, `test/mcp*.test.js`.

## Phase 35: Frontend/UI runtime dependency cleanup
- [x] Remove jQuery runtime dependency from boot/resize flow and switch to
  native DOM/event APIs end-to-end.
  Touchpoints: `js/app/boot.js`, `index.html`, `editor.html`, `package.json`.
- [x] Eliminate `window.lemmings` coupling in procgen/bootstrap paths and route
  stage updates through explicit runtime handles.
  Touchpoints: `js/app/procgenBoot.js`, `js/app/procgenStageAdapter.js`.
- [x] Reduce MIDI UI listener churn by consolidating repetitive per-control
  binding into delegated/section-level handlers where feasible.
  Touchpoints: `js/app/midiUiController.js`, `js/app/midi-ui/midiUiSections.js`.
- [x] Add versioned storage migration for editor/MIDI settings to keep persisted
  state deterministic across UI schema changes.
  Touchpoints: `js/app/midi-ui/midiUiStorage.js`, `js/editor/EditorStorage.js`.

## Phase 36: Test suite throughput tier 2
- [x] Extract shared test support harnesses (globals/dom/canvas/timers/deps) and
  refactor largest suites to remove duplicated scaffolding.
  Touchpoints: `test/helpers/*`, `test/support/*`, `test/midi/*.test.js`,
  `test/gameview.coverage.test.js`, `test/history-store.test.js`.
- [x] Split oversized coverage-heavy suites into focused behavior suites while
  preserving branch coverage guarantees.
  Touchpoints: `test/*coverage*.test.js`, `test/action-systems.test.js`.
- [x] Tighten fast benchmark smoke defaults so perf checks stay under a short
  dev-loop budget by default, with explicit opt-in soak runs.
  Touchpoints: `scripts/bench-smoke.js`, `scripts/bench-performance.js`,
  `scripts/bench-history-stress.js`, `docs/TESTING.md`.
- [x] Clarify and align test script semantics/docs (`test-bench` vs bench
  scripts) to avoid misuse and false expectations.
  Touchpoints: `package.json`, `docs/TESTING.md`.

## Phase 37: Static analysis and correctness guardrails
- [x] Replace ad-hoc undefined-call scanning with scope-aware analysis and
  controlled HTML entrypoint scanning to reduce false positives/negatives.
  Touchpoints: `scripts/check-undefined.js`, `scripts/processHtmlFile.js`,
  `test/check-undefined.test.js`.
- [x] Add guardrails for tricky perf/correctness invariants (dirty-rect
  integrity, history replay equivalence, trigger ownership cleanup) with
  targeted invariant tests.
  Touchpoints: `test/render/stage.test.js`, `test/history-store.test.js`,
  `test/level/trigger-manager.test.js`.

## Phase 38: Runtime lifecycle and static safety hardening
- [x] Replace hard `process.exit` signal shutdown behavior in MCP server with an
  idempotent graceful shutdown controller that disposes runtime sessions and
  closes server transports in a deterministic order.
  Touchpoints: `mcp/server.js`, `mcp/shutdownController.js`,
  `test/mcp-shutdown-controller.test.js`.
- [x] Enforce radix-safe integer parsing in lint and clear remaining non-vendor
  `parseInt` hotpath usage without explicit base to prevent coercion edge
  cases.
  Touchpoints: `eslint.config.js`, `js/xbrz/xbrz.js`.

## Phase 39: Test suite overlap reduction
- [x] Consolidate overlapping SoundEvent bus suites into a single canonical test
  file and remove redundant duplicate coverage to reduce maintenance churn while
  preserving assertions.
  Touchpoints: `test/sound-events.test.js`, `test/soundevents.test.js`.

## Phase 40: MCP server surface split and semantic-first workflows
- [x] Freeze versioned semantic schemas in the current MCP surface first
  (`game.*`, `editor.*`) with hard-cut underscore call names.
  Touchpoints: `mcp/server.js`, `mcp/tools/*`, `docs/mcp/protocol-v2.md`.
- [x] Replace catch-all editor mutation flows with typed verbs (`objects.list`,
  `objects.place`, `objects.update`, `objects.delete`) that support paging,
  bbox filtering, compact field profiles, and revision-aware deltas.
  Touchpoints: `mcp/server.js`, `mcp/tools/*`, `test/mcp*.test.js`.
- [x] Remove non-canonical protocol support after the semantic tools shipped.
  Touchpoints: `mcp/server.js`, `test/mcp*.test.js`, `docs/mcp/*`.
- [x] Split MCP into dedicated game/editor/interact registrations/manifests
  only after semantic APIs and adapters are stable.
  Touchpoints: `mcp/server.js`, `mcp/tools/*`, `docs/mcp/*`.
- [x] Add conformance tests that enforce semantic-first usage (game/editor
  servers reject raw input tools; interact server remains explicit fallback).
  Touchpoints: `test/mcp*.test.js`, `docs/mcp/protocol-v2.md`.
- [x] Publish MCP agent playbooks only after schema freeze, including
  snapshot-first loops, batching, paging, and explicit Interact fallback rules.
  Touchpoints: `docs/mcp/README.md`, `docs/mcp/protocol-v2.md`.

## Phase 41: History/rewind compression tier 3
- [x] Ship bounded-history defaults and profile-driven retention first so long
  sessions are safe before deeper codec changes.
  Touchpoints: `js/game/HistoryStore.js`, `js/app/boot.js`, `docs/TESTING.md`.
- [x] Add replay invariant harnesses (random seek/rewind/replay + stable hashes)
  and make them mandatory guards before enabling new compression layers.
  Touchpoints: `test/history-store.test.js`, `test/time-travel-controller.test.js`.
- [x] Add no-op delta tokens plus run-length encoding for unchanged tick spans
  to reduce idle-history memory growth.
  Touchpoints: `js/game/HistoryStore.js`, `docs/compression-format.md`.
- [x] Encode deltas into fixed-size canonical typed-array blocks to improve
  locality and reduce per-tick object churn.
  Touchpoints: `js/game/HistoryStore.js`, `docs/compression-format.md`.
- [x] Add optional cold-block compression and dictionary dedupe behind feature
  flags with benchmark gates and collision-safe verification fallback.
  Touchpoints: `js/game/HistoryStore.js`, `scripts/bench-history-stress.js`.

## Phase 42: Render throughput tier 5 (Canvas2D-first)
- [x] Extend perf instrumentation first with p50/p95/p99/worst-case capture and
  allocation-aware diagnostics so optimization claims are evidence-based.
  Touchpoints: `js/render/Stage.js`, `scripts/bench-hotpaths.js`,
  `docs/TESTING.md`.
- [x] Unify damage tracking into one authoritative aggregator for terrain,
  sprites, and overlays with deterministic full-redraw fallback thresholds.
  Touchpoints: `js/render/Stage.js`, `js/render/GroundRenderer.js`,
  `js/game/GameView.js`.
- [x] Audit minimap/particle redraw cadence and batching for quick wins before
  deeper compositor changes.
  Touchpoints: `js/game/MiniMap.js`, `js/game/ParticleTable.js`,
  `test/minimap.test.js`.
- [x] Reduce hot-path `putImageData` with capability-gated offscreen composition
  and `drawImage` present paths while keeping correctness fallbacks.
  Touchpoints: `js/render/Stage.js`, `js/render/DisplayImage.js`.
- [x] Run a feature-gated worker/offscreen experiment path (non-default) with
  rollback flags for unsupported browser/device profiles.
  Touchpoints: `js/render/Stage.js`, `docs/TESTING.md`.

## Phase 43: MIDI UI expressive controls and intent model
- [x] Extract a stable `MidiIntent` model used by UI, persistence, and router
  layers so control widgets are decoupled from mapping internals.
  Touchpoints: `js/app/midiUiController.js`, `js/app/midi-ui/*`.
- [x] Add settings migration and backward-compatible persistence mapping for
  `MidiIntent` before replacing legacy widget contracts.
  Touchpoints: `js/app/midi-ui/*`, `test/midi/*.test.js`.
- [x] Introduce feature flags for new controls and require accessibility parity
  (keyboard navigation + labels + focus behavior) before defaulting on.
  Touchpoints: `js/app/midiUiController.js`, `css/*`, `e2e/midi-ui.spec.js`.
- [x] Replace key/octave dropdown flows with direct-manipulation controls
  (keyboard-style picker + octave shift) and deterministic test hooks.
  Touchpoints: `js/app/midiUiController.js`, `css/*`, `test/midi/*.test.js`.
- [x] Replace arpeggiator mode dropdown with a compact step-pattern editor plus
  presets and explicit serialization semantics.
  Touchpoints: `js/app/midi-ui/*`, `test/midi/*.test.js`.
- [x] Add preview/audition and MIDI-learn affordances that remain fully
  automatable in E2E harness flows.
  Touchpoints: `js/app/midiUiController.js`, `e2e/midi-ui.spec.js`.
- [x] Finalize expressive controls as the only mapping UI after accessibility
  checks pass across desktop/mobile layouts.
  Touchpoints: `js/app/midiUiController.js`, `test/midi/*.test.js`.

## Phase 44: Runtime correctness and profile hardening
- [x] Introduce runtime profile presets (`classic`, `midi`, `editor`, `e2e`,
  `perf`) to centralize history, logging, and rendering defaults.
  Touchpoints: `js/app/boot.js`, `js/game/GameFactory.js`, `docs/TESTING.md`.
- [x] Complete DOM resolution hardening in boot paths via explicit
  required/optional element helpers and clearer embed-mode failure behavior.
  Touchpoints: `js/app/boot.js`, `js/app/domResolver.js`, `test/app-boot.test.js`.
- [x] Add targeted `tsc --checkJs` coverage for critical modules to catch
  undefined-shape regressions before runtime.
  Touchpoints: `js/game/HistoryStore.js`, `js/render/Stage.js`,
  `js/level/Trigger.js`, `package.json`.
- [x] Roll out strict-equality guardrails via lint + codemods in scoped slices,
  allowing intentional `== null` usage only where dual-null semantics are
  documented.
  Touchpoints: `eslint.config.js`, `js/actions/*`, `js/game/*`, `js/lemmings/*`.
- [x] Remove remaining runtime reads of `globalThis.*` singletons in app/game
  paths and route through explicit dependency/context boundaries.
  Touchpoints: `js/app/*`, `js/game/*`, `js/midi/*`, `js/core/dependencies.js`.

## Phase 45: Test suite condensation tier 3
- [x] Expand shared test support (`dom`, `canvas`, `deps`, fixtures) and migrate
  largest suites to remove duplicated scaffolding.
  Touchpoints: `test/support/*`, `test/helpers/*`, `test/*coverage*.test.js`.
- [x] Merge remaining near-duplicate coverage suites and standardize naming
  conventions to avoid case/collision drift.
  Touchpoints: `test/*`.
- [x] Refactor top-volume suites into table-driven scenario runners with shared
  harnesses while preserving branch coverage guarantees.
  Touchpoints: `test/history-store.test.js`, `test/action-systems.test.js`,
  `test/midi/*.test.js`, `test/gameview.coverage.test.js`.
- [x] Add E2E page-object fixtures and semantic selector helpers to reduce
  repeated harness setup boilerplate.
  Touchpoints: `e2e/*.spec.js`, `e2e/helpers/*`.
- [x] Add test-runtime budgets and suite-duration guardrails so condensation
  work measurably improves local dev-loop speed.
  Touchpoints: `scripts/runTests.js`, `docs/TESTING.md`, `package.json`.

## Phase 46: Privacy-first analytics (optional)
- [x] Document consent defaults and data-minimization constraints for visitor
  stats and gameplay/editor events.
  Touchpoints: `docs/*`.
- [x] Add local-only analytics ring buffer with explicit export/import so
  development telemetry works with zero hosted backend.
  Touchpoints: `js/app/*`, `docs/*`.
- [x] Add optional managed `sendBeacon` endpoint integration path (off by
  default) with strict, versioned, low-cardinality event schema and sampling.
  Touchpoints: `js/app/*`, `docs/*`.
- [x] Add explicit build/runtime kill switches so analytics remains disabled by
  default in development and can be hard-disabled per deployment.
  Touchpoints: `js/app/*`, `docs/*`.

## Phase 47: Cross-cutting risk retirement (complex/tricky)
- [x] Add browser capability matrix coverage for WebMIDI, OffscreenCanvas,
  ImageBitmap paths, and deterministic fallbacks.
  Touchpoints: `js/app/*`, `js/render/*`, `test/*`, `e2e/*`.
- [x] Introduce staged rollout flags and rollback toggles for high-risk changes
  in phases 40-43 (MCP/API split, history codec, render present paths, MIDI UI).
  Touchpoints: `js/app/boot.js`, `js/game/GameFactory.js`, `docs/TESTING.md`.
- [x] Add long-session soak tests (memory, GC churn, replay integrity, event
  queue growth) and enforce regression thresholds in CI.
  Touchpoints: `scripts/bench-*.js`, `scripts/runTests.js`, `test/*`.
- [x] Add release-readiness checklist gates covering compatibility, migration,
  performance, accessibility, and rollback rehearsals before enabling defaults.
  Touchpoints: `docs/*`, `scripts/*`.

## Phase 48: Large-file modularization
- [x] Modularize history/time storage and tests. Current inventory:
  `test/history-store.test.js` (3398 lines), `js/game/HistoryStore.js` (3031),
  `test/time-travel-controller.test.js` (718), `test/game-timer.test.js` (650).
  Target tree: `js/game/history/HistoryStoreCore.js`,
  `HistoryBinaryCodec.js`, `HistoryDeltaCodec.js`, `HistoryLemmingState.js`,
  `HistoryTriggerState.js`, `HistoryObjectState.js`, `HistoryGroundState.js`,
  `HistoryScalarState.js`, `HistoryColdBlocks.js`; keep
  `js/game/HistoryStore.js` as the stable facade export. Split tests into
  codec, keyframe/delta, lemming, ground/trigger/object, scalar/manager,
  cold-block, replay, timer, and time-travel suites with shared fixtures in
  `test/support/history-fixtures.js`.
- [x] Modularize MIDI runtime, UI, and tests. Current inventory:
  `js/app/midiUiController.js` (2128), `test/midi/midi-event-router.test.js`
  (1944), `test/midi/midi-ui-controller.test.js` (1748),
  `test/midi/midi-mapping.test.js` (1066), `js/midi/MidiScheduler.js` (723),
  `test/midi/midi-scheduler.coverage.test.js` (713),
  `js/midi/MidiEventRouter.js` (698), `js/midi/MidiMapping.js` (626),
  `test/midi/midi-scheduler.test.js` (564). Target tree:
  `js/app/midi-ui/midiUiDevices.js`, `midiUiErrors.js`,
  `midiUiMappingEditor.js`, `midiUiDebug.js`, `midiUiLifecycle.js`;
  `js/midi/MidiRateLimiter.js`, `MidiMpeAllocator.js`, `MidiNoteQueue.js`,
  `MidiRoutePlanner.js`, `MidiRepeatState.js`, `MidiArpState.js`,
  `MidiRouteBudget.js`. Preserve `createMidiUiController`, scheduler/router
  public constructors, mapping persistence keys, and MIDI test hooks.
- [x] Modularize MCP server surface. Current inventory: `mcp/server.js` (2090),
  `mcp/watchPolling.js` (552). Target tree: `mcp/schemas.js`,
  `mcp/protocolMetadata.js`, `mcp/sessionTools.js`, `mcp/gameTools.js`,
  `mcp/editorObjectTools.js`, `mcp/visionTools.js`; keep `mcp/server.js` as
  startup, registry, and runtime export wiring. Preserve shipped tool names,
  schemas, and protocol metadata.
- [x] Modularize E2E/editor harnesses and specs. Current inventory:
  `js/app/e2eHarness.js` (2004), `e2e/harness.editor.spec.js` (1062). Target
  tree: `js/app/e2e/stateSerialization.js`, `editorApplyHarness.js`,
  `canvasHarness.js`, `gameControlsHarness.js`, `diagnosticsHarness.js`; keep
  `installE2EHarness`, `isE2EEnabled`, and `window.__E2E__` method names
  stable. Split editor harness specs by state, mutations, saved/import/export,
  and canvas-coordinate flows.
- [x] Modularize editor runtime/UI and tests. Current inventory:
  `js/app/editorUiController.js` (1930), `js/editor/EditorController.js`
  (1619), `test/editor/editor-controller.test.js` (1300). Target tree:
  `js/editor/EditorSelectionModel.js`, `EditorSelectionCommands.js`,
  `EditorPlacementTools.js`, `EditorPointerController.js`;
  `js/app/editor-ui/editorUiBindings.js`, `editorPaletteUi.js`,
  `editorSelectionPanel.js`, `editorLevelIoUi.js`, `editorStatusUi.js`.
  Preserve `EditorController` and `EditorUiController` public APIs and existing
  editor storage/history behavior.
- [x] Modularize render/game UI and tests. Current inventory:
  `js/game/GameView.js` (1836), `test/gameview.coverage.test.js` (1760),
  `js/render/Stage.js` (1542), `js/render/DisplayImage.js` (1420),
  `test/render/stage.test.js` (1168), `js/game/GameGui.js` (1039),
  `test/game-gui.coverage.test.js` (761), `js/render/MiniMap.js` (588).
  Target tree: `js/game/game-view/GameViewQuery.js`,
  `GameViewLevelSelection.js`, `GameViewMidi.js`, `GameViewEditorMode.js`,
  `GameViewDiagnostics.js`; `js/render/stage/StagePerf.js`,
  `StageInput.js`, `StageCompositor.js`, `StageOverlays.js`;
  `js/render/display/DisplayDirtyTracking.js`, `DisplayFrameCache.js`,
  `DisplayPrimitives.js`, `DisplayBlit.js`; `js/game/game-gui/GameGuiInput.js`,
  `GameGuiRender.js`, `SkillPanelDrawing.js`, `SmoothScroller.js`. Preserve
  exported classes, canvas ownership, render test hooks, and public game UI
  behavior.
- [x] Modularize game/level/lemming/data/input/app/script support files.
  Current inventory: `test/action-systems.test.js` (1760),
  `js/app/procgenController.js` (1497), `test/fileprovider.test.js` (1256),
  `scripts/bench-hotpaths.js` (1240), `js/lemmings/LemmingManager.js` (835),
  `js/level/Level.js` (831), `test/midi/midi-input-controller.coverage.test.js`
  (773), `scripts/check-undefined.js` (766), `js/data/FileProvider.js` (758),
  `js/app/analytics.js` (582), `test/input/keyboard-shortcuts-coverage.test.js`
  (572), `scripts/runTests.js` (566), `js/app/boot.js` (547),
  `js/input/GamepadInputController.js` (543), `scripts/bench-long-session.js`
  (542), `scripts/bench-history-stress.js` (537), `js/xbrz/xbrz.js` (532),
  `js/input/KeyboardShortcuts.js` (525). Target trees: procgen director,
  terrain generation, terrain painting, and tracking modules; level object,
  ground mutation, steel, and arrow modules; lemming action registry, spawner,
  selection index, and nuke modules; FileProvider fetch/cache/validation
  modules; input binding/polling/format modules; script-local `scripts/*`
  helper modules. Treat `js/xbrz/xbrz.js` as low-priority algorithmic code and
  split only where behavior is clearly repo-owned.
- [x] Keep modularization behavior-preserving. Old facade files must continue
  exporting the same public symbols, browser `js/` modules must remain
  Node-free, `js/vendor/` must not be touched, and no strict file-length gate
  should be added. Validate each section with its targeted suite before moving
  on, then run `npm run format`, `npm run check-undefined`, `npm run lint`,
  `npm run typecheck:critical`, `npm test`, `npm run test-bench-unit`, and
  `npm run depcheck` before completing the phase.

## Phase 49: Hard-cut cleanup and current guardrails
- [x] Remove non-canonical MCP tool-name paths and rollout environment toggles
  so `listTools` names are the only accepted call names.
  Touchpoints: `mcp/server.js`, `mcp/toolRouting.js`,
  `mcp/protocolMetadata.js`, `docs/mcp/*`, `test/mcp*.test.js`.
- [x] Remove retired MIDI legacy-control rollout paths and keep expressive MIDI
  mapping controls as the only UI contract.
  Touchpoints: `js/app/midiUiController.js`, `js/app/midi-ui/*`,
  `js/core/rolloutFlags.js`, `docs/midi-ui.md`, `test/midi/*`.
- [x] Add existing audit/typecheck/MCP client/MCP smoke/benchmark smoke checks
  to CI with an HTTPS server startup step for browser-backed smoke scripts.
  Touchpoints: `.github/workflows/test.yml`.
- [x] Expand critical typecheck coverage to the newly extracted high-risk
  modules that can pass without introducing repo-wide mixin declarations.
  Touchpoints: `tsconfig.checkjs.json`.
- [x] Continue second-pass modularization of the largest remaining editor and
  MIDI UI files by extracting feature flags, refresh-section derivation,
  editor pointer method groups, editor UI binding groups, and E2E editor apply
  helpers/result assembly.
  Touchpoints: `js/app/midi-ui/*`, `js/app/e2e/*`,
  `js/editor/editor-controller/*`, `js/app/editor-ui/*`.
- [x] Move the root `mcp_editor_apply_spec.md` into `docs/mcp/editor-apply.md`
  and rewrite it as the shipped contract rather than a proposal.
  Touchpoints: `docs/mcp/editor-apply.md`, `docs/mcp/README.md`.
