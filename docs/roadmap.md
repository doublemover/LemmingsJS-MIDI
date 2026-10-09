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
- [ ] Add bar-defined conditions and layered pitch/repeat transformations without introducing another clock or conflating event/bar/pass counters.
- [x] Expose direct Panic, join level navigation, remove redundant picker labels, rename Source to GitHub and make color swatches contiguous with outer rounded ends.
- [x] Preserve live playback and focus across compositor-only Focus/Split/Overlay transitions.
- [x] Dock existing skill-specific cards beneath action selectors, preserving canvas controls, keyboard focus and synchronous availability/cheat updates.
- [x] Leave a glyph of space before OUT while retaining complete Increase/Decrease labels; show a lighter minimap click-destination preview with existing marching ants.

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

**Outcome:** Procgen is an endless left-to-right mode that picks one visual
theme, then efficiently and tastefully adds level pieces ahead of the lemmings
as they progress. It should feel like a coherent generated Lemmings level, not
random pixels or a stress-test mode with hazards sprinkled around.

Current status: checkpointed on May 7, 2026. The procgen debug state exposes
theme, seed, generated end, lead frontier, recent chunks, assists, and explicit
certificate policy. Certificates are scoped to local tactical checks and must
not claim full-level solvability. Fixed-seed E2E, desktop capture, and bounded
soak evidence are available under ignored `temp/` artifacts.

**Core Behavior**

- Pick one theme/style for the run and stay visually coherent.
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
- Use minimal automatic skill assists only where basic generated challenges
  require them:
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

- Start procgen and verify it chooses exactly one theme for the run.
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
  Explicit onset capture now keeps gaps/overlapping lengths with a documented last-note-per-cell rule. Trigger-bar conditions, phases, completed/started phrase counters and composable pitch layers are implemented. Next: polyphonic capture/overdubbing and layered repeat transforms without duplicate clocks; final-tree listening/interaction acceptance remains open.
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

- Main-game endless/benchmark spawning still appends to the historical ID-indexed
  `LemmingManager.lemmings` array and leaves null slots after removal. Object pooling
  bounds reusable actor instances, not that array's lifetime slot count. Investigate
  a monotonic ID plus bounded live lookup while preserving history, rewind and
  `getLemming(id)` compatibility. Do not compact the array as a quick fix. The
  procgen world's separately compacted actor array is unaffected.

## Owner review queue (October 8)

- Keep skill cards mounted beneath the game HUD and shared audio controls visible with Studio closed: implemented; native desktop/narrow checks captured in ignored temp/review-followup.
- Generated hazard support, water basins, terrain-only arrows and idle activation correction: implemented and checked with normal sourced assets; operational sourced TRAP/DROWN/KILL/FRYING contacts now use bounded shared Trigger/MapObject owners and existing death actions.
- Persistent procgen seed/generation/playtest and shared local audio controls: implemented; native desktop/narrow 64-lane workflows checked.
- Seeded readable words use verified normal fire glyphs, a finite curated no-slur pool, terrain clearance and actual baseline/spacing checks. Native source-art review captured readable GO/YES; other packs require verified glyph sets.
- Camera zoom now preserves follow; deliberate pan releases it and the visible Follow/F control restores it. Lane-stack fit, jitter, no-live-leader, DPR and resize checks pass; bounded CCTV integration is implemented and native-reviewed.
- Shared MIDI output budgeting now retains wall-time history across speed changes, gives active lanes fair shares, expires stale notes and reports thinning beside the existing audio controls. Editable complementary ensemble roles are implemented through existing palettes and track controls; saved-setting and channel-safety checks pass.
- Verified prior-run distance markers keep the same metric and positions; screen-space black/white dashes pause with game ticks and respect reduced motion.
- Make deterministic terrain growth finer and prioritize reachable frontiers with bounded shared work and matching collision/display. Canonical normal-level descriptors and pure revision-cached zone plans are implemented with authored-width caps and exact selected-pack provenance; screened additive groups are implemented; the October 9 batch replaces eight-column reveal with whole source pieces and sections. Conditional/destructive roles retain the sourced baseline; real generated trap/drowning/fire/lethal contacts are implemented and checked with sourced footprints, cooldowns and terminal action timing.
- Ranked live overview CCTV and the persistent active count are implemented; focused/native desktop and narrow checks pass. The Library reference was unavailable after the supported transfer and one retry, so explicit owner requirements and actual app evidence guided the layout.
- Ramp constructible challenge motifs with distance. Deep mining/switchback routes require real mining/digging and turning policy in the lane world before claiming playable escalation.

- Tunnel-corner wall-column transition is reproduced and fixed using real shared action systems; non-climber turnaround and natural hoisting are covered.
- Starting lane themes now use a deterministic balanced permutation of available selected-pack groundsets; canonical co-occurrence plans and screened additive runtime groups are implemented for verified normal themes.

- Population-aware cohort easing, delayed sparse scout abilities and sustained pile detection are implemented with focused checks and a 65-lane native run. New-session random shapes/body colors already preserve saved controls and stable lane rainbow assignments.

## Approved followups after the current October 8 fixes

- CCTV director is implemented: actual cached construction/survival/lead-change signals, up to four user pins, stable dwell/ties, explicit reasons, fair rotation and the Eight leaders override pass focused and native desktop checks.
- Bounded output capture is implemented in Expert and procgen Details: finite ring, actual request/API/synth lifecycle evidence, explicit clocks and context, demand-only waveform inspection, JSONL/CSV/HTML exports and objective summaries. Seeded native local output and a full 16-cell audition/cancellation are the acceptance fixtures; physical MIDI receipt is unverified.
- Owner review correction: ordinary wall bounces, unclassified source-shelf access, uninterrupted shared construction tasks and taller uniformly scaled CCTV are implemented as a separate checkpoint before musical work; focused shared-action and native desktop checks pass.
- Musical tension is implemented with saved amount/threshold/fade controls and procgen lane status. Actual completed-tick population collapse, recovery and breakthrough signals thin or restore layers smoothly; instruments, notes, scale, saved edits, channel safety and the shared output budget remain intact. Focused checks and muted desktop collapse/recovery plus main/procgen persistence checks pass. Authored main levels do not yet provide these observations.
- Musical automation spans are implemented through the existing project/router: explicit beat or actor-distance intervals, lane/group/global scope, constant/ramped values, source conditions and priority. Main/procgen editors support draw/drag/resize/bypass and persistence; live compatible edits preserve event ordinals and queued phrases. Bounded rectangles and cached phase reuse the existing renderer. Focused and native combined validation cover actual local note dispatch and Panic.
- Ghosts, named construction landmarks and replay capture are shelved. Literal weather visuals are outside the approved span concept.

- Owner edge/crew correction is implemented: a visible baseline edge, actor-owned shared blocker contacts and saved concurrent bash/dig/build limits. Exact admission/death accounting replaces obsolete all-survive assumptions. Bash-to-fall is normal shared gameplay; advanced switchback/mining policy remains open.


## Owner review queue (October 9)

- Safe spawn/drop/landing and the first 256 pixels of travel, gradual small-gap/elevation introduction, full source hazard envelopes and bounded grounded build/bash/dig/mine proposals are implemented. Actual ordinary-walker dig and mine descent replays pass under shared masks and protected terrain; broader route certification remains open.
- Cross-stripe falls/climbs, current actor/trigger/worker/music ownership, transfer-aware population observations, eight-lane new-session defaults, centered panel handle and quiet spawn-event defaults: implemented in the review branch; focused regressions and muted desktop/narrow checks pass.
- Generated dig-direction arrows are disabled. General authored assembly discovery must preserve exact relative transforms, alpha adjacency/overlap, semantic links, attachment anchors, evidence counts and pack/art provenance. Conservative ambiguous placements stay suppressed; authored levels stay intact. The bounded 16-scope source catalogue and anchored runtime placement are implemented and checked. Ambiguous unsupported placements remain suppressed; catalogue provenance is tied to exact pack/art revisions.
- Whole source pieces and route sections materialize through dependency-ordered jobs, with attached heads following their bodies and support. Collision, steel, colors, hazards and rendering share active job flags; pause/reset and bounded large-lane work are checked.
- Local audio now has independent gates, the existing 32-gate policy, priority/lane-aware overflow, capacity-independent nominal gain, one shared compressor and the existing ceiling. Muted 19-case A/B PCM renders check sustained/coherent peaks and exact post-Panic silence; other engines, real-time cost, acoustic listening and physical MIDI acceptance remain open.
- Compact Distance/Best/alive metrics and a closed secondary Seed disclosure are implemented and checked at desktop/narrow sizes.
- Accumulate ongoing related changes in existing PR #965. Local preview servers are internal development tools; no merge is authorized.

- Parent route research resolves at Library catalogue `libfile_dbb5b75a082081918a51aac2d702541c`, version 1 (61 proposed patterns, 28 proposed fixtures), and report `libfile_9959902958948191b24b263c67b147a2`, version 1. Supported consumer-local materialization returned HTTP 403 for both attempted catalogue versions; contents and source replays have not been inspected or engine-qualified here. Preserve stable provenance when transfer becomes available. Never combine independently reported per-skill minima into one assumed feasible inventory. Default safe play excludes sacrifice/trap-compression and version-sensitive tricks.
- Focused new growth/assembly/sound/trigger coverage is 99.1% of lines and 86.7% of branches. Remaining test targets include empty/snapshot growth paths and adjacent blocker-query fallbacks; prioritize actual ownership regressions over mirroring implementation.
- The finite sourced Brick seed-42 run at 64 lanes/500 ticks now retains 448/448 actors with zero failures, after nine unsafe falls at x=344..351 were traced to unfinished bridges and full-depth early gaps. Active builder footprints reject destructive route proposals, including same-tick cached proposals. Before x1024, small gaps retain real source-foundation recovery floors; later gaps retain full depth. Eight ordinary walkers cross the actual early source gap without skills or permanent abilities. A separate full-depth bridge fixture contains followers through real blocker contacts, then releases the blocker through empty shared basher masks after actual connection; all eight walkers cross without deaths or release excavation, respecting worker caps and ownership cleanup. Qualify later bridge/descent routes with whole crews before claiming arbitrary generated routes preserve every actor.
- Bounded actual-mask continuation now follows each consecutive shared walking column rather than rejecting a single occupied head pixel. Eight ordinary actors bash through the real Brick support/roof assembly and return naturally to walking with no failures or permanent abilities; wider walls outside the current 40-pixel local bound remain open.
- Solver replay now requires an initialized real Game or an explicit boolean authority assertion; unmarked adapters remain unknown. Terrain snapshots and synthetic mask copies reject more than 4,194,304 pixels before reading or copying masks, and callers can lower that cap. This bounds allocation but does not qualify an independent procgen actor/goal adapter.
- Next route qualification should use exact shared-action, whole-population replay with ordinary walkers and protected terrain, then an independent solver without an intended-route hint. The existing synthetic solver adapter is not evidence that these procgen motifs are certified. Start with safe walking/bridge/containment/connection guards before deep return tunnels or mining.
