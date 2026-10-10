# Roadmap

Historical completed roadmap entries live in git history. This file is the
current source of truth for future work and should stay focused on active
product and tooling direction.

## Format

Each milestone uses the same shape:

- **Outcome:** What should be true for users or maintainers when the milestone
  is done.
- **Scope:** Work that belongs in the milestone.
- **Workflow Coverage:** Real workflows that must be exercised, preferably by
  headless Playwright or deterministic unit/integration tests.
- **Deliverables:** Concrete code, docs, tools, or artifacts.
- **Acceptance:** Observable completion criteria.
- **Out of Scope:** Tempting work that should not be mixed into the milestone.

Prefer hard cutovers over aliases, shims, fallbacks, or retired behavior tests.
When a milestone replaces an old path, remove the old path in the same phase.

## Sequencing

1. Level editor audit and productization.
2. Procedural generation productization.
3. Solver and solvability platform.
4. MIDI sequencer follow-up polish only when captures, tests, or real workflow
   use expose a concrete gap.

## Current MIDI and game UI backlog (October 8, 2026)

- [x] Diagnose local preview attenuation; offer explicit local gain/headroom while preserving saved levels and external MIDI values.
- [x] Strengthen explicitly applied starting palettes without rewriting saved projects or their velocity limits.
- [x] Restore game shortcuts while a speed range is focused; use tenths below 1x, integers through 10x, then tens, following effective slowdown.
- [x] Move starting palettes beside Listen to game; tighten event cards, remove repeated empty labels and successful audition footers.
- [x] Show locally dispatched pitches moving left to right through event rows, matching actual triangle attack/hold/release and clearing on Panic.
- [x] Hide only unavailable skill events, preserve mappings and restore rows immediately for cheats.
- [x] Extend reusable clips with per-event 8/16-cell note/drag entry, per-cell velocity/duration/chance, event/pass conditions and explicit event/game-tick advance.
- [x] Add bar-defined conditions and ordered pitch/repeat transformations without introducing another clock or conflating event/bar/pass counters.
- [x] Expose direct Panic, join level navigation, remove redundant picker labels, rename Source to GitHub and make color swatches contiguous with outer rounded ends.
- [x] Preserve live playback and focus across compositor-only Focus/Split/Overlay transitions.
- [x] Dock existing skill-specific cards beneath action selectors, preserving canvas controls, keyboard focus and synchronous availability/cheat updates.
- [x] Leave a glyph of space before OUT while retaining complete Increase/Decrease labels; show a lighter minimap click-destination preview with existing marching ants.

## Current worker follow-through (October 9, 2026)

- [x] Publish the owner-approved 32-commit checkpoint through 5ab94ec1 on existing PR 966 against master; do not merge.
- [x] Audit real JavaScript output/phrase lifecycle hazards, preserving emitted-pitch ownership and unrelated voices.
- [x] Reuse the existing ensemble and clip/phrase owners for opt-in, bar-aligned scene direction and rare verified-passage replies.
- [x] Persist one shared compact recipe/status control through the existing project, storage and Undo.
- [x] Retain a full guarded entrance approval for the real ordinary walker; preserve exact current-pose proofs and original budgets/deadlines.
- [x] Qualify the fixed ordinary-spawn basin crossing and native local cue ownership; retain global casualty accounting separately.
- [x] Update the approved PR 966 description to the published checkpoint only; fresh direct owner approval resolved the separate disclosure review.
- [x] Check native recipe focus, dimensions, local cue scheduling and owned Panic after a qualified passage.
- [ ] Review acoustic quality and physical MIDI behavior; muted output-call tests do not complete these items.

## Milestone 1: DAW-Like Multichannel MIDI Sequencer UI

**Outcome:** The MIDI surface is a DAW-like multichannel sequencer for gameplay
events. It should let users design, route, audition, sequence, automate, and
perform MIDI responses with the polish expected from music software, while
remaining deterministic and testable without real hardware.

Current status: checkpointed on May 7, 2026. The project-based sequencer,
source browser filters, track/clip editing, learn/record flows, modulation
lanes, template import/export, legacy storage cleanup, per-track output
dispatch, mocked device/setup-state coverage, scheduler pressure summaries,
output-log confidence checks, and disposable desktop/tablet/mobile captures are
implemented. Remaining Milestone 1 work should stay limited to focused polish,
starter-template gaps, small editor controls, and live-device confidence rather
than broad sequencer rewrites.

**Product Goals**

- Make first-run setup obvious: enable MIDI, pick devices, confirm permissions,
  choose a starter template, hear a preview, and recover from device errors.
- Treat game events, trigger flags, procgen events, and global modulation as
  sequencer sources that can be assigned to tracks and channels.
- Support multichannel routing with clear track strips, output devices,
  channels, instruments, mute/solo/arm, velocity, priority, and panic controls.
- Make editing musical: piano-roll style note entry, step sequencing, chord
  editing, arpeggiators, envelopes, repeats, probability, swing, quantization,
  and automation lanes.
- Make mappings easy to understand at a glance: what is enabled, what changed,
  what conflicts, what is silent, what track/channel it routes through, and what
  global rules affect it.
- Make live performance safe: all-notes-off, stuck-note detection, scheduler
  pressure display, output log, device reconnect handling, and readable status.
- Make recovery safe: undo/reset per field, mapping, clip, track, profile, and
  whole project.

**Sequencer Model**

- Preserve the existing intent-style state model, but expand it into a canonical
  MIDI project model:
  - project metadata and schema version.
  - devices and output routing.
  - tracks with channel/output/instrument labels.
  - event sources mapped to clips or direct mappings.
  - clips/patterns for notes, chords, arps, repeats, and automation.
  - global tempo/key/scale/quantization/swing settings.
  - per-track and per-mapping envelopes, velocity curves, priority, and limits.
  - diagnostics and migration metadata.
- Hard-cut obsolete duplicate persistence paths after migration; do not keep
  legacy aliases as editable contracts.
- Define import/export JSON for MIDI projects and templates.
- Support factory templates and user templates.

**Interface Scope**

- Transport and setup:
  - device chooser.
  - input channel and output routing.
  - tempo/BPM and game-speed relationship.
  - quantization and swing.
  - MIDI reset and panic.
  - device health and permission state.
- Track mixer:
  - multiple MIDI tracks.
  - output device and channel per track.
  - track name and instrument label.
  - mute/solo/arm.
  - track volume/velocity scale.
  - priority and voice budget.
  - scheduler pressure and recent output indicators.
- Source browser:
  - SFX events.
  - trigger types.
  - MIDI flags.
  - procgen/challenge events when available.
  - global/system events.
  - search, category filters, changed-only, enabled-only, conflict-only,
    available-in-level, and assigned/unassigned views.
- Arrangement and pattern editing:
  - map an event source directly to a note/chord/arp or to a reusable clip.
  - clip/pattern library.
  - step sequencer grid with note, rest, hold, tie, velocity, probability, and
    channel/track awareness.
  - compact piano-roll style editor for short MIDI phrases.
  - chord builder with common shapes, inversions, voicing, and scale locking.
  - arpeggiator editor with direction, pattern, rate, octave range, gate, and
    reset behavior.
  - repeat/rhythm editor that reads as musical timing rather than raw config.
- Automation and modulation:
  - envelope editor with curve preview.
  - velocity curves.
  - global intensity and accent.
  - position-based modulation mapped to velocity, pitch, CC, repeat, density, or
    track selection.
  - per-track and per-event automation lanes where they add real value.
- Inspector:
  - selected source, track, clip, or step.
  - contextual controls only.
  - validation/conflict status.
  - audition controls.
  - reset/revert at the smallest useful scope.
- Learn and recording:
  - global Learn mode.
  - arm a target from the inspector.
  - capture note/channel/velocity.
  - show pending assignment before commit.
  - record a short step pattern from mocked or real MIDI input.
  - detect and resolve conflicts.
  - keyboard-only capture flow with mocked WebMIDI in tests.
- Audition:
  - preview selected mapping.
  - preview clip/pattern.
  - preview chord/arp over a short beat window.
  - preview through the selected track/channel/output.
  - preview with current key/scale/global shaping.
  - visible output log and all-notes-off/panic.
- Layout:
  - desktop: stable DAW-like workspace with transport, browser, track/mixer, and
    inspector regions.
  - tablet: collapsible browser/inspector with the sequencer grid still usable.
  - phone/narrow: task-focused single-column flows for setup, browse, edit, and
    audition without clipped labels.
- Accessibility:
  - semantic controls.
  - focus order matching visual order.
  - keyboard navigation for browser, track list, piano keys, step grid, tabs,
    template operations, and inspector controls.
  - visible focus states.
  - aria labels for icon-only controls.
  - no hidden focused element when panels change.
- Performance:
  - no full mapping or track rebuild for single-field edits.
  - large mapping sets and clip libraries remain responsive.
  - no recurring layout thrash while MIDI input is active.
  - UI refresh metrics exposed to diagnostics in E2E mode.

**Workflow Coverage**

- First-run no-device state with clear permission and device messaging.
- First-run with mocked input/output devices.
- Enable MIDI, choose input/output, configure tracks/channels, send reset, and
  use panic.
- Create a project from a factory template; edit it, duplicate it, export it,
  import it, and reset it.
- Create multiple tracks and route different event sources to different
  channels.
- Search and filter sources by text, category, enabled state, changed state,
  conflict state, assigned state, and current-level availability.
- Assign an event source to:
  - direct note.
  - chord.
  - arp.
  - step pattern.
  - reusable clip.
  - automation/modulation target.
- Edit a step pattern with note/rest/hold/velocity/probability and verify the
  generated MIDI events.
- Use learn mode to capture a mocked note and resolve a conflict.
- Record a short mocked MIDI phrase into a step pattern.
- Audition a track, source mapping, chord, arp, and clip without real hardware.
- Verify persistence across reload.
- Verify migration hard-cuts obsolete storage after migration.
- Desktop/tablet/mobile visual capture runs for setup, track mixer, source
  browser, sequencer grid, inspector, learn, diagnostics, and import/export.

**Deliverables**

- New MIDI sequencer architecture docs.
- Expanded canonical MIDI project state and migration.
- Refactored UI modules for transport/setup, tracks, source browser, sequencer
  grid, inspector, templates, learn, audition, diagnostics, and layout.
- Project/template import/export UI.
- Conflict detection and validation.
- Expanded Playwright coverage using mocked WebMIDI and generic visual capture
  helpers.
- Focused unit coverage for project validation, sequencing, conflict detection,
  scheduler reservations, migrations, and intent/project updates.

**Acceptance**

- A user can build a multichannel MIDI project from scratch without editing
  JSON.
- Game events can drive multiple tracks/channels with note, chord, arp, clip,
  and automation behavior.
- The UI works without MIDI hardware through the mocked test path.
- Major MIDI sequencer states have disposable local captures and overflow
  checks.
- No obsolete legacy mapping UI or duplicate persistence path remains after the
  migration/cutover phase.

**Out of Scope**

- Audio recording, audio mixing, plugin hosting, soft synths, or waveform
  editing.
- Supporting non-WebMIDI browser APIs.
- Network sync or cloud project storage.

## Milestone 2: Level Editor Audit and Productization

**Outcome:** The level editor is evaluated from real workflows, then upgraded
into a trustworthy creation tool with documented capabilities, clear limits,
usable UX, and robust workflow tests.

Current status: checkpointed on May 7, 2026. The classic-subset audit,
visible lossy/unsupported-data warnings, validation report export, semantic
round-trip tests, palette throughput improvements, solver advisory hooks, local
project storage, project-level actions, pack JSON handoff export, browser-safe
pack archive export/install, incomplete-archive rejection, and refreshed desktop
editor capture are implemented. Remaining editor work should focus on
additional visual workflow captures and NeoLemmix expansion only when that
larger compatibility phase is deliberately started.

**Audit Scope**

- Perform a current-state editor audit before changing behavior:
  - layout screenshots across desktop/tablet/mobile.
  - local `temp/` captures for major flows where visual evidence is useful.
  - docs-vs-code matrix.
  - implemented vs claimed feature matrix.
  - severity-ranked UX issues.
  - severity-ranked correctness/data-integrity issues.
  - test coverage map for each workflow.
- Evaluate the editor as a product, not just as code:
  - how quickly a user can create a playable level.
  - how easy it is to select, move, inspect, duplicate, align, reorder, and
    delete pieces.
  - whether validation explains problems and offers safe fixes.
  - whether playtest flow feels connected to editing.
  - whether import/export errors are understandable.
  - whether classic subset limits are obvious.
  - whether NeoLemmix limitations are explicit.

**Productization Scope**

- Workflow and navigation:
  - New level.
  - Open classic level.
  - Open saved level.
  - Import `.nxlv`.
  - Import classic `.lvl`.
  - Save locally.
  - Export `.nxlv`.
  - Export classic `.lvl`.
  - Playtest and return to editing.
  - Undo/redo across all meaningful edits.
- Canvas UX:
  - pan/zoom behavior that never fights placement.
  - selection outlines and handles that remain visible at common zoom levels.
  - marquee select.
  - drag, nudge, duplicate, copy/paste.
  - align/distribute and ordering controls.
  - grid/snap controls that are visible and predictable.
  - context actions for common operations.
- Palette UX:
  - terrain/object/trigger browsing with thumbnails.
  - search/filter/sort.
  - style switch behavior.
  - missing asset handling.
  - recently used pieces.
  - favorites or pinned pieces if audit shows palette scanning is slow.
- Inspector UX:
  - single selection editor.
  - multi-selection summary and batch edit.
  - safe numeric editing with commit/revert behavior.
  - transform controls.
  - flags/properties only where they apply.
  - selected entry identity, uid, type, and source style.
- Validation UX:
  - clear error/warning separation.
  - fix buttons grouped by issue.
  - export blocking only for true blockers.
  - validation report export.
  - pack-level consistency checks where data is available.
- Data integrity:
  - round-trip `.nxlv` comments and unknown sections.
  - preserve unknown data that the editor does not understand.
  - hard-cut unsupported runtime preview paths into explicit warnings.
  - no silent data loss during import, save, export, playtest, or style switch.
- NeoLemmix decision track:
  - decide whether the editor remains a classic subset or expands.
  - if expanding, phase parser/model/UI/runtime work for `$TERRAINGROUP`,
    `$TALISMAN`, `$PRETEXT`, `$POSTTEXT`, lemming placement, custom trigger
    boxes, and style metadata.
  - document unsupported NeoLemmix features in the UI, not only in docs.
- Project workflow:
  - project or pack export bundle plan.
  - level metadata and level list handling.
  - local project storage strategy.
  - import/export validation reports.

**Workflow Coverage**

- Create a blank level, place entrance/exit/terrain/steel/trap/MIDI flag,
  validate, playtest, save, export, import back, and compare semantic state.
- Load a built-in classic level, modify it, save locally, reload, and export.
- Import `.nxlv` with comments, unknown sections, terrain groups, and unsupported
  props; verify preservation or explicit warnings.
- Exercise selection:
  - click select.
  - shift multi-select.
  - marquee select.
  - move.
  - resize where supported.
  - duplicate.
  - copy/paste.
  - reorder.
  - delete.
  - undo/redo each.
- Exercise palette:
  - search.
  - style switch.
  - thumbnail loading.
  - missing asset state.
- Exercise validation:
  - missing entrance.
  - missing exit.
  - out-of-bounds pieces.
  - invalid counts.
  - unsupported classic props.
  - terrain groups.
  - steel bounds.
- Exercise playtest:
  - timer state.
  - input suppression while editing.
  - return to editor.
  - history/seek/reverse interactions where relevant.
- Run visual capture matrices for editor shell, canvas, palette, inspector,
  validation, save/import/export, and playtest states.

**Deliverables**

- Editor audit report committed under `docs/level-editor/`.
- Updated editor docs based on current behavior.
- Expanded Playwright editor workflows using generic visual capture tooling.
- UX fixes prioritized from the audit.
- Clear classic-subset vs NeoLemmix-expansion decision and follow-up plan.
- Optional project export design if the audit confirms it is the next highest
  value editor workflow.

**Acceptance**

- The editor can create and round-trip a playable level through tested
  workflows.
- Major UX states have screenshot captures and overflow checks.
- Unsupported or lossy operations are impossible or explicitly warned.
- Editor docs match current behavior.

**Out of Scope**

- Implementing every NeoLemmix feature before the audit is complete.
- Adding solver-backed validation before the solver milestone produces a stable
  interface.

## Milestone 3: Procedural Level-Piece Streaming

**Outcome:** Procgen is a shared endless world with coherent source artwork per
lane and mixed themes from the selected pack. Bounded regions compose readable
scenes ahead: a scout discovers trouble, a crew prepares and contains a route,
ordinary followers cross, and actual progress resolves the musical phrase.

Current status: checkpointed on May 7, 2026. The procgen debug state exposes
theme, seed, generated end, lead frontier, recent chunks, assists, and explicit
certificate policy. Certificates are scoped to local tactical checks and must
not claim full-level solvability. Fixed-seed E2E, desktop capture, and bounded
soak evidence are available under ignored `temp/` artifacts.

**Core Behavior**

- Keep each lane visually coherent within the selected pack; preserve the
  implemented deterministic mixed-theme assignments.
- Build the world out of real level pieces from that theme:
  - terrain pieces.
  - decorative pieces.
  - simple obstacles.
  - occasional gadgets only when they make sense for the theme and generated
    path.
- Stream pieces from left to right as the lemmings advance.
- Track progression from the actual rightmost viable lemming position, not from
  lemming id. Lemmings can turn around, bounce, die, or get stuck, so the
  generator must derive the lead edge from current positions and viability.
- Maintain a generation lookahead that varies enough to avoid a mechanical feel
  but always creates needed terrain before lemmings reach it.
- Keep generation bounded and efficient:
  - avoid full scans over all historic lemmings or pieces.
  - prune old tracking state.
  - track only recent/near-future generated chunks.
  - avoid unnecessary allocations in per-tick logic.
- Use purposeful autonomous crew projects with physical containment and
  recovery obligations, building on the existing bounded local action owners:
  - build over smaller gaps.
  - dig or mine through smaller barriers.
  - bash through simple horizontal obstructions.
  - assign floaters only for small, intentional fall challenges.
- Do not spam skills. The ideal run should look like occasional purposeful
  interventions, not constant AI control.

**Generation Scope**

- Theme selection:
  - choose a compatible style from available packs.
  - expose the selected theme in the URL/debug state.
  - allow deterministic seeds for repros.
- Piece placement:
  - maintain a stable baseline path.
  - add rises, dips, small gaps, small barriers, and visual variety.
  - use pieces with sensible overlap and no obvious floating/ugly seams.
  - avoid unreadable clutter around the active path.
  - prefer tasteful, theme-appropriate decoration away from the route.
- Lookahead and pacing:
  - calculate a lead lemming/frontier each update.
  - decide when more terrain is needed based on distance to generated end,
    current speed, release rate, and recent lead movement.
  - vary the lookahead threshold within safe bounds.
  - guarantee the next playable segment exists before it can be reached.
- Challenge design:
  - small gaps that can be bridged with a low number of builders.
  - small barriers that can be dug, mined, or bashed.
  - safe landing surfaces for intentional drops.
  - avoid unavoidable traps, impossible gaps, hard steel blockers, and
    challenge chains that require precise expert timing.
- Assist design:
  - detect the next simple challenge before contact.
  - spend the smallest useful skill.
  - prefer the lead viable lemming.
  - avoid repeated attempts on the same failed situation.
  - expose recent assist decisions for debugging.
- Camera:
  - follow progression smoothly.
  - do not jump because an old or wrong-id lemming becomes selected.
  - keep the generated path readable ahead of the lead.

**Workflow Coverage**

- Start procgen and verify source provenance and deterministic per-lane theme
  assignments from the selected pack.
- Verify generated pieces come from the selected theme.
- Step through fixed seeds and assert generated end stays safely ahead of the
  rightmost viable lemming.
- Verify the lead frontier changes correctly when the previous lead turns,
  bounces, dies, or gets stuck.
- Verify small gaps trigger minimal builder usage.
- Verify small barriers trigger minimal dig/mine/bash usage.
- Verify no assist is spent when terrain is already traversable.
- Verify generation continues for a long run without unbounded tracking growth.
- Capture temporary local screenshots around the lead and newest generated
  pieces when debugging visual quality.

**Deliverables**

- Clear procgen spec in `docs/procgen.md` matching this product intent.
- Theme selection and seed repro path.
- Efficient rightmost viable lemming/frontier tracker.
- Piece-streaming planner using real theme assets.
- Safe lookahead policy with bounded variation.
- Minimal skill-assist planner for basic generated challenges.
- Debug state for selected theme, generated end, lead frontier, recent pieces,
  and recent assists.
- E2E and unit coverage for frontier tracking, lookahead, piece placement, and
  minimal assists.
- Long-run benchmark coverage for bounded memory and allocation behavior.

**Acceptance**

- Procgen reliably adds coherent theme pieces before lemmings need them.
- The generated level reads as tasteful themed terrain, not noise.
- Rightmost progression is based on live viable positions, not lemming id.
- Small generated gaps/barriers are handled with minimal appropriate skills.
- Long runs do not grow tracking state without bound.

**Out of Scope**

- Full campaign/level-pack generation.
- Complex puzzle design requiring precise human timing.
- Guaranteeing every possible seed is solvable before the solver milestone.

## Milestone 4: Solver and Solvability Platform

**Outcome:** The project gains a comprehensive deterministic solver platform
that can reason about levels, replay candidate solutions through the real game
runtime, verify procgen chunks, and eventually provide useful editor
solvability guidance. The solver should be ambitious, but honest about result
types: solved, failed, unknown, timed out, or unsupported.

Current status: checkpointed on May 7, 2026. The local solver result schema and
MCP route output expose replay verification and replay authority fields. A
`solved` result remains meaningful only when replay verification succeeds, and
non-real adapter results stay explicitly labeled instead of being promoted to
full runtime proof.

**Core Principles**

- The real game runtime is the authority. Any proposed solution must replay
  successfully in the actual simulation.
- Solver state extraction can be optimized, but it must not become a divergent
  gameplay implementation.
- Every solver run is deterministic for a fixed level, seed, skill set, options,
  and budget.
- Bounded "unknown" is a valid result. Hanging or unbounded search is not.
- Explanations matter: a failed or unknown solve should say what blocked
  progress.

**Foundations**

- Deterministic headless runner:
  - load built-in levels, editor levels, procgen chunks, and synthetic fixtures.
  - step/pause/seek through existing runtime APIs.
  - isolate solver runs from UI state.
  - support fixed random seeds.
- State snapshot and hashing:
  - terrain mask.
  - steel and one-way constraints.
  - entrances/exits.
  - hazards/traps/water.
  - blockers.
  - lemming positions, actions, directions, fall distance, timers, skills.
  - active builder stairs and terrain mutations.
  - victory/save counts and timer state.
- Action script format:
  - skill type.
  - target lemming selector.
  - tick or tick window.
  - preconditions.
  - expected postconditions.
  - optional rationale.
- Replay verifier:
  - apply candidate scripts to the real runtime.
  - confirm exit/save target.
  - emit final state summary.
  - detect divergence from expected postconditions.

**Environment Understanding**

- Geometry analysis:
  - walkable surfaces.
  - cliffs and fall distances.
  - small gaps.
  - large gaps.
  - walls/barriers.
  - ceilings.
  - steel-blocked dig/bash/mine paths.
  - landing zones.
  - route continuity.
- Hazard analysis:
  - trap trigger areas.
  - water/drown zones.
  - fire/frying zones.
  - fall-death zones.
  - unavoidable hazards.
  - hazards avoidable by route, bridge, dig, or timing.
- Skill affordance analysis:
  - builder reach and stair landing.
  - basher horizontal tunnel candidates.
  - miner diagonal tunnel candidates.
  - digger vertical shaft candidates.
  - floater/parachute survival.
  - blocker turnarounds and crowd control.
  - climber-specific routes where available.
  - bomber/destructive changes only when allowed by pack mechanics and scope.
- Reachability graph:
  - coarse segments connected by walking, falling, building, digging, mining,
    bashing, turning, and exiting.
  - annotations for required skills, estimated timing windows, hazards, and
    uncertainty.
  - incremental invalidation when terrain changes.

**Solver Layers**

- Tactical local solvers:
  - bridge small gaps with minimal builders.
  - cross larger but bounded gaps with multiple builders when skill budget
    allows.
  - dig through small vertical barriers.
  - bash through horizontal barriers.
  - mine through diagonal barriers or down to a landing.
  - survive falls with floaters.
  - turn around with blockers when needed.
  - route around or neutralize simple hazards.
  - reach a nearby exit from a bounded local area.
- Route planner:
  - find candidate paths from entrance/frontier to exit.
  - score routes by required skills, timing difficulty, hazard exposure, and
    terrain mutations.
  - prefer minimal-skill, low-risk routes.
  - produce a plan skeleton before exact timing search.
- Timing search:
  - choose assignment ticks/windows.
  - handle lemming identity changes, crowding, and selection ambiguity.
  - use deterministic pruning for equivalent states.
  - support beam/A-star-style search with explicit node/time/depth budgets.
  - keep route-plan guidance separate from runtime verification.
- Multi-lemming reasoning:
  - identify useful candidate lemmings by position/action/direction.
  - reason about lead lemming vs crowd.
  - detect when a blocker or crowd-control action is required.
  - avoid plans that save one lemming while dooming the required save count.
- Terrain mutation planning:
  - model generated builder stairs, dig shafts, bash tunnels, and mine tunnels.
  - update reachability after replayed mutations.
  - detect destructive actions blocked by steel or one-way constraints.
- Pack/mechanics awareness:
  - respect pack-specific mechanics that affect skill behavior.
  - record unsupported mechanics as explicit unsupported result reasons.

**Search and Budgeting**

- Solver options:
  - max ticks.
  - max nodes.
  - max wall time.
  - max actions.
  - skill subset.
  - target save count.
  - allowed/destructive skills.
  - tactical-only vs route search vs full search.
- Result types:
  - `solved`: verified in runtime.
  - `failed`: proof-like local reason within supported scope.
  - `unknown`: search exhausted or unsupported complexity.
  - `timeout`: wall-time budget reached.
  - `unsupported`: required mechanic is outside solver scope.
- Explanations:
  - no route to exit.
  - missing landing.
  - gap exceeds builder budget.
  - barrier blocked by steel.
  - hazard unavoidable.
  - timing window too narrow.
  - save count unreachable.
  - state explosion.
  - unsupported mechanic.

**Procgen Integration**

- Each generated challenge can include an intended solution certificate:
  - challenge type.
  - expected skill.
  - rough assignment window.
  - expected landing/exit segment.
  - minimal skill count.
- Procgen verifies generated gap certificates synchronously through the local
  tactical solver before placement.
- Failed local verification causes procgen to simplify, replace, or extend
  terrain rather than creating impossible content.
- Fixed procgen seeds replay small generated gap certificates through solver
  verification and expose accepted decisions through E2E debug state.

**Editor Integration**

- Validation can surface bounded solver advisory warnings when the editor has a
  rendered preview or other source with route geometry.
- Dedicated advisory "check solvability" command now refreshes the preview and
  reports bounded ok/warning guidance without blocking editing or export.
- Show solver result as guidance, not as an absolute guarantee.
- Highlight likely problem areas:
  - unreachable exit.
  - impossible gap.
  - lethal drop.
  - steel-blocked intended dig/bash/mine.
  - insufficient skill budget.
  - missing entrance/exit.
- Allow saving a temporary local failure capture under `temp/` for debugging.
- Attach concise solver explanations and stable advisory codes to editor
  validation output.

**MCP/E2E Integration**

- Expose solver runs through deterministic local APIs first.
- Add MCP tools only after the local API and result schema stabilize.
- Return compact result JSON with optional references to `temp/` captures during
  local development.
- Avoid huge state dumps by default.

**Workflow Coverage**

- Solve tactical positive fixtures for gap, wall, dig, mine, bash, floater, and
  blocker cases.
- Return meaningful failed/unknown/unsupported results for negative fixtures.
- Replay every positive solver result in the real runtime.
- Solve a small built-in classic level or curated mini-level end to end.
- Verify procgen local challenge certificates for fixed seeds through unit and
  E2E debug-state coverage.
- Run editor-created levels through bounded advisory checks.
- Verify deterministic output for repeated runs with identical inputs.
- Verify all budgets terminate cleanly.
- Save temporary local captures for selected solver failures when requested.

**Deliverables**

- Solver module tree with clear boundaries:
  - runtime runner.
  - state extraction.
  - geometry analysis.
  - hazard analysis.
  - skill affordance analysis.
  - reachability graph.
  - tactical solvers.
  - route planner.
  - timing search.
  - replay verifier.
  - result/explanation formatting.
- Action script schema and replay verifier.
- Synthetic fixture suite.
- Curated classic-level mini corpus.
- Procgen challenge certificate API.
- Editor advisory integration for validation plus dedicated advisory controls.
- Solver docs covering capabilities, limits, result meanings, budgets, and
  reproduction.

**Acceptance**

- Tactical fixtures are solved or rejected deterministically.
- Positive solutions replay successfully in the real runtime.
- Negative results are useful enough to guide a developer or level designer.
- Procgen can use solver checks to avoid simple impossible generated chunks.
- Editor solvability checks are advisory, bounded, and never block normal work.
- The solver never hangs or silently exceeds budgets.

**Out of Scope**

- Claiming complete solvability for every original or custom Lemmings level.
- Replacing gameplay logic with a separate authoritative simulation.
- Non-deterministic external services.
- Cloud solving.

## Cross-Cutting Validation

Use the narrowest useful validation while work is in progress. Before merging a
complete milestone, run the relevant subset plus the standard repo checks:

- `npm run format`
- `npm run check-undefined`
- `npm run lint`
- `npm run typecheck:critical`
- `npm test`
- `npm run test-bench-unit`

Milestones that touch Playwright should also run targeted E2E commands. Long
soaks and broad seed corpuses should stay opt-in unless explicitly promoted to
CI.

Milestone closeout evidence uses the shared checkpoint format in
[`TESTING.md`](TESTING.md): commands run, ignored `temp/` artifact paths,
GitHub issues closed, skipped checks with reasons, unrelated failures, and
follow-up risks. Capture artifacts remain disposable and must not become a
second roadmap, gallery, or committed manifest.

## Roadmap Maintenance Rules

- Keep this file focused on active and future work.
- Do not add separate plan files unless explicitly requested. If one is created,
  absorb the durable work back into this file and remove the plan file.
- Remove completed detail when it stops being useful; git preserves history.
- Prefer observable deliverables over vague intentions.
- Record hard-cut decisions directly in the relevant milestone.


## Live-instrument follow-through

The live-instrument branch adds a single persistent game canvas, Focus/Split/Overlay,
game-clock transport, event controls, musical undo, isolated local audition, and
stable-ID selection for twelve bodies, including donut, native named colors, and
fitted berets with lift/open/reattach cosmetics on every shape. Acceptance instructions are in
`docs/live-instrument.md`; blocked cloud browser execution is not a UI/audio pass.

- Run the final-tree browser, listening, keyboard/screen-reader, and physical-MIDI
  acceptance. Preserve zero hardware sends from local event tests.
- Historical sequencer/dependency checkpoints are reconciled by behavior in
  `docs/branch-reconciliation.md`. New routing, shared-MPE, program and owned-gate
  regressions supersede known defects; unknown original source differences remain
  unrecoverable. Do not inherit historical acceptance counts.
- Give temporal clips and recording explicit onset/overlap/retrigger semantics.
  Legacy clips retain chord/event-arp lowering. Explicit temporal clips now honor cell
  rests, probability and event/pass conditions; phrase-mode Hold/Tie have bounded gates.
  Explicit onset capture now keeps gaps/overlapping lengths with Mono/Poly and Replace/Overdub controls. Cells retain up to eight independently editable voices; overdub preserves untouched cells and modifiers. Trigger-bar conditions, phases, completed/started phrase counters and up to four ordered pitch/repeat layers are implemented through the existing phrase queue, with bounded capture/expansion and real owned-gate/Panic regressions. Manual acoustic/physical-MIDI and final-tree interaction acceptance remain distinct.
- Visually accept the complete eight-accessory/five-eyewear pack on all twelve
  bodies, including the explicit custom ear/donut crown fits and final in-game
  appearance. Native source comparisons and decoder sheets are available; source
  tests do not substitute for visual acceptance. Exactly one accessory is selected;
  eyewear is separate, matching the native validator and preset evidence. The
  previously reviewed berets remain immutable. No further native catalog items
  remain to extract or implement in this batch.
- Finish broader editor interoperability and retain the verified clean dependency graph.
  GitHub CI for 97128aff reported 0 registry vulnerabilities. The concrete dry-run, object-property, debug-state,
  async bridge, stale-header and double-skill defects now have regression tests.
  Terrain horizontal flip is implemented and tested through runtime lowering and
  pixel/collision-mask rendering. Rotation, terrain resizing, one-way behavior,
  and gadget transforms remain disabled/preserved pending specified implementation. Do not treat this MIDI/appearance batch as those
  separate closures or as a global performance gain.


## Long-running actor storage

- Main-game identities now use a monotonic signed32 ID plus O(1) live lookup; collection slots are separate dense live storage. Compact history keyframes carry explicit IDs and reusable scratch slots are bounded by peak live crew. Recorded IDs restore on seek/rewind; fresh branch admissions retain the lifetime high-water ID. Legacy indexed keyframes remain readable. Real command, pooled nuke, blocker-owner and rewind regressions pass, including 4,096 admissions with one live actor and 32 retained ticks. Exhaustion rejects admission before wrapping or partially admitting a batch. The procgen world's separately managed actor array is unaffected. Focused manager/history/time-travel/particle coverage is 99.14% of lines, 93.49% of branches and all changed-owner functions. Meaningful remaining targets are legacy-to-live history layout transitions with missing optional fields, unusual remove/countdown ownership guards, and constrained spawn-mode fallbacks; ordinary admission/seek/branch order is covered by real terrain replay.

## Owner review queue (October 8)

- Keep skill cards mounted beneath the game HUD and shared audio controls visible with Studio closed: implemented; native desktop/narrow checks captured in ignored temp/review-followup.
- Generated hazard support, water basins, terrain-only arrows and idle activation correction: implemented and checked with normal sourced assets; operational sourced TRAP/DROWN/KILL/FRYING contacts now use bounded shared Trigger/MapObject owners and existing death actions.
- Persistent procgen seed/generation/playtest and shared local audio controls: implemented; native desktop/narrow 64-lane workflows checked.
- Seeded readable words use verified normal fire glyphs, a finite curated no-slur pool, terrain clearance and actual baseline/spacing checks. Native source-art review captured readable GO/YES; other packs require verified glyph sets.
- Camera zoom now preserves follow; deliberate pan releases it and the visible Follow/F control restores it. Lane-stack fit, jitter, no-live-leader, DPR and resize checks pass; bounded CCTV integration is implemented and native-reviewed.
- Shared MIDI output budgeting now retains wall-time history across speed changes, gives active lanes fair shares, expires stale notes and reports thinning beside the existing audio controls. Editable complementary ensemble roles are implemented through existing palettes and track controls; saved-setting and channel-safety checks pass.
- Verified prior-run distance markers keep the same metric and positions; screen-space black/white dashes pause with game ticks and respect reduced motion.
- Make deterministic terrain growth finer and prioritize reachable frontiers with bounded shared work and matching collision/display. Canonical normal-level descriptors and pure revision-cached zone plans are implemented with authored-width caps and exact selected-pack provenance; screened additive groups are implemented; the October 9 batch replaces eight-column reveal with whole source pieces and sections. Ordered joining/repeating/overlap/conditional and eraser source groups now apply exact alpha/flags to the actual foundation, with conservative route/support/steel/hazard/attachment guards and atomic dependency-ordered jobs; real generated trap/drowning/fire/lethal contacts are implemented and checked with sourced footprints, cooldowns and terminal action timing.
- Ranked live overview CCTV and the persistent active count are implemented; focused/native desktop and narrow checks pass. The Library reference was unavailable after the supported transfer and one retry, so explicit owner requirements and actual app evidence guided the layout.
- Ramp constructible challenge motifs with distance. Beyond the measured 32-pixel contained dig/mine descent, deeper mining/switchback routes require actual geometry and turning policy before claiming playable escalation.

- Tunnel-corner wall-column transition is reproduced and fixed using real shared action systems; non-climber turnaround and natural hoisting are covered.
- Starting lane themes now use a deterministic balanced permutation of available selected-pack groundsets; canonical co-occurrence plans and screened additive runtime groups are implemented for verified normal themes.

- Population-aware cohort easing, delayed sparse scout abilities and sustained pile detection are implemented with focused checks and a 65-lane native run. New-session random shapes/body colors already preserve saved controls and stable lane rainbow assignments.

## Approved followups after the current October 8 fixes

- CCTV director is implemented: actual cached construction/survival/lead-change signals, up to four user pins, stable dwell/ties, explicit reasons, fair rotation and the Eight leaders override pass focused and native desktop checks.
- Bounded output capture is implemented in Expert and procgen Details: finite ring, actual request/API/synth lifecycle evidence, explicit clocks and context, demand-only waveform inspection, JSONL/CSV/HTML exports and objective summaries. Seeded native local output and a full 16-cell audition/cancellation are the acceptance fixtures; physical MIDI receipt is unverified.
- Owner review correction: ordinary wall bounces, unclassified source-shelf access, uninterrupted shared construction tasks and taller uniformly scaled CCTV are implemented as a separate checkpoint before musical work; focused shared-action and native desktop checks pass.
- Musical tension is implemented with saved amount/threshold/fade controls and procgen lane status. Actual completed-tick population collapse, recovery and breakthrough signals thin or restore layers smoothly in both procgen and authored main levels; instruments, notes, scale, saved edits, channel safety and the shared output budget remain intact. Main-game observations separate successful exits from deaths, reuse bounded actor-position records and invalidate on level/timer changes or history restore. Focused checks and muted desktop collapse/recovery plus main/procgen persistence checks pass. Focused cache/policy coverage is 100% of lines and 92.13% of branches; remaining targets include direct reverse-mode publication and alternate action/coordinate guards.
- Musical automation spans are implemented through the existing project/router: explicit beat or actor-distance intervals, lane/group/global scope, constant/ramped values, source conditions and priority. Main/procgen editors support draw/drag/resize/bypass and persistence; live compatible edits preserve event ordinals and queued phrases. Bounded translucent rectangles and cached phase reuse the existing renderer. Focused and native combined validation cover actual local note dispatch and Panic. Actual main Game landing/walking fixtures now capture queued positions 10, 12 and 14, static pause, Panic cleanup and history rewind invalidation.
- Ghosts, named construction landmarks and replay capture are shelved. Literal weather visuals are outside the approved span concept.

- Owner edge/crew correction is implemented: a visible baseline edge, actor-owned shared blocker contacts and saved concurrent bash/dig/build limits. Exact admission/death accounting replaces obsolete all-survive assumptions. Bash-to-fall is normal shared gameplay; advanced switchback/mining policy remains open.


## Owner review queue (October 9)

- Safe spawn/drop/landing and the first 256 pixels of travel, gradual small-gap/elevation introduction, full source hazard envelopes and bounded grounded build/bash/dig/mine proposals are implemented. Actual ordinary-walker dig and mine descent replays pass under shared masks and protected terrain; broader route certification remains open.
- Cross-stripe falls/climbs, current actor/trigger/worker/music ownership, transfer-aware population observations, eight-lane new-session defaults, centered panel handle and quiet spawn-event defaults: implemented in the review branch; focused regressions and muted desktop/narrow checks pass.
- Generated dig-direction arrows are disabled. General authored assembly discovery must preserve exact relative transforms, alpha adjacency/overlap, semantic links, attachment anchors, evidence counts and pack/art provenance. Conservative ambiguous placements stay suppressed; authored levels stay intact. The bounded 16-scope source catalogue and anchored runtime placement are implemented and checked. Ambiguous unsupported placements remain suppressed; catalogue provenance is tied to exact pack/art revisions.
- Whole source pieces and route sections materialize through dependency-ordered jobs, with attached heads following their bodies and support. Collision, steel, colors, hazards and rendering share active job flags; pause/reset and bounded large-lane work are checked.
- Local audio now has independent gates, the existing 32-gate policy, priority/lane-aware overflow, capacity-independent nominal gain, one shared compressor and the existing ceiling. Muted 19-case A/B PCM renders check sustained/coherent peaks and exact post-Panic silence; other engines, real-time cost, acoustic listening and physical MIDI acceptance remain open.
- Compact Distance/Best/alive metrics and a closed secondary Seed disclosure are implemented and checked at desktop/narrow sizes.
- PR #965 merged at 84b3a38f into master 979011d4 on October 9. Owner approval of exact followthrough head f67586a5 authorized its push and new PR #966 against master; publication is complete. Further implementation remains local until its exact head is approved. Local preview servers are internal development tools; no merge or retarget is authorized.

- Parent route research resolves at Library catalogue `libfile_dbb5b75a082081918a51aac2d702541c`, version 1 (61 proposed patterns, 28 proposed fixtures), and report `libfile_9959902958948191b24b263c67b147a2`, version 1. Supported consumer-local materialization returned HTTP 403 for both attempted catalogue versions; contents and source replays have not been inspected or engine-qualified here. Preserve stable provenance when transfer becomes available. Never combine independently reported per-skill minima into one assumed feasible inventory. Default safe play excludes sacrifice/trap-compression and version-sensitive tricks.
- Focused new growth/assembly/sound/trigger coverage is 99.1% of lines and 86.7% of branches. Remaining test targets include empty/snapshot growth paths and adjacent blocker-query fallbacks; prioritize actual ownership regressions over mirroring implementation.
- The finite sourced Brick seed-42 run at 64 lanes/500 ticks now retains 448/448 actors with zero failures, after nine unsafe falls at x=344..351 were traced to unfinished bridges and full-depth early gaps. Active builder footprints reject destructive route proposals, including same-tick cached proposals. Before x1024, small gaps retain real source-foundation recovery floors; later gaps retain full depth. Eight ordinary walkers cross the actual early source gap without skills or permanent abilities. A separate full-depth bridge fixture contains followers through real blocker contacts, then releases the blocker through empty shared basher masks after actual connection; all eight walkers cross without deaths or release excavation, respecting worker caps and ownership cleanup. Qualify later bridge/descent routes with whole crews before claiming arbitrary generated routes preserve every actor.
- Bounded actual-mask continuation now follows each consecutive shared walking column rather than rejecting a single occupied head pixel. Eight ordinary actors bash through the real Brick support/roof assembly and return naturally to walking with no failures or permanent abilities. A separate bounded observed-tunnel preflight now follows one uninterrupted real basher through longer horizontal walls, reserving the actual rear/clearing/exit footprint. The 64-pixel wall completes at tick 197 and all eight/sixteen ordinary actors traverse identically on fresh replay with no losses, hazards, abilities or permanent blocker. It preserves the local 40-pixel proposal bound, 1,024 observations and eight lane slots; the 96-pixel automatic proposal remains budget-rejected. Local cache invalidation, partial growth, enabled source hazards, protected masks, overlapping claims, caps and reset/disposal are covered. Coincident actors already behind a new open-edge blocker contact now retain their real direction/position by legally containing themselves with an additional actor-owned blocker; stationary blockers remain distinct from goal arrivals and clean up on reassignment/removal/reset. This preflight is not independent catalogue qualification.
- Before x1024, whole source assemblies whose exact final walking-height masks exceed the finite 40-pixel admission envelope are deferred together with attached objects. The assembly-isolated two-wall fixture carries all sixteen ordinary actors through without excavation or abilities, while the short tunnel and wide walkable roof remain admitted. Newly physical canonical decoration is independently screened and may require route work after the safe intro; that fixture does not prove default unassisted traversal of new role content. Later eligibility, exact transforms and provenance remain intact; this preparation policy is not route certification.
- Solver replay now requires an initialized real Game or an explicit boolean authority assertion; unmarked adapters remain unknown. Terrain snapshots and synthetic mask copies reject more than 4,194,304 pixels before reading or copying masks, and callers can lower that cap. This bounds allocation. A separate real procgen actor/physical-goal adapter now disables assistance/admissions, checks complete ordinary crews and protected terrain, and distinguishes physical arrival from exit rescue.
- Next imported/general route qualification must use exact shared-action, whole-population replay with ordinary walkers and protected terrain, then an independent solver without an intended-route hint. The existing synthetic solver adapter is not evidence that these procgen motifs are certified. Retain verified finite walking, bridge, tunnel and 32-pixel descent guards before extending deeper return/switchback policy.

## Active approved implementation queue

- Implemented: bounded lifetime actor lookup/history; all measured source terrain roles with exact ordered foundation semantics; complete-inventory source route contracts and an independent bounded real-action search/fresh replay path. The finite 96-pixel wall in a measured scene with rear/forward containment admits sixteen ordinary actors with one basher; an independently searched left-facing counterpart admits eight; the exact sourced Brick support/roof admits eight without assistance, permanent abilities, hazard contacts or deaths. These finite physical goals do not certify arbitrary generated routes or exit rescues.
- Implemented: bounded supported horizontal tunnels and measured 32-pixel two-stripe dig/mine descents, preserving shared observation/lane/resource limits and actual containment. Automatic fresh replays and independent no-hint searches qualify all eight/sixteen ordinary actors with natural excavation/fall/walk, zero losses and protected terrain; narrow uncontained replay is rejected. Polyphonic capture/overdub, ordered repeat transforms and concrete editor preview/round-trip interoperability are locally committed. General generated connection/return/switchback certification still requires exact route evidence and turning policy; manual acoustic, physical-MIDI and interaction acceptance remains separate.
- Required source handoff: the authorized research schema/index and complete safe walking, bridge, containment/release, connected tunnel/wide-wall, safe descent and return/switchback records, including stable IDs/version, original source URL/engine/port, measured entry/exit geometry/state, one jointly feasible inventory, ordered action/timing rules, whole-crowd guards, failure cases and fixture/evidence status. Prior supported Library transfer returned HTTP403; no bypass/retry or research qualification is inferred. Optional recipe-book routeContracts now validate and select only the exact pack/ground/art fingerprint; matched records remain cold proposals until actual independent whole-crew qualification.
- Editor interoperability follow-through: actual source-scaled/RGBA thumbnails and palette bounds now match ground pixels/collision, Frame changes invalidate preview cache, runtime horizontal terrain flips survive editor text round trips, and supplied terrain rotation metadata is preserved. Focused changed-owner coverage is 97.49% of lines and 89.72% of branches. Meaningful remaining guards include unavailable canvas/storage and palette mutation versions. Rotation/resizing/one-way/gadget gameplay semantics await an exact format/engine contract; no NeoLemmix parity or transformed-trigger closure is inferred.

- Final descent-tree validation: 3,108 tests pass in 130.06 seconds against the unchanged 180-second target, with a temporary five-second Mocha timeout restored afterward. Repository formatting, lint, runtime-global/critical-type guards, undefined-call and dependency checks pass. The earlier 3,082-case checkpoint took 184.29 seconds; these are uncontrolled whole-suite observations, not a demonstrated performance gain. A read-only retained-module profile of exact 32-lane/5,000-tick snow/dirt fixtures measured tunnel proof below 0.2% of world-step time, with every cold proof rejected before bashing. Accepted-tunnel cost remains unmeasured; no relaxed budget or causal suite attribution is inferred. Full validation is recorded in ignored temp/final-contained-descent-test.log.

- Independent descent discovery/search and adapter coverage: the 26-case focused real-action/contract run covers all search lines and 93.5% of its branches; the two-owner report covers 97.74% of lines and 87.24% of branches. Remaining adapter source-object metadata branches require a distinct real object-bearing route, rather than redundant synthetic mask assertions.

- Focused descent proof/ownership validation: 61 affected checks pass; the new helper covers all lines and 96.19% of branches, with Planner at all lines/95.22% of branches. DIG uses 579 source observations/514 actual shared steps; MINE uses 651/650. Every final-patch entry suffix retains explicit natural-fall evidence. Remaining meaningful cases include genuine jump/ledge entry geometry and saturated nearby hazard sets; extend only with measured routes rather than duplicating action physics.

## Local followthrough (October 9, after PR #965)

Remote master 979011d4 was checked before work. Branch codex/lemmings-followthrough-20261009 starts there and carries the three prior commits plus followthrough f67586a5; the predecessor branch and its exact tree are preserved. The owner approved exact f67586a5a77443f674bdc0f73896046000191cb4 for push and new [PR #966](https://github.com/doublemover/LemmingsJS-MIDI/pull/966) in doublemover/LemmingsJS-MIDI against master. That publication is complete. The continuation below remains local, without waiting for CI.

- [x] Lean startup/share URLs, explicit normal-game MIDI opt-in, separate soundFont identifier and procgen redirect.
- [x] Traveling details tab, collapsed Advanced before optional CCTV, bottom share controls, stable thinning status, help and lane/all-lane nuke keys, volume/speed resets.
- [x] Preserve unlocked listening across live changes; beat-aware staggered births, local lane pan, quieter descending landings and bounded evolving rolling bounce phrases.
- [x] Preset-first multiple spans and actual modifier combinations through the existing project, clips and shared scheduler.
- [x] Original pack default, actual 144px lane geometry/control, sourced hazard geometry, safe decorative/assembly selection and planned terrain silhouette/columns/words.
- [x] Independent ahead scouts, revision-scoped hazard knowledge, seeded lane biases, bounded adaptations, productive whole-crew construction and blocker/builder bypass.
- [x] Earlier sustained-stall OHNO while protecting useful work; higher construction caps with local contention guards.
- [x] Compare live/initial speed using the same clock; profile high-lane panning/offscreen work and report requested versus achieved speed.
- [x] Integrate focused checks, final validation, local commit and exact remaining limits.

Supported Library transfer returned HTTP 403 for the three new visual references (libfile_caa421013174819186ae03cb2a68270e, libfile_86a8c07f86cc81918903c715cc7ddd03, libfile_043651fbe9f88191b412d715c26ff35a). No image bytes were inspected here; source and parent-reviewed observations guide this batch. No alternate download path is used.

Root integration evidence: 94 focused startup/control/CCTV/render tests pass, plus native muted normal-game hidden MIDI, actual one AudioContext retained through 8-to-32-lane regeneration, Panic, desktop/narrow panel geometry, no horizontal overflow and no page errors. A paused 1024-lane 50-pan sample removes 51,100 offscreen bounds calls; p95 moves from 8.8 to 6.9ms in that fixture only. New visibility owner coverage is 100% lines/95.23% branches; StartupUrlConfig and ProcgenUrlConfig have 100% lines. The broader focused node-only selection is 76.48% lines/74.48% branches (below the inherited 81% global branch threshold): native RAF/HUD/source-raster paths and uncommon UI input/error branches remain meaningful followup targets. This diagnostic selection is not a whole-suite coverage claim.

World integration at published f67586a5: 160 focused cases pass. New bounded policy/bypass/columns/word owners cover 99.42% lines / 89% branches; optional descent-preference selection remains outside this narrow coverage fixture. The new blocker bypass has fresh 8/16 ordinary-follower replay and an 8-follower 144px replay, zero deaths/abilities/excavation and actual contacts; that published head had no independent solver qualification. Source pools now reserve complete contact/support envelopes so adjacent cavities cannot erase support. Physical glyph components and complete ceiling-height source columns retain actual alpha, source provenance and bounded growth dependencies.

Final muted Edge receipt confirms laneHeight 144 / surface 120, Help scrolled into the open panel after range focus, live 20x on the shared World timer, one unlocked AudioContext through 8-to-32-lane regeneration, Panic cancellation and no page errors. The changed headroom scene repeats 1024-lane paused panning with 0 offscreen bounds calls and 6ms p95; this later timing is not an identical before/after scene comparison. Evidence stays in ignored temp/followthrough-native. The internal loopback preview server is stopped.

Final current-tree validation: 3,172 tests pass in 147.22 seconds against the unchanged 180-second target. The temporary five-second Mocha timeout is restored after the run. Required repository formatting, lint, automatic runtime-global/critical-type guards, undefined-call and dependency checks pass. The first integration run exposed 11 stale fixture contracts; explicit MIDI opt-in, physical attachment height, complete sourced-column provenance and fresh seeded birth replay now replace those assumptions. Original whole-crew survival/accounting/progress/memory assertions remain intact. Receipts are retained in ignored temp/followthrough-final-test.log and temp/followthrough-integration-contract-failures.log. These whole-suite timings are uncontrolled observations, not a performance attribution. These checks describe the exact f67586a5 head now published in PR #966. No merge, retarget or publication of a subsequent head is authorized.

## Local continuation after PR #966

- [x] Independently search and freshly replay finite ordinary-crew blocker bypasses with explicit stationary environmental owners and unchanged local/runtime budgets.
- [x] Exclude complete random entrance/exit groups, retain source catalog ordering, and verify all nine normal-pack themes plus multipart hazard ownership.
- [x] Keep unprepared source descriptors cold during rendering, preserve shared edits and completed/partial reveal, and retain excluded entrance/exit placement slots as empty.
- [x] Reconcile current scout, rear-corridor, recovery and publication documentation.
- [x] Complete affected coverage, required checks and one local continuation commit; remote PR head remains the approved f67586a5.

Continuation evidence: 43 affected independent wall/descent/contract/bypass checks pass under scoped coverage (98.27% lines / 91.74% branches; search 100% / 94.68%, adapter 97.44% / 90.49%). Rightward 8/16 crews at 96/144px reach the declared physical region at tick 233; mirrored 8/16 crews at 96px and eight at 144px reach it at tick 234. Each discovers one builder in two search nodes and freshly verifies the complete moving crew with zero deaths, hazards, permanent abilities or excavation, while retaining the original stationary blocker. Runtime 40px/1,024-observation/eight-lane limits and existing search/snapshot budgets remain unchanged. Finite receipts are in ignored temp/blocker-solver-coverage. Existing source-object hazard metadata branches remain a meaningful separate route fixture gap.

The initial coverage and full runs surfaced excessive source composition for unprepared future materialization in the existing 1,024-lane animation fixture. That fixture passed alone with both approved and current source, while broader runs exceeded its unchanged 30-second timeout. The renderer now skips invisible source descriptor/raster/object discovery without skipping shared edits or prepared partial/completed source geometry; a real-source regression check rejects any hidden descriptor access and verifies construction color plus later reveal. The affected 36-case source/growth/renderer group passes in 12 seconds. Earlier diagnostic receipts remain in ignored temp/followthrough-continuation-assembly-coverage and temp/followthrough-animation-*; final coverage/check receipts supersede them below.

Final affected source/render coverage: 42 checks pass, covering 95% lines / 86.09% branches across Placement (100% / 89.26%), RecipeTerrain (97.88% / 85.83%) and Renderer (88.74% / 83.88%). The formerly timed-out animation contract passes under instrumentation with its original 1,024 lanes, 4,096px frontier and 30-second timeout. Real object clipping/cooling cases and native HUD/appearance branches remain meaningful separate fixtures; no coverage quota is simulated. The complete source/renderer check and report are in ignored temp/followthrough-continuation-final-coverage.

Final continuation validation: 3,188 tests pass in 137.80 seconds against the unchanged 180-second target. Formatting, lint, automatic runtime-global/critical-type guards, undefined-call and dependency checks pass. The original 1,024-lane animation fixture passes in 3.42 seconds, with no change to its frontier or timeout; the source-cold/shared-edit/reveal regression passes too. The temporary five-second Mocha setting is restored after the run. Whole-suite timings remain uncontrolled observations, not a causal performance attribution. Receipts are in ignored temp/followthrough-continuation-test.log and the adjacent format/lint/undefined/dependencies logs. Remote master remains 979011d4 and PR #966 remains at exact f67586a5a77443f674bdc0f73896046000191cb4. This continuation is committed locally; publishing its new head, merging or retargeting still requires parent approval of the exact destination.


## Independent audit followthrough (October 9)

The [independent audit](https://chatgpt.com/space/page_179a9515ede88191ad53489bad4921b0) and [Lemmings test-waste findings](https://chatgpt.com/space/page_aff77f2fb78c8191a47d9de14d622c6b) are accessible and reconciled against local 5f4a9ddc. Independent blocker qualification, complete entrance/exit exclusion and cold unprepared source rendering above already resolve those findings. PR #966 now points to the owner-approved c4437e5e batch; later granular commits stay local on the same branch until their exact-head publication is approved.

- [x] Scope all 67 module-level app-context fixtures to owning suites; remove six pure contexts; scope manager/nearest action hooks and restore dimension ownership. Eight action shards and eight router shards now share fresh factories. Redundant StubLevel algorithms, repeated missing-action/countdown/shrug checks, the dead display hook, prose/header locks and patched-source tool testing are removed; real walking/render/action/public resolver checks remain.
- [x] Use explicit midi=1 browser entry for MIDI journeys, retain invalid/default-off boundaries and exercise actual file/template controls. Eight finite browser journeys pass, including editor save/export and placement. All-asset galleries now require an explicit capture command; asserted finite editor journeys remain ordinary checks.
- [x] Run one full unit/coverage pass per CI workflow, one static-check pass and distinct browser, MCP and performance checks. Physical game, MIDI, procgen and top-level listSprites ownership are represented in subsets; verified PR/default bases replace same-feature tracking refs, with full-suite fallback. Complete coverage and inherited thresholds pass.
- [x] Give late pending terrain work its real start grace; admit bounded relevant workfronts fairly rather than caching the first flat actor. Actual late tick 1001 starts grace, count changes do not renew it, and tick 1022 expires it. A later useful builder is admitted after a flat older actor in the same tick; both ordinary walkers cross with one real builder, zero losses and no abilities. At most four numeric workfront records per lane, eight serviced lanes and cumulative 1,024 observations remain.
- [x] Preserve ensemble presence in Undo; make Reset reversible, Stop cancel audition/unlock, Save report durable/session outcomes and adopt identity, and reject stale imports. The state batch passes 93 focused checks; actual browser file upload/download, saved identity, Save as new, Reset and reload pass.
- [x] Preserve live note/instrument/ensemble metadata in audition and account for the combined audible mix. Four bounded owner sessions share one context, voice budget, compressor and ceiling; game and audition controls/gates remain independent. Explicit audition role/actor context reuses live mapping, lane pan and bend range; unavailable live tension/span/rolling context is labeled. Actual selected procgen hardware output uses the existing router and an explicit Connect action, with device, permission, cancellation, restart and disconnect boundaries.
- [x] Bound dense edit caches and revision metadata by actual actor/task/growth/hazard interests; preserve lossless cold rear patches and epoch-qualified revisit identity. Stationary blockers retain their contact band, protected source pixels/steel and active crossing-stripe work survive compaction, and actual ordinary actor motion still uses returned edits. Reachable cold history can grow; debug counters expose resident/cold/total typed-payload bytes and logical keys. Forced growth is deduplicated and normal/forced/total preparation and reveal are counted without changing normal budgets.
- [x] Admit complete paired source motifs and HYDRO/SNEAKY words with exact source alpha/collision/support and charged atomic materialization.
- [x] Qualify physical ahead scouts, real ceiling-rejection knowledge and ordinary crossing through shared actions in declared eight/sixteen-actor scenes with explicit construction-only inventory.
- [x] Preserve safe unsupported completed-builder exits with excavation enabled using private real WALK/JUMP/FALL. The exact tick430 endpoint now lands naturally at y112; fresh eight/sixteen-actor replays retain every actor/brick and one builder with no excavation. Bare ledges and supported bridges still build, while hazards, blockers, partial terrain, active work and fatal falls remain unqualified.
- [x] Preserve active field identity/caret across main Studio automation, independent voice and transform-layer edits.
- [x] Expose compact selected-cell Hold/Tie controls and mode-correct help through the existing clip model.
- [x] Extend existing simultaneous span selection, naming and atomic common edits to main Studio, preserving spatial curves, active gates and keyboard focus. Saved overflow stays editable through bounded 64-row pages.
- [x] Select several spans, keep their editors open, rename individual rows and apply common target/range/interval/bypass changes as one bounded project transaction. Preset IDs are assigned before selection; actual browser focus, saved interval edits, bypass and reload pass.
- [ ] Implement selected audible backends with an authorized sample source, bounded loading/cache/voices and explicit fallback; acoustic and physical MIDI acceptance require their actual devices.

No casino, dancer, terrain-pack generation, image generation, NuSSR changes, merge or retarget is authorized. Library route/visual transfers previously returned HTTP403; no source receipt or qualification is inferred. Long simulations and screenshot galleries belong to explicit diagnostics; ordinary checks retain real walking/actions, ownership, whole-crew and transport behavior.

First audit integration: 3,198 checks pass in 93.67 seconds against the unchanged 180-second target. Formatting, lint, runtime-global/critical-type guards, undefined-call and dependency checks pass. Actual browser game step/seek, invariant time travel, layout/canvas identity and musical Undo, local-listening independence, file/template persistence, editor save/export and centered gadget/trigger placement, and invalid/default-off mobile MIDI boundaries pass in eight finite journeys. Two stale layout expectations were corrected to the current skill-visibility and event-playback canvas owners. A generated Playwright trace exposed source inventory contamination; the miner now excludes disposable browser output. Receipts stay in ignored temp/audit-*. No causal timing or acoustic/physical MIDI claim is inferred.

The single full coverage command retained in both CI workflows passes with inherited thresholds; the detailed summary and test count are in ignored temp/audit-ci-coverage.log. No thresholds, fixtures for independently qualified routes, transport smoke or performance smoke were removed. The original long source simulations and old-policy comparison remain explicit diagnostics. Follow-up audit fixes replace CSS/contrast literals with rendered field contrast, clipping, contiguous swatches and title geometry; make all-asset galleries explicit; register spectator socket/server cleanup immediately; use a real pong receipt barrier for disabled input; supervise Mocha with its remaining process budget; and consolidate identical MPE/hard-cap cases while preserving zero/invalid duration and proposed-overflow guards.

Shared audio proof uses a muted offline render of twelve game plus twelve audition voices through one graph. At 100% and 400% local gain, final peaks are 0.442799 and 0.560341 with no full-scale samples. Audition Stop removes its PCM after settling while game PCM continues; Panic reaches zero. This measures digital mixing and cancellation, not perceived loudness or physical device output. Receipts stay in ignored temp/shared-local-audio-evidence.

Second integration validation: 3,221 complete tests pass in 111.61 seconds with the inherited 180-second Mocha process budget enforced; all 13 finite browser boundaries pass in installed Edge. Formatting, lint, runtime-global/critical-type guards, undefined-call and dependency checks pass. The first full attempt exposed a misaligned clock in the new shared-audio fixture; it now owns an aligned fake clock and guaranteed disposal, retaining real nonempty game/audition voice assertions. Browser span acceptance exposed missing preset IDs before selection; IDs are now assigned before sanitation and all editors persist. Receipts are ignored temp/audit-second-*. Scoped Growth and retention coverage is 100% lines, 95.55% and 98.71% branches respectively. Span controls have 100% lines/83.58% branches; the legacy overlay selection is 81.13%/68.75%, so its combined scoped diagnostic falls below the inherited global branch threshold without changing thresholds. The subsequent real move/resize/cancel/runtime-replacement and controller fixture covers all span control and overlay lines, with 83.63% combined branches; inherited thresholds pass unchanged. The actual controller and native Edge journey cancel capture before asynchronous regeneration and retain the exact stored spans. Live cursor and alternate clipping/input branches remain meaningful separate targets; the complete coverage pass earlier remains separate. Source-priority edits keep active gates and actual sent history but retain the existing cancellation of preplanned phrase tails. Acoustic/physical MIDI and an authorized sample bank remain unresolved.

Follow-up ownership review: actual scheduler-to-shared-session capture now retains origin identity while matching the true local output ID/scope. Future-note Stop evidence is reported as cancelled-before-start, with a second audition gate retained. The audio/capture/local-listening group passes 100 focused checks. Canvas move/resize/cancel and real controller restart pass 33 checks; native captured-drag regeneration passes in Edge without changing saved spans. Receipts stay in ignored temp/audit-span-*; publication remains at the approved PR head.

Whole-source integration: 29 finite source/growth checks pass; the 33-check affected coverage selection covers 99.51% of lines/91.04% of branches. The new shared-span owner has all lines/92.30% branches, Growth all lines/96.82%, and ordered groups all lines/98.44%. Natural source lane seed 2280 at chunks 18/19 admits HYDRO; source lane seed 14663 at chunks 16/17 admits SNEAKY, both at physical height 144 with 161 px opaque widths and unchanged 32 px glyph assets. These are source lane seeds, not promised public run seeds. Every partial activation and completion compares both tiles through actual World collision/color/steel and Renderer pixels. The measured 157px six-member repeat has complete source-supported admission/protection evidence; no natural incidence or ordinary-crew route certification is inferred. Capacity-one fallback, remaining-budget deferral and adjacent forced-arrival accounting pass. Receipts stay in ignored temp/audit-whole-source-coverage*. Meaningful remaining scoped targets include aligned descriptor eviction/rebuild, liquid envelope variants and margin rejection; no source or test limits are widened. Final span coverage now passes at all lines/83.63% branches over 33 checks.

Physical scout integration: all 30 affected checks pass; the changed lane policy covers all lines/functions and 92.52% of branches with inherited thresholds unchanged. Genuine shared CLIMBING to FALLING ceiling rejection moves the actor two pixels and now records nearby revision-scoped knowledge. Naturally born eight/sixteen-actor crews freshly replay twice with one builder slot, excavation disabled, at least 40px scout lead, twelve actual brick events, all declared forward arrivals and no losses, hazard contacts, excavation or ordinary permanent abilities. Default sparse frequency/delay, 40px route distance, 1,024 probes and eight evaluated lanes remain unchanged. The proposed completed-stair walking screen was withdrawn after its endpoint still admitted mining; no broad scaffold preservation is claimed. Meaningful remaining physical coverage includes mirrored ceiling rejection and knowledge across a lane boundary. Receipts stay in ignored temp/audit-scout-coverage*.

Final integration validation: 3,234 complete tests pass in 105.39 seconds under the unchanged enforced 180-second Mocha budget. All 13 finite native Edge boundaries pass in 39.0 seconds, including actual span pointer capture/regeneration, durable project lifecycle, workspace geometry and explicit selected MIDI destination bytes/disconnect. Required formatting, lint, runtime-global guard, critical type checking, undefined-call and dependency checks pass. The complete coverage pass reported earlier remains a separate checkpoint; final affected source, span and scout coverage is reported above. Receipts stay in ignored temp/audit-third-*. These batches remain local on the existing branch; the approved remote head remains f67586a5. No acoustic/physical MIDI acceptance, authorized sample bank, blocked Library reference transfer or general unsupported-scaffold preservation is claimed.

Authorized stair continuation: the exact unsupported endpoint now takes ordinary WALK/FALL rather than MINING. All 40 affected route/scout/admission checks pass; changed-owner coverage is all lines/functions and 93.22% branches. Fresh eight/sixteen-actor excavation-enabled replays each use one real builder, preserve every brick and forward steel, and retain every admitted ordinary actor with zero excavation, losses or hazard contacts. The passive proof is quiet and observational, bounded to 24px/64 shared action calls within the unchanged 1,024 observations/eight-lane ledger. Bare ledges and supported gap bridges still build. Genuine fatal falls, real trap/blocker contacts, partial geometry, active work, revision changes and insufficient work remain rejected. Receipts stay in ignored temp/continuation-* and the affected helper coverage report; formatting, critical types and the runtime guard pass.

Studio cell continuation: 115 focused controller/polyphonic/temporal/span checks pass; combined with the physical batch, all 155 affected checks pass in three seconds. The finite native Edge journey passes in 6.5 seconds: second-voice pitch caret and repeat-layer field focus survive rendering, original voice values remain, selected Hold/Tie values follow actual mode help, and real Save/reload preserves the exact clip without MIDI permission. The actual router fixture retains independent held voices until their next played cell and verifies Panic cancels pending cells and releases gates. The compact inspector keeps its existing three-row layout. Receipts stay in ignored temp/continuation-first-focused.log and temp/continuation-studio-cell-native.log. No whole-suite rerun, playback model, clock or audio backend change was needed.

Approved publication receipt: the owner-approved thirteen-commit batch through c4437e5e6eb3ed670f79c6ecce89dc7b1e845aa4 is now pushed to the existing codex/lemmings-followthrough-20261009 branch and PR #966 against master. Fresh GitHub PR metadata and git ls-remote both confirm that exact head. The later b645a466 stair and a13685b1 Studio commits, and subsequent work, remain local. No new PR, merge or retarget occurred.

Main Studio span continuation: all 108 affected controller/polyphony/span UI checks pass in three seconds. New shared span controls cover all lines and 90.47% of branches; the unchanged public procgen wrapper covers all lines/branches, with inherited thresholds passing for those changed span owners. Four finite native Edge journeys pass across the cell reorder, main span, saved-overflow and preserved procgen workflows. Main three-span length edits undo together, backward rename caret survives, target/range/bypass edits persist through actual Save/reload, and keyboard spatial/span conversion keeps focus on the same source. A 65-entry saved bypassed project renders 64 rows per page, preserves the first 64 entries while editing the last, and reloads exactly without activating output or requesting MIDI. Repeated layer Earlier/Later activation follows the moved layer. Formatting, runtime-global/critical-type guards, undefined-call and whitespace checks pass. The first main native attempt differed only in updatedAt after Undo; the fixture now checks the complete musical project while retaining its legitimate refreshed timestamp. Receipts stay in ignored temp/continuation-main-span-* and temp/continuation-cell-reorder-native.log. No whole-suite rerun or new project, clock, routing or audio model was introduced. The broader partial UI coverage diagnostic remains separate and below the inherited global branch threshold; direct off-page selection and mixed-domain toolbar branches remain future focused targets.

Boundary job repair: CI launched its MCP/performance HTTPS server before Playwright, whose CI configuration refused to reuse the occupied port. Browser boundaries now own an OS-assigned loopback server and run before the separate HTTPS smoke server. The latter starts the actual Node server directly and verifies its recorded command before cleanup. Direct Playwright managed servers honor their configured port/protocol and refuse implicit listener reuse; explicit external mode remains available for a deliberately provisioned server. Mobile contexts follow the configured origin. Overlapping game step/seek and invariant restoration share one page boot; editor schema checks now share the real save/reload journey. Fourteen explicit @boundary tags replace broad title matching. Six successful boundary screenshots are removed while rendered contrast/geometry and actual file, focus, canvas, pointer-capture, permission and persistence transitions remain asserted.

Boundary repair acceptance: the published c4437e5e [Node.js CI run 37936016415](https://github.com/doublemover/LemmingsJS-MIDI/actions/runs/37936016415) confirms failure before any tests ran because the job had already started its port8080 HTTPS server. The corrected actual npm job passes all fourteen tagged native Edge journeys in 51.2 seconds with CI=1 while a controlled independent listener occupies8080. It receives zero requests from the job, remains alive afterward, and the owned OS-assigned port is confirmed closed; the fixture then cleans up only its own listener. Thirteen focused configuration/workflow/real-server checks pass, including concurrent distinct leases, callback failure cleanup and an actual nonzero Playwright startup exit. Both final Ubuntu server lifecycle blocks pass Bash syntax checks. A separate native direct Playwright run starts the configured HTTP port43821, passes the shared harness journey and closes that port. Required formatting and patch whitespace checks pass. Receipts are ignored temp/boundary-job-native-final.log, temp/boundary-server-focused-final.log, temp/boundary-direct-native.log and temp/boundary-remote-failure.log. No whole-suite rerun was used. This repair remains local with the newer Studio/stair commits; remote PR966 still points to approved c4437e5e, so this is local job acceptance rather than a new hosted CI result.


## Restarted audit implementation queue (October 9)

Accepted design is pinned to fe73f80 in the [independent audit](https://chatgpt.com/space/page_67ee173f128c8191bb2aa83346210c79), [terrain/crew design](https://chatgpt.com/space/page_107a474a65cc8191828ac7a3dd8bffab) and [music/interaction design](https://chatgpt.com/space/page_50e7cfca60408191892809c1cca9ad4a). All three full Pages are accessible. Their Node timings, cache endpoint parity and catalogue counts are source evidence; native interaction, sound and visible-scene acceptance remain separate. The approved four-commit continuation through fe73f80 is published to existing PR966, whose base remains master.

- [x] Compose one naturally selected source-backed basin region with explicit
  shores, public route ports and protected void/support envelopes. Reuse exact
  source alpha/order/steel and complete assembly ownership across storage tiles.
- [x] Connect scout discovery, proactive bridge, containment, ordinary crowd
  passage and release/recovery through existing physical action owners; emit
  musical resolution only from actual completed-tick progress. Qualify the exact
  scene with ordinary crews and inspect it at the default native camera.
- [x] Reward useful ordinary passage, complete admitted crews and recovered
  containment; decay learned preferences toward seeded lane personality.
  Preserve worker/probe limits; no cosmetic builder quota.
- [ ] Add scene-level preserved-option and unnecessary-intervention scoring once
  real alternate routes and staged construction outcomes supply evidence.
- [x] Retain active descriptor/growth pairs fairly across actor, worksite and
  materialization interests; release cold history, preserve aligned source
  groups and expose bounded hit/miss/rebuild/payload counters. Compare identical
  finite trajectories and another theme before attributing performance.
- [x] Fix procgen conversion losing its editing surface, nuke/draw gesture
  ownership, frozen drag coordinates and backend-truthful Timbre/Release labels.
  Extend shared group canvas edits with one Undo; preserve saved settings.
- [x] Anchor births to the actual absolute beat grid, including regeneration
  and live policy changes, using the existing simulation clock.
- [ ] Expand complete source assemblies through stratified support-bearing
  selection, explicit rejection/incidence evidence and bounded 2D productions.
  Further arches, return corridors and branching routes require concrete source
  and whole-crew evidence; catalogue eligibility alone is insufficient.

Parallel owners: Ari integrates retention/roadmap/native receipts; procgen owns
crew policy/projects; source_grammar owns source regions/assembly admission;
ensemble owns shared span gestures, targets and birth scheduling. Granular local
commits follow focused meaningful checks. Further publication requires approval
of the exact head/destination; no new PR, merge, retarget or excluded content.

Active-region retention receipt: nineteen focused cache/span/cold-edit/pack checks
pass. Descriptor and growth owners evict together in aligned pairs; the live
interest window includes forward materialization, rear actors and owned worksite
footprints, with round-robin seed residence and a hard 4,096-pair pin bound per
theme plus 128 cold pairs. The finite seed42 Dirt comparison at128lanes/700ticks
reduces misses1,506 to592 with2,322 descriptor calls in both variants; every-tick
actor/action/frontier/world-stat hashes match. A second32lane/400tick Fire run
retains identical hashes and96 misses in both variants. These uncontrolled Node
observations are not browser timing, universal survival or release speed claims.
Dirt retains107,840 typed-payload bytes and2,400,576 estimated metadata bytes;
immutable source art is excluded from these per-run estimates. Rebuild counters
refer only to the bounded most recent128 eviction records. Receipts remain in
ignored temp/restart-cache-focused.log and temp/restart-cache-parity.log.

Span gesture receipt: the first interaction batch prevents unsupported procgen
Return-to-spatial conversion while main Studio retains it, makes Draw/Nuke
exclusive, freezes pointerdown projection through beat/camera/size changes, and
rejects stale restart errors. All129 affected controller/span checks pass. The
muted native Edge journey crosses ticks133 to135 (beat15.96 to16.20), moves the
selected span exactly0.5beat and preserves the other entries; a real nuke click
queues only lane5, with no span edit. Escape releases capture and both modes.
There are no page errors, output activation or MIDI permission requests.
Historical v1 conversions already omitted from storage cannot be recovered;
present non-span entries will be preserved by the next canonical history batch.
Receipts are ignored temp/ui-music-native/receipt.json and desktop-draft.png.

Separate native watch/listen receipt: one fresh1440px headless Edge session
records65 actual local synth note admissions, preserves listening through speed
1-to3 and8-to16lane regeneration, then stops cleanly with no page errors. Its119
short scheduling samples have p50 4.2ms, p95 4.3ms and maximum12.5ms. These are
muted headless browser observations, not display FPS, acoustics or physical MIDI
acceptance. Capture and receipt are ignored temp/restart-watch-listen-native.*.

Complete source-region receipt: natural original Marble lane seed90, chunks12/13,
admits the whole144x90 LEVEL005.DAT#7 atom (indices51/52/53) and its measured
source support. Exact authored order/native alpha replaces327 extruded pixels
with genuine open geometry. Every opaque support column is checked, with at most
eight protected voids and sixteen explicitly unqualified standing ports.
Materialization reuses the existing atomic two-tile transaction and records all
source IDs; cold rebuilds preserve geometry/request-order identity. Fourteen
affected checks pass; the new source owner covers all lines/functions and92.3%
branches. The composite cache is fixed at16 and admission tries at most4atoms.
This fixture retains155,520 region typed-payload bytes initially and304,512 with
128 pinned pairs; total typed terrain is1.4574/1.5995MiB for this exact fixture.
Dirt's unsupported atoms remain suppressed. Joint object regions, broader
stratified mining and physical traversal of these ports remain unqualified.
The exact pixel/steel/support/activation test is test/procgen-source-regions.test.js.

Musical completion source: a dedicated procgen route-complete event/SFX has an
editable four-cell rising phrase through the existing scheduler, distinct from
exit/death events. Existing saved completion clips, bypass, track and performance
edits survive preset changes; projects without this source stay silent. The
26 focused defaults/phrase checks pass, with actual output calls at0/180/360/540ms
and four corresponding gate releases. Physical/acoustic acceptance remains
separate. Live crew emission is the next policy checkpoint; a source default by
itself is not an actual scene resolution.

Passage reward checkpoint: bounded local projects admit only actual observed
crew through their admission tick, then require current completed-tick ordinary
passage and recovered temporary containment. Worker-only completion earns no
positive preference; real crew loss reverses passage credit. Seeded personalities
remain unchanged and learned offsets decay every256simulationticks. Projects
retain at most4/lane,64numeric members,8revision tiles and a1,600tickdeadline;
missing/changed crew, stripe transfer, support changes and future births cannot
certify the admitted cohort. No worker,40px proposal,1,024 observation or eight
evaluated-lane caps are increased.

Thirty-five affected policy/crew/scout/stair checks pass. Fresh controlled8/16
ordinary crews each connect at192 and resolve at249 with one real builder, one
empty-mask basher, one recovered blocker, zero losses/hazards/removed pixels and
retained steel. Additional planner proposals are explicitly disabled in this
outcome-owner fixture; it does not prove natural open-basin incidence. The true
completion event owns lemmingId and crewProjectId, and the existing default router
admits four rising cells at249/252/255/258 with four gate releases, pause retention
and Panic cleanup. Projects cover97.88%lines/92.63%branches; Policy all lines and
90.16%branches. Late containment-capacity remains a meaningful coverage target.
The earlier exposed64px Crystal candidate is largely roofed and is not an
accepted bridge scene. Open-bank source admission and staged construction remain
the next feature slice. Receipts are ignored temp/crew-project-coverage.

Canonical automation and group editing: procgen now stores every present
sanitized automation entry in v2, including converted spatial curves. Legacy v1
entries migrate without truncating overflow pages; data already discarded by an
older v1 save remains unrecoverable. The list renders 64 rows per page and retains
later pages. A same-domain group move or resize creates one batch edit and one
Undo step; Undo/Redo restores automation while preserving current preset,
priority, tension, device, gain and listening settings. Mixed-domain moves report
an explicit refusal, and stale spans or regenerated worlds cancel the draft.

All 132 affected controller/shared-span checks pass. A muted native Edge journey
at 1440 by 960 moves two selected spans by exactly 0.5 beat, writes only on
pointer release, undoes/redoes both together, and preserves a named, disabled
spatial curve and its points across reload. No output activation, MIDI permission
request or page error occurs. Existing runtime limits remain unchanged. The
ignored receipt is temp/procgen-group-native/receipt.json.

Open-bank geometry checkpoint: Crystal lane seed 8, chunk 15 naturally reserves
one complete 64 by 16 liquid, with its original frames and trigger, two 24-pixel
shores at y=124 and a solid floor at y=140. The production records its native
motif foundation and explicit negative void; it is generated geometry, not an
authored open basin or a qualified crew route. Optional words, columns and
assemblies respect the reservation. Existing closed cavities and the roofed
4157451727 candidate retain their source geometry. The entire opening and hazard
activate in one existing object job after all bank/floor foundation dependencies.

Focused checks compare every collision, color and steel sample before and after
activation, reject missing support, steel, source art, overlapping hazards and
invalid bounds, and verify cold rebuild/request-order identity. New helper
coverage is 100% lines/functions and 98.18% branches; another prior non-liquid
object envelope remains a useful branch target. The muted native inspection uses
public seed 4274680063, 16 lanes, lane 9 and 3x zoom. Cold terrain has no enabled
hazard; explicit bounded source preparation reveals both intact shores, floor,
open sky and original liquid with no page errors. This source inspection does
not certify ordinary traffic. Ignored receipts are temp/source-open-bank-native.json
and temp/source-open-bank-inspection-native.png.

Automation target labels now describe the existing lowering contract in both
Studio and procgen: default Timbre CC74 is ignored by the browser synth and
external MIDI response depends on the device; supported channel controllers
remain identified. Release scales note-off velocity rather than envelope time.
Legacy attack, decay and sustain targets describe strength, reduction and gate
multipliers. Saved target keys, DSP and mapping values are unchanged; backend/CC
help updates preserve the editor node and text selection. Open-air and airy
factory descriptions now match their existing gates and note-off behavior.

The canonical storage owner additionally covers all lines/functions and 84.21%
branches through the existing focused controller suite. Unavailable storage and
fallback/error alternatives remain useful branch targets; its ignored report is
temp/restart-automation-storage-coverage.log.

Absolute birth checkpoint: cohort admission now uses the same generation-relative
beat zero as the existing musical transport. It quantizes actual birth ticks,
including fractional quarter beats, instead of merely rounding lane offsets.
An admitted cohort freezes its spread and beat settings; changes apply to the
next cohort, or to the pending first cohort before admission. Long beat periods
use bounded future-grid deferral, exposed beside the unchanged nominal adaptive
interval. Beat-disabled schedules and capacity/reserved-probe rules retain their
existing behavior; pause and wall-clock speed do not move the musical grid.

Nineteen affected population, spawn-role and beat checks pass. Muted native Edge
records 32 births before regeneration and 20 afterward with exact rounded-grid
and phase labels, an inert pause, and unchanged beat duration through 1x to 22x.
The restart observer began after four initial births; later full cohorts each
contain all eight lanes. There are no permission requests, output activation or
page errors. Receipt: temp/procgen-beat-birth-native/receipt.json. The earlier
truthful-target batch passes 140 affected controller/span/preset checks.

Staged basin checkpoint: one bounded scene owner uses the actual enabled source
basin, four privately screened full 12-brick BUILD cycles and natural SHRUG/WALK
transitions. The scout service actor legally holds supported endpoints between
sections. The original rear blocker stays until a real final landing; it and the
landing owner recover through empty-mask BASH. One canonical project covers all
sections, current admitted ordinary recipients and recovered blockers. The
passive exit is distinct from the revision footprint, preventing a release
deadlock. Equivalent cold receipt rebuilds preserve source identity and geometry.

Source readiness and crew capacity reject before BUILD. Waiting work shares the
existing lane admission ledger; a 16-lane off-service launch is independently
screened rather than moving an actor. Relevant foreign edits, lost crew, deadline,
queued nuke or failed project retire once through the existing lane-local OHNO
lifecycle, preserving other lanes. Worker-only progress and future births cannot
produce a crew completion. The scene uses one worker, at most four sections,
a 1,200-tick lifetime, unchanged worker caps and the existing 40-pixel forward
route, 1,024-work and eight-lane service limits; maximum private combined work is
369. The new manager covers all lines, 82.71% branches and 92.3% functions;
Projects covers 98.03% lines and 92.48% branches. Remaining alternate rejection
and active-scene snapshot branches are useful focused coverage targets.

Native muted Edge at 1440 by 900 and normal 3x zoom uses the actual public seed
4274680063, lane 9, Crystal lane seed 8, with a deliberately positioned bank
cohort: 16 ordinary recipients plus one birth-classified scout worker. It connects
at tick 831 and completes at 969. All 17 are actual WALK recipients afterward,
with four complete builder cycles, two empty recoveries, no losses, hazard
contacts, removed terrain, digging, mining or stripe transfers. One true scene
cue maps to notes 60/64/67/72 at ticks 969/972/975/978, with four owned offs,
pause preservation and empty Panic state. There are no page errors; active scene,
actor tags and temporary trigger owners clear. Root inspected the visible start,
section-2 and completed-scene images in temp/source-basin-crew-*.png; the detailed
receipt is temp/source-basin-crew-native.json. This qualifies the exact controlled
source-bank crew, not unaided public arrival, every generated route, high-lane
cadence beyond 16, acoustics or physical MIDI. General catalogue ports remain
explicitly unqualified until they have their own physical evidence.

The birth owner additionally passes all 20 affected population/spawn checks,
with all PopulationPolicy lines/functions and 91.22% branches covered. Nonfinite
policy and exact quantization boundary alternatives remain useful branch targets.

Final integration at implementation head 4c8ef7ad: 49 focused crew/scout/blocker/
stair/open-bank checks and 38 source/cache/birth integration checks pass. Critical
types, undefined-call and dependency guards pass; required formatting and diff
checks pass. These are scoped checks, not a full-suite or release qualification.

One finite current-tree diagnostic runs original mixed terrain at 144-pixel lane
height for 4,500 ticks with the existing 120 BPM Crowd relay preset and real
original masks. Seeds 42 and 12345, each with eight lanes, record builders/miners
72/101 and 84/138. Learned miner saturation is 0/8 and 1/8 at the final tick, while
excavation remains the more frequent action. This is not a pinned old/new audit
comparison; source geometry and absolute births have changed. Each run respects
at most 1,024 charged work per lane and eight evaluated lanes per tick.

The one known public-seed run, 4274680063 with 16 lanes, verifies Crystal lane 9
has source seed 8. It reaches x=1693 in the first generation but never reaches the
basin's left bank at x=1923 during these 4,500 ticks, so no staged scene is
admitted. The saved lane observations include a real failed climb near x=1691;
they do not by themselves identify a certified upstream solution. The new
controlled scene is reviewable, but natural arrival remains an explicit gap.
Receipt: temp/restart-mixed-policy-diagnostic.json; scripts and logs remain in
the ignored project-owned temp folder. Node durations are not browser FPS or
acoustic evidence.

Next ready work:
- [x] Admit the measured relief and full builder continuation through the
  natural planner, retaining the original probe, worker and deadline limits.
- [x] Retain a scout-built basin for one observed bank cohort, excluding future
  births and preserving the original lifetime and physical recovery checks.
- [x] Recover an unstarted stale guard through its actual supported exit.
- [x] Retire a fulfilled generic owner-only project without a cue or reward.
- [x] Prevent new worker claims from cutting through active promised passages.
- [x] Retire the measured unstarted guard through an actual exit before its deadline.
- [ ] Retain a bounded full admission for an actual impending wall arrival, with
  actor, local revision, guard, hazard, claim and deadline checks; a future guard
  request alone still misses the worker's one-tick pose between service turns.
- [ ] Prove unaided basin passage and its actual musical cue on the integrated tree.
- [ ] Qualify safe release for the real forward ledge blocker. Its current legal
  containment catches arrivals, but completed stairs make basher recovery unsafe.
- [ ] Use actual alternate-route and unnecessary-intervention outcomes to address
  remaining excavation dominance; do not force a cosmetic builder quota.
  General source ports and high-lane scene qualification remain separate checks.

Resumed continuation checkpoint: private route owners now recognize complete
columns inside partially materialized tiles. Descent decisions observe live
blocker and hazard geometry before cache reuse. Builder qualification executes
all twelve real bricks, SHRUG, JUMP and a supported passive exit; it rejects the
Crystal shoulder whose old instantaneous column model predicted a useful stair
but whose real builder turns at tick 203. No worker or observation cap increased.

Complete source regions now carry frozen measurements of their actual ordered
alpha, roof clearance and supporting columns. Bounded alternatives diversify
substantial support shapes after the unchanged first seeded choice. All sixteen
prefix chunks of the known Crystal source remain byte-identical. Frozen passage
classifications expose walls, openings and unsupported lips without qualifying
or changing them. Eight ordinary actors return through one controlled alternate
Marble atom on its unchanged generated foundation by tick 101; its full original
native level is a closed-body negative. This is not natural generated admission.

Actual local voices now paint event rows and the selected source/clip grid cells
with their final transformed pitches and real attack/decay/sustain/release.
One bounded 64-voice observer preserves rerender focus and clears on project
replacement and Panic. Skipped/rest cells stay blank; shared clips do not inherit
another source's voices. Native muted Edge records D#4/G4/A#4/D5 in the dispatched
cell, with no output permission request or page error. Acoustic and physical MIDI
receipt remain unverified. Dirty note edits commit to their original cell before
painting; stale project replacement cancels a gesture.

The known intact Crystal shoulder now has a supported real arriving rear guard,
one shared-action basher and ordinary entry/return replay. Controlled 8/16 crews
cross its exit by tick 341; empty-mask blocker recovery adds no excavation.
Exactly 624 source pixels are removed, with no losses through recovery tick 346.
A fixed unpositioned 16-lane run now reaches the next ordinary fatal fall at
x=1652 instead of stalling at x=1422. At that intermediate checkpoint the scout
still stopped near x=1693; the later natural receipt below supersedes that
arrival limit. Maximum charged lane work remains 1,024 and at most eight lanes
are evaluated per tick.

The independent relief proof compares an actual unchanged fatal FALL (63 pixels)
with one short real BASH removing 35 pixels, natural FALL/WALK, ordinary patched
entry and a supported real rear blocker at x=1580. Its recovery masks are empty;
x=1584 is explicitly rejected as blocked recovery. The proof reaches x=1652/y=114
within the existing 40-pixel forward window, charging at most 893 combined cell
observations/actions and 318 of 384 private action steps. Controlled 8/16 ordinary
actors cross with no losses or abilities. Natural planner admission is now
integrated in e259593f; unpositioned basin crew qualification follows below. Passive-safe or unresolved
original walks do not justify excavation. Five causal relief checks pass; the
helper covers all lines, 92.77% branches and 90% functions. Alternate invalid
launch/lifecycle exits remain useful focused coverage targets.

The reachable Crystal port is now a concrete construction opportunity. Unchanged
shared WALK reaches x=1649/y=47, x=1650/y=46 and x=1651/y=46 on the original source.
A full BUILD produces 72 pixels, naturally SHRUGs and falls onto the supported
roof, reaching its passive exit in 217 actions within 395 charged planner work.
Controlled ordinary followers cross the intact assembly after construction with
no removed native pixels. This is distinct from live construction: in actual
arriving 8/16 crews, 6/8 and 14/16 pass while two followers fall during BUILD.
A supported forward BLOCK catches arrivals without interrupting all twelve
bricks, but leaves fifteen of sixteen actors pending. Completed stairs occupy its
basher masks [3,0,2,15]; recovery removes eighteen stair pixels then splats.
The native BUILD recovery first respects the existing retry fence at tick 2286.
A legal brick attempt then turns left after sixteen actions, with no added or
removed pixels and normal trigger cleanup. Sixty-four further shared actions end
at x=1590/y=53, falling left and alive, without rejoining rightward travel.
This is a finite return negative, not a completed BUILD or a fatality proof.
Neither containment alone nor the post-construction fixture proves safe live
crew completion. Receipts: temp/natural-crystal-crew-summary.json and
temp/natural-crystal-forward-build-return.json.

An earlier pre-e259 working draft runs public seed 4274680063 for 4,500 ticks,
with sixteen lanes and Crystal lane seed 8. In that draft it reaches the bank: scout 84 arrives at tick 3135,
starts four sections at 3157 and connects at 3979. Ordinary actor 36, born at
119 with no abilities, first reaches the bank at 4136. The original scene retires
worker-only at 3984 before that arrival; it records zero crew completions.
Narrow builder admission retains the imminent actual opening test, avoiding the
broad experiment that created excessive stairs. Maximum lane charge remains
1,024 with eight serviced lanes. This superseded draft is neither final-tree
arrival evidence nor whole-crew basin qualification; the integrated negative is
recorded below. Receipts:
temp/natural-narrow-build-diagnostic.json and temp/natural-basin-membership.json.

The integrated route lifecycle preserves the private action proof through the
actual declared exit. It does not replace a basher after its natural FALL or
reward a builder at SHRUG. Numeric builder evidence expires at 264 actions and
rejects loss, disabled or removed owners, turnaround, replacement, generation
changes and relevant foreign edits; self-owned bricks and unrelated edits remain
valid. Guard release requires current ordinary WALK beyond its recorded crossing.
Required formatting and all 512 procgen category checks pass at e259593f. The old
192-tick fixture now observes its true supported WALK exit at 209. Focused
coverage receipts and useful remaining rejection branches are retained in
temp/narrow-route-coverage and temp/final-route-procgen.log.

The controlled late-arrival policy is committed in 6a62c180. Only a scout-owned
scene initially lacking ordinary recipients waits for one completed bank tick.
Real pre-assist WALK becoming its supported blocker is retained; geographic FALL
entry does not qualify. Every insertion excludes future births, and one frozen
cohort never expands. Sixty-three ordinary recipients plus the owner fit the
64-member cap; overflow rejects the whole admission. The final service blocker
holds during the wait, and the original 1,200-tick lifetime is unchanged. Twenty-
four focused basin/crew checks pass, including exact capacity, late loss and
deadline cleanup. Basin lines are fully covered with 85.8% branches; CrewProjects
has 98.05% lines and 92.69% branches. Alternate lifecycle/rejection branches remain
useful targets. Receipt: temp/basin-arrival-coverage/coverage-summary.json.

The exact integrated 4,500-tick run does not reach the basin or emit its cue.
A bounded first-retirement trace identifies a newer guarded proposal requested
at 2613 and held by ordinary actor 100 at x=1798/y=96 from 2713. A foreign edit
invalidates its observed bounds at 2733, before any worker, task or project exists.
The manager nukes the lane, ending scout 84 at x=1875 and ordinary 52 at x=1807.
The original shoulder guard correctly released at 1852 and cleared at 1856;
this failure is distinct from that established recovery or a lost promised crew.
Safe local recovery of the unstarted guard is the next narrowly scoped proof.
The first two ordinary ledge casualties remain explicit. Maximum charged work
is still 1,024 with eight serviced lanes. Receipts:
temp/natural-scout-arrival-diagnostic.json and temp/natural-first-retirement-trace.json.
The earlier draft's arrival timing is superseded, and the prepared native basin
cue fixture remains unrun until current physical arrival qualifies.

An independent private recovery receipt identifies scout/miner 84 clearing
x=1874/y=77 and y=78 at tick 2733. The loaded recovery draft delayed retirement,
so its snapshot is at 2739, six ticks after the edit. The unchanged guard's four
BASH masks are empty; shared BASH becomes WALK after five calls and reaches the
supported x=1806/y=96 exit, eight pixels forward, after thirteen. Zero pixels are
removed, and all other blocker/hazard contacts remain in the proof. A 64-call
extension naturally returns left to supported x=1771/y=96. It does not establish
a forty-pixel forward route or exact tick-2733 admission. The draft rejects a
miner footprint at x=1743..1760/y=63..83, outside the actual recovery path.
The original OHNO retirement remains unchanged in this receipt; no live passage
is claimed. Receipt: temp/current-stale-guard-empty-return.json.

Commit 685f7856 adds bounded recovery only for a stale guarded proposal that has
no started worker, task, project or promised recipients. Exact current ordinary
guard identity, direction, two owned blocker rectangles and all four empty masks
must qualify. Shared BASH/WALK/JUMP/FALL runs privately within sixty-four actions,
forty horizontal pixels and the existing 1,024 combined work/eight-lane service
budget. Construction overlap checks use the actual read and body bounds. The
real guard then has to reach the proved supported exit; original lifetime,
active-project failures and relevant foreign-edit rejection remain unchanged.
Recovery earns no project, score or route cue. Sixteen causal checks pass;
both changed production files have all lines covered, with 91.12% aggregate
branches. Alternate invalid-mask, terminal action and current-copy geometry
branches remain useful focused targets. The affected procgen category passes
521 checks in 73.14 seconds, along with required formatting, critical types,
undefined calls and dependency checks. Receipts: temp/final-guard-procgen.log
and temp/guard-recovery-coverage/coverage-summary.json.

One unaided 4,500-tick replay against committed 685f7856 confirms real recovery:
guard 100 starts at 2739, charges 97 combined work, and reaches supported ordinary
WALK at x=1806/y=96 on tick 2752. Scout 84 first reaches the bank vicinity at
2853, x=1923/y=113, while FALLING. It drowns at 2881, x=1947/y=128; there is no
basin proof, scene, ordinary supported arrival or basin cue. A distinct route
edit retires the lane at 3343. Earlier unrelated route-complete events are kept
as such and do not qualify basin output. Maximum charged work is 1,024 with eight
serviced lanes. Receipt: temp/natural-safe-guard-arrival.json, including source
hashes and the real recovery endpoint. The remaining natural bank launch and
later retirement need exact causal evidence; the native basin fixture stays held.

The bounded current-tree causal trace confirms supported scout WALK at the bank
from tick 2858. Existing basin calls at 2861 and 2865 receive the full 1,024 work
budget and the enabled source water, but return crew-capacity. The first capacity
snapshot has twenty-two live records, two nearby recipients and four projects.
Owner-only builder 1:9:24 connected at 2578; its sole owner 228 has physically
crossed, remains ordinary WALK at x=1294/y=114 beyond goal x=1012/y=120, and has
unchanged route revisions. It cannot produce a follower cue with that membership.
The other three projects have real promised passive members and cannot be evicted.
This is a measured owner-only retirement gap, not a missed launch or service slot.
Receipts: temp/natural-bank-retirement-cause.json and
temp/natural-bank-capacity-cause.json.

The later tick-3343 edit is materially different from the recovered unstarted
guard. The scene, started at 2897, is connected with guard 132 and worker 164 at
its x=1881/y=87 exit. Only that worker has crossed; five recorded release members
are still promised. Member/miner 180 clears x=1875/y=79 in the actual route bounds.
Once the worker becomes WALK, its access-task owner is released, so a new job can
claim that footprint despite the remaining project. Preserve genuine edit/loss
retirement, and prevent admitting the conflicting excavation in the first place.
No extra action, deadline, capacity or source geometry change is justified by
these receipts.

Commit d99a462a retires a generic owner-only connected project only after the
completed actor pass observes its live owner in WALK beyond the exit, within the
current thirty-two-pixel vertical band, with its recorded crossing and unchanged
route revisions. Held blockers, source scenes, waiting arrivals and every passive
promise keep their original lifetime. Retirement is diagnostic only and does not
emit completion, score or music. Twenty-eight focused checks pass, including the
exact four-slot situation and current +/-32 versus +/-33 boundary. CrewProjects
coverage is 98.18% lines, 94.55% branches and all functions; old containment
insertion remains a useful focused target. All 525 procgen category checks pass
in 72.60 seconds, with required formatting and critical types. Receipts:
temp/owner-only-procgen.log and temp/owner-only-retirement-coverage.

Commit 3ae8e113 protects both the supplied footprint and the actual initial
BUILD/DIG/BASH/MINE mask bounds before a new worker claim mutates skills, tasks or
counters. Being a promised member or the former worker grants no exception.
Existing basin sections and empty-mask service recovery use short-lived manager
contexts with exact scene, project, actor, pose, trigger, revision and lifetime
checks; contexts clear even if assignment throws, and stale reuse is refused.
Active four-project/sixty-four-member limits and real foreign-edit failure remain
unchanged. The exact later miner pose x=1876/y=90 is refused before its first cut
at x=1875/y=79. Four new causal tests and fifty-seven focused route checks pass.
Changed Basin/Crew/Tunnel owners have all lines covered; LaneWorld has 87.26%
lines, with 92.51% lines and 87.15% branches across those four owners. Uncommon
world input/action/resource branches remain useful focused targets. All 529
procgen category checks pass in 82.88 seconds, with required formatting, critical
types, undefined calls and dependency checks. Receipts:
temp/final-project-claims-procgen.log and temp/project-claims-coverage.

One ordinary-spawn 4,500-tick replay against committed 3ae8e113 now physically
admits scout 84's first basin BUILD section at tick 3183, x=1938/y=124. The
supported launch and project capacity have therefore advanced beyond the prior
negative receipt. An older tunnel guard reaches its original retirement at 3234
and cancels the lane while that first section is still building. No ordinary
supported bank arrival, connected basin or basin completion cue qualifies.
Unrelated route completions remain separate; owner-only retirement earns no
music. Maximum charged work remains 1,024 with eight serviced lanes. The exact
old guard state needs a bounded causal receipt before further recovery changes;
the native basin cue fixture remains held. Receipt:
temp/natural-promised-passage-arrival.json, with held source hashes.

The single bounded expiry trace identifies a distinct unstarted guard: the
proposal starts at 2233, ordinary actor 164 becomes BLOCK at x=1407/y=109 on 2259,
and retains its exact two triggers through the original deadline at 3233. It has
no worker, task, project, release membership, crossing or changed-route failure.
Expiry at 3234 nukes the lane and cancels the distant new basin builder. The
current active promised project overlaps the old proposed tunnel envelope at
x=1486..1496; its remaining member has not crossed. This trace does not retain a
historical worker-refusal call, so claim starvation is not established. A narrow
predeadline empty-mask recovery needs current shared-action and actual-exit
qualification, with the original deadline and active promised routes preserved.
Receipt: temp/natural-unstarted-expiry-cause.json.

Commit 55a4c325 checks stored future worker bounds and the
real initial BASH mask rectangles against active promised projects at request,
then again before a pending request creates BLOCK. Members and previous owners
receive no exemption; only that conflicting pending request clears. Touching,
unrelated and terminal projects retain normal admission. A genuinely unstarted
guard can enter its final sixty-four-tick retirement window, where guard()/begin
are fenced and the existing current-state empty-mask proof must fit the remaining
original lifetime. Real supported exit still has to occur by the original
deadline. Working/connected scene promises retain their existing failure policy.
Sixty-four focused route checks pass, along with scoped lint and whitespace.
Controlled source x=1407/y=109 reaches supported x=1415/y=109 after thirteen real
actions without excavation, contact, loss or cue. Exactly thirteen remaining
ticks succeeds; twelve is refused before BASH. Parity, busy ledger and zero
resource waits retain the original deadline. The controller has all lines and
functions covered, with 92.4% branches over twenty focused checks; unusual
identity/trigger/recovery-state combinations remain useful scoped targets.
Receipt: temp/unstarted-deadline-coverage/coverage-summary.json. A transient
execution transport reset interrupted the formatting/category check launch;
the completed focused receipts and source changes remained intact. The first
category attempt reports 530 passing checks and four timeouts, without a failed
behavior assertion. A temporary committed-controller loader also times out three
of the selected checks; its inherited child-loader startup makes that diagnostic
unsuitable as a causal performance comparison. The same six selected checks on
the current implementation then pass in 23 seconds under the original limits,
including the 1,024-actor replay. The subsequent full retry reports 535 passing
checks and one remaining
15-second timeout in the 1,024-actor case, which passed alone in 7.8 seconds.
That existing benchmark now uses a fresh Node process with identical masks,
seed 42, 3,000 ticks, 1,024 actors and all original assertions. Its child and
Mocha deadline both remain fifteen seconds; no workload or threshold is reduced.
Commit d3eacf9f isolates the measured simulation from preceding fixtures' heap.
The final procgen category passes all 536 checks in 70.15 seconds against the
unchanged 180-second process budget. Required formatting, critical types,
undefined-call and dependency checks pass. Receipt:
temp/final-guard-isolation-procgen.log. Earlier diagnostic receipts:
temp/final-unstarted-guard-procgen-retry.log, temp/final-unstarted-guard-procgen.log,
temp/guard-timeouts-baseline.log and temp/guard-timeouts-current.log.

One ordinary-spawn replay against committed 55a4c325 now completes the actual
four-section bridge without a staged actor, terrain preparation, extra abilities,
cap change or deadline extension. Scout 84 starts BUILD at 3069, finishes the
fourth section at 3868 and reaches the supported far bank at 3887. The finite
arrival cohort remains open: no ordinary actor reaches the supported left bank
before the original 1,200-tick scene expires at 4270. The failure label is
scene-owner from the original lifetime check, not an observed prior owner loss.
Retirement then cascades all thirty-two recorded original/current lane-9 actors
at 4338. Global accounting separately retains 164 failures of 528 births; this
is not a whole-run survival claim. The ordinary crowd remains upstream, with
actor 52 near x=1421/y=103. There are two successful tunnel guard recoveries and
zero tunnel failures, so the previous unstarted-guard retirement is resolved.
No basin completion or music cue qualifies; eleven unrelated route completions
remain distinct. Maximum charged work is 1,024 with eight serviced lanes. The
4,500-tick primary run required no active-scene continuation; such a continuation
would only finish one already-active scene within its original deadline, never
start a replacement. Receipt: temp/natural-deadline-guard-arrival.json, including
held source hashes, exact scene phases and bounded origin/current-lane casualties.
The following bounded causal receipt concerns the ordinary crowd's upstream
turnaround; the native basin fixture remains held.

The single observational ordinary-crowd trace against 55a4c325 stops at 4269.
Actor 52, born at 183 without scout abilities, reaches WALK x=1422/y=101 and
turns at 1608, then again at 2657 and 3531. The real next column is solid through
y=93..101; no blocker contact causes those turns. Its first imminent wall pose
falls on a non-service tick; later turns follow another actor consuming lane
service. Latest selected approaches at x=1399..1419 do run the unchanged WALK
proof, observe a turn, and reject descent before scalar fallbacks spend
996..1024 probes. No private BUILD or tunnel proof is retained for those
approaches. Detailed first-launch helper history fell outside the bounded rings,
so its exact historical refusal is not established. The existing controlled
x=1422/y=101 port proves a real guard at 1408/109 and ordinary 8/16 passage;
that does not establish current natural admission under active promises.
The proposed next batch would retain an exact impending terrain-turn pose from
the existing shared WALK/JUMP copy, then use the existing full guarded proof with
remaining work before descent consumes it. Real worker arrival, current claims,
original deadlines and all exits still govern assignment. Request-only lookahead
does not solve the same worker reaching its exact one-tick WALK entrance on a
non-service tick. A retained full approval would additionally need exact actor
identity, current local tile revisions, actual guard/trigger and hazard state,
current claims, exact arrival pose and original lifetime checks. That lifecycle
is not implemented in this batch; production remains held at 55a4c325.
Trace maxima remain 1,024 probes/eight lanes. There are no observed origin/current lane-9 casualties
before 4269; global accounting separately reports 125 failures of 512 births.
No ordinary basin arrival or cue qualifies. Receipt:
temp/natural-ordinary52-arrest-cause.json, with held source hashes and copied
calls, guards, claims, source placements and bounded production-observed cells.

Automation spans now expose the actual resolved evaluation: held phase/value,
winning priority and gated or suppressed rules. The geometric transport preview
has a separate dim lane. Bounded resolution records reuse the existing cached
runtime state, with sixty-four displayed entries and all authored data retained.
Counters, clock and output bytes are unchanged; Panic and project replacement
clear the display. Native muted Edge records thirty-five accepted local calls,
eight priority-88 notes, stable editor focus and no permission or page errors.
The MIDI category passes 890 checks. Receipt:
temp/music-span-resolution-review/native.json.

Evidence remains in ignored project-owned temp: continuation-route-grid-check,
music-envelope-grid-review, music-grid-admissions-review,
source-return-generated-ordinary, natural-guarded-port-diagnostic and
relief-proof-coverage. Those earlier receipts supported the owner-approved publication through
5ab94ec1 on existing PR 966 against master. Six new follow-through commits
remain local; the approved checkpoint description is updated, with no retarget
or merge. The owner checkout remains
at d3b9ce9 and its saved stash at 8083a30, with prior metrics/index/archive changes
preserved. No excluded content, vendor code or binary assets were modified.

The complete 83-block LabMuse review was read and reconciled with actual current
JavaScript owners. Its useful direction is implemented in local commits b6d9fd6d
(scheduler lifecycle), 6d77cc1b (real entrance approval), 169e2915 (shared clock
and scene direction), and bc35266f (canonical recipe and compact UI). The
default Event music path adds no director or completed-summary reads. Scene
replies are explicit opt-in; arrangements commit together at a shared musical
bar, with future attack gains moving over one quarter. A verified completed
crew project can request a next-quarter lead and a different permitted role
can answer one bar later only after actual admission. Source clip cells,
transforms, event/pass counters and trailing rests remain authored; a missed
reply boundary drops rather than bursting late. Manual mute/solo, scale/register,
spans, tension and existing sixteen ordinary voices/1,024 rolling lanes/sixteen
rolling dispatches retain authority. There is no second sequencer or C++ port.

The scheduler audit reproduced seven failures before fixes and added nine
causal checks. Retired destinations release the actual original output gates;
cleanup detaches token ownership before callbacks; reentrant Panic prevents
late onsets. Phrase dispatch uses a bounded phase snapshot, so clear or
replacement cannot continue a stale tail or erase callback-created work.
Scoped cancelGamePhrase releases only matching tokens, without CC120/123.
Existing emitted-pitch ownership was already covered and did not need a new
transposition implementation.

The first combined category run exposed five supported-tunnel regressions: an
already occupied wall produced a zero-step terrain turn, and future lookahead
spent the existing exact-entrance proof budget. Restricting lookahead to positive
steps restored all original assertions. Forty-eight affected physical checks
pass, including unchanged 8/16 whole-crew routes. The final npm test midi procgen
run passes all 1,473 checks in 86.62 seconds with runtime lint and critical
types. Required formatting, undefined-call, dependency and whitespace checks
pass. Receipt: temp/scene-entrance-categories-final.log. Scene owners have all
lines/functions covered and 91.16% branches over nineteen causal checks; useful
remaining targets are overloaded-voice/cue-thinning combinations and native
recipe layout/listening. Receipt: temp/director-coverage-final/coverage-summary.json.
Scheduler affected coverage is 92.25% lines/87.26% branches; new shared UI
controls have all lines/functions and 95.74% branches. Physical MIDI and acoustic
acceptance remain open. The following ordinary and native receipts close the scoped passage/cue
acceptance without implying whole-run survival or acoustic quality.

The single ordinary-spawn replay against bc35266f now admits the actual actor 52
at the previously blocking source wall: a positive-step approach requests the
port at 1587, the full guarded approval is retained at 1605, and the same real
ordinary walker becomes BASH at its exact 1422/101 entrance at 1608. No extra
proof is spent at that off-service arrival. It reaches the supported basin bank
at 2723, starts the four-section job at 2739 and connects at 3559. The completed
project 1:9:27 emits its single unchanged-source basin cue at 3691. Both original
ordinary members 52 and 116 are recorded as crossed and supported WALK at 3692;
both blockers recovered. The original 1,200-tick scene deadline, abilities,
geometry and caps are unchanged. Maximum charged work is still 1,024 with eight
serviced lanes. Global outcome is separately 538 births/174 failures; sixteen
original/current lane-9 casualties are retained without truncation. This is a
scoped passage proof, not whole-run survival. Receipt:
temp/natural-approved-entrance-arrival.json, including committed head, source
hashes, entrance approvals and actual membership.

The first qualified muted native capture exposed a genuine integration gap:
completed projects store [tile, revision] pairs and can be pruned from active
admission lists before a deferred musical cue. It produced a qualified request
but no owned note. Commit 51528e16 retains the actual bounded completed project
reference for the short cue lifetime and validates its real tuple revisions;
owner/generation/completion are checked at request. A causal prune regression
passes alongside actual revision and manual-shutdown negatives. The final MIDI
category passes 927 checks in 9.53 seconds with runtime lint and critical types;
production route owners are unchanged from the passing combined category.
Twenty focused director checks cover all lines/functions and 90.43% branches.
Receipts: temp/native-completion-midi.log and
temp/director-completion-coverage/coverage-summary.json.

One repetition for that concrete fix, against committed 51528e16, confirms the
qualified basin cue at the same native tick 3691, separated from twenty-two
unrelated lane-9 route completions. Scene replies remains selected; its node,
focus and 150 by 32 dimensions stay unchanged. One uniquely captured origin
request owns four local lead notes (74, 67, 69, 74), four synth schedules, four
ends and four releases. The existing rare-cue cooldown places the first attack
at shared quarter 444/tick 3700, then actual ticks 3704, 3708 and 3713. Pause
holds tick 3691 for 182 ms with no cue onset; Panic at 3715 prevents a pending
answer and leaves zero open gates/orphan releases. The bounded capture contains
3,007 of 4,096 records without truncation, zero MIDI permission requests, no
external output and no page errors. Source fingerprints match before/after.
Receipts: temp/natural-approved-basin-native-fixed.json, .jsonl and .png; the
initial negative receipt is preserved as natural-approved-basin-native. These
muted browser API and render-schedule observations do not establish acoustics
or physical MIDI acceptance. The owned loopback test server is stopped at the
end of this task.


## Paired procgen survey (owner approved October 9)

The complete survey strategy is at https://chatgpt.com/space/page_6302351196088191ac4c419e5f85b938. This is an opt-in diagnostic on the existing PR966 worker, excluding casino and other excluded content. Sixteen logical candidates each own a separate real world with matching physical topology; sixty-four is supported as a candidate width, not independent physical lanes or CPU workers. Start with one CPU worker and sixteen resident worlds.

- [x] Package 1: deterministic scenarios, exact baseline/no learned preference controls, validated policy settings, isolated real worlds and full fixed-cohort accounting. Keep production safety gates and deadlines. Diagnostic reads must not mutate policy decay.
- [x] Package 2: bounded CPU execution, completed-tick controls, deterministic restart/replay, idempotent checksummed results and a storage cap retaining immutable originals. No checkpoint-restore claim.
- [x] Package 3: constrained family-stratified candidates, paired complete episodes, independent-world uncertainty, frozen holdout declarations and bounded success/failure/normal exemplars. Preserve original successes and all negative verification neighbors; distinguish easy scenes, trajectory sensitivity and tested policy improvement.
- [x] Package 4: low-rate 16/64 mosaic, one selected muted replay, paired baseline/first-divergence inspection and finite native acceptance. Views consume detached telemetry; they never advance or materialize other worlds.

A small smoke corpus is not a policy ranking or reliability campaign. Source/asset hashes, policy/environment identities, denominators and budgets accompany each receipt. Wider sampling needs an explicit resource checkpoint after measured throughput/memory/storage and harness parity. Exact reruns verify consistency and are not independent reliability samples.

The first milestone is implemented as an opt-in diagnostic. Run `npm run procgen:survey -- --name=Ari` from this checkout; results remain under `temp/procgen-surveys`. Defaults are 16 candidates, one CPU worker, 16 resident worlds, 100,000 total simulation ticks, a 120-second experiment wall limit, a 60-second trial safety limit and 32 MiB storage. `--candidates=64` changes logical width; `--execution-workers=2` is the CPU ceiling. `--serve=true` exposes an owned loopback dashboard only while the finite run is active, with the control token in its URL fragment; `--paused=true` waits visibly for Resume. `--resume=<exact experiment directory>` verifies source/assets and Node/V8 identity, skips completed episodes and reuses exact verification. A snapshot is evidence, never a checkpoint restore.

Open `procgen-survey.html` on a local repository server and load an exported report for persistent review. The mosaic is one corpus scene at a time, with shared-coordinate or independent-follow comparison cameras. Generated previews explicitly show already cached base collision; they do not reconstruct edits or partial growth. Final cached previews remain available on resume. The CLI server is stopped on completion/cancellation, and the native runner owns and closes its own listeners.

Acceptance experiment `survey-16e82578ac28bafc` pins published base commit `5b2b4fd804e06e226b4944d4e1aef99875cd2146` plus SHA-256 of 320 actually referenced working-tree source files and selected assets. Source digest: `c94464a74283d4e817b66969ca5c2ce4ea03157172d7c7a8693fb153c823268f`. The 52 original finite episodes comprise 16 flat completions, 20 timeouts and 16 gap failures; all 10 frozen baseline/finalist replays match. One CPU worker with 16 resident worlds executed 29,856 ticks in 9.45 seconds; the largest observed RSS was 184.67 MiB for the entire Node process, not a worker RSS bound. Storage including report export was 6,676,247 bytes of 33,554,432. A subsequent exact-source resume admits zero ticks and retains prior measurements.

The full designated baseline cohort is retained: flat 8/8 arrived with no deaths; wall 6/8 arrived, all eight alive and two unresolved at the declared 600-tick horizon; the 32-pixel gap lost all eight, first death at tick 70. Both untouched generated holdouts arrived 7/8 with all eight alive; seed 903 has unknown protected-terrain validity after editing and is excluded from qualified comparisons. No scope or horizon was changed to make these outcomes favorable. The bounded archive contains three failure exemplars, one ordinary exemplar and two explicit incomplete-validity contexts; there is no qualified remarkable-success winner. Fourteen nonfinalist policies remain explicitly unverified for deterministic ranking. No policy promotion or reliability claim follows from this smoke.

Validation: `npm test procgen` passed 591 tests in 95.82 seconds, within the existing 180-second budget. Format, undefined-call and dependency checks passed. Narrow core/browser-loader coverage was 99.56% lines / 87.65% branches; constrained-design/analysis coverage was 100% lines / 84.96% branches. The final focused operational selection passed 22 tests and covered 92.57% lines / 86.21% branches of the execution modules; CLI coverage in that selection was 40% lines, with actual CLI smoke/resume exercised separately. Native Edge passed two boundaries: real controlled and generated source hashes match headless, tile focus survives reload, 64 queued tiles render without a 64-world campaign, and visible Resume/Pause/Step/Cancel control real residents. No MIDI permission or AudioContext requests occurred. An initial focus-loss failure was reproduced and corrected by keeping visible focused tile nodes visible during refresh.

Selected real flat, wall and gap event streams passed through the existing router/ensemble/director with a controlled clock and muted capture sink: 8, 204 and 16 accepted note-on calls respectively, zero qualified completion cues, zero open gates and zero orphan releases after Panic. Their physical and logical hashes match routing-free controls. Existing real-source basin tests retain the separate four-cell qualified crew-cue checks. This is API ownership/scheduling evidence; listening, acoustic quality and physical MIDI are still separate acceptance layers.

Receipts: `temp/procgen-surveys/acceptance/survey-16e82578ac28bafc/report.json`, immutable result/attempt/verification/exemplar siblings, `temp/procgen-surveys/musical-qualification.json`, native attachments under `test-results`, and `temp/survey-execution-coverage/coverage-summary.json`. Earlier finite source versions remain in their own experiment folders and do not count as independent samples. Local commits include source/tests/docs only; no survey receipts, binary captures or external publication.

- [ ] Exercise the conditional remarkable-success qualification executor on a naturally observed qualifying winner. Its exact/competing/nearby/held-out plan, complete-block cap, all-negative retention and interpretation contracts are tested; this smoke did not trigger the conditional execution branch.
- [ ] Before any 64-world campaign, review the measured resource checkpoint, reserve storage for required comparisons and add compressed trace export. Never delete pinned originals to admit more diagnostics.
- [ ] Cover fatal worker exit, HTTP disconnect and conditional qualification/storage exhaustion branches with narrow faults; preserve the existing coverage thresholds.
- [ ] Investigate the retained wall guard timeouts and real gap counterexample as bounded routing work, preserving the original predicates and source semantics. Unknown validity remains an exclusion, not a favorable result.
