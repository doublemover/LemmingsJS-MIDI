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

### ProcGen performance workstation (October 12, 2026)

- **Outcome:** Eight wide, independently voiced lanes in one physical world, with persistent musical editing and resumable live projects.
- **Scope:** The approved five-stage workstation plan, based on `d16efe87` with current master integrated on `codex/procgen-workstation`.
- **Workflow Coverage:** Identical Strip/Overlay edits, independent global key and collections, deterministic hybrid patterns, synchronized transport/MIDI, full checkpoint continuation, incremental terrain and real follower-verified action chains.
- **Deliverables:** `js/app/procgen/workstation/`, the integrated workstation shell, shared projection, mixed classic terrain loader, scenery layer, action-chain proof and regression/browser cases.
- **Acceptance:** Automated tests and browser evidence below; subjective listening and physical-device synchronization require separate evidence and remain explicitly unverified until exercised.
- **Out of Scope:** Publishing or merging the branch; treating mocked MIDI as physical-device validation.

Implementation milestones:

1. **Session and lane foundation — implemented.** The canonical MIDI project now carries lane identity, four phrases, step expressions, roles and routing. The versioned session wraps music, transport and a graph checkpoint preserving actor/action frames, terrain edits, growth, scenery and crew ownership. Tests compare continued real simulations after JSON round trips, including active building, bashing, mining and mixed-theme assignments.
2. **Transport and MIDI — implemented and browser verified.** A worker wakeup driver advances one musical authority separately from physical simulation. It handles internal/external clocks, 24 PPQN, Start/Stop/Continue/SPP, timestamped output, loss/suspension cleanup, recording, CC and SMF export. Timely incoming clock pulses refresh scheduling activity; genuine missed deadlines still stop playback. Character previews finish preparing before the new runtime is published. Port fixtures and browser clock input do not establish physical MIDI jitter or audible quality.
3. **Workstation and music — implemented and browser verified.** Persistent silver/glass transport, virtualized lane headers, Strip/Overlay steps, resizable inspector, project workflows and editing use one project model. Ten collections each provide eight roles, including articulation, register, dynamics, patterns and event responses. Soft patches alter playback dynamics without replacing edited steps. Existing spatial curves and bounded automation spans remain active. Input monitoring and explicit Thru are separate from clock output.
4. **Terrain and reveal — implemented.** Mixed classic families, variable composition, actor-led piece assembly, wider hazard corridors and bounded distant scenery replace uniform visual chunk cadence. Scenery is non-colliding and dithered; reduced motion and checkpoint restoration are covered. Three seeded eight-lane runs and a sixteen-lane run each completed 3,000 ticks with bounded residency.
5. **Solver and automated acceptance — implemented and verified.** Real action-system fixtures exercise build→bash, bash→build, mine→build, repeated building, three-stage and four-stage routes, worker loss, guarded followers and reservations. A discovered four-stage route consumes 996 of the existing 1,024 proof-work budget. Sixteen-lane fixtures preserve waiting chains through service rotation using real blockers, then revalidate before assignment. Immediate contact observation uses at most eleven reads per walking actor per tick; broader proof retains eight serviced lanes per tick and the existing work budget. Successful cases require ordinary followers crossing the route. Physical MIDI and subjective listening acceptance remain manual.

Scoped coverage: 111 workstation/checkpoint/music/solver tests passed, measuring 84.27% lines and 84.12% branches across the selected owners. The chain proof measured 100% lines and 91.25% branches; checkpoint serialization measured 97.48% lines and 90.62% branches. Changed terrain modules separately measured 98.19% lines and 87.2% branches. Node coverage does not exercise most DOM rendering or IndexedDB implementation paths; real browser workflows cover those separately. Coverage follow-up: collect browser V8 coverage and add explicit IndexedDB quota/transaction-abort cases.

Final unit evidence (October 13): the complete suite passed 3,642 cases in 187.72 seconds, using a ten-second per-test allowance on this busy host. The optional 180-second suite budget was exceeded by 7.72 seconds; it was not an enforced gate. Formatting, lint, critical type, dependency, undefined-call and whitespace checks passed. Current master (`0ff0a369`) was fetched again and is already integrated. Integrated browser workflows cover real IndexedDB restore at the saved tick, paused load, key/edited-chord preservation through collection changes, fresh New/Reroll seeds, deterministic Replay, quantized phrase launch, MIDI input recording/export and both layouts. A real Web Audio analyser measured non-zero synthesizer output; that is signal evidence, not a subjective listening verdict.

Final browser evidence (October 13): all fifteen workstation cases passed together in 41 seconds after fixing external-clock activity tracking and late character-preview preparation. Twelve retained legacy ProcGen browser cases also passed. New checkpoint regressions cover automatic reset continuation and reproducing terrain, spawn order and later reset seeds from the displayed seed. Saved internal and measured external tempo survive subsequent control events. The 250 ms suspension and 750 ms clock-loss guards were not relaxed.

Live Edge profiling at 1440×1000, 3× visual zoom, sound enabled, eight visible rows, after a 1,200-tick warmup:

| Session / view | Render p50 | Render p95 | Render p99 |
| --- | --- | --- | --- |
| 8 lanes / Strip | 4.6 ms | 11.4 ms | 13.7 ms |
| 8 lanes / Overlay | 1.6 ms | 8.7 ms | 10.0 ms |
| 16 lanes / Strip | 7.7 ms | 13.9 ms | 14.9 ms |
| 16 lanes / Overlay | 2.3 ms | 10.2 ms | 12.2 ms |

Each sample ran six seconds, advancing 100 physical ticks. All p95 render costs were below the 16.7 ms desktop target. Headless Edge's animation callback cadence was approximately 240 Hz; these timings measure render cost, not a promise of display refresh or device latency. Terrain residency stayed approximately 18.6–18.8 MB for eight lanes and 20.3–20.7 MB for sixteen; scenery stayed at 112–116 / 230–236 pieces. A paused 100,000-pixel camera pan generated no terrain descriptors and preserved reveal progress. Reduced-motion scenery completed statically. The user explicitly deferred physical MIDI synchronization to manual device testing; acoustic palette approval also remains outside the measured signal test.

### Music workspace and deeper source checkpoint (October 11, 2026)

- **Outcome:** One discoverable musical workspace, saved lane orchestration, and better crew survival beyond the introductory skill stretch.
- **Scope:** Global root/scale, 0–48 semitone total lane spread, local stereo width, six event-driven percussion schemes, ordered inclusive lane ranges, shared Undo and source-terrain reliability.
- **Workflow Coverage:** Muted desktop/mobile musical edits, range precedence/reordering, Undo/reload, explicit survey evidence, real source crews and shared builder/basher actions.
- **Deliverables:** `ProcgenMusicControls`, `ProcgenMusicProject`, `MidiLaneMusic`, `MidiLaneSchemes`, `ProcgenDrumSchemes`, integrated project persistence and regression cases.
- **Acceptance:** Bounded affected tests and unchanged physical work limits; retain incomplete routes and aggregate-gate uncertainty explicitly.
- **Out of Scope:** Publication, physical MIDI acceptance, acoustic approval and another full aggregate test run.

At the October 11 checkpoint, the music drawer was the main workspace, with world/population controls folded
below it. Ranges use 1-based inclusive endpoints, at most 32 rows; the last
enabled matching row wins. Unassigned lanes retain the default scheme. Disabled
and out-of-run ranges remain saved. Existing explicit clips, mute decisions and
destination routing survive lane overrides. Global key/scale edits affect
melodies; General MIDI drum instrument numbers stay fixed on channel 10 and are
excluded from MPE member allocation. Six kits cover pocket, breakbeat, tom,
hand percussion, soft ticks and metal voices, with deterministic accent choices.
Pitch spread is the total low-to-high span across current lanes, bounded by the
existing note range. Stereo width uses the existing local per-note audio owner.

The existing v2 automation payload gains a versioned musical snapshot; old v1
spans and v2 automation-only saves still load. Full saved compositions take
precedence over legacy palette preferences. Musical Undo includes palette,
key/spread, ranges, tension and automation, and excludes device access and output
enablement. Legacy projects keep their event pitches until an explicit global
pitch edit. No control starts sound or regenerates the world.

Two existing helpers, both launch-confirmed `gpt-6-astra` at Medium, completed
disjoint main-workspace and survey-review scopes. The survey now separates
physical arrivals, qualified arrivals, deaths, unresolved members and unknown
validity; scenario/policy navigation retains paired-baseline context. This is
evidence review, not automatic policy promotion.

Fresh finite cases used 16 original ordinary births, six ticks apart, for 3,000
ticks, without replacement, special abilities or increased work budgets:

| Lemmings ground / seed | Alive before → after | Physical arrivals at x1024 after | Physical arrivals at x1536 after |
| --- | --- | --- | --- |
| Fire / 7 | 16 → 16 | 16 | 0 |
| Fire / 19 | 16 → 16 | 16 | 0 |
| Fire / 73 | 15 → 16 | 16 | 0 |
| Fire / 113 | 0 → 16 | 15 | 0 |
| Dirt / 7 | 0 → 16 | 16 | 0 |
| Crystal / 19 | 16 → 16 | 15 | 0 |

All final cases had zero hazard contacts and at most 1,024 charged lane probes.
These are survival improvements, **not completed deeper routes**. Dirt seed 7
previously recorded eight arrivals at x1536 before losing all sixteen actors;
its new intermediate recovery floor preserves the cohort but leaves it below
the far bank. Fire 113 now completes its actual two-section fire project; one
original actor remains the entrance blocker. Unrestricted source walls still
stop forward progress in this corpus.

The fire failure combined a six-pixel following distance with an eight-pixel
guard admission threshold. A closer physical blocker safely holds the follower,
but overlaps the first stair. Recovery now rehearses the existing basher and
walker against the finished bridge, charges the existing lane budget, and grants
only its exact removed cells to the original guard until that action expires.
An unrelated edit by the same actor still invalidates the project. Source fire
triggers are unchanged.

Intermediate gaps between x1024 and x2048 retain a visible 16-pixel recovery
floor and a finite far-bank ramp. Later full-depth gaps retain their void and
gain a visible return lip. Starting at chunk 17, one in eight chunks offers a
seeded ledge, tunnel, gap or terrace, with chapter-dependent dimensions and
source terrain between encounters. Existing wide source assemblies take
precedence. Four positioned deep encounters at chunks 17/25 each pass all
sixteen original walkers, with real construction/excavation or passive walking;
this controlled evidence does not establish natural arrival at those chunks.

Validation receipts are `temp/campaign-midi-tests.log` (412 passing),
`temp/campaign-terrain-tests.log` and `temp/campaign-integration-tests.log`
(the single initially mistimed recovery assertion was corrected and passed in
the integration selection). The fresh before/final corpus is
`temp/campaign-seeds-{before,final}.jsonl`. Main UI: 11 muted Edge journeys;
survey UI: 12 muted Edge journeys. Screenshots at 390/768/1440 widths show no
drawer overflow, and output stayed off. The prior full aggregate gate remains
unverified; no timeout or budget was relaxed. All work remains local pending a
separate publication approval, and the team is parked after this checkpoint.

Focused coverage collected 29 passing tests: 92.74% lines / 77.27% branches
across the selected owners. The lane scheme resolver, drum definitions, lane
schema, local tunnel and terrain challenge owners have 100% line coverage in
that collection. The musical command adapter is 75% lines / 37.5% branches;
its range ordering/removal is covered by the muted browser journey, while
isolated invalid-command and boundary tests remain a future coverage task.
The additional percussion scene-cue regression passes with the ten-test lane
music selection. Format, lint, undefined-call, dependency, critical type and
diff checks pass. The ignored historical checkpoint copies are excluded from
format/lint because they are evidence snapshots rather than runnable sources.

- [ ] Resolve intermediate lower-bank escapes and unrestricted source-wall stalls without weakening complete-crew accounting.
- [ ] Broaden natural arrival/return qualification for the spaced deep encounters.
- [ ] Review acoustic quality and physical MIDI behavior separately from muted scheduling evidence.

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

## Terrain and skill decisions (October 10, 2026)

- [x] Introduce seeded ledge, finite-wall, recovery-gap and walking-terrace forms with reserved approaches, supported exits and unchanged chunk seams.
- [x] Replace scalar-only short-tunnel acceptance with a silent private replay of the real basher masks and exit actions; retain steel, hazard, observation and work limits.
- [x] Fix passive jump completion beyond the nominal lookahead endpoint and choose safe walking before construction.
- [x] Discover imminent solver decisions between stride samples and sample builder approaches before contact; retain fresh-world replay as the authority.
- [x] Refine main procgen controls and survey comparison in disjoint Astra Medium UI scopes; exercise desktop/mobile controls and real resident-world pause/step/cancel.
- [x] Broaden whole-crew reliability sampling for the concrete follower failures recorded in the October 11 follow-through below; these finite cases are not a policy ranking.
- [ ] Add focused local-tunnel coverage for unusual directional-blocker and world-boundary combinations; keep acoustic/physical MIDI acceptance separate.

The causal regressions are in `test/procgen-skill-decisions.test.js` and
`test/procgen-terrain-challenges.test.js`. A 16-tick decision stride previously
missed the x77/tick13 bridge launch, despite a successful real action replay.
The current search discovers it. A basher head contact at y61..63 was outside
the old scalar envelope; the actual-action rehearsal rejects it without live
effects. A terrace WALK proof previously stopped at exact x440 while JUMP
landed at x441, leading to an unnecessary builder; the supported landing now
qualifies ordinary walking. Controlled generated ledge/gap crossings each use
one full twelve-brick builder, the wall uses one real basher, and terraces use
zero skills.

Two 1,800-tick, one-ordinary-actor Dirt comparisons against merged 3dffaea1
retain seed, masks and worker limits. Seed 2 changes from three builders/no
basher to two builders/one basher; seed 42 changes from two builders/no basher
to three builders/one basher. Both survive; current positions at the horizon
are respectively x726 and x961 versus x867 and x699, so these examples do not
claim universal forward-progress improvement. Changed early terrain produces
different trajectories. Maximum charged lane work stays at or below 1,024.
Disposable receipts are `temp/seeds-before.jsonl`, `temp/seeds-after.jsonl`,
`temp/skill-coverage/`, and the helpers' `temp/e2e-captures/` and `temp/survey-ui/`.

Validation: the full `npm test` gate passed 3,479 checks in 154.88 seconds
within the existing 180-second budget, including critical type and runtime
checks. The final active-construction guard passed a supplemental 57 affected
checks; focused coverage of the four terrain/search/proof owners is 100% of
lines/functions and 94% of branches. Format, lint, undefined-call, dependency
and whitespace checks pass. Fourteen focused Edge journeys cover the main
page and survey, including actual resident-world controls, responsive layouts,
MIDI bytes, span editing and reload. Offline replay pause/resume has a bounded
UI regression; a new exact-source saved-report browser qualification was not
run. A muted integrated four-lane seed-42 capture at tick 1,500 had no page
errors and retained all 60 births, 59 living actors and one trapped failure.
That capture exposed stale manual-step counters, now fixed and checked in the
browser. Receipts: `temp/full-test-final.log`, `temp/skill-coverage-final.log`,
`temp/integrated-browser.json` and `temp/integrated-terrain.png`.

## Whole-crew follow-through (October 11, 2026)

The approved checkpoint `8b49fe7c` is published as draft PR 967 against master.
The following work is isolated on `codex/crew-route-reliability-20261011` and
requires separate publication approval.

- [x] Retain followers at incomplete early stairs/tunnels with an actual entrance return wall; give fallen gap followers a finite far-bank bash and supported rising exit.
- [x] Rehearse supported walking falls down to 32 pixels with matching lower-band hazard observations, and defer fallback excavation while another real construction job occupies the passive corridor.
- [x] Spend short-basher proof work before speculative future guarded entrances; keep denied terrain queries from charging beyond the existing 1,024-work cap.
- [x] Search the foremost unfinished walking actor after a leader is busy or already arrived; retain temporal alternatives, bounded nodes and fresh whole-crew verification.
- [x] Move lethal source objects after x1024 so the crew encounters the initial skill challenges first; retain later real hazards and their existing ramp.
- [x] Preserve paused regeneration and explicit seed drafts, unify keyboard/button stepping, and repair keyboard drawer focus.
- [x] Fence stale report requests and replay instances, detach imported reports from live controls, and reject future baseline telemetry at earlier checkpoints.
- [x] Exercise real saved-report browser replay from current source, including changed-byte rejection, without requesting MIDI or audio.
- [x] Resolve the fifteen recorded later Fire deaths with bounded two-section builder routes, recoverable coincident guards and visible return lips; qualify both original birth cohorts beyond the fire.
- [x] Diagnose recorded test timeouts with sequential exact-case rechecks at unchanged limits; remove unnecessary accessory row allocation while retaining byte-identical output.
- [ ] Extend forward progress beyond later source walls (including Fire seed3 at x1316), and qualify additional hazards without treating prefix arrivals as whole-run survival.
- [ ] Extend loader branch coverage for request failures, byte limits and unavailable assets; keep physical MIDI and acoustic acceptance open.
- [ ] Cover unusual local-tunnel directional blockers and boundary exits, basin delegation in the planner, and the default steel predicate in early assembly admission.

The controlled corpus covers thirty distinct seed/theme/cohort configurations,
including crews of eight and sixteen in Dirt, Fire and Snow, all four challenge
forms and six additional seed/chunk combinations. Repeated gap executions check
determinism rather than providing independent reliability samples. Two separate
entrance regressions use sixteen real births at six-tick intervals. Every
original member must reach supported walking beyond the stated goal. Controlled
cases start from declared supported poses; after initialization, no actor is
replaced, teleported, granted a permanent ability or omitted from accounting.

Matched dense Dirt cases at the published checkpoint reached 11/16 for the
ledge, 11/16 for the wall and 5/16 for the gap; the revised local forms retain
all sixteen. The short Snow source wall exposed a different cause: at tick304,
a future guarded proof spent 369 observations before the current short bash,
and actor0 missed its launch at x330. Prioritizing the actual short cut keeps
that original leader. A separate eight-actor independent search previously
ignored seven blocked followers after its frontier actor arrived; the current
search discovers and freshly replays the follower's tick7 basher assignment.

The initial natural-spawn receipt samples Dirt, Fire and Snow with seeds 2, 3
and 42, sixteen births at six-tick intervals and a 2,200-tick ceiling. All 144
original actors reach supported walking at or beyond x1024; all charged lane
work stays at or below 1,024. Seven runs retain all sixteen living actors when
the last member arrives. Fire seed3 loses twelve and Fire seed42 loses three
actors to later fire after their recorded arrivals, leaving 129 alive globally.
These are early-prefix crossings, not whole-run survival qualifications.
That pre-fire-fix receipt is `temp/crew-natural-verified.jsonl`.

The fifteen later deaths exposed a two-section fire crossing, a flat-floor
containment omission and overlapping walkers inside a blocker's central gap.
Reusing the physical staged-project owner and legally recovering both guards
resolves the outbound crossing. A longer seed3 check then exposed returning
traffic below the bridge; a visible eight-pixel foundation lip resolves that
specific return path without changing the source trigger. The current natural
birth regressions retain 32/32 original actors through seed3 tick2600 and seed42
tick2200, with all sixteen in each case reaching supported walking beyond the
fire, zero contacts/deaths, two real builder sections and one completed crew
project each. No permanent abilities, replacements or held guards qualify.
The source trigger bounds remain 1052..1076/y53..61 and 1107..1131/y55..63.
These are two finite cases; later terrain still limits progress. Regressions
are in `test/procgen-fire-crews.test.js`; keep the negative traces in
`temp/fire-crews-before.jsonl` and `temp/fire-reuse-seed3.jsonl` as causal evidence.

Before the fire follow-up, focused terrain/solver validation passed 113 checks. Across the six inspected
modules, coverage is 99.29% of lines, 98.18% of functions and 93.89% of branches;
the challenge shapes have full line/function/branch coverage. Coverage describes
that focused suite only. The fire follow-up passes 43 affected checks, covering
fire crews, basins, construction claims, terrain growth, challenges and hazard
progression. Coverage of the three inspected owners is 90.10% lines, 86.54%
functions and 84.48% branches; the staged crew owner has 100% lines/functions
and 87.94% branches. Uncovered recipe fallback/cache paths and uncommon scene
rejection branches remain candidates for focused future coverage. Both UI helpers used `gpt-6-astra` at Medium effort;
their disjoint controller and survey ownership changes are integrated here.
All 22 self-contained main/survey Edge journeys pass with audio muted, including
two exact-source 64-tick saved reports, changed-source rejection, MIDI stub
bytes, span persistence, pause/step and responsive controls. The pre-existing
external campaign-report journey was not rerun. Desktop and narrow-view
screenshots were inspected in `temp/crew-browser-final/`.
A separate muted Edge check renders the explicitly selected single-theme Fire
fixture before and after construction with the real renderer and sprites;
all sixteen original births survive tick2600 with zero contacts or page errors.
The completed stair and source-colored return lip were visually inspected in
`temp/fire-visual-1250.png` and `temp/fire-visual-2600.png`. This controlled
source-scene view is separate from the default pack's theme selection and HUD.

Format, lint, undefined-call, dependency and whitespace checks pass. The final
full gate is blocked: `temp/crew-full-test.log` records 3,495 passes and one
15-second recipe-mining timeout; that unchanged file then passes all seven
checks alone, regenerating the source book in 6.8 seconds. A full retry records
3,485 passes and nine timeouts in character rendering, source mining and lane
simulation (`temp/crew-full-test-retry.log`). A read-only host snapshot showed
substantial unrelated CPU activity; that is evidence of contention, not proof
that every timeout is environmental. No timeout, work or budget limit was
relaxed. A subsequent affected-file recheck still recorded twelve timing
failures (`temp/crew-timeout-rechecks.log`). Exact selections from those three
logs were then run sequentially in fresh Node processes. Source assemblies,
behavior, lane determinism/1024-lane execution, donut colors and several
character cases passed. The remaining six cases passed individually after
the accessory allocation fix (`temp/timeout-individual-summary.jsonl`): the
unchanged recipe regeneration took 4.98 seconds; character checks took
0.244..1.472 seconds at their original limits. The former supports host
contention as an explanation, without proving every historical timeout was
environmental. A bounded comparison confirms all 96 accessory outputs are
identical and source rows remain unchanged; measured composition CPU drops
from 548ms to 141ms (`temp/accessory-work-comparison.json`).

Checkpoint verification: 43 affected tests and format, lint, undefined-call,
dependency, critical-type and whitespace checks pass. All 18 prior timeout
cases have passing targeted rechecks at unchanged limits. The two extended
Fire cases retain 32/32 original actors. The full aggregate gate was not rerun
and remains unverified for this follow-on tree.

The owner explicitly approved a local checkpoint commit with that limitation
documented, as a specific exception to the full-gate-before-commit policy.
The checksummed pre-commit file/patch checkpoint remains preserved in
`temp/crew-route-checkpoint/`. This follow-on starts at `8b49fe7c`, the head of
`codex/terrain-skill-design-20261010`. Any future publication should stack onto
that branch to keep PR967's changes out of the follow-on diff. No follow-on
push or PR is authorized.

Disposable diagnostics remain under `temp/crew-*`, `temp/snow-budget-*`,
`temp/survey-final-ownership-tests` and `temp/survey-browser-coverage`. Retain the
intermediate negative cases: these explain the fixes and are not qualified
final-source receipts.

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

## Open-issue implementation continuation (October 23, 2026)

The current inventory contains 288 open issues. Continue implementation solo on
`codex/all-open-issues-20261022`, commit and push complete batches, and refresh
draft PR #1243 after every 20 continuation commits. The owner requested runtime
tests only after all open-issue code is implemented. Formatting and static
dependency analysis continue; newly authored runtime fixtures are unexecuted.
Earlier measurements above apply only to their recorded revisions.

Recent foundations include opaque audio execution retirement, append-only
causal journal indexes, cross-page score joins, recoverable stopped take tails,
bounded coverage uncertainty, scoped MIDI route grants, independent teardown,
immutable browser generations, complete offline installation and fresh-worker
survey execution identity. Startup now resolves fresh, recipe, document,
recovery and previous-setup modes through the existing load transaction and
publishes preferences after world commit. These are implementation statements,
not acceptance or acoustic/native-device qualification receipts.

Subsequent implementation batches add bounded sound manifests, typed compilation,
immutable renderer pins, staged rights-aware archives, durable registry ownership,
isolated audition, exact lane references and the sound library. Streaming causal
archive inspection uses admitted worker verification. Physical playback connects
actual worklet reductions to actor presentation through owned execution and clock
correlation; control-reference WAV rendering uses the same sine kernel. The take
workbench compares detached worlds and owns explicitly stepped, recoverable
branches. These implementations still require the deferred acceptance matrix;
advanced sound families, real-take audio, native device and listening work remain.

The browser-master capture now has a bounded stereo PCM processor, admitted host
storage, explicit frame gaps/interruption evidence and a workstation save dialog.
Its streamed WAV includes the tap and coverage manifest. Memory-backed PCM is
retained for retry until discard/expiry; this does not provide browser-crash
recovery, physical-take rendering, private cue exclusion or acoustic evidence.
Capture ownership fixtures are authored and await the deferred validation pass.

Cue routing now separates a deliberately selected media-element output from
live-output rehearsal, with explicit quotas that cannot steal live voices. The
single foreground audition owner and shared PRELISTEN rail connect sound-library
auditions, route changes, capture inclusion and actual source retirement. Physical
device separation, multichannel identification, latency and combined workload
qualification remain deferred; the UI does not claim private headphone routing.
Native cue errors are reduced to fixed public classifications before reaching
status or capture manifests. Worklet control auditions require scoped actual
application receipts and clock progress; admission alone cannot authorize Apply.
Native scheduling remains labeled as API evidence. Receipt/privacy fixtures are
authored and await the deferred validation pass.

The workstation now shares an admitted InstrumentDisplayScheduler with PRELISTEN.
Bounded per-surface mailboxes coalesce transport, playheads, MIDI text and monitor
updates; resize reads precede scheduled writes. Hidden/offscreen surfaces suspend
and resume from their latest snapshot. Visible lane lookups use one stable-ID
index per lane-array revision, and unchanged geometry does not resize the renderer.
Bounded UI cost distributions and coalesced/skipped/error counters are inspectable.
No timing target, idle soak or audio-independence result is claimed before the
deferred browser/profile pass; scheduler fixtures are authored and unexecuted.
The owned sine kernel now supports fixed-size complete state cuts bound to exact
engine/patch/graph/rate/profile identities, including future controls and ramps.
This prepares restoration and chunked/cropped rendering; live restoration/UI and
continuity qualification remain outstanding. Audio evidence tooling now derives
its server/hash inventory from the complete static module closure.
The new causal sine render core consumes bounded covered intent snapshots in an
explicit new local realization, with captured source-clock boundaries, immutable
intent/source hashes, silent preroll, exact crop or declared bounded/derived tails,
and simultaneous dry lane taps from one graph. It rejects unknown held ancestry,
unsupported expression, unqualified timing and capacity rather than inventing attacks
or replaying current physics. The fixed worker requires immutable engine identity
and admits PCM/encoding/transfer overlap. Host/UI integration is connected; authored
PCM/stem/crop/cancellation fixtures remain unexecuted.
The causal render host retains exact source and computation ownership through
publication of checked master/stem export artifacts. The saved-take inspector now
opens a sine-revoice dialog with range/rate/tail/all-lane-stem choices, bounded
progress, cancellation and separate download/save/retry/discard. Replacement
failure preserves the previous bundle; unknown cleanup remains explicit. Missing
clock/held ancestry is shown before enabling render. Component fixtures use a
declared test adapter and do not stand in for immutable-build worker/browser
qualification. General engines, admission-history reconstruction and physical
master/cue equivalence remain outside this first adapter.
New intents retain their actual source tick duration. The shared render timing
adapter validates captured tempo/rate epochs and beat consistency, qualifies
fractional-tick placement, and removes the source origin before adding fractional
time. Complete onset-set capacity planning uses frame/source-order ties rather
than actor traversal order. The worker manifest records timing provenance/hash;
timing, numeric-origin and fractional-order fixtures remain unexecuted.
Pinned instrument preparation/routing now follows the 1,024-lane project bound
while keeping renderer children and candidate preparation separately capped.
Routing metadata and active candidate input overlap grow through shared admission;
unknown renderer cleanup retains accounting. A required pinned revision cannot
silently fall back to the basic oscillator when preparation is absent or stale.
Live lane and offline sine adapters share one authored hold/release policy.
Large-lane and policy fixtures are authored and unexecuted.
The new native FM adapter connects two/four-operator graphs to existing owned
voices, library audition and pinned-lane preparation. Index-to-Hz conversion,
independent envelopes, bounded pitch settling and child source accounting are
explicit. Register-based index reduction is labeled an estimate, not a spectral
qualification. Native hidden DSP state/offline/receipt limits stay explicit.
FM Forge now supplies Glass Rivet, Copper Tine, Alarm Bloom and Rubber Bolt as
typed source recipes through staged library compilation/audition/install/Apply.
Selected ratios/index timing remain visible. The compiler distinguishes index
from Hz and retains archived v1 explanations. Full physical/macro bindings,
feedback/sends and spectral/listening gates remain; content, adapter and browser
fixtures are authored and unexecuted with the consolidated validation pass.
Typed macro curves now survive into executable patch data and native onset
planning. A deterministic replace/add/scale order precedes the final domain
clamp; receipts carry effective targets. FM Forge authors onset HARDNESS, RING
and stepped ALLOY. Separate lane overrides use one committed control gesture,
are captured on semantic onsets and do not mutate held voices or physical RNG.
One-shot release policy follows the actual onset envelope. Continuous controls,
identity/physical composition, momentary/controller pickup and audio/listening
qualification remain; the new macro fixtures have not run.
Native onset performance now composes keyed actor/event variation and typed
completed-fact bindings between macros and the final safety clamp. Variation
uses versioned ordered encoding, bounded named latent factors, no mutable RNG
or identity cache, and an explicit event-only fallback. Amount/Reroll timbre
are separate saved musical controls captured on onsets. FM Forge revision 3
authors small correlated ratio/decay variation and work-cell-driven color;
cells/pixels are not force or energy. Missing measured fields skip the binding
with a receipt. Continuous bindings, actor locks, noise-state support and the
deferred PCM/listening/physical qualification remain outstanding.
The native modal adapter now realizes 4–8 authored damped-sine modes inside one
owned voice, with explicit T60 seconds, two authored strike-gain sites, bounded
register taper/omissions, onset L1 normalization and all-child source accounting.
Modal body decay, onset envelope and host release are separate; one-shot holds
follow the selected body's actual longest mode. The library prepares Timber,
Slate, Glass, Sheet metal and Unclassified source recipes with MASS/HARDNESS/
DAMPING/HOLLOW, identity variation and typed work-strength bindings. This is a
musical impulse-response adapter, not a feedback resonator/FEM pickup or verified
terrain-material resolver. Source/model/content/browser fixtures remain deferred
with real PCM, spectral, listening and combined cost qualification.
The new owned pluck source shares the existing command/receipt/lease lifecycle
with sine and has a separate fixed 24-field ABI. Delay, excitation scratch and
per-voice state are preallocated and admitted before worklet construction.
Actor/event-seeded comb-shaped noise initializes a bounded fractional-delay
feedback string; two optional damped body modes share the same logical voice.
An absolute 128-frame excitation-write budget reports actual kernel rejection
without shifting onsets. The host advertises the bounded pitch/bend profile and
accounts optional body complexity. Exact pluck DSP restore and offline rendering
are unavailable; pitch/decay/quality and workload fixtures are authored, unrun.
Source design context: https://faustlibraries.grame.fr/libs/physmodels/ documents
waveguide/termination/exciter building blocks. This first-party loop does not
compile or wrap a Faust MIDI instrument and makes no library qualification claim.
Pluck tuning uses a first-order allpass fractional delay, with the loop filter's
phase delay removed at the fundamental and its attenuation included in the
bounded target loss. This avoids treating a linear-interpolated delay's extra
loss as the authored T60. These are model equations, not measured tuning/decay.
Reference: https://www.dsprelated.com/freebooks/pasp/First_Order_Allpass_Interpolation.html
Plucked Garden now stages four original recipes through the same library flow,
with BODY/PICK/DAMP/SPARK, deterministic siblings/strikes and typed work-strength
inputs. A distinct held-voice damping control ramps string/body loss without
retriggering excitation. Live contexts are explicitly limited to 44.1/48/96 kHz.
The macro panel remains next-onset; physical continuous-damping mapping is still
outstanding. Content, actual-kernel damping and immutable-browser fixtures are
authored and unexecuted. No pitch/decay, listening or hardware result is claimed.
Travel phase, committed distances and crossing positions now live in a distinct
immutable articulationState field. DSP expression contains only actual engine
controls, so strict native/worklet adapters no longer reject distance-derived
onsets for carrying geometric metadata. A metadata-only held update is recorded
as a semantic observation without queueing a DSP command or claiming application.
The original completed-fact timestamps and interpolated-position evidence remain
unchanged. Real strict-adapter and dispatcher regression fixtures are authored
and await the consolidated validation pass.
The new artificial choir kernel shares owned commands, leases, measured display
and source retirement. Eight bounded voice slots each retain independent seeded
breath, a harmonic-bank voiced table/chorus and three double-precision trapezoidal
SVF formants. Original vowel landmarks morph in log frequency; SIZE moves the
formants without rewriting pitch. Live vowel/breath/size/chorus/vibrato/bandwidth
controls use audio-domain ramps with an 8 ms minimum and bounded coefficient cadence.
No recordings, anatomical model, words or person imitation are involved. Exact
choir state cuts/offline output remain unavailable; held/ramp/determinism fixtures
are authored and unexecuted. Mathematical reference: Andrew Simper's
https://cytomic.com/files/dsp/SvfLinearTrapOptimised2.pdf ; no external DSP runtime
or complete MIDI wrapper is imported. Source-specific telemetry now names pluck/
choir correctly, preserves float headroom and omits their unsupported sine phase.
The eight-level (1–128 harmonics) exciter bank is authored offline as a pinned
first-party source module; worklet construction copies it without generation
trig. Phase-aligned adjacent levels blend under the pitch/chorus/vibrato limit;
typed table bytes and the separate immutable JavaScript table heap estimate are
admitted before construction. Artificial Choir now stages four original recipes
through the existing compile/archive/audition/install/apply transaction, with
executable onset macros and seeded variation. Runtime and listening fixtures
remain unexecuted; full scene integration remains.
Continuous completed-fact bindings now recompute choir timbre and held-pluck
damping from an immutable onset baseline, with source-specific safe targets,
bounded audio-domain slew and no new notes or simulation RNG. Actor indexes
avoid scanning unrelated held voices; missing measurements hold their previous
qualified value. Captured source-kind subscriptions survive semantic checkpoints
and old renderer ownership survives lane replacement. Update overflow releases
affected owners rather than leaving stale sound. Contact-anchor metadata now
uses articulationState, consistent with travel metadata. Compiler v8 retains
the continuous declarations. Take checkpoints now retain at most 1024 lane
performance inputs (typed macro/variation controls and continuous source kinds)
without copying full patch definitions. Changes retain only modified lane
entries and are admitted at the current world boundary, including one atomic
record for a combined mapping/control edit. Re-performance restores that
provider before the semantic engine, retains held subscriptions, and compares
performance metadata at component checkpoints. The new capture profile declares
instrument-performance state explicitly. Runtime replay and DSP fixtures remain
authored and unexecuted.

The new owned spectral oscillator source supplies the shared kernel for #1041/
#1202: 16 original phase-aligned frames, five harmonic levels with bounded
pitch-dependent blending, and a separate 16-partial additive mode with authored
ratios, gains and per-partial T60 scales. Scan/body/edge controls retain phase
and use the existing audio-domain ramps. Table mode rejects unused additive
layout edits; additive mode tapers/omits out-of-register components. Fixed typed
storage, immutable bank heap estimates and per-voice source costs enter shared
admission. Compiler v9/catalog/artifact/runtime preparation and real application
receipts support the eighth engine. Six family recipes now stage through the
shared library and audition/install/apply transaction: Bubble Reed, Prism Pad,
Acid Current (dry table), Pipe Crew, Glass Drawbars and Falling Stars. BODY/EDGE/
FLOW/RING affect actual onset values; completed world height contributes an
explicit calibrated FLOW offset to held actors. Source data pins its generator
metadata/Float32 SHA-256. Shared SPACE sends and Acid Current resonance/drive
remain unavailable, with those limits shown in the library. Fixtures remain
unexecuted. PWM/distortion/sync, exact state,
offline spectrum output and measured capacity/alias/listening acceptance remain.

Control-budget retirement now suppresses the same held physical scope instead
of allowing the travel path to reopen it on that observation or a later tick.
Suppressed scopes share the held-owner capacity, retire at causal lifecycle/
mapping/source boundaries and persist in semantic checkpoints. New mapping
revisions use distinct voice IDs so old release tails cannot collide with a
new mapping's owned gate. Physical music/performance source versions record
these semantics. Source/host-queue fixtures cover actual choir/pluck/spectrum
control application, missing observations and independent attack identity;
they remain authored and unexecuted.

Owned source wire layouts, sample-rate/register limits, seeded birth fields,
continuous controls and resource/source-cost estimates now live in fixed
source profiles shared by preparation and onset admission. The host retains
one queue/execution/lease/retirement implementation for all four owned sources.
Spectrum table-layout checks use precomputed field IDs before allocation;
expression membership is retained per backend instead of rebuilding arrays in
the control hot path. Choir admission now conservatively includes immutable
table heap estimates in both host and worklet realms. Existing actual-kernel
host fixtures cover the extracted path and remain unexecuted.

PCM source preparation now owns bounded immutable planar Float32 banks before
the upcoming sample/granular worklet adapters. It retains a decoded asset pin
through chunked copying, reserves exact source/copy storage and an explicit
native digest workspace estimate, rejects nonfinite or magnitude-over-16 data,
and pins the actual decoded PCM SHA-256 separately from its encoded asset hash.
At most two independent processor-input copies can be outstanding. Source
discard cancels unfinished copies and holds storage until readers actually
retire; unknown pin/resource release remains explicit. Absolute monotonic
deadlines are checked between cooperative chunks. This is source preparation,
not an exposed granular instrument or runtime/audio qualification; adapter,
asset-stage/library integration and granular rendering remain next.

The bounded granular source kernel now has eight parent clouds with 16 fixed
grain slots each, an absolute 128-frame birth budget, xorshift content RNG,
20–140 ms precomputed Hann windows and coherent per-grain pitch/duration/position
snapshots. Scan and pitch are separate; source-position hold is distinct from
PCM/field freeze. A motion-gated mode stops replenishment at zero activity;
held-action mode is explicit. Source edges fade and clip without invented wrap
samples. Both native source rate and decoded rate enter cursor conversion.
Linear-resampling quality is unqualified. The common owned kernel now preserves
stereo source channels with a declared balance pan law, measures pre-pan stereo
RMS/peak, and calls source release/retirement hooks so Panic cannot orphan grain
children. Grain-state inspection is bounded and on request. Kernel/stereo/
control/pool fixtures are authored and unexecuted. This source is not yet
advertised in the catalog: PCM preparation, profile/host handoff, asset staging
and the family UI must be connected next.

The ninth renderer now connects that pool to the owned host: one validated
decoded sample pin becomes a hashed PCM bank and an independently reserved
processor clone. Ready publication verifies the actual worklet bank hash and
retires preparation readers before connecting audio. Changed source assets
require another prepared renderer, preserving old held PCM. Root ratio/region
limits are checked before voice allocation; each cloud charges its full 16-child
budget. Compiler v10, schema/catalog/artifact identity, stereo measurement metadata
and one-shot duration cover the source. Consumer-owned audio reservations now
join producer retirement instead of being freed by bulk session cleanup while
copying/hashing; backend disposal joins bounded pending preparations. The rare
maximum hash-derived seed is clamped into uint32. Host/kernel handoff and resource
failure fixtures remain unexecuted. Sound-archive asset materialization, shared
WAV metadata inspection and granular family/library controls remain next; linear
resampling, offline/exact-state and measured capacity/listening are unqualified.

Source dimensions/storage formulas now live in a small shared layout module.
The host no longer eagerly executes choir/spectrum/window data modules on the
main page to read constants; explicit worklet URL literals preserve static
artifact discovery. Module heap estimates are retained once per context until
its actual closed state, including canceled or failed preparation, rather than
being freed with the last node while the module remains resident. Native heap
sizes remain estimates. Fixed table preparation now runs in an admitted dedicated worker, with exact
Float32 byte identities, bounded startup/copy estimates and processor handoff
acknowledgment before audible publication. The audio realm adopts prepared
arrays; it no longer parses the large numeric source modules. Cancellation and
producer retirement stay charged until acknowledged. Final live source-loading
qualification is deferred.
Module-lifetime fixtures are authored and unexecuted.

Staged and installed single-WAV material now has a shared browser-audio owner.
An admitted worker verifies complete RIFF layout, source rates/frames, hashes
and finite float samples before native decoding. Library auditions and pinned
lane preparation use the same bounded encoded/decoded cache and hand pins to
the granular host; missing material keeps publication unavailable. Blob readers,
worker results, native decode and copied PCM keep independent lifetime joins.
Four original integer-arithmetic synthetic biome sources now have pinned WAV
identities, source seeds and generator ancestry, with Rain Glass, Gravel Choir,
Water Lens and Rust Breath recipes. Their held-action gates own bounded clouds;
completed motion/height controls density and scan. CROWD/SCALE/SCAN/WEATHER are
explicit onset controls. Private local regeneration runs in an admitted worker
and the final content publisher writes the same source bytes. These are synthetic
textures, not field recordings. Dry original-source and permitted-region
comparisons now use the same pinned decoded source, foreground audition lease
and native sample owner. They preserve source-frame identity and forward rate,
limit preview to eight seconds, and have separate receipts that cannot authorize
Apply or replace the actual instrument control audition. Multi-source/derived
adapters remain implementation work. Runtime, cancellation and audible checks are deferred.

Fixed control-reference WAV preparation now uses the actual sine, pluck, choir
and spectrum kernels, including the shared seed derivation, default macro and
variation composition, source-specific command width and fixed bank verification.
Missing physical observations stay explicit in the manifest. Rendering begins
from silence and records the output tap before the shared owner/master graph.
This extends control references; causal-take/offline-state support for the newer
sources remains separate work. All runtime renders and PCM comparisons are deferred.

The local host now admits 20 bounded renderer owners, covering the 17-child lane
router, two preparing candidates and one foreground cue owner. Each retained
backend has its own metadata reservation joined through actual retirement.
Cue logical voices and source cost units are now separate: the workstation keeps
four cue gates with 16 reserved source units, enough for one granular cloud,
while preserving live quotas and denying cue theft of live voices. Cue gate and
lease-extension checks enforce both bounds. These are declared cost estimates;
combined device/workload qualification remains deferred.

Causal revoice now offers sine, seeded pluck, artificial formants and spectral
frames through the same audio-frame kernels, range/preroll, source-clock timing,
release policies and simultaneous lane stems. Source-specific width, voice limits,
seeds, macro defaults, identity variation and retained completed physical updates
share the live source profiles. A new target uses its own macro defaults;
captured physical observations drive its bindings only when present in the source.
Missing observations are reported, never invented. Planning accounts for retained
per-voice control state before allocating long histories. Empty initial voice
boundaries still apply: this forward render does not add arbitrary new DSP state
cuts or reconstruct missing held ancestry. Granular asset render handoff and
native offline engines remain separate implementation work. Runtime, PCM and
cross-browser qualification is deferred until the implementation pass is complete.

Granular material now has a source-rate PCM decoder variant within the same
encoded/decoded asset cache. A worker validates WAV identity and decodes 8/16/24/32
bit integer or 32 bit float samples to pinned planar Float32 at the original rate,
without a live AudioContext or native resampling. Native sample voices and dry
source comparisons keep the native-context AudioBuffer variant. Cloud bank
preparation verifies the decoded PCM digest as well as the encoded asset hash.
Background cancellation exposes producer quiescence so temporary input retirement
is joined before caller workspaces are released; unknown producers stay charged.
Source-rate conversion in the grain kernel remains linear and unqualified for
alias safety. Granular control-reference WAVs and causal render APIs now consume this path
through owned PCM bank loans. The render worker verifies actual planar bytes,
peak and the complete bank metadata hash before constructing the same grain
kernel. Its manifest retains encoded/source/decoded identities and the explicit
linear resampling profile. Main input copies remain reserved until the render
producer has retired; cleanup joins copies, original banks and decoded pins
before publishing files. The take dialog now captures the selected lane
instrument reference on open, offers its exact revision beside the four generic
source presets, and resolves its pinned material through the shared cache without
enabling live audio. The reference has its own retained metadata reservation.
Changing lane selection does not replace the captured render target; reopening
can select a new revision. Unavailable native offline engines stay visible as
unsupported choices.

Native oscillator/FM/modal offline driving now shares the live host's voice
lifetime and interval admission code. Its private driver owns an isolated native
OfflineAudioContext, schedules explicit frame targets in suspended quantum
windows and taps the master plus at most fifteen stereo lane stems from one
graph. Complete terminal intervals are scheduled with each onset; dense windows
are bounded before continuing. Cancellation disconnects owned sources and joins
the bounded native producer instead of assuming every browser implements
OfflineAudioContext.close(). Native PCM stays reserved through its consumer.
Native oscillator/FM/modal control-reference preparation now drives this
adapter without enabling live audio, then lends its native planar PCM to an
admitted immutable-build worker for float WAV encoding and hashing. Encoding
checks complete channel lengths and finiteness, preserves float headroom and
crops simultaneous taps at shared frame zero. Producer and consumer retirement
both precede release. Causal-take rendering now includes oscillator, native FM and modal bodies
through this same backend. A shared preflight retains original world/actor/voice
identity, source-clock timing, per-onset variation and recorded onset physical
causes. Native terminal intervals use the actual source release duration and
modal register plan. Each voice gets a separate execution identity without
rewriting its musical identity. Full forward preroll and all simultaneous native
taps are admitted before PCM allocation; the portable native limit is fifteen
stereo lane stems, versus sixteen for owned kernels. The dialog offers native
presets and exact saved native references when OfflineAudioContext is available.
Native sample material, shared effect returns and arbitrary held-state restoration
remain implementation work. All runtime qualification remains deferred; new
encoder and native causal-preflight fixtures have been authored but not executed.

Native offline rendering now acquires the shared background execution slot
before creating its context or PCM. Its existing audio leases account for PCM
and graph storage; the queue reservation covers dispatch metadata. Cancellation
and deadlines retain the slot through actual native producer drainage, including
confirmation after an interim unknown cancellation. The latest issue refresh
adds #1256 (289 inventoried issues). Its shared native ADSR repair reconstructs
truncated ramp endpoints, including zero attack/decay and earlier repeated
releases. Initial envelopes and lease renewal use the same bounded linear
scheduler, preserving attack/decay even when a lease tail begins inside them.
New API-double ownership, analytical envelope and real ConstantSource browser
fixtures are authored for the later consolidated pass, not executed evidence.

The shared asset cache now accepts an explicitly owned offline native decode
context without opening the live context. Its native rate/decoder cache identity
is shared with live consumers; borrowed context requests must join cancellation
through the accepted decode producer. Material preparation forwards this lifetime
contract. A private native-render material adapter uses a one-frame silent
OfflineAudioContext to decode through the same provider, then drains that context
before lending native buffer pins. Native render batches also check current
request ownership at each scheduling frontier. Sample-map content and native
sample product rendering remain implementation work. Ownership fixtures are
authored; no runtime decode, native render or tests were executed in this pass.

Authored sample maps now have a bounded immutable schema and stateless semantic
onset selector in the existing sound-content compiler (typed-recipes-v11).
Maps declare gesture layers, half-open velocity intervals, nearest-root ranges,
contiguous alternates, source-frame regions, explicit forward/sustain loops,
owned release children and authored gain/tuning trims. Native seam crossfades
remain rejected. Selection uses original onset/actor/asset revision identity,
never playback acceptance or actor traversal counters. Exact world/lane/kit
scope distinguishes choke ownership; missing gestures use only the declared
neutral policy and report that fallback. Captured causal mapping rules can
retain explicit sampleGesture/sampleKitId tags without adding physical events.
Compiler render identity excludes display labels/evidence references and includes
the effective map; source credits and measurement references remain separate.
Decoded asset admission verifies every mapped region before activation. Product
sample-backend wiring, the original proof pack and offline sample rendering
remain work; selector and metadata fixtures are authored and unexecuted.

Mapped native samples now use the actual sample backend in library audition
and saved lane preparation. The shared material cache pins up to 32 unique
sources, and backend preparation validates all map regions against real source
bounds before admitting a voice. Each prepared map has a conservative metadata
reservation joined through its retirement. Selection receipts retain the map,
zone, velocity layer, alternate and seed without PCM. The chosen authored gesture
is part of the immutable control fixture hash; it cannot share another gesture's
fixture identity merely because timing and expression are the same. The library offers authored
gesture audition choices and the physical-rule editor captures gesture/kit tags.
Same-kit choke intervals are preflighted before admission, retaining source-tail
quotas and kit isolation. Later tail chokes cannot reopen a captured ended gate.
Causal sink receipts retain bounded actual map-selection evidence, separately
from kernel application or audible output. Sample main/child release scheduling preserves truncated
ramps and an already playing original release when a future choke is canceled; selected-region duration informs bounded one-shot hold. Offline clock mode
uses render-frontier/source retirement instead of expiry timers. The native render
material helper now lends up to 32 pinned native source buffers. Two earlier text
encoding conversions in library labels and this roadmap are repaired. Original
tactile proof material and native sample control/take export remain work; runtime,
UI, source-pitch/loop and resource qualification remain deferred.

Mapped native samples now render controls and causal takes through the same
sample backend, using isolated offline material decoding and the shared cache.
Native buffers never pass through the encoding worker: the main-thread offline
producer supplies planar PCM after quantum-bounded scheduling and joined
retirement. The saved-instrument option supports the exact installed sample map;
control WAVs retain their selected gesture fixture hash. Source-rate regions,
relative varispeed pitch, per-onset hold and conservative release-child bounds
share live definitions. Causal preflight models exact kit-scoped chokes before
logical gate capacity and explicitly rejects controls after a newly realized
choke. Bounded selection API receipts expose their retained/omitted coverage;
they do not certify native applied frames, acoustic output or prior admission
history. Five owned and four native sources now have implementation paths.
Original tactile proof material and advanced sample traversal still remain;
all runtime, PCM, resource and browser fixtures stay unexecuted until the final
consolidated validation pass.

The original tactile proof pack now authors eight procedural sources (one C4
root, two intensity layers, two alternates and open/muted contacts). Three actual
source regions per file expose center/edge/brush through six gesture labels and
24 zones, with exact half-open velocity layers and a plus/minus six-semitone
varispeed range. Its existing library preparation/audition/render path shares the
same source provider and admitted material generation worker as synthetic biomes.
Generation dispatch is now explicit by pinned original generator revision; native
or pure-source decoding uses the shared asset cache. The publisher materializes
the same fixed hashes without checked-in binaries. Metadata reports authored
trims and unmeasured normalization; no recording or acoustic evidence is invented.
Source identities/recipes were authored; compiler, unit, browser, PCM, pitch,
listening and memory qualification stay deferred. Three-root expansion, advanced
loops, source traversal and exact DSP-state restoration remain work.

The custom-source kernel state adapters now capture pluck delay/allpass/body
memory, choir phase/noise/filter memory, spectrum partial/filter memory and
complete granular cloud/grain/birth state. They include the committed future
command heap, gate/envelope/interpolation state and receipt frontier at the
kernel's declared output frame. Extended core widths use an explicit format
version while the existing sine byte ABI remains unchanged. Source cuts bind
exact engine, patch, graph, rate, slot profile and immutable fixed/PCM bank
hashes. Little-endian transfer buffers are bounded, exclusive and preallocated;
checksum/shape/state validation precedes destination mutation. Mutable DSP memory
is copied independently and display subscriptions require new observation.
These are concrete kernel adapters, not a qualified live scrub/restore claim:
block-boundary transport, journal-cursor custody and staged sink replacement still
need integration. Uninterrupted/chunked PCM, attack/held/release/future-control,
asset mismatch, corrupt state and independent memory fixtures are authored for
all source rates and remain unexecuted with runtime testing deferred.

Causal owned-source output can now stage a fresh kernel from a complete source
cut at the chosen range boundary after covered silent preroll. The render loop
splits exactly at that frame, keeps the immutable plan/cursor and slot-to-stem
routes, and restores independent mutable memory before output continues. The
transfer is preallocated and included with the temporary second kernel in the
worker's admitted workspace. Fixed banks and PCM stay shared read-only; source
state bytes receive a SHA-256 and an explicit planner frontier in the manifest.
Cancellation checks bracket staging, restore and hashing, and successful staging
clears the temporary transfer. The existing take-render dialog offers this as an
experimental owned-source reconstruction choice. Native sources explicitly keep
forward history. This is worker-local range reconstruction, not live-host queue
capture, a persisted take checkpoint or a qualified exact scrub claim. Deferred
PCM fixtures compare full graph and simultaneous stems across a cut inside a
control ramp. Live block transport and canonical cursor/sink replacement remain.

Owner-local creative effect hosting now prepares immutable typed stereo graphs
with bounded nodes/edges, stable DAG order, complete-path tail/latency/storage
admission and compounded gain bounds. Arbitrary cycles reject; feedback is owned
inside one explicit bounded stereo delay operator. Its preallocated ring supports
two-sample linear fractional taps, causal bounded tape glide or a fixed two-tap
linear jump crossfade. A second jump during transition explicitly refuses. The
feedback path has lowpass/DC-block state, a declared gain ceiling and nonfinite/
state-amplitude containment. Continuous wet/feedback use an explicit 8 ms time
constant. These are unqualified creative processors, not a final output limiter.

The shared browser channel now has an owned insertion/dry point before its
existing master or explicit cue destination. Session and physical playback APIs
prepare a graph without enabling audio, preserve the committed graph on candidate
failure, and admit at most two current/tailing revisions. Input crossfades leave
old owned energy until its hard audio-clock deadline; neutral, tail, mute and
Panic have separate transitions. Native graph retirement waits for processor
acknowledgment before releasing graph/route/channel storage. An unavailable or
failed producer keeps an explicit unknown reservation. Context module ownership
allows five source modules plus one effect module, held until context closure.
The graph/control UI, authored Dub Quarry rack, convolution, typed detector paths,
shared nonlinear/spectral/body processing, offline effect taps and full acceptance
remain implementation work. Routing, fractional impulse, transition refusal and
producer-ownership fixtures are authored; runtime and DSP qualification stay
postponed with the consolidated validation pass.

Quarry Echo now has an original source/dry/send/delay/return topology and an
existing-workstation dialog. Momentary THROW changes only the source-send gain;
release leaves the existing return connected, while TIME, FEEDBACK and RETURN
request bounded native controls. Gain nodes declare a maximum amplitude envelope
used for graph headroom admission. A control receipt includes graph definition
hash and owner route revision; releasing a gesture from an older route cannot
change a replacement rack. Native control submission and actual render application
remain separate. Runtime diagnostics retain the immutable application identity
and requested parameter state. No control enables audio or opens MIDI output.

Optional saved owner-rack defaults are validated in procgen projects and use a
newer graph revision for each edit. They preserve physical mapping and lane
identities, roundtrip through project sanitization, and participate in history.
The dialog loads/saves defaults separately from live control gestures. Saved
rack edits are blocked during an active causal take until their journal contract
is implemented. Effect gesture persistence/replay, causal per-voice throws,
input coloration/AGE/spring recipes, matched A/B and offline effect-return taps
still remain work. The UI explicitly identifies the current gesture-recording
limit; master PCM capture can retain actual played output. Schema, headroom,
project roundtrip and stale-gesture ownership fixtures are authored and unrun.

Native convolution bodies now have a bounded immutable IR descriptor, explicit
mono/stereo/native-true-stereo layout and shared native decode ownership. Four
channels are admitted only for IR assets; sample voices keep their two-channel
limit. The same encoded/decoded cache verifies actual WAV kind/layout/rate/frames
and joins accepted native decoding before cancellation releases an owner. Each
convolver retains an independent graph pin through the final native buffer clear
and disconnect, even when its material provider retires its own reader loan.

Admitted worker analysis scans copied native PCM for finite coefficients, RMS,
absolute coefficient sums and normalization/headroom bounds. Native RMS scaling
and separate calibration gain are explicit; four-channel bounds conservatively
sum all matrix paths. Source plane hashes identify the analyzed host byte order;
no acoustic, room, latency or cross-browser equivalence evidence is inferred.
The graph host sets normalization before assigning the buffer, prepares new
convolvers for replacement, and reserves decoded material plus separate native
copy/algorithm estimates. Four bodies and 64 MiB decoded IR inventory are graph
ceilings, subject to the shared budget and two-revision overlap admission.
Unknown native latency propagates as null and requires the explicit uncompensated
policy; it never becomes a zero-latency alignment claim. Native disposal precedes
IR pin retirement. Delay-state containment also reports an owned fault so the host
can name and bypass its branch. Source/layout/normalization/gain/assignment-order/
pin-lifetime fixtures are authored. Original procedural bodies, their focused UI,
convolution offline output, measured latency and all runtime qualification remain
work; no tests, native renders or content builds ran in this implementation pass.

Original convolution bodies now include reproducible mono Hollow Spring,
stereo Stone Courtyard and four-channel Crossed Gallery source data. The shared
material provider generates and verifies their encoded identities through its
existing admitted worker, then uses the same native decode/cache/analysis path.
The Quarry dialog selects these bodies, saves their exact graph/asset defaults,
performs momentary source sends and SPACE return changes, and preserves prior
tails across prepared replacements. Controls are locked during preparation.
These are original synthetic bodies with explicit native RMS normalization and
reference gain, not measured hardware/room responses or qualified level matches.
Source-data authoring wrote identity metadata only; no binary is committed.
Native latency, offline convolution, source-bound throws, listening and all
remaining acceptance gates are still pending. No runtime tests ran.

The shared effect runtime now implements an original bounded nonlinear chain:
ordered cubic/fold transfers, direct or stable first-order ADAA, real local 2x/4x
polyphase up/down filters with pinned source coefficients, explicit HP/DC stages
and a kernel-owned binary64 state transfer. Native graph preparation verifies
the exact configuration identity and reserves full state/alignment estimates;
four nonlinear islands is the current unqualified graph limit. Fractional FIR/
small-signal ADAA group delay and frequency-dependent phase/droop are explicit.
Native parameter queues are bounded and refusals cannot become accepted receipts.
Quarry Tape adds the shared cubic preamp and AGE drive/feedback-darkening control
without replacing final protection. Quality changes prepare another graph.
Arithmetic, restoration, silence and graph fixtures are authored, not executed.
Native WaveShaper comparison, ADAA2/WASM precision variants, host-wide state cuts,
offline full-effect rendering, alias/cost/latency/level/listening qualification
and the remaining effect recipes/causal gestures are still required.

Issue #1258 now has one owned-profile footprint interface with named
`{ sampleRate, voices, pcm }` fields. All five source adapters distinguish PCM
from capacity; low-level voice validation stays strict. Live admission uses the
actual full processor capacity, while control/causal/state-cut renders use the
actual configured capacity and exact PCM bytes. Non-PCM null/undefined material
no longer enters a low-level voice argument. Resource-present live preparation,
all-rate capacity/storage parity and direct control/state-cut regressions are
authored for the deferred acceptance pass; no runtime tests have run.

Issue #1257 now gives each classic long-session replay probe explicit
transport ownership. It waits for meaningful retained history, verifies both
seeks and the restored tick/exposed physical projection/history before resuming
only a previously running workload. Failed restoration invalidates and stops
the run. Required raw telemetry, completed forward ticks, sustained progress,
sampled active/paused/probe time, complete replay receipts and profile-specific
history turnover gates prevent a tiny initial advance from passing an idle
window. Cold compaction/thaw/retirement counters report actual owner operations.
Controlled actual-E2E/TimeTravelController integration fixtures are authored,
including failed/incomplete seeks and originally paused state; no browser run,
benchmark, runtime test or throughput result is claimed.

The #1131 v11 artifact producer/consumer regression now admits the emitted
`cost.sampleZones` and nested `display.sampleMap` with strict type, inventory,
unknown-field and archived-map consistency checks. V11 counts must be explicit
and equal the actual zone count; non-map counts are zero. Earlier supported
compiler artifacts retain their exact archived bytes with an implicit zero
count and cannot claim the v11 sample-map capability. Whole-family compile/
readmission, malformed-count/display, legacy-read and existing display-versus-
render-identity fixtures are authored. CLI/background compilation share this
validator; build/publication and runtime acceptance remain deferred.

The bounded creative delay now has a complete kernel-owned state transfer:
immutable rate/configuration identity, independent stereo ring/filter storage,
write/frame cursors, glide/jump frontier, feedback/wet/tone smoothing, fault and
Panic flags. The shared little-endian effect-state helper validates CRC, layout
and every domain before mutating DSP. Transfer buffers are exact/exclusive and
retain their full cost; no checkpoint work or allocation enters sample().
Forward-continuation, corruption/foreign-state, alias refusal and Panic fixtures
are authored at all supported rates/modes. Host-wide capture/queue cuts and
full-graph offline restoration remain work; these kernel APIs are unqualified
and no runtime/DSP tests ran.

Graph dry/parallel alignment now uses an owned fixed stereo fractional-delay
kernel with exact reserved ring storage, including sub-sample delays below one
frame. It shares code/state transfer with the planned offline graph path and
loads in the existing single effect module. Native graph preparation shares one
ABI/configuration/ACK/fault/retirement adapter for all owned processors. Used
delay/nonlinear/alignment revisions now bind graph identity. Linear two-tap
alignment remains frequency-dependent and is not a broadband phase-null claim.
Impulse, state and actual-kernel host/resource fixtures are authored; full-graph
render integration and all execution qualification remain pending.

The owned causal renderer now has a full shared effect DAG path using the
same delay/nonlinear/fractional-alignment kernels as live graph hosting. Every
source aggregate/preroll frame passes through that single graph; dry lane taps
and up to eight actual shared node-output taps are captured simultaneously.
Ranges retain prior effect excitation, and bounded tail/output/worker storage
include the complete graph and tap set. Manifests bind graph definition, used
processor revisions, exact graph hash and source/tap scope. Authored static
defaults are explicitly a new realization, not replay of unstored live gestures.
Native convolution/native source full-effect adapters, public render-owner/UI
wiring, host-wide state cuts and all runtime qualification remain work.
Arithmetic/shared-nonlinearity, simultaneous tap and crop fixtures are authored
but unexecuted; no tests, native renders or content builds ran.

The public causal render owner and dialog now select explicit dry, Quarry
Echo/Tape or compatible saved owner defaults, with a separate new source-send
amount and optional simultaneous shared-return WAV. They retain exact graph/
processor/tap identity through worker admission, complete memory/output bounds
and per-file artifact validation. A mismatched/failed candidate preserves the
prior complete bundle. Saved defaults remain unchanged and bypassed/native-body
racks are not silently activated. The UI identifies static new realization
versus unreplayed live gestures. Owned sources are wired; native source/effect
postprocessing and convolution adapters, graph-wide cuts, gesture capture/replay
and all runtime/PCM/listening acceptance remain work. No runtime tests ran.

All four native source profiles now feed the same owned effect graph in the
admitted encoding worker, after their actual source-only OfflineAudioContext
completes. Full preroll excitation is retained; processed master/shared returns
come from one graph and original dry planes remain unchanged. Graph/hash/ABI/
tap manifests and worker transfers cover the complete 25-file owned profile
(24 for native sources). Native sample decoded-byte footprints and retained
native PCM are included before source/worker admission. The dialog supports
these explicit effect revoices for all nine implemented source profiles. No
additional context is created by the effect pass. Native IR offline processing,
recorded effect gestures/causal voice sends, graph-wide state cuts, remaining
DSP/content/world features and all deferred acceptance still remain. No runtime
unit/browser/PCM/performance/listening tests or content builds ran.

The latest repository refresh adds #1259–#1263 to the inventory (296 known
issues). Next correctness work is the held-out exemplar/report contradiction,
shared WALK read/action accounting, per-endpoint solver surface bindings, and
finite multi-entrance birth/minimap-death lifecycle ownership. Their reported
producer/consumer paths are reviewed before further new DSP work.

Committed interval admission now checks future overlaps and lease extensions
across native, sample and worklet voices, with separate live/cue source and tail
quotas. Atomic host-side lease batches preserve terminal queue capacity. Logical
admission and actual kernel application remain separate receipts. Measured cost
profiles, request-set canonicalization and combined device stress still require
the deferred qualification pass.

Journal verification now admits checkpoint/chunk loading, canonical validation
and hashing through the shared worker owner, using exact new byte/object counts
and explicit legacy bounds. Owned queries now select records in the worker and
retain result/index reservations through reader retirement. Detached replay owns
its checkpoint/page loans through actual source/world retirement. Score projection
and causal-parent views now adopt owned pages and publish retained worker snapshots
with bounded cause links. Sound-only revoice now retains a bounded independent
snapshot with exact source hash, coverage and explicit boundary-state limits;
it preserves captured intent identity without synthesizing attacks or rerunning
physics. Full playback/render integration and acceptance qualification remain.

- [ ] Finish shared background job execution for import, export encoding,
  recovery and asset preparation under the shared worker/memory admission owner.
  Registered import/export/checksum/hash jobs now share admission with exact
  replay and content-coalesced terrain decode/fingerprinting. Active/candidate
  decoded consumers retain independent leases through runtime retirement.
  Combined stress and failure qualification remains deferred with runtime tests.
- [ ] Complete remaining issue contracts in dependency batches, preserving
  authored sound/content, physical semantics and output ownership requirements.
- [ ] After implementation, run deferred unit, real-browser, interruption,
  performance and artifact qualification gates; repair failures and record their
  exact revisions. Keep unsupported hardware/listening evidence explicit.
- [ ] Reconcile every open issue against its complete acceptance requirements
  before closure. No issue is closed merely for adding a schema or fixture.

### Continuation 141 — newest correctness reports (#1259–#1263)

Finite gameplay entrance batches now recheck admission before opening an entrance,
allocating an actor identity or publishing spawn effects. Final non-exit removal
is the only minimap death-marker boundary: drowning, splatting, oh-no, frying,
explosion, missing-action and off-world producers no longer publish duplicate
markers. Explosion markers therefore appear on final removal after its particle
animation; rendering and replay drawing are presentation only.

Solver geometry retains each endpoint index, anchor, snap radius and unresolved
binding. Named spawn/exit graph edges use those bindings exclusively, with an
explicit weighted-distance and stable-ID tie policy; aggregate continuity remains
an any-entrance diagnostic, and route skeletons remain unverified until replay.
Passive WALK proofs debit one local ledger before every unique terrain read or
shared action advance; every caller adds the returned action steps before an
admission early return. Selected holdout successes retain reproducibility and
sensitivity evidence, but explicitly defer independent qualification when no
unseen corpus was declared. The final report and immutable exemplar archive can
complete without relabelling observed worlds or declaring an improvement.

Actual manager/MiniMap/history, solver-island, shared-action budget and survey
coordinator/evidence-store regression fixtures are authored. Their execution and
all runtime/PCM/browser qualification remain deferred until implementation of all
open-issue code. These reports remain open pending complete acceptance evidence.

### Continuation 142 — native-source convolution export (#1012, #1015, #1070, #1155)

Native oscillator/FM/modal/sample causal rendering can now prepare the same native
convolution graph, material pins and normalization used live. One offline context
captures the complete processed owner, selected dry lanes and actual shared node
returns simultaneously; the aggregate native output has at most fifteen stereo
taps beyond the master. No per-lane or per-actor convolution rerender is used.
The encoding worker verifies graph, IR identity/layout, decoded coefficient
hashes, normalization and gain bounds before accepting native processed channels.
It does not run those channels through the graph a second time. Unknown native
algorithmic latency remains null, separately from authored predelay.

IR analysis completes before native execution admission, avoiding nested worker
slot deadlock. Ordinary dry-source renders retain admission-before-allocation.
Native producer completion and graph disconnection/buffer clearing precede IR pin
and storage retirement; unresolved preparation custody keeps reservations held.
The render surface offers Hollow Spring, Stone Courtyard and Crossed Gallery for
native sources and active compatible saved body defaults. This first native
profile supports gain/bus/convolution graphs. Owned-source convolution staging
and graphs mixing convolution with owned delay/nonlinear processors remain to be
implemented; those combinations currently return named refusals before output.

API/codec and source-planning fixtures cover all supported IR layouts and sample
rates, normalization ordering, receipt tampering, simultaneous tap channel order
and material retirement. All execution, real-browser PCM/latency, listening and
performance qualification remain deferred with the rest of the backlog.

### Continuation 143 — owned-source convolution staging (#1012, #1015, #1046, #1155)

All five owned source kernels can now supply complete dry master/lane PCM history
through a separate admitted worker stage. Independent full-plane buffers carry
source/artifact identity, sample rate, frame coverage and byte hashes. Their
computed-result lease remains held while a native body graph verifies and copies
the data. One bounded OfflineAudioContext plays that exact PCM at the same rate,
applies the shared native body, and captures master/dry lanes/returns together.
Hash validation precedes native copying; chunked copies yield to the UI. The
requested crop is applied only after the complete source and body history has
run. Owned source state cuts remain distinct from hidden native convolution state.

The foreground owner now supports native body presets with every realized source,
keeps source PCM and native output loans through their respective producer
retirement, and retains unresolved custody on failure. Final encoding checks the
owned-source worker receipt against the native input hashes and application
revision. No temporary WAV, decode roundtrip, separate lane bounce or additional
live AudioContext is introduced. Native input copies and complete preroll output
are included in preflight alongside IR, source-material and encoding overlap.
Mixed convolution/owned-processor graphs still require their separate adapter.

Direct kernel full-history/crop/state-cut fixtures and staged native API/codec
fixtures are authored. Their execution, real-browser PCM equivalence and all
remaining acceptance qualification stay deferred until all open-issue code is
implemented.

### Continuation 144 — complete mixed native/worklet effect graphs (#1015, #1070, #1155, #1218)

Convolution can now share the actual native graph and OfflineAudioContext with
owned delay, nonlinear and fractional alignment processors. Preparation loads and
connects trusted processors without waiting for an offline render thread that has
not started. Private rendering then verifies each initialization ABI before
publication. Every processor on an output/selected-return path emits a terminal
receipt binding its configuration, contiguous frame-zero history, final padded
quantum, state bytes and zero fault/Panic state. The encoder verifies the complete
processor inventory and those terminal receipts with the IR analysis; a late fault,
missing acknowledgment or mismatched ABI cannot become a published WAV.

Preparation failure retires the private context through a bounded admitted drain,
so module lifetime estimates and processor disposal do not depend on messages from
an unstarted thread. Context closure is explicitly reconciled with the module
cache before storage retirement. Unknown custody retains reservations. Internal
alignment processor identities use a namespace unavailable to authored node IDs.
Owned and native sources use the same complete graph, shared input sum and
simultaneous dry/return taps. Native convolution latency stays unmeasured; no
physical timestamps or scheduling horizons are moved to compensate for it.

An original Tape + Spring rack now combines the existing preamp, dark echo and
one shared Hollow Spring with a restrained fixed blend into the common return.
The live controls and causal revoice selector expose the same authored topology.
Live effect gesture journaling and source-bound throws remain outstanding.

Deferred API fixtures cover readiness emitted only after render start, terminal
receipt omission, late faults, bad ABI and preparation failure cleanup. Terminal
protocol and combined-rack fixtures are authored. No runtime/browser/PCM/listening
or performance qualification has been run during this continuation.


### Continuation 145 — typed envelope/control graph and reactive return ducking (#1163)

Effect ports now distinguish mono/stereo audio, normalized detector envelopes and
linear gain modulation. Invalid casts, ambiguous control fan-in, implicit master
sources and graph cycles fail preparation. Shared detectors can feed independently
configured depth/polarity mappings without making their source audio audible.
Original peak and trailing RMS kernels use fixed reference normalization, linked
stereo energy, bounded preallocated state and explicit amplitude 1/e time constants.
The RMS sum is updated in constant time with compensated arithmetic and exact
silence drain. Mapping uses either linear amplitude or a prepared dB lookup; native
AudioParam modulation and owned offline rendering use the same typed graph.
Followers declare reactive zero-lookahead timing and separate RMS window age.
Kernel snapshots retain window, accumulator, envelope and frame frontier; complete
graph restoration still requires deterministic preroll.

External source activation checks context, owner, generation, tap, channel layout
and an upstream source pin before committing the candidate. Disconnecting a route
feeds zero and releases toward the authored neutral mapping. Source pins remain
owned until graph producer retirement. The existing live owner offers its actual
post-fader upstream bus; arbitrary cross-lane and pre-fader source realization
remain outstanding. Focused rack diagnostics request bounded DSP activity receipts,
separate from the signal-rate modulation clock. The original Quarry Duck recipe
shapes only the echo return from the owner source, preserving its separate dry path.
Live and causal revoice selectors expose the same authored recipe. The parallel
Tape + Spring branch also now attenuates its IR input by the declared body gain
bound, keeping its convex blend within the echo branch headroom.

Step/RMS/time-constant, stereo antiphase, state continuation, typed port rejection,
shared detector, inaudible donor, depth/polarity, missing-input release and candidate
activation isolation fixtures are authored but unrun. Cross-lane bus realization,
true multiband vocoder, live gesture journaling and source-bound throws remain
outstanding. All runtime/browser/PCM/listening/performance qualification remains
deferred until implementation of all open issue code.


### Continuation 146 — terrain undo transaction ordering (#1264)

Terrain replay now applies previous values in exact reverse write order, including
reverse span traversal and the matching reverse color/value offsets. Forward replay
retains original write order. The existing append-only terrain log, cold codec and
bounded scratch/storage policy stay compatible; undo adds no pixel-sized allocation
or per-tick coalescing map. This restores pre-tick collision and RGB values after
overlapping builders, same-value writes, interleaved edits and build-then-dig work.

Authored regression fixtures use real Level, palette, builder and digger producers,
recording and delta application. They compare complete mask/RGBA snapshots through
warm spans, sentinel-backed cold decode, thaw and legacy index logs. Actual
TimeTravelController fixtures rewind, replay and branch from restored ground.
Execution remains deferred with all other acceptance tests as requested.


### Continuation 147 — actual configurable multiband vocoder (#1185, dependency of #1165)

The effect graph now registers a true donor/carrier vocoder with separate typed
inputs, immutable 8/12/16/32-band topology and the original configurable geometric
bank. Defaults span 120–6000 Hz by geometric cell boundaries. Receipts retain every
actual centre, nominal bandwidth, Q, digital coefficient, pole radius and filter
realization. This uses the RBJ constant-zero-dB-peak bandpass equations documented
in the [W3C Audio EQ Cookbook](https://www.w3.org/TR/audio-eq-cookbook/), not the
stock Faust bank with a fixed 12800 Hz upper centre. Nominal bandwidth is named
explicitly; measured digital reconstruction/coloration remains unqualified.

A preallocated binary64 kernel filters mono or linked stereo donor bands and an
independent stereo carrier, then applies signal-rate amplitude 1/e followers and
fixed reference/depth/baseline/per-band gain/sum trim. There is no instantaneous
AGC. Stable complex poles and an analytic absolute impulse-sum bound constrain
filter state and complete summed headroom before admission; nonfinite/excessive
state quarantines the processor. Missing input feeds zero, lets stored filter
energy decay and releases to the authored baseline. Filter phase remains frequency
dependent; the mode is reactive with no lookahead. Typed graph timing aligns the
carrier route without silently delaying the donor to create lookahead.

The same kernel runs inside the actual two-input Worklet and owned offline graph.
Ready receipts compare the resolved bank as well as the immutable configuration;
full-bank coefficients participate in the SHA-256 graph identity. State-cut
compatibility uses a separate explicitly named coefficient fingerprint. Native
mixed-convolution receipts retain and check the bank alongside terminal frame/fault
fences. Kernel snapshots preserve every filter/envelope history; whole graph state
still uses preroll. Graph diagnostics count actual filters and followers, separately
from unmeasured CPU/deadline capacity. Focused inspection distinguishes donor/carrier
availability, levels and envelope activity.

Authored fixtures cover rates/band counts, real owned-graph parity, mono donor order,
linked antiphase energy, spectral band selection, dry preservation, missing donor,
nonfinite containment, topology/state incompatibility and exact state continuation.
They remain unrun. Tools Talk stays unavailable until its resolved 12-band bank,
listening, spectral transfer and device cost are qualified. Live/offline cross-lane
bus realization is the next routing dependency; neither a kernel foundation nor
an unexecuted fixture completes #1185 or #1165 acceptance.


### Continuation 148 — simultaneous causal donor lane realization (#1163, #1185, #1046)

Causal source planning now separates exported dry stems from internal detector lane
taps. The owned source pass captures their bounded union once, feeds preallocated
sidechain samples into the complete shared effect graph, and exports only selected
stems/returns. Missing and connected-silent sources carry different presence bits;
followers and vocoder donor/carrier diagnostics retain that distinction. Stored
filter energy can decay after its input disappears. An explicit stereo-to-mono
operator supports mono donor banks without silently casting typed ports.

Native source renders now execute every selected effect graph in the actual same
OfflineAudioContext, including graphs with only owned processors. Trusted upstream
owner/lane pins activate before native rendering and remain owned through producer
retirement. For owned-source/native-body staging, source PCM carries a separate
exact lane-plane inventory including unexported donors. Native analysis taps receive
those planes without adding another audible lane sum to the already complete master.
The final native channel budget covers selected WAV stems and shared returns, while
source history/copy/transfer preflight accounts for internal donor planes separately.

Receipts record the actual source/tap membership, missing status, same-frame clock
and full-history-before-crop policy. The new sound-only realization has a unity
owner fader, making its declared pre/post owner taps equivalent; historical live
mute/solo and effect gestures are explicitly not recreated. The encoding worker
checks source-plane inventories/hashes, donor membership, native initialization,
terminal fences and the same immutable application build for all native effects.
Live owner/cross-lane pre/post tap realization remains separate outstanding work.

Authored production-kernel fixtures compare full causal renders, dry stems, unexported
donor effects and exact cropped preroll, with no additional semantic onsets. API
staging fixtures check donor planes independent of exported stems, missing sources,
route receipt tampering and resource retirement. Additional typed mono-adapter and
connected-silent/absent source fixtures are authored. All remain unrun, along with
browser, spectral/listening and performance qualification for the complete backlog.


### Continuation 149 — real live owner pre/post-fader taps and epoch replacement (#1163)

Live channels now have an explicit unity source-input node before owner volume,
expression and pan, alongside the existing post-fader/pre-effect input. Classic
preview voices and all nine native/owned instrument producers enter that source
node. Same-owner sidechain pins select the actual requested pre/post tap with the
same context and session generation; master returns and cue destinations cannot
be used as upstream sources. Both taps retain per-voice source envelopes and pan;
owner fader/expression/pan affect only the post tap. Channel resource estimates and
failure/normal retirement include the new native node.

An effect host from an earlier stopped session generation must retire completely
before the next enabled generation prepares another graph. Preparation and source
pins also reject stale session generations. This prevents reusing an old host and
resource epoch after stop/re-enable. API fixtures check both tap connection points,
retained dry routing, source disconnection and subsequent epoch preparation. They
remain unrun. Live cross-lane taps and their owned Worklet producer buses are still
outstanding; this continuation does not claim full #1163 acceptance.


### Consolidated test repair (October 25, 2026)

Pulled the issue branch through `2c956c83`; fetched master was already integrated.
Repaired the integrated runtime contracts in a frontloaded pass, then retested the
failures together before the final full run. Fixes cover independent binary
ownership, bounded worker envelopes, immutable effects, audio admission and
retirement, checkpoint/replay ownership, incoming-session graph restoration,
paired survey identities and resumable evidence, and close fire-bridge followers.
Fixtures now use the current generator/compiler profiles, real paged worker
transport, explicit resource leases and settlement boundaries.

- **Validation:** `npm test` passed all **5,371 tests**, including the runtime-global
  and critical type-check guards; exit status 0. Total runner time was 239.51s,
  above its advisory 180s budget; budget enforcement was not enabled.
- **Static checks:** `npm run format`, whitespace checks and runtime provenance
  verification passed (10 components, 188 files).
- **Focused coverage:** BinaryReader's 17 direct tests passed with 96.18% line
  and 87.95% branch coverage. Further direct unit coverage can exercise duplicate
  lease attachment, invalid logical windows and EOF boundary guards.
- **Acceptance boundary:** This validates the local Node suite, not browser,
  listening, hardware or performance-soak acceptance for the open issue backlog.


### Continuation 150 — live cross-lane native/Worklet source buses (#1163, #1185, #1165)

The refreshed GitHub inventory contains 248 open issues. The remaining code is
being reviewed by shared dependencies, starting with complete live signal routes,
then captured effect performance, dependent sound recipes/scenes and their editing
surfaces. Broad validation is deferred until the remaining development is written.
The existing benchmark receipt, long-session transport and native ADSR repairs
remain in place for their later full acceptance audits.

Live physical rendering now publishes stable resolved lane identities to the
shared audio owner. Each declared donor owns distinct stereo pre/post lane-fader
taps, with no automatic audible destination. Native oscillator/FM/modal/sample
voices register their actual upstream source and post gain/pan nodes. All five
owned Worklet producers expose the same taps from their real shared sample pass,
using fixed output storage and slot-token-qualified routing. No extra source
rendering, semantic onsets, meter polling or UI-rate modulation is introduced.
Pre taps retain source envelopes/pan; post taps additionally include lane gain,
pan, mute and solo. The owner master remains downstream of both lane taps.

At most eight distinct donor lanes can be pinned concurrently across effect
consumers. Staged graphs share a donor; individual voice, source renderer, lane
identity and native bus storage are admitted before allocation. Deleting a lane,
stopping its session or replacing its epoch disconnects the actual producer and
notifies all consumer pins before resource release, so followers decay naturally
to neutral. Unknown retirement preserves reservations. Declared silent lanes stay
connected-silent; undeclared lanes remain missing. Old source processor builds are
rejected by new pinned build identities and the explicit live tap handshake.

API and production-kernel fixtures cover native pre/post isolation, donor sharing,
source deletion, finite capacity, slot reuse and sample-exact stereo sums at
44.1/48/96 kHz. They are authored but deliberately unrun. Browser routing, device
cost and listening acceptance remain deferred; this does not close those gates.


### Continuation 151 — interlocking source recipes and real stereo ring DSP (#1165)

The shared graph now includes a typed two-input bipolar ring processor. Independent
100 Hz highpasses feed two original 2x polyphase FIR input paths, a bounded donor
multiplier and the original FIR decimator. Source order, linked frame clock,
16-frame FIR delay, frequency-dependent highpass phase, fixed drive, L1/output
bounds and conservative memory/tail profiles are explicit. The live two-input
Worklet and owned offline graph use the same binary64 kernel. Both native mixed
graph initialization and terminal receipts check its exact coefficients/config;
full graph identity includes the actual fixed filter realization. Complete CRC-
protected state transfers preserve both input histories, decimator histories,
cursors, source-presence and diagnostic frontiers, with all checks before mutation.

Four original rack recipes now connect actual declared donor/carrier lane taps:
Tools Talk's resolved 12-band 120–6000 Hz bank; Rust Bloom's stereo ring return;
Footstep Air's filtered full-band follower; and a prepared one-way Mirror Breath
swap. Each keeps the original owner dry path, adds a bounded carrier-only return
and emits no semantic onsets. WHO SPEAKS, BITE and AIR use explicit prepared
revisions; MERGE controls the active return. The route panel distinguishes source
connection and latest DSP receipts without a new animation-rate polling loop.
Saved defaults reuse project Undo and existing explicit saved-rack revoice; they
do not silently journal live effect gestures. Master capture remains available.

The rack is reachable from Quarry Echo's Interlocking lanes control. It stages
route changes, supports source swaps, cancellation, bypass/tail clear and scoped
retirement, and rejects self donors before preparing a graph. Empty source taps
remain distinct from unavailable lanes. Processor tap summation is skipped when
no donor is connected. Standalone APIs declare lanes even while the world is
paused so initial preparation cannot permanently bind a false missing source.

Authored fixtures cover all recipes/rates, real ring sidebands and stereo polarity,
unchanged aligned dry output, exact state continuation, invalid/foreign state,
source loss and Panic. Runtime, browser, spectral/listening and cost qualification
remain deliberately deferred with the implementation-first backlog pass.


### Continuation 152 — actual travel-driven comb/flange and bounded cubic delay (#1188, #1211)

The shared delay now offers an explicit third-order four-tap Lagrange realization,
with a two-sample minimum and support beyond its nominal ring bound. Its maximum
interpolation L1 is 1.25. The cubic profile caps feedback at 0.35 and includes the
filter/interpolation absolute bound in graph gain and conservative tail estimates.
Linear interpolation keeps its own declared profile. Jump transitions can reject
busy requests or coalesce exactly one latest target behind the current two taps;
returning to the current target cancels that pending request. State cuts retain
the complete fractional transition/pending frontier. The processor revision is
bumped; neither cubic interpolation nor glide claims alias-free modulation.

Rail Comb and Return Flange are original prepared recipes with 0.8–6 ms and
0.4–8 ms ranges, convex dry/wet mixing, optional explicit polarity inversion,
128–512 world-pixel sweeps, conservative feedback and chosen glide/jump behavior.
Their control reads the existing sustained signed-distance articulation intents
from the canonical travel accumulator. No private distance accumulator, free-running
LFO, additional musical begin or camera-derived motion is introduced. Idle facts
send no repeated control. Reversal/wrap use a smooth spatial curve; discontinuities
end the source binding or require explicit prepared rebind. Source end disarms
motion and holds the last timbre; the owner rack persists until explicit bypass,
replacement or retirement. Known smoothing and admitted delay contents may finish.

The Travel color surface is reachable from Quarry Echo, lists current eligible
physical voices, and stages actor binding together with the real effect graph.
A voice that ends during preparation cannot publish an unattended binding. All
updates retain the exact owner graph token, physical source IDs, signed distance
and the shared source/audio-clock frame. Delivery receipts are API scheduling
evidence and can be captured with the take; static saved-rack revoice does not
claim to replay these gestures. Stop/dispose releases the motion owner, and stale
control retirement cannot bypass another surface's later effect graph.

Authored fixtures exercise cubic impulse weights at 44.1/48/96 kHz, minimum and
maximum taps, repeated/coalesced jumps, mid-transition restore, wrap/reversal,
selected-voice isolation and actual CausalMusicEngine travel intents without extra
notes. They remain unrun. Allpass-notch/through-zero modes, full gesture replay,
browser alias/cost/listening qualification and the remaining issue backlog remain
separate work; no completed acceptance is inferred from this implementation.


### Continuation 153 — travel-driven normalized lattice notches (#1188, #1211)

Hollow Steps now shares the existing actor-travel control owner with comb/flange,
using eight normalized first-order lattice stages per channel, paired at four
frequencies. Every moving scattering matrix preserves input plus stored energy;
feedback is owned, delayed by one sample and capped at .25. The declared gain
bound is an induced L2 energy bound, separately labeled from instantaneous peak
fault containment. Coefficients slew toward real travel-derived frequency targets;
there is no free-running LFO or invented musical attack.

The same processor runs in the Worklet and owned offline graph, with exact
coefficient identity, state transfer, bounded automation, retirement/completion
receipts and Panic. Phase/group delay remains frequency dependent and is not
misrepresented as a compensated fixed delay. The source UI exposes four moving
notches, conservative dry/wet and feedback bounds, and explicit processed polarity.

Fixtures for time-varying energy conservation, static magnitude, mid-modulation
restore and full-graph control were authored but remain unrun. The hard two-second
tail ceiling, notch shape, modulation sidebands, browser cost and listening need
the deferred qualification pass. Through-zero flange uses two strictly causal positive delays around an explicit
4.2 ms creative reference, with a signed relative-delay domain. This reference is
not graph alignment or negative physical latency; neutral bypass restores the
immediate owner dry path. Its route/rate fixture is also deferred. Gesture replay
and other remaining issues are not claimed complete.


### Continuation 154 — owned spectral freeze and Glass Hold (#1134, #1071)

An original prepared radix-2 transform and stereo STFT renderer now support
512/1024/2048 windows with quarter-window hops. Periodic sqrt-Hann analysis and
synthesis use a fixed overlap normalization; zero-padded startup is processed so
an initial impulse is not discarded. The causal overlap-add path declares N
frames of delay. The new preserve-dry graph policy deliberately leaves immediate
dry attacks unaligned; it does not pretend that the spectral path has no delay.

Freeze captures only a complete connected digital source window on the next
global hop after a discrete request. Receipts distinguish warming, pending,
ready, frozen, releasing, source unavailable and captured silence, with the actual
analysis interval. Per-channel instantaneous frequency evolves the held phase;
prepared pitch remap, neighboring-bin blur and high-frequency damping stay
bounded. Captured magnitudes are attenuated using a conservative spectral L1
peak bound, never boosted from silence. This is a bounded-history peak policy,
not a claim that a sustained frozen output has the same total energy as its input.

All transform plans, scratch, spectra, overlap and input rings are allocated at
prepare time and included in the resource profile. Exact state transfer covers
phase, magnitudes, normalization, source availability, hold and overlap frontiers.
The same kernel is wired into live Worklets and complete-graph offline rendering,
including identity/completion receipts, source retirement, bounded hold/thaw and
Panic. A latched state has explicit ownership and a hard hold deadline.

Glass Hold is reachable from Quarry Echo and can select the physical owner or
an actual lane tap. Momentary/latch controls release on their declared gestures;
prepared reconfiguration uses the shared graph transaction. Wet-only audition is
explicit. Save defaults does not save captured spectra: transient material is
marked unavailable after reload, and actual played output can use master capture.
Requested note IDs are not inferred to be contributing PCM provenance. Portable
frozen assets, next-eligible-causal-event gating, Dust Loop/Breath Imprint, live
gesture replay and causal capture attribution remain pending.

Complex transform roundtrip, impulse/noise-like stereo identity at all three
rates/windows, exact mid-hold restore, capture timing, silence/missing source,
maximum hold, dry timing and full-graph fixtures are authored and unrun. Measured
latency/error, browser hop/worst-block cost, pitch/blur quality and listening remain
deferred; this implementation does not close the qualification acceptance.


### Continuation 155 — persistent sparse sympathetic audio bodies (#1135, #1157)

The owned graph now has a shared stereo modal network with at most 64 bodies,
eight modes per body, 512 total modes/edges and degree four. These are hard
construction limits, not qualified real-time capacities. Each mode is a damped
complex rotation. Sparse edges apply a canonical sequence of contractive
identity-to-Givens transforms; no arbitrary feedback matrix or all-pairs crowd
network is generated. The excitation vector is normalized against the maximum
prepared contraction radius, and pickups have bounded norm. Internal finite-state
and energy containment is independent of master limiting. The conservative input
normalization still needs musical level calibration; it is not a listening claim.

COUPLE and DAMP move continuously within that domain. Retune, excitation-body,
pickup and topology edits prepare a new graph; the existing owner retains the
old tail. Native and offline adapters share the same kernel, exact configuration,
receipts and state codec. The codec now optionally carries bounded exact immutable
configuration bytes outside its fixed header, so large body topologies cannot
alias a small state identity or overflow the transfer header. Existing layouts
without configuration bytes keep their previous layout. Canonical UTF-8 encoding
also runs without DOM encoding globals, allowing the same identities to be
constructed in the Worklet realm; Unicode equivalence fixtures remain deferred. Body energy is inspected
only on demand and is explicitly modeled audio energy, not terrain deformation.

String Trellis, Metal Constellation and Undertone Basin expose three original
sparse topologies, prepared TOUCH/TUNE, direct versus sympathetic pickup audition,
and actual owner/lane excitation taps through the Shared bodies surface. Basin
coupling is explicitly fundamental-mode-only, not mislabeled as a lowpass filter.
Actual source PCM excites persistent state; actor end stops that excitation while
body memory can ring. No new semantic onset or physical intervention is emitted.
Terrain anchors, per-contact preparation slots, admitted body-command ancestry,
and the Resonance Terrarium proof scene remain pending integrations.

Decay/contraction, superposition, stereo polarity, exact/foreign state restore,
full-graph input, invalid coupling and 8/32/64-body construction/accounting fixtures
are authored and unrun. Those sizes are comparison fixtures, not measured deadline
or memory acceptance. Device benchmarks, macro level matching and listening remain
in the deferred qualification pass.


### Continuation 156 — sidechain publication and bounded tail input gates (#1015, #1163)

Live sidechain inputs now start at zero in the prepared graph, and the owner arm
output stays zero throughout asynchronous source activation. The commit boundary
opens sidechain and owner input ramps together. Donor audio cannot become audible
merely because a staged lane pin connects before the route is published.

A retiring graph ramps its sidechain input to zero along with owner input, rather
than abruptly severing a donor during ring/vocoder processing. Pins remain owned
until the admitted tail producer retires; Panic and disposal still detach them.
Diagnostics label evaluated API gate values separately from rendered evidence.
The standalone graph activation API retains explicit immediate activation, while
the host selects silent staging. A deferred fixture holds activation across an
asynchronous boundary and checks silent candidate output, exact gate ordering,
old-tail ownership and complete resource release. Runtime validation remains
postponed with the rest of the development backlog.

The committed graph also receives a lifetime distinct from its preparation UI
token. Finishing a dialog request or beginning a later revision no longer makes
the active/retiring graph's native control predicate stale. Candidate validity
still gates publication, and owner/context validity still gates the committed
lifetime. Publication schedules the candidate gates before retiring the previous
arm so a rejected candidate gate does not unnecessarily cut the working graph.
A second deferred fixture covers completed UI tokens, later requests, live
controls, retained old tails and final owner retirement.


### Continuation 157 — captured effect commands and bounded owned revoice (#1070, #1046, #1071, #1188)

Actual graph publications, accepted parameter commands and lifecycle requests now
enter the existing causal take's sink-outcome records. They retain immutable graph
identity, owner-route revision, per-stream sequence, actual context rate/frame and
an existing source-intent/audio-clock anchor. Physical travel controls also retain
their contributing fact IDs; a manual gesture does not invent physical ancestry.
Clock rebases invalidate stale anchors. Capture/append failures mark effect-history
coverage gaps rather than silently qualifying an incomplete gesture performance.
The default capture profile is physical-basic-v12; other profiles must explicitly
include this state kind. No competing recorder or transport was introduced.

The render surface can explicitly choose captured FX commands independently of
static authored defaults. It reconstructs one unchanged owned graph from cleared
initial memory, projects original audio-frame deltas through captured intent time,
preserves same-frame command order and recreates the owner's input/sidechain fade.
Source and return taps are still taken simultaneously from the full graph. The
source journal remains immutable; its separate command-plan hash is bound in both
main-thread and worker preflight and checked again before artifact publication.
All parameter domains are validated before allocating the output PCM. Analysis
frame origin is retained for the spectral kernel's global hop grid.

This is API-command revoice, not exact live PCM/DSP reconstruction. Graph swaps,
in-range mute/bypass/Panic/stop, missing clock anchors, native convolution and
native-source command revoice explicitly fail this first profile. Spectral requests
can be replayed, but original source readiness and the actual captured window are
not reconstructed from API submission alone. Preexisting effect memory is cleared;
master capture remains the actual digital-output evidence. Dry stems remain source
dry; owner gates and creative dry scaling belong to the complete master. These
limits are visible before render rather than replaced by a silent static fallback.

Fixtures for clock/rate projection, original-history immutability, preparation
silence, owner fades, same-frame replacement, domain preflight, coverage/route
rejection and actual take-journal-to-WAV host integration are authored and unrun.
Runtime/browser/audio qualification remains deferred. Voice-scoped throws, full
multi-graph/lifecycle replay and portable captured spectral assets remain pending.


The integration also closes an owner-stop hole exposed by latched effects: a
session now retires all of its effect producers even when another owner keeps the
shared context running. All route-arm outputs mute before asynchronous disposal.
Re-enabling an owner waits for that producer retirement; complete retirement
restores its dry path, and unresolved retirement retains accounting and blocks
reuse. Other owners remain independent. A deferred lifecycle fixture covers a
latched producer, concurrent owner, pending acknowledgement and rapid re-enable.
Effect command construction is skipped when no causal take is recording.


### Continuation 158 — selected causal-voice throws and overlapping source taps (#1070, #1163, #1046)

Quarry can now prepare THROW for an immutable selection of admitted causal voice
IDs/generations, independently of owner-sum sends. Same-lane unrelated voices and
later onsets are excluded. The dry owner path stays intact. Pre/post lane taps are
explicit; post-fader is the initial selection policy. Saved defaults remain owner
sum, while transient selections and command history belong to the performance.
Quarry controls retain the prepared route token so an old surface cannot perform
a replacement rack. Initially unadmitted or entirely ended selections fail preparation before replacing
the current rack; release closes new send input and retains admitted echo memory.

Native oscillator/FM/modal and sample voices can feed overlapping lane/selection
buses. Worklet routing uses bounded token-fenced bitmasks, accumulating all taps
in the same source pass. A routing acknowledgement barrier, emitted after the actual source render quantum,
precedes source pin publication, preventing a reused output slot from exposing its previous routing.
Cancellation/retirement settles that barrier; bookkeeping is bounded per producer
and bus. Ended kernel routes release their idle rendering cost without clearing a
new slot token. Source routing protocol/build identities are bumped explicitly.

Offline owned rendering captures lane and selected-voice sums simultaneously,
with at most sixteen combined source taps. Selections preserve exact semantic
voice/generation identity and do not fall back to the owner mix when absent.
Native-source/native-convolution selected-source export remains explicitly
unavailable in this adapter; live native throws are independent of that limit.
The causal engine exposes a bounded small voice view so source inspection does
not clone full travel, motif, encounter and checkpoint state.

Source bus memory estimates now include bounded fan-in connection overhead and
producer routing/barrier metadata. Same-lane isolation, overlapping native pins,
source retirement/acknowledgement, immutable selection validation, actual offline
selection taps, multi-mask PCM invariance at three rates and ended-token cost
fixtures are authored and unrun. Browser routing latency, full source/export
matrices, correlated gain, click behavior and listening remain in the deferred
qualification pass.

Captured lane performance inventories now resolve physical source indices into
stable project IDs at each recorded onset, including covered lane reorders.
Revoice carries a separate bounded routing timeline derived from the existing
instrument-performance journal; semantic intents remain unchanged. Live and
rendered cross-excitation therefore address the same donor IDs. Missing coverage,
conflicting indices and unbound onsets reject explicitly. Legacy takes without
an inventory retain their explicit numeric source namespace and do not guess
stable IDs. Render manifests hash the routing evidence. Fixtures are authored;
runtime validation remains deferred with the broader implementation batch.

### Continuation 159 — pinned scene contracts and candidate ownership (#1097, #1151, #1175)

The scene layer now has an immutable versioned manifest validator, exact-version
registry, bounded metadata pages, user-derived parent/override identities and
future-schema inspection without activation. Physical controls expose units,
ranges and geometry/physical/sound ownership. Complete patch references, world
source/score references, physical observation requirements, paused transport,
landmarks, source credits and authored resource bounds are explicit.

Dependency preflight resolves the complete enabled variant: source, score,
patch definitions, engine artifacts, parameter schemas, assets and observations.
Optional missing material remains distinct from required missing dependencies.
Named approximations require an explicit choice and retain changed-behavior
receipts. Embedded/frozen playable material can remain available while optional
source lineage cannot regenerate it. These are availability/API receipts, never
listening or measured realtime-capacity evidence.

The new candidate loader serializes preparation/retirement, fences selection and
live document/routing identity, retains late canceled resources until confirmed
retirement, and requires complete admission before exposing Apply. Its only
publication policy is a synchronous fenced stopped replacement with a paused,
unarmed receipt; it never implies a seamless transition. Isolated rehearsal is
an optional independently owned adapter, and absence is explicit. Metadata
selection and checks cannot mutate the active world. Final confirmation rechecks
the base, preserving concurrent edits and output choices. Failed retirement stays
charged and blocks replacement; committed state remains distinct from cleanup.

These modules are the shared contract foundation. The boot/world candidate
adapter, installed scene catalog, scene browser/cue integration, authored scores,
save/reopen lineage and browser proof paths remain pending; no scene issue is
marked complete by this contract work. Four/eight-lane sparse/medium/dense content,
closure, lineage, future versions, cancellation and base-change fixtures are
authored but unrun. Runtime testing remains deferred until implementation ends.

Boot candidates now construct with deferred presentation: no animation callback,
physical ticking, visibility listener, camera input or canvas resizing is admitted
until explicit publication activation. A candidate cannot resume/step itself while
unpublished, and cancellation does not own the active canvas backing store.
Ordinary runtime creation retains immediate activation. Real-world candidate
fixtures cover paused activation and canceled-candidate canvas preservation;
these join the deferred runtime batch. Long-lived staged world leases and the
scene-specific publication adapter remain the next integration step.

### Continuation 160 — real staged score worlds and initial scene browser (#1097, #1151, #1048)

Boot now exposes one owned, unadvanced world candidate with a synchronous guarded
publication method. The same path serves ordinary startup/replacement and scene
loading. Prepared scene worlds retain their world budget until either handoff or
confirmed retirement; cancellation cannot activate their renderer or clock.
Sound-only lane aliases no longer choose staged terrain families: explicit world
theme IDs select terrain. Fresh score starts ignore prior cumulative distances.

The initial installed catalog contains two original Crossing Corridors scores
(four/eight lanes), pinned to the executing immutable build, one exact original
sine definition and the real committed crossing observation. Per-corridor gates
use new sorted source-lane selectors; unrelated corridors no longer trigger each
other's mappings. Held sources leaving declared lanes end explicitly. This adds
physical music source revision 7. These are initial crossing scores, not stand-ins
for the six larger named scene-content issues.

The actual adapter compiles pinned patches against bound engine descriptors,
admits the combined shared source pools, prepares the real world through boot,
and configures its physical authoring before returning a candidate. The initial
adapter handles local, asset-free original variants; sampled material, external
routing variants and named score substitutions require their own preparation
adapters and fail explicitly. Audio contexts remain gesture-enabled. Publication
adopts one new document, resets its clock/history, preserves the immutable scene
origin and leaves transport paused. Saved projects retain the complete starting
manifest/recipe alongside their independent current world checkpoint. Reopening
checks exact origin hashes and executing build instead of silently reinterpreting
an old score on a new source version.

A lazy Scenes drawer now uses bounded metadata pages, mechanism/density/lesson
filters, keyboard selection, physical landmarks, requirement/source details,
explicit Prepare/Load/Cancel and the existing saved-project entry point. Selection
never loads a world. Source-unbound builds remain inspectably unavailable. Load
uses the existing final unsaved-edit confirmation and rechecks document/routing
identity afterward. Active capture/history/world operations block scene admission.
The initial UI explicitly leaves isolated rehearsal and starting-world thumbnails
unavailable; authored approximations, cue/stage transitions, derived-scene export,
more score content and full first-use/browser/reopen proof paths remain pending.

Installed-catalog closure, origin round-trip/build mismatch, real world/patch
preparation, lane-isolated crossings and held-source transfer fixtures are
written, not run. All runtime validation remains in the final combined pass.

### Continuation 161 — protected stage surface and one prepared NEXT owner (#1175)

Stage mode now collapses file controls, structural world controls, step cells and
the deep inspector while retaining the world, lane mix, performance controls and
explicit Play/Pause/Stop/Panic. A compact CURRENT/NEXT strip names the candidate,
preparation state and stopped-replacement policy. GO consumes the existing scene
loader; it cannot create a second scene, note clock or transition. The browser can
retain a ready candidate for the visible stage cue; ordinary close/cancellation
retires it. Exit stage releases that preparation and restores the previous chrome.
No scene automatically resumes after GO.

Command and edit guards reject structural history/file/world/sound/routing changes
while stage is active, including global legacy regeneration shortcuts before they
mutate settings or suspend output. Mix/macros, actual release/junction performance,
recording controls, camera, Stop/Panic and cleanup remain deliberate operations.
Prepared-base readiness now includes actual transport and output identity; UI GO
is disabled after the base changes, before publication. Capture/world/history
admission rules still apply. Stage view state is presentation-local and is never
silently restored from a saved project's UI data.

Policy, cleanup, stale-base readiness and paused-GO fixtures are authored and
unrun. Isolated rehearsal, measured seamless transitions and browser/accessibility
qualification remain pending; no crossfade animation implies continuity. This
implements the stopped-replacement policy only, with explicit unavailable paths
for absent preview/transition adapters.

### Continuation 162 — bounded observed sample cursor (#1130, #1224)

Advanced owned sample playback now has a source/output-frame cursor contract and
preallocated segment owner. Original-source endpoints convert through the pinned
decoder rate. Explicit output-frame intervals retain reversals, gaps and seek
boundaries; a full queue rejects rather than discarding an unrendered turn. No
future motion is extrapolated and no private cumulative travel state is created.
Linear or named zero-endpoint smoothstep interpolation preserves exact segment
endpoints, with derivative admission including smoothstep's 1.5 peak factor.

Prepared stop/wrap/reflect policies are distinct. Reflection uses decoded sample
centers; wrap preserves fractional positions at the seam. At rest or after source
coverage ends, the cursor holds and its gain fades to zero over an authored
5–20ms bound. Explicit seeks expose a bounded two-head mix to the future reader.
Reset reuses storage. State cuts retain the queue, actual position, rest/seek
frontiers and immutable bank/map/rate identity, with validation before mutation.

Cursor and source-rate fixtures are written and unrun. This is a renderer
component, not a second physical mapper or a completed sampler. The bandlimited
reader, sample-map capability extension, actual Worklet source, release children,
shared source/PCM admission, capture/offline wiring and canonical travel adapter
remain the next implementation span. Spectral, seam, browser and listening
qualification remains deferred with all other runtime validation.

### Continuation 163 — prepared bandlimited sample reader (#1130, #1024)

The next sampler component is an original 128-tap Blackman-windowed sinc reader,
with 128 phase intervals and nineteen logarithmic rate rows. Convex phase/rate
interpolation avoids per-sample coefficient allocation. Each selected rate pair
uses a conservative next-row cutoff for read derivatives up to four decoded
frames/output frame. Finite-window alias rejection remains a measured gate, not
a consequence assumed solely from the nominal cutoff. The primary interpolation
foundation is [Julius O. Smith's windowed-sinc discussion](https://dsprelated.com/freebooks/pasp/Windowed_Sinc_Interpolation.html);
no third-party implementation is imported.

The existing fixed-bank worker prepares the coefficients cooperatively, verifies
the generated byte hash, and admits the larger startup/copy footprint. Coefficients
use a 2^-24 grid with exact row DC repair; this is a coefficient representation,
not a 24-bit audio-quality claim. Build-time identity generation records the exact
coefficient L1 bound (2.392466902732849) and 1,254,912-byte table. Render reads have
no mutable filter history or extra physical lookahead: they access immutable sound
material only. Stereo shares the same coefficients and explicit integer PCM guard
regions; clamp/zero/wrap/reflect edge fetches are bounded. Fractional logical loop
coordinates and seam crossfades remain the sample-source owner's job.

The bank identity was generated as development data. Table/DC, fractional-phase,
stereo, guard and high-tone alias fixtures are authored but unrun. Actual Worklet
sample-source/release layering, sample-map capability publication, aggregate PCM
ownership, travel wiring and live/offline integration remain in progress. No
real-time voice capacity or listening quality is claimed by these components.

The cursor also rejects an explicit seek that would overlap an already admitted
seek fade. This bounds the future source to two simultaneous read heads without
silently replacing one still contributing to the output. Continuous observed
segments remain admissible through that fade, and the seek frontier is included
in state validation. The fixed-bank result bound includes metadata overhead as
well as the larger coefficient plane.

### Continuation 164 — bounded multi-asset PCM sets (#1130, #1133, #1162)

Advanced sample voices now have a shared multi-asset preparation owner. Up to
thirty-two exact assets fit within one sixteen-MiB decoded-plane cap across attack,
loop and release sources. Exact aliases deduplicate; conflicting variants reject
before copying. Stable sorted asset indices and aggregate metadata/PCM identities
bind the complete set, while each existing bank retains its verified source-rate,
channel and PCM evidence. No per-actor PCM copy is introduced.

Processor-copy loans share the existing bounded bank ownership path. Ready readers
retain every source through Set discard, pending copies cancel coherently, and
complete retirement is required before releasing aggregate metadata. Partial or
unknown copy/consumer retirement retains accounting and blocks new set copies.
A shared strict descriptor contract now serves individual and aggregate offline
verification; actual plane storage and cross-asset aliases are checked before
hashing, while stereo channels may share their own bank's contiguous buffer.

Deduplication, stereo ownership, aggregate admission, later-bank cancellation,
reader quiescence and tamper fixtures are written and unrun. Source-map selection,
release-layer commands, actual sample Worklet registration and travel/render
integration remain the next span. Runtime validation remains deferred.


### Continuation 165 — carried donor routing at the audio frame (#1058, #1163, #1080)

A carried voice now schedules its destination source lane alongside its fader
control, even when both lanes have identical gain and pan. The original renderer,
voice identity, articulation and selected-voice donor membership remain owned by
the onset. Native routes use charged, bounded pairs of pre/post gain gates with
an eight-millisecond causal fade. Late donor attachment observes the same actual
scheduled curves. Old gates retire against AudioContext time, with at most eight
retained lane paths and sixteen future automation points per voice/path. Routing
failure invalidates every dependent donor graph before retaining unknown custody.

Owned sources use stable lane tokens, independent of the eight reusable live tap
slots. A scheduled MIX control applies the new identity only at its target render
frame. Selected-voice membership stays on the control port, while lane tokens and
actual fade state live in the fixed kernel owner. Retired/reused tap slots cannot
redirect future transfers into unrelated donors. Tokens never recycle within the
audio owner; metadata is charged in blocks, with a 4096-identity lifetime cap and
an explicit refusal requiring a fresh owner at exhaustion. Runtime build identities,
routing protocol, state ABI and declared typed storage advance together. Snapshot
storage includes pending onset identities and in-flight fades without changing the
existing source voice stride.

Causal revoice resolves stable lanes at original onsets and explicit transfer
intents only. Inventory reorder does not move held sources. The same owned pass
renders dry lanes and selected-voice groups with convex transfer weights, including
state cuts inside a fade. Native offline rendering shares the actual source-bus
owner and native voice backend, with a separate bounded native-only tap inventory;
master audio remains one direct source sum. Transfer commands are disclosed as
derived realization controls and do not add musical onsets. Overlapping fades
refuse explicitly instead of allocating a third active lane basis.

Frame-boundary, identical-fader, stale-slot, selected-group, late native attachment,
pruning, offline native no-retrigger, reorder and state-cut fixtures are written.
They remain unrun with the rest of the frontloaded development pass. This closes
a source-routing implementation gap; it is not an acoustic, browser, performance
or complete backlog qualification claim. Sample-engine integration follows.


### Continuation 166 — advanced maps through the existing sample content owner (#1130, #1133, #1224)

The existing immutable sample-map schema now has an explicit owned renderer
profile. It declares forward, reverse or position-driven source traversal, bounded
loop crossfades and linear/equal-power seam gain laws. Position policies name
stop/wrap/reflect, interpolation, observed derivative admission, rest/seek slew
and wrap seams. The native-forward profile retains its previous normalized render
identity and rejects advanced maps rather than dropping unsupported fields.
Patch activation checks the actual engine capability; archived display metadata
can inspect the supported owned profile without granting playback capability.

Owned map preparation consumes the same deterministic semantic-onset selector
and verified aggregate PCM metadata. Fractional original-to-decoded region and
loop endpoints stay explicit; integer filter guards are separate. Attack and
release assets resolve together, with pitch/rate limits checked for both before
onset publication. Position-driven playback explicitly gives varispeed pitch to
observed cursor derivative; note pitch selects the authored zone, and independent
pitch offsets refuse. No release or cursor observation reselects an attack.

Prepared loop metadata declares a fixed-period symmetric edge-held seam policy;
a crossfade does not silently shorten the authored loop period. Actual sample
rendering of this policy remains the next implementation step. Two logical voices,
two layers, up to four read heads per voice and preallocated thirty-two-segment
cursor pools have declared storage bounds, not a qualified real-time capacity.
Preparation does not copy PCM or advance selection. Native compatibility, gain-law
identity, frame conversion, selected release rates, position policy and unsupported
read-domain fixtures are authored and unrun. The actual sample Worklet, shared
backend/offline integration and travel mapper remain in development.


### Continuation 167 — pooled sample layers on the shared kernel (#1130, #1224, #1079)

The owned sampler now has a real source and processor kernel on the existing
command heap, voice identity, source-tap and display infrastructure. It reads
shared private PCM through the prepared sinc bank, preserves fractional forward
and reverse playheads, and uses fixed-period symmetric edge-held seam heads with
an explicit gain law. Sustain-loop release waits for a seam-safe exit instead of
changing an active crossfade abruptly. The conservative peak policy covers
correlated seam heads and simultaneous attack/release layers; mono sources use
equal-power pan and stereo/mixed sources use the existing stereo-balance policy.
No resampling quality or native timbre equivalence is inferred from that bound.

Position cursors use preallocated views into fixed queue/scalar planes. Segment
admission has a pure preflight path and field-based application; reading a sample
does not allocate a loop policy or a cursor command. Settled rests skip source
reads and output zero. Seeks use one held old head alongside at most two current
seam heads; a release child keeps the total at four. Continuous pitch changes
preserve source phase. Position-driven pitch remains tied to committed source
coordinate derivative.

A release-trigger sample is a child of its original logical voice and selected
map entry. Its own envelope survives the parent envelope reaching zero. Child
velocity, region, source-rate conversion and frame deadline remain explicit;
generation cancellation and Panic fade all layers without spawning another
release. The common kernel now lets such sources own their envelope completion
while retaining the existing gate, command and retirement evidence. Cancellation
release lengths also normalize to integer output frames before state capture.

Source cuts contain all pooled cursor planes, actual playheads, layer envelopes,
future controls and the exact prepared map configuration. Verification checks
configuration, source/PCM identities, cursor domains and shared gate ancestry
before staging any mutation; immutable PCM and filter coefficients stay shared.
Forward/reverse period, child lifetime, position reversal/rest, cancellation,
same-pitch ownership and complete state-cut fixtures are authored and unrun.
The processor is implemented, but engine catalog publication, live preparation,
sample-map onset commands, offline fixtures and canonical travel integration are
still pending. It is deliberately not yet advertised as an available sampler.


### Continuation 168 — prepared sampler ownership and processor retirement (#1130, #1079, #1162)

The shared Worklet backend can now prepare the pooled sampler from a complete
multi-asset PCM set and the existing sample-map selector. A ready processor must
report the exact map/PCM/filter identity and support explicit state retirement.
Changing the prepared map or decoded material requires another renderer. Every
required asset and both selected layer pitch domains are checked before onset
publication. Per-onset selection, source-frame derivative and release ownership
have an owned-source receipt rather than a native-API label. Runtime metadata and
maximum configuration storage are charged before processor allocation; source
heap estimates now participate in the shared runtime reservation.

The same voice accepts bounded position segments through execution and routed
backend handles. Host and processor share one pure segment admission rule, retain
future coverage/reversal/seek frontiers and reject overlap or excessive derivative
before enqueue. A later processor refusal faults the source owner instead of
silently continuing an obsolete path. Four-second release-child admission is
clipped by the existing voice interval. Same-kit choke controls use a forced
all-layer fade and never trigger another release; same-frame losers are silent.
Explicit semantic release remains distinct from preview cleanup and Panic.

A shared ownership audit found that native node disconnect alone did not confirm
private PCM retirement. Current processors now drop their DSP/source graph in a
fenced control-port operation, acknowledge the completed state release and return
false from subsequent processing. Runtime reservations wait for that receipt or
confirmed AudioContext closure. Missing or malformed acknowledgement retains the
concrete producer and unknown accounting. Pending retirement is distinct from a
failed retirement, including fault/dispose bookkeeping. Existing native disconnect
evidence is retained for legacy API doubles, not promoted into measured acoustic
or browser-resident-memory evidence.

Preparation, missing/changed material, release tails, exact kit choke, position
control, processor reference release, closure and unknown-retirement fixtures are
written and unrun. Formatting/lint and provenance are the only checks in this
frontloaded pass. The sampler remains absent from the public engine catalog and
fixed offline adapter until material/audition/render and canonical travel wiring
are complete. No new real-time capacity, listening or clean-CI claim is made.


Lane-mix failure cleanup now carries an explicit force flag through native and
owned backend ends. It can shorten an existing release and stop every child
without treating cleanup as another semantic release. Native choke rebuilding
retains that force policy. Source-forced release has its own kernel reason code,
so its receipt is not mislabeled as Panic. Matching active-child cleanup fixtures
are authored for both renderers and remain unrun.


### Continuation 169 — shared sampler auditions and offline planning (#1130, #1162, #1058)

The owned sampler now has a pinned two-slot engine descriptor, lane preparation,
complete multi-asset source material, authored gesture controls and a fixed WAV
adapter. Live and offline auditions resolve the same immutable onset identity and
map selection. Forward/reverse loops, source-rate conversion, selected release
children and fractional-region reading use the same processor. Position auditions
carry a clearly labeled authored outbound/return source-frame program; they do not
claim canonical physical traversal. Public capability metadata distinguishes the
advanced renderer from the existing native forward-only sample profile.

Offline causal planning counts full release/choke tails against the physical pool
while enforcing the patch's logical gate limit separately. Forced choke events
stop every owned layer without triggering another release. Finished custom-source
slots retire before commands at the exact reuse frame. Captured lane inventories
include explicit carried-voice transfers, and pitch updates preflight both selected
reader domains. Position-driven causal export still refuses absent canonical
travel binding instead of producing an unexplained silent cursor.

Source material preflight charges the complete decoded PCM aggregate before
decoding; render loans verify the exact asset inventory. Isolated auditions admit
a four-second maximum child tail and retain actual kernel-end evidence separately
from command application. Their selection receipts now include the actual asset
and stable selection seed. Stereo Float32 WAV writing has a shared bounded encoder.

Multi-rate forward/reverse/position control exports, deterministic selection,
original release ownership and exact frame reuse fixtures are authored and unrun.
Only formatting/lint and source provenance checks accompany this development
batch. Listening, spectral/capacity qualification, the full suite and CI remain
deferred until the remaining development backlog is implemented.


### Continuation 170 — canonical physical source-position traversal (#1224, #1115, #1130)

Travel intents retain immutable observations from the canonical accumulator:
world/actor/generation, scope instance, metric/orientation, evidence precision,
world origin, before/after coordinates and discontinuity/direction epochs. Held
voices publish observed rests without beginning another note. Actor-journey
identity continues across action changes; contact/action scopes retain their
existing explicit lifecycle. Physical music interpretation advances to revision 8
and the capture profile to physical-basic-v13 so old histories are not silently
promoted into newly covered travel evidence.

Position-driven sample regions may bind an authored traversal recipe to an exact
physical mapping. Tape footpath consumes canonical signed-axis distance; one-way
rubbing requires unsigned contact-path distance. Precision requirements, source
frame/pixel units, origin offset, read-rate bound and end-at-discontinuity policy
are explicit. Unsupported route coordinates and pitch-preserving glass traversal
remain unavailable rather than borrowing another coordinate meaning or claiming
stretch qualification. The existing sample-map owner retains asset selection.

The shared planner maps only completed observations. Ordered writes in one tick
occupy equal subspans of that observed tick duration beginning at its audio commit
target; this is labeled interpolation, not measured intra-tick timing. There is
no future-distance extrapolation or second cumulative distance clock. Real
reversals remain separate segments. Scope/epoch/source-coordinate/output coverage
checks prevent accidental jumps, overlap and unsupported read speeds.

Live onset admission includes the initial cursor segment in the same processor
command, and routed/execution-owned updates use the same planner as causal export.
Normal release follows already admitted completed travel. A forced choke cancels
future controls for that exact slot/token and ends every layer; it does not create
a release articulation. Finishing a segment exactly at release retains its true
endpoint. Position auditions remain an explicitly authored control program, with
physical evidence reserved for the canonical adapter.

Authored fixtures cover outbound/rest/return across walking/fall/landing, scope
reset, absent contact/precision, ordered reversal within a tick, output-rate units,
live owner continuity and identical forward/state-cut offline rendering. These
fixtures are unrun. Only source formatting/lint, syntax and provenance checks have
been performed; acoustic, listening, spectral and real-time qualification await
the consolidated acceptance pass after the remaining development work.


### Continuation 171 — actual sampler state inspection (#1130)

Sampler tools can request one deduplicated, request-fenced processor snapshot.
The response identifies its completed output frame, prepared PCM/map, selected
zone and asset, original-rate region, nominal note ratio, actual decoded read
derivative, unwrapped source cursor, loop activity/turns and the original release
child. The main owner verifies frame/asset/range bounds and projects only bounded
metadata; PCM and coefficient planes never enter UI state.

Timeout, wrong producer/request identity and renderer retirement cannot publish
a stale response as current state. Disposing the owner rejects a pending read.
The retained diagnostic remains labeled processor state at its reported frame,
not acoustic output. Actual child-state and pending-read retirement fixtures are
authored and unrun; broad runtime validation remains deferred.


### Continuation 172 — travel-owned circular spectra on the additive core (#1226, #1202)

The existing spectral Worklet has an octave-circular additive mode, rather than a
separate timer or playback engine. Its resolved recipe separates the frequency
lattice reference (55 Hz by default) from the Gaussian amplitude-envelope center
(700 Hz), declares width as log-frequency standard deviation, caps the authored
band below 0.4 of the output sample rate and reserves eight to ten fixed slots
including silent recycling guards. Period ratios other than exactly two are
rejected by content validation and runtime preflight. Original phase policy and
amplitude normalization are explicit; perceptual endlessness is not asserted.

Canonical signed-axis observations determine unwrapped cycle phase from origin
and pixels/cycle. Scope, mapping, evidence precision, discontinuity epoch and
completed-tick interpolation are fenced. Journey phase survives ordinary action
changes; an action-scoped patch resets only at its authored instance. A rest holds
distance phase while an observed owned gate may sustain its current tone. Reverse
travel uses floor-based negative phase, not JavaScript negative remainder. Live
and offline updates use one planner and one shared execution owner. Normal release
follows the final admitted observation; rejected source controls fault their owner.

The spectral source prepares circular views and oscillator slots before onsets.
In-band carrier phases survive octave reindexing; only silent outer guards are
recycled. Sine lookup is shared with the existing additive renderer, and control
weights refresh at a bounded interval with convex amplitude interpolation and a
declared 0.8 L1 bound. Source cuts retain the unwrapped phase/frontier, integer
lattice state, carrier phases, gains and resolved recipe planes. Restore validates
these before changing the shared gate and rehydrates only active source caches.

Original Endless Stair, Counter-walk and explicit action-scope instrument recipes
are available through the existing content collection. CLIMB, WINDOW, CENTER and
WEIGHT are onset controls, with their units and scope visible. Typed compilation
advances to v12 for octave/cycle/count quantities while preserving prior archived
artifact admission. Directed-route coordinates, non-octave variants, contact-only
stepping-stone realization and the authored Impossible Staircase world remain
separate pending integrations.

Frequency/reference, Gaussian-width, negative phase, wrap handoff, ten-second rest,
forward/return, all three output rates, peak bounds, actual kernel state cuts,
original content and canonical causal-render fixtures are authored and unrun.
Formatting/syntax/provenance are the only current checks. Spectral seams, measured
render cost, listening direction/ambiguity and browser acceptance remain deferred.
Primary historical foundation: [Shepard (1964), original-paper scan](https://www.brainmusic.org/MBB91%20Webpage/Pitch_I_Shepard.pdf).


### Continuation 173 — immutable sound-seed window foundation (#1154, #1164, #1170)

Owned master captures, individual causal render files and frozen seeds now share
a bounded source-window reader. It checks the original WAV inventory and exact
embedded manifest, copies only the selected PCM region, admits one original
reader at a time and awaits its retirement before publishing a private window.
Streamed captures yield between bounded chunks. Reader cancellation and unknown
retirement retain concrete ownership and resource accounting.

The shared background worker analyzes stereo min/max envelopes at bounded
resolutions, raw/baked peak and RMS, clipping, silence and channel correlation.
Only explicit edge fades change samples; no normalization, pitch inference or
silence removal is implicit. Exact frame/rate and parent-manifest identities,
printed effects and at most sixteen ancestry links are embedded in a new Float32
WAV. Missing captured frames remain labeled missing through nested trimming; a
fully baked seed can play without retaining its original take. Regeneration and
playback prerequisites are separate.

The latest-generation analysis owner retains the previous candidate on failure,
serializes source replacement, fences stale worker results, and retires workers,
input windows, artifacts and waveform reservations in dependency order. Asset,
compile, audition and durability readiness remain independent. Each rendered
file now exposes its actual immutable manifest for harvesting a selected stem or
return rather than substituting the bundle manifest.

Impulse, streamed sole-reader, stereo anti-phase, clipping, gap propagation,
nested-source and resource-retirement fixtures are authored and unrun. The compact
editor, seed recipe compiler and project application integration are the next
dependent work. Only formatting, syntax and provenance checks accompany this
development batch.


### Continuation 174 — harvest dock, seed recipes and fixed-rate playback (#1154, #1164, #1170)

Completed captures and individual revoice files can open a compact dock beneath
the world. The selected source identifies LIVE CAPTURE/OFFLINE REVOICE, exact tap,
original frame count/rate and immutable source reference. Numeric trim/fade fields,
separate touch/keyboard handles, single-frame nudges, cached stereo min/max plots,
frame/time rulers and bounded zoom share the original frame domain. Optional
low-amplitude edge-crossing suggestions show their displacement and require an
explicit edit followed by a new freeze. Hollow ancestry marks distinguish old
material from the next actor's semantic onset. Missing/unknown coverage, silence,
clipping and stereo correlation stay separate from preparation failures.

Hammer seed and explicitly named recorded Route relic compile to the existing
owned sampler. Unpitched now means actual fixed source-rate playback in attack,
release, live/offline selection and processor diagnostics, with no inferred root.
Pitched zones retain explicit varispeed limits. A voice-owned one-pole tone filter
uses semantic onset velocity, independently of output gain, with bounded cutoff
and terminal fade. BODY, EDGE and DAMP are onset macros. Source state retains and
validates filter histories. The sampler runtime advances to owned-sample-v4-fixed-rate;
the command width and shared voice stride are unchanged.

Ice dust uses the existing actor-owned granular source with declared 65 ms grains,
16 Hz density, bounded 40–90 ms/8–24 Hz macros and observed horizontal world
position controlling source position. Its current renderer requires a declared
root; the UI precisely refuses Unpitched Ice dust while keeping sampler recipes
available. Completed motion causes now retain measured positionXWorldPixels;
instrumentPerformance identity advances to 4 and capture profile to
physical-basic-v14. Old captures are not relabeled as containing this field.

Each seed pack contains its verified WAV plus a deterministic, hashed recipe with
pitch declaration, printed processing and bounded ancestry. Raw ancestors are
regeneration evidence rather than required playback assets. Original WAV annotation
and recipe/frame inventory are compared before staging. Compilation uses the
shared bound worker; normal content verification, isolated foreground audition,
IndexedDB commit and undoable lane selection are reused. Asset, patch, audition
and durable readiness are independent. Failed storage preserves inspectable and
exportable in-memory material; failed or canceled preparation preserves the old
patch. The default recipe adds no creative effect graph and flags printed effects
for destination-send review.

Audition has an explicit one-pass or three-pass choice with an eight-second sample
window per pass. Stop, Escape, dock close, Panic and page suspension cancel the
owned preview. A trim/recipe revision fences stale results and prevents applying
an older patch. Disposal retires previews before stages, seed readers before
capture/render owners, and preserves accounting on unknown retirement.

Recipe identity/closure, fixed-rate attack/release, sampler filter, stale compile,
private pack verification and retirement fixtures are authored and unrun. No
runtime suite, listening, browser layout, touch, storage reload or end-to-end
onset-count qualification is claimed. BODY FIT/COMPONENTS, derived rebuilds and
advanced warp remain subsequent dependent work.


### Continuation 175 — linked stereo component analysis (#1178, #1170)

The same seed dock now has a COMPONENTS page with three aligned cached stereo
waveform strips. A bounded shared-worker job computes linked root-mean-channel
spectral magnitudes, temporal/frequency median estimates and real soft masks over
the unchanged complex phase of both channels. The original first-party FFT is
reused at 512/1024/2048 points, quarter-window hops and periodic square-root Hann
analysis/synthesis. A second spectral pass avoids retaining all complex planes.
Each job has explicit matrix/frame/memory limits, cooperative progress and
latest-draft cancellation. No Python or external runtime dependency is shipped.

Transient-like and sustained-like Float32 components preserve source alignment;
the residual is their actual time-domain complement. A separate neutral
recombination artifact and measured maximum/RMS/relative error accompany the exact
window, padding, crop, mask margin and linked-stereo recipe. Every component embeds
its parent asset/manifest identity, frame domain, printed effects and algorithm
revision. These are estimates, not isolated miners, instruments or physical modes.
Low reconstruction error does not qualify perceptual separation.

Selecting original, a component or neutral recombination feeds the same recipe,
compile, isolated audition, durable installation and undoable lane application
path. An additional dry material comparison uses the existing native source-rate
prelisten adapter, capped at eight seconds. Its receipt cannot satisfy instrument
control-audition readiness. Foreground prelisten serializes these comparisons.
The derived owner keeps last-good artifacts on failure, retires accepted workers
before source windows, and keeps component readers before waveform/accounting
release. Trim changes visibly invalidate derived readiness.

Silence, impulse, sustained tone, mixed attack, stereo anti-phase, neutral
reconstruction, cancellation, quota bounds, source-rate comparison and ownership
fixtures are authored and unrun. Formatting and syntax checks only. Creative
simultaneous sample/granular/modal child graphs, saved per-component revoicing,
modal estimation and browser/listening acceptance remain dependent work.
Reference algorithm context: [librosa 0.11.0 HPSS documentation](https://librosa.org/doc/0.11.0/generated/librosa.decompose.hpss.html);
this is an original bounded implementation, not a measured oracle match.


### Continuation 176 — inspectable body-fit baseline and modal recipe (#1177, #1170)

BODY FIT now runs in the same bounded shared-worker/source-window ownership path.
It begins with linked stereo Hann spectral peaks, refines frequency using local
phase tracks, fits amplitude log-decay, and solves stereo damped cosine/sine
coefficients. Growing, insufficient, out-of-range or poorly exponential tracks
are declined. Confidence remains a baseline estimate; clipping, observed fraction
of amplitude T60 and minimum observation-limited mode separation are explicit.
Silence can produce a declined estimate with an unchanged residual rather than
invented modes. Root pitch, material, geometry and impact force are not inferred.

The original FFT supports up to 65536 points only behind an explicit offline
maximum; ordinary worklet construction still admits only 512/1024/2048. Observed
frames and zero padding are separate receipt fields. The dock plots the actual
linked source spectrum and estimated frequency marks, exposes exact frequency and
T60 edits plus Pin/Remove/Merge, and refits saved choices under a new generation.
Pinned modes survive automatic refinement of the remaining candidates. Spectrum,
waveform and mode rows refresh on analysis changes rather than scanning PCM on
presentation frames; rebuilt mode rows release their old listeners.

Stereo phase-preserving reconstruction and its actual Float32 residual become
independent immutable seed artifacts with original frame alignment and ancestry.
Model RMS error is reported separately from neutral complement error. The common
foreground dry-material comparison can audition either material after staging;
its receipt does not mark a new instrument ready. Failed/stale fitting keeps the
last-good artifacts and ordinary sampler/granular use available.

A Found body recipe compiles selected estimates to the existing native modal
engine with a separately declared reference pitch. Exact fit/selection receipts
and the original frozen material remain in the content pack. New excitation is
explicitly an approximation; the original stereo phases remain analysis evidence.
The renderer's frequency-ratio and 2.5-second T60 limits reject unsupported modes
before replacing a lane, without silent clamping. There are no extra semantic
onsets for the fitted oscillator children.

Known decays/phase, close-mode observation limits, padding, silence, growth,
clipping, pinned/manual edits, stale cancellation and modal recipe fixtures are
authored and unrun. No estimator accuracy, listening, performance-grid, production
browser or Found Bell end-to-end qualification is claimed. Composite creative
exciter/body graphs, richer body engines and lineage rebuild coordination remain
subsequent development.
Research context: [Lagrange and Scherrer, DAFx 2008](https://dafx.de/paper-archive/2008/papers/dafx08_21.pdf)
and [Sirdey et al., DAFx 2011](https://www.dafx.de/paper-archive/2011/Papers/61_e.pdf).
The shipped baseline is original code and is not an implementation or validation
of their higher-resolution estimators.


### Continuation 177 — explicit selected seed-lineage rebuild (#1236)

Offering another revoice file to an occupied seed dock no longer replaces the
current frozen material implicitly. Keep recorded material, independent harvest
and a reviewed derived-branch plan are distinct choices. The plan binds the exact
original take/revision/semantic hash, old/new resolved patch receipts, source rate,
timeline origin, tap, complete parent frame range, fades and selected component/
modal/recipe closure. Current captures retain their original source patch receipt
in seed ancestry. Older origins lacking it remain playable and report regeneration
unknown rather than acquiring fabricated provenance.

Preflight reports missing prerequisites, unsupported realization and unknown
coverage separately. A changed tail cannot silently shorten a selected region;
a changed take, rate, origin or tap requires explicit new material/coordinates.
Captured master PCM cannot masquerade as a covered semantic revoice. The selected
DAG is bounded and cycle-checked; effective recipes and patch receipts contribute
to the plan hash. Numerical reproducibility across builds remains unqualified.

Preparation reuses the owned source-window, worker analysis, component, modal,
content verification and isolated installation owners in dependency order. Only
affected selected stages run. Original asset nodes, existing project references
and other projects are never deleted or rewritten. A new branch gets new artifact
hashes, exact analysis ancestry and its own compiled pack. Its waveform, changed
hashes, staged patch and target freshness are visible beside the kept material.
Audition, durable save and one undoable lane Apply remain explicit separate actions.
Document, selected lane, project revision and lab/source revision fence publication
and Apply. New source offers cancel old in-flight preparation.

Failed/canceled preparation retains the original seed and previous complete branch.
Retirement releases auditions before stages, modal before component parents and
workers before input windows. Unknown retirement retains concrete owners and blocks
further mutation. Durable material is kept if later project application fails.

Matching-input plan identity, unchanged old material, changed source/tail/rate/tap,
missing old patch receipt, missing component closure, isolated branch preparation,
stale target, corrupted plan and reservation cleanup fixtures are authored and
unrun. The integrated closure currently covers a direct revoice window, its
components, fitted bodies and current ordinary recipes. Arbitrary imported DAGs,
qualified warp/graft descendants, reinterpretation/reperformance coordination and
shared two-project storage/browser acceptance remain subsequent work.


### Continuation 178 — finite audio exciter into an actor-owned body (#1216, #1233)

The existing owned sampler now optionally feeds a private 1–8 mode linear body.
This is an actual audio-excitation path: silent PCM leaves every mode at zero.
Detector envelopes, parameter modulation and sealed feedback ports reject the
finite-audio template. A typed graft descriptor retains exact exciter/body/pickup
references, declared calibration, articulation, cost dimensions and capability
requirements. It compiles to an ordinary sampler patch, not a cable-graph runtime.

Each modal state contracts by a damped complex rotation. Injection coefficients
sqrt(1-r²)/sqrt(declared input energy), a measured cumulative stereo-input cap and
an L1-bounded signed observation bound the state/output independently of master
protection. Coefficients prepare at onset; the audio loop has no allocation or
trigonometric/table construction. The input has 20 Hz DC blocking, declared finite
support and a terminal drive fade. Calibration overflow caps the last injection,
stops further drive and retains a processor diagnostic; the dry path stays under
its own source envelope. This is normalized audio calibration, not physical force.

A body tail continues after the sample gate/release and ends under its explicit
four-second/owner deadline or forced fade. Both states remain on one logical
source and reuse the existing physical pool/tail admission. Same-pitch actors own
independent modal/DC/calibration state. Normal release preserves resonance;
choke, Stop and Panic clear only the owned body. Loops, reverse/position-driven
excitation and release-trigger layers are unavailable in this finite template.
Independent bends reject rather than retuning a ringing body silently.

Original tin/wood modal body components and a reviewed fitted body can receive a
frozen seed. Exciter playback stays fixed-rate while the body has a separately
declared root. EXCITE, BODY, DAMP and MIX map to real onset parameters with their
equations visible in three compact EXCITER → BODY → PICKUP/MIX slots. Signed A/B
pickup weights are authored observation maps, not spatial geometry. Replacements
are next-onset-only; existing voices keep their prepared bodies. The same recipe,
isolated cue, save/Apply and selected lineage-rebuild paths are reused.

Sampler state storage expands to 144 scalars per slot, within its unchanged
40-field command width and shared logical voice stride. Source cuts bind the exact
body profile and validate radius, rotation, injection, observation, finite support,
control and calibration state before mutation. Render cost includes modal count;
byte reservations include the enlarged source plane. Live/offline control and
causal renders retain the independent body tail budget. Current runtime becomes
owned-sample-v5-feedforward-body with source configuration v3.

Silent/excited input, tail ownership, calibration overflow, same-pitch isolation,
forced cleanup, register rejection, complete state restore, typed-port rejection
and normal compiled recipes have authored, unrun fixtures. Formatting/syntax and
provenance only. Peak/decay/listening/device-grid qualification remains deferred.
Continuous travel excitation, shared prepared surfaces, sealed reed/bow outer-body
templates and their nursery scene remain subsequent work; they are not relabeled
as supported by this finite-strike adapter.
Context: [Bilbao, Ducceschi and Webb, DAFx 2019](https://dafx.de/paper-archive/2019/DAFx2019_paper_22.pdf)
motivates explicit treatment of nonlinear feedback. This original feed-forward
contraction does not implement that paper's nonlinear mechanical network.


### Continuation 179 — contact-coordinate circular stepping stones (#1226)

Circular spectra now have an explicit contact-coordinate mode alongside continuous
canonical travel. A completed ContactSpanBegan support anchor or ContactResolved
actor position projects a bounded immutable observation with world/generation,
actor, mapping/graph revision, source event/sequence, contact instance and source
tick. Support-cell coordinates and actor positions at a resolved contact have
distinct labels. Partial/stale/missing observations cannot become valid contact
pitch, and old captures are not promoted to containing these coordinates.

A new onset samples the declared world axis, origin and pixels/cycle exactly once.
Its one-frame constant phase segment adds no interpolated travel, timer ascent or
extra semantic trigger. Negative phase uses the same floor-based lattice as the
continuous adapter. The existing kernel, command width, partial pool and live/
offline/state-cut paths are reused. Authored control auditions remain explicitly
nonphysical and need no invented contact.

The original Stepping stones recipe uses percussive envelopes and actual observed
contact coordinates. It is available through the circular collection, now content
version 0.2.0. Source/library and render summaries distinguish contact onsets from
continuous signed-axis observations. Runtime becomes owned-spectrum-v8-contact-coordinate;
physicalMusic is 9 and capture profile physical-basic-v15.

Negative contact phase, identity/coverage rejection, source event ancestry and
one-contact/one-onset revoice fixtures are authored and unrun; existing collection
fixtures now expect the additional recipe. Formatting/syntax and provenance only.
Directed-route coordinates, authored Impossible Staircase geometry and listening/
spectral/browser acceptance remain pending independent integrations.


### Continuation 180 — owned rectangular audio membrane foundation (#1210)

An original centered-time, five-point finite-difference membrane is now an owned
shared graph processor in both the live Worklet and offline kernel. The initial
8/16-site interior grids have a one-cell fixed-zero Dirichlet halo. Lossless
fundamental tuning derives lambda-squared from the discrete minimum eigenvalue;
the actual two-dimensional Courant bound is enforced at <= .49, below .5.
Positive centered velocity loss has separate prepared long/short amplitude T60
coefficients. DAMP slews their positive interpolation; tuning/grid changes prepare
a new graph and retain the old body's independently owned tail.

The discrete energy is half the squared time difference plus half lambda-squared
times the cross-time edge-gradient product. The strict Courant domain makes it
positive. Bilinear excitation has L1 one and L2 <= one. Before each nonzero
injection, an energy-norm triangle bound caps admitted force against the remaining
unit energy budget. This is independent of output protection; cap counts remain
visible. The positive energy lower bound derives a conservative displacement and
pickup peak bound. Nonfinite/excess energy clears and quarantines only this body
in live/owned graphs; a faulty offline render still cannot publish a clean receipt.

Three Float64 wave planes and controls allocate at preparation, with no per-sample
allocation or coefficient construction. Independent strike and left/right pickup
coordinates use normalized interior-grid units, not meters/Newtons. Stereo input
is explicitly (L+R)/2, including anti-phase cancellation. Moving a pickup changes
observation only. The full plane rotation, wave history, smoothing targets, energy,
frame and fault state transfer under exact rate/configuration identity. Graph-level
restoration continues to use deterministic preroll. Cost includes grid updates,
energy edges and update rate, with up to four prepared bodies plus host overlap.

Quarry effects now expose a compact Rectangular skin surface: actual excitation
bus, prepared grid/tuning/T60/return and independent live coordinate/loss controls.
Inspection requests decimated 8x8 modeled-audio displacement and actual energy at
the existing four-Hz maximum; it never drives DSP stepping or terrain deformation.
Saved defaults reuse the normal rack; captured controls and causal revoice use the
existing shared clock/receipt path. The authored rectangle explicitly has no
terrain topology binding yet.

Sine-mode independent reference, symmetry, small-signal superposition, positive
loss, boundary zeros, observation-only movement, internal excitation caps, state
restore, unsupported masks and 8/16-grid with 1/4-body cost fixtures are authored
and unrun. No dispersion/deadline/listening/browser qualification is claimed.
Mapped/admitted contact excitation, terrain revision binding, independent held
preparation owners and proof scenes remain subsequent work for #1210/#1215.
Research context: [Fontana and Rocchesso](https://arxiv.org/abs/cs/0101003)
discusses geometry-dependent wave-mesh dispersion. This original finite-difference
implementation does not copy or claim qualification of the Faust mesh.

Static API review also corrected travel-effect reservation retirement to call the
owned reservation release method, including source end and disposal paths.


### Continuation 181 — localized loss preparation for shared skins (#1210, #1215)

The rectangular body now has four distinct touch slots in its existing typed
control adapter. Each patch contributes a normalized parabolic-disc loss field;
the deterministic maximum combines overlapping patches. Positive centered-velocity
loss changes the wave field locally, rather than multiplying the output gain or
adding excitation. The field slews over eight milliseconds. Moving/releasing a
patch cannot restore dissipated energy. A patch too small to reach any grid site
is declined before mutation; coarse-grid silence is not called successful damping.

Touch targets are sample-frame AudioParams, with Float32 targets shared by owned
rendering. Constant blocks avoid per-frame field rebuilding; changing targets
rebuild the preallocated target field once per sample at most. Current/target
fields, exact touch slots and smoothing state join the actual source cut. Cost and
byte admissions include the additional fields and worst-case target rebuild work.
The worklet tolerates Float32 representation of the admitted radius endpoints,
then retains canonical endpoints rather than quarantining legal .08/.18 controls.

The skin view exposes two explicitly authored manual touch slots alongside
independent strike and pickup coordinates. Preparing another graph resets those
manual slots to released, and inspection projects actual backend touch state.
These controls are not relabeled as physical contact owners. Contact-span bindings,
map/topology revisions, old-tail rebinding and lesson/world integration remain the
next mapping/ownership work. Runtime becomes owned-dirichlet-membrane-fd5-prepared-loss-v2.

Local field support, two-slot independent release, no silent-source excitation,
monotone energy while moving/releasing a patch, exact field-state restore and
underresolved/Float32 endpoint fixtures are authored and unrun. This adds a
loss-only preparation mechanism; compliant contacts, rattles and mass attachments
remain unavailable. Formatting/syntax/provenance only; all runtime qualification
is still deferred with the rest of the development pass.


### Continuation 182 — mapped preparation commands and retained body ownership (#1210, #1215, #1233)

Prepared surfaces are now a validated optional physical-graph feature. Named
world-to-normalized maps retain authored region-instance, source-edit and bound
terrain revisions. Loss-only touch and independent left/right pickup mappings
consume actual completed support spans, source lanes/actions and source facts
inside the existing causal music engine. They emit a separate bounded command
stream, not note begins, child voices or a second UI collision mapper. The same
semantic score timeline supplies command time; stationary observations refresh
continuity, while unknown coverage, action/actor/contact loss and map changes
release owned preparations. No camera or presentation clock supplies coordinates.

The audio adapter binds an explicitly selected current membrane to document,
physical execution/world/generation, surface/map, owner route, graph hash, node
and processor revisions. An immutable bodyInstanceId hashes that identity. One
DSP node cannot masquerade as multiple surface bodies. Four touch slots and one
pickup owner per side admit independently; touch slots project to existing positive
loss parameters, and pickup end retains its last observation without adding energy.
Unchanged observations avoid repeated native automation writes. Admission and
submission remain separate from applied/acoustic evidence.

The existing graph host now addresses a retained body by its original route/hash,
with its actual old-tail deadline. The supported cutover is keep-old-tail: held
contacts remain on their exact old body, while new contacts use an explicitly bound
replacement. Late old-map commands cannot prepare the new body. Physical contact
or actor end closes every matching retained contribution, preserving another
actor's touch. Closed-contact ledgers prevent late updates from resurrecting a
released preparation. Other rebind/both policies are unavailable, not inferred.
Unknown native cleanup retains binding metadata/reservation until actual body
retirement; Stop/document retirement submit owned body clearing.

Physical graph authoring can stage a reviewed rectangular contact map using the
observed terrain revision. The skin surface selects/binds that saved map and
projects CURRENT versus RETAINED TAIL body IDs and actual contact bindings. Manual
touch inputs yield to assigned contact owners. Body-specific quarantine/Panic
leaves unrelated graph branches alive. Message-port body Panic is captured as a
separate operation; command revoice declines it because its applied audio frame
is unknown rather than treating submission time as renderer proof.

Mapped preparation commands and their original ancestry accompany each journal
intent batch without changing musical onset counts. Logical held mapping state
is checkpointed and checked against the physical frontier. Re-performance compares
commands separately, branch recording retains them, and sound-only query explicitly
distinguishes dry source output from captured effect commands. physicalMusic is 10
and the capture profile is physical-basic-v16; older takes acquire no fabricated
preparation coverage. The mapping observer and body metadata have bounded, separate
resource estimates; exact audio body state remains in the existing DSP owner.

Authored unrun fixtures cover stationary/unknown support, mapping state restore,
multiple intentional musical begins beside one preparation, two touch owners over
body replacement, stale maps, independent release, pickup limits, body alias
rejection and unknown retirement accounting. Formatting/syntax/type/provenance
checks are the only validation in this development pass.

Mapped per-source strike coordinates/force envelopes, prepared modal-bar masks,
qualified rebind/both policies, irregular terrain geometry, the Three hands lesson,
spectral/listening/deadline and production-browser acceptance remain subsequent
work. This batch establishes loss/pickup ownership on the fixed rectangle; it does
not claim a qualified shared physical instrument or complete #1210/#1215 acceptance.


### Continuation 183 — canonical directed-route circular spectra (#1226, #1182)

The existing route atlas now retains a stable observed entry ID, previous completed
coordinate/tick and actual last motion source event/sequence. Explicit teleports and
coordinate jumps exceeding the observed movement plus declared projection tolerance
invalidate the route. Qualified data is labeled completed-route-endpoint-projection;
authored versus measured-trace geometry remains visible. Legacy state without a
captured entry is not promoted to canonical directed-route evidence.

The single TravelAccumulator now admits a qualified-route-arc-pixels variant with
actorJourney lifetime, directed-route orientation and a held voice without distance
crossing notes. It consumes the atlas after an actual entry, primes its reference
at the first covered endpoint, and only the last motion fact for each completed
actor tick projects that endpoint. A U path or ordered loop seam can advance route
phase while signed world-X returns to zero. Actual backtracking within qualified
route geometry reverses phase; stationary observed ticks add no distance. Unknown
entry/order, stale/changed geometry, teleport or missing coverage ends the source
instead of bridging a gap. Entry/revision identity and exact endpoint reference
join canonical travel cuts. Route changes participate in mapping dependency fences.

Circular control mode 2 consumes that canonical route evidence through the same
owned partial pool, phase planner, live atomic commands, offline render and source
state-cut path. It requires actorJourney and endpoint precision, retains its exact
route/branch/entry and rejects a segment-precision claim or inconsistent distance
origin. Compiled patches reject unsupported mode/scope/axis combinations before
preview. The original Route staircase recipe joins the circular collection at
version 0.3.0; a physical-graph staging action names the required route articulation.
Source/library/render summaries distinguish route arcs, world axes and sampled
contact coordinates without claiming perceptual endlessness.

The source runtime becomes owned-spectrum-v9-route-coordinate; physicalMusic is 11
and capture profile physical-basic-v17. Route revoice declines older capture
versions. The physical observer memory estimate increases for the retained route
metadata. Its numerical projection is authored route distance, not proof of an
unobserved physical path between coordinate writes.

Controlled atlas/accumulator fixtures cover U-route versus signed-X, a 1024-pixel
ordered loop, observed rest, reversal, complete route-state restore, missing entry,
teleport, foreign branch and segment-precision rejection. A short causal render/
state-cut fixture and old-capture rejection are authored and unrun. Existing content
fixtures now expect five circular recipes. Formatting/syntax/provenance only; no
browser, spectral, listening or render-deadline qualification is claimed.

The Impossible Staircase world, comparison oscillator and visual lesson remain
pending. Reverse traversal through an ambiguous/unqualified loop seam still
ends under the atlas policy; this batch does not infer route orientation there.
Full multi-segment path qualification and broader route-atlas acceptance remain
separate from this completed-endpoint adapter.


### Continuation 184 — finite spatial sources inside persistent bodies (#1210, #1215)

The membrane now accepts four independent fixed-point finite exciters through a
64-command frame-addressed heap. Prepared 4/8/12 ms raised-cosine pulses have unit
sample area; amplitude is normalized model impulse area, not Newtons. Stereo
input and all source forces share one spatial L2 energy admission budget before
injection into the existing wave field. The body, loss preparations and pickups
persist after each source ends. There are no per-actor mesh copies or implicit
restarts. Sample processing uses fixed typed storage without per-sample packets.

The worklet reports queue admission, exact application and exclusive finite-end
frames. Main-thread transport validates entire bounded receipt packets before
releasing command ownership. Malformed evidence or uncertain delivery quarantines
that body and retains its metadata until producer retirement. Offline completion
requires every admitted strike to finish. Native owner routes expose exact body
command submission and observers; old graph tail deadlines now include the last
admitted finite drive. New strikes require the current body, while already queued
sources remain with the retiring body. Owned graph export rejects quarantined or
rejected body branches before artifact publication.

Complete private state cuts include pending heap entries, active pulse cursors,
receipt rings and their frame frontier. Authored fixtures cover spatial
superposition, finite support, queue order/capacity, overlap rejection, panic,
exact transfer and atomic malformed-receipt rejection. A separate capture repair
marks rejected effect capture as a coverage gap for immediate and buffered
outcomes. These fixtures are unrun; only formatting, syntax and provenance checks
are performed during this development pass.

This is the DSP/transport primitive. Physical mapping to finite source intents,
captured body-strike replay and the multi-actor proof scene remain dependent work;
API queue submission alone is never reported as applied acoustic evidence.


### Continuation 185 — observed finite body sources and captured replay (#1210, #1215, #1233)

A validated prepared-body instrument maps a direct ContactSpanBegan or
ContactResolved semantic source to a saved surface ID/revision, one prepared
4/8/12 ms pulse and normalized amplitude. Completed support evidence and matching
terrain/map revisions are required. Resolved-contact terrain revision is retained
only when the complete batch has identical before/after revisions. Unsupported
travel, tonal, feedback and swarm compositions decline rather than silently
retuning a shared body or changing source cardinality. Fixed prepared-body tuning
is explicit; source note pitch does not retune the common field.

The normal causal dispatcher now has an owned prepared-body sink. It resolves the
actual current body, admits finite intervals against four simultaneous exciters,
retains original intent/voice/onset/contact/map/body ancestry and awaits exact DSP
application/end or actual body retirement. One source end releases only its
semantic gate; it cannot erase another actor's shared energy. Stop and execution
replacement clear the owned bodies through their existing host. Metadata and
retirement uncertainty remain bounded/accounted. Two intentionally mapped intents
from one contact stay two sources; mesh sites and finite DSP children add no
semantic begins.

Applied finite commands join the existing effect-performance capture with exact
source-intent audio-frame anchors and processor acknowledgment evidence, without
claiming acoustic output. Captured replay checks unique source ancestry, mapped
revision, amplitude, pulse and exact node, then drives the common owned body at
the projected source frame. Original body-force sources receive no additional dry
oscillator. Explicit new-target source-only revoice remains a distinct operation.
Tail planning includes the final finite support; incomplete histories, overlapping
fifth exciters and malformed acknowledgment evidence decline.

Effect capture now retains at most sixteen pre-anchor graph/control packets in a
separate reservation until the first actual source clock arrives. A changed
context/execution, overflow or retirement without an anchor marks a coverage gap.
Normalization uses mutable local copies only where needed and preserves immutable
input content: membrane Float32 controls, prepared surface sorting and identity
validation no longer try to mutate frozen canonical copies.

The physical graph editor stages observed strike mappings; the existing skin view
explains fixed tuning and shows actual queued/active finite exciters. Runtime
physicalMusic becomes 12 and capture profile physical-basic-v18. Authored fixtures
cover mapping cardinality, stale maps, source/end ownership, capacity, acknowledged
replay without duplicate notes, source-state cuts and pre-anchor capture ownership.
All runtime fixtures remain unrun under the requested frontloaded development
policy. Native browser equivalence, listening, device qualification, compliant
collision/rattle models and the Three Hands proof scene remain pending.


### Continuation 186 — original offline solid-to-modal foundry (#1217)

The original foundry implements constant-strain tetrahedral elasticity with
explicit SI material/scale assumptions, lumped mass, mass whitening and bounded
cyclic Jacobi diagonalization. It verifies positive nonoverlapping volumes,
closed manifold boundary and face connectivity, rejects unused/degenerate inputs,
checks the expected rigid modes, and reports actual residual/orthogonality error.
Angular frequency, damped frequency and amplitude T60 have distinct units; the
analytic decay contract uses ln(1000)/(zeta*omega), addressing the candidate's
reported 2π ambiguity without importing its native solver.

Original bar, slotted plate and asymmetric pebble source generators use curated
excitation vertices and independent pickup directions. Assets retain mesh/source
and solver-build hashes, full signed mass-normalized mode shapes and separate
signed site vectors. Explicit 8/16/32-mode selection ranks the supported curated
site-response residue energy and reports retained numerical salience. Unsupported
or negligible modes are excluded and insufficient tiers decline without fallback.

A bounded offline calibration path renders same-onset signed modal impulses at
all sites using one conservative all-site peak calibration. It writes ordinary
fixed-rate sampler recipes with the complete mesh/material/solver/asset closure;
playback uses existing sample maps, not a live FEM engine. Two fixed shared worker
job kinds expose solve and calibration under normal admission. The standalone
build tool compiles normal sound packs and publishes immutable hash directories
plus an atomic head, retaining last-good output on failure or cancellation.

Authored numerical fixtures cover affine strain energy, symmetric stiffness,
lumped mass, rigid rotation, six rigid modes, modulus scaling, exact angular T60,
malformed/canceled/budgeted sources, forged decay units, selected-site response
and ordinary pack compilation. They are unrun. The build command has also not
been executed. Only formatting/syntax/provenance checks belong to this frontloaded
pass.

This provides the production baseline, not comprehensive #1217 acceptance.
Mesh-refinement qualification (a refined bar is authored), level-matched listening,
render/runtime device measurements, in-app foundry controls and Pocket Foundry's
actual physical-zone proof scene remain pending. Output labels distinguish
algebraic convergence from geometric/acoustic/perceptual qualification.


### Continuation 187 — foundry preparation, prelisten and canonical application (#1217)

A compact foundry dialog now prepares an original solid through one fixed,
128-MiB shared worker operation: geometry validation, eigensolve, all-site
calibration and normal sound compilation. Actual immutable worker build identity
must match the requested solver build. Worker-owned generated buffers use the
existing bounded page transfer path. The main thread constructs original source
data without performing the geometry solve or overlap analysis there.

The generated pack then goes through the existing verified archive reader,
sound-content registry and isolated installation owner. Compilation, selected-site
prelisten and durable installation are separate readiness states. Apply uses the
canonical lane sound transaction/Undo boundary. Explicit shape, tier, rate and
sample duration plus document/project/lane fences prevent a stale candidate from
applying to a changed target. Retained previous material survives failed or
canceled preparation. Active producer or material retirement uncertainty keeps its
concrete reservation and blocks new preparation.

Site auditions use the ordinary sampler articulation and declared finite sample
hold. No physical collision or route is invented for the preview. Close, Escape,
output Stop/Panic and page suspension cancel pending preparation and stop the
foreground cue. Existing stage-command protection also covers the new authoring
action. Readiness and actual solver/source/mode receipts remain visible without
claiming acoustic material or mesh-resolution accuracy.

An additional authored ownership fixture stages a real generated body through API
doubles, rejects stale preparation while retaining the previous pack, requires
independent audition/install before Apply and checks final reservation retirement.
All runtime/UI fixtures and actual worker/browser preparation remain unrun. The
Pocket Foundry physical-zone scene, mesh-refinement qualification and listening/
device measurements remain pending; this UI does not promote those absent gates.


### Continuation 188 — authored selected-mode loss on shared bars (#1215)

The existing persistent modal network now prepares up to four explicit nonnegative
mode-loss masks. Each has a fixed body mode inventory, normalized weights
and additional amplitude-T60 seconds. A smoothed amount multiplies only a prepared
contractive pole factor. Overlap takes the maximum additional pole depth per mode;
release changes future decay without restoring already dissipated energy. Mask
movement adds no excitation and no musical begin. The masks are expressly authored
mode selections, not exact spatial finger damping or inferred material geometry.

Felt Bridge adds one six-mode body with open amplitude T60 2/1.6/1.1/.8/.5/.3
seconds at DAMP=0 and released masks, plus two complementary authored felt masks.
The existing shared-body UI exposes their manual loss amounts, alongside the
actual bus excitation and old-tail preparation policy. Live AudioParams, captured
normal effect controls and owned graph rendering use the same Float32 targets and
8-ms slew. Private state cuts include both active and target mask amounts and
reject changed masks/rates/topology before mutation.

Prepared depths, state planes and scratch factors are charged before allocation;
mode-mask comparisons are computed once per mode/frame and reused by both stereo
branches. Realization hashes bind the prepared pole factors. Runtime revision is
owned-contractive-complex-modal-network-prepared-loss-v2. A faulty shared modal
branch now quarantines locally in live/owned graph processing; export still
requires all branches healthy and cannot publish a silently partial result.

Authored fixtures check the open T60 oracle, selected versus untouched modal loss,
silent preparation, independent mask targets/release, monotonic energy, exact
in-flight slew restoration, foreign-mask rejection and normal graph controls.
They remain unrun. Only formatting/syntax/provenance checks are performed here.
Observed contact ownership for named modal masks, travel-based pickup weighting,
Three Hands/Felt Bridge physical proof lessons and listening/device qualification
remain dependent work; manual controls are never labeled observed contacts.


### Continuation 189 — observed ownership of authored modal masks (#1215, #1233)

Saved prepared surfaces can now map completed supported contacts to named
mode-loss masks. The schema keeps this distinct from a spatial touch radius and
pickup coordinates. The actual owner host inventories which preparation kinds
and masks each current/retained processor exposes. Binding checks the exact
body/map/execution identity, available mask names and released manual targets;
pending future manual automation also prevents an ambiguous handoff. The shared
parameter scheduler exposes a read-only future-event predicate for that fence.

Each source contact retains its own bounded mask contribution. The main-thread
owner computes the maximum amount among actual owners of each mask; releasing a
weaker owner leaves the stronger target unchanged and avoids a redundant native
write. Contact end removes matching contributions across retained bodies while
unrelated actors remain. Held bindings stay with their original prepared body;
new contacts require the explicitly bound current body. Stale old-map updates
cannot change replacement masks. Unknown native scheduling quarantines only the
owned body and retains concrete metadata.

The physical editor stages a reviewed Felt Bridge map using the observed terrain
revision. Shared bodies can bind that saved map and inspect actual contact owners;
manual mask inputs disable while the body has physical ownership. API targets and
actual acoustic evidence remain separate. Mode-loss updates use existing effect
capture and deterministic command preroll. physicalMusic becomes 13 and capture
profile physical-basic-v19. A related capacity fix applies one-pickup-owner
admission to current-observed-contact updates as well as explicit begins.

Authored fixtures cover zero-onset mapping, same-mask aggregation, independent
release, old-tail replacement, stale map rejection, unsupported preparation kinds,
manual/future-automation handoff and the pickup update admission boundary. They
remain unrun; formatting/syntax/provenance and the critical typecheck are the only
checks in this development pass. Named physical lessons, route-driven pickup
weighting, measured spectral contrasts, listening and device qualification remain
pending.


### Continuation 190 — private physical scene rehearsal (#1151, #1187, #1175)

The staged scene candidate lends one cooperatively captured, admitted checkpoint
while remaining at tick zero. Commit declines while a reader is owned; candidate
retirement cancels and joins capture before retiring world assets. A separate
asset-backed inspection world restores that checkpoint, observes every actual
physical batch for six source-clock seconds, and retains bounded causal intents.
Incomplete observations, onset rejection, stale document/source/route identity,
unsupported assets/shared bodies or capacity exhaustion decline the rehearsal.
CURRENT and NEXT are never stepped by that simulation.

One admitted worker renders the pinned lane definitions sequentially and mixes
those actual source realizations with the scene's static gain, stereo pan,
mute and solo values. Each lane retains its exact definition, source trace,
intent and PCM hashes. The single cue WAV reports its new private source,
bounded boundary release and pending independent render/listening qualification;
it is not a historical take or an acoustic receipt. Source copying, the private
world, interpretation, render result and native playback buffer have separate
budget and retirement ownership.

Rendered PCM now has an ordinary cue-session adapter: bounded complete Float32
WAV parsing, PCM digest verification, cooperative native-buffer copying, one
source-quota admission and short explicit edge fades. It participates in shared
foreground audition, source handoff, Stop/Panic, session disposal and unknown
native ownership retention. The chosen monitor route is preserved. Rehearsal on
live output is truthfully included in master capture; a separate-device route
is excluded. Explicit audio and Prelisten setup precede scene rehearsal.
The browser exposes preparation, playback/source details and Stop rehearsal;
normal paused scene publication still uses the existing candidate fence.

The scene audit also fixes canonical normalization trying to mutate a frozen
copy. A shared lightweight background-job contract replaces divergent kernel
and admission lists: shape foundry, seed analysis/decomposition/modal fitting
and scene rehearsal now have actual worker admission and require workers even
when their request envelopes are small. Heavy work cannot silently use the
bounded main-thread fallback.

Ownership, malformed wave, cancellation/fence, private-reader, empty-source
silence and worker-admission fixtures are authored but unrun. Development stays
frontloaded; only formatting, syntax, provenance and limited critical typecheck
checks are used here. Named authored layouts, thumbnails, sampled/shared-body
scene materialization, full browser acceptance and listening/device evidence
remain pending.


### Continuation 191 — independent authored modal pickup observation (#1215, #1233)

Prepared sympathetic networks may now own a bounded two-dimensional table of
signed mode-observation weights with independent left/right positions. Every
grid-point vector must have L2 norm at most one; bilinear convex interpolation
retains that bound without separately normalizing away site-level dynamics.
Changing either observation reads the existing complex state and changes neither
excitation, modal loss nor coupling. Four coordinates slew over eight milliseconds;
all current/target positions transfer through exact state cuts. The audio loop
uses preallocated coefficients and weight scratch, with declared storage and
per-frame operator counts. Pickup movement on an unexcited body stays silent.

Live worklet parameters, native scheduling, deterministic owned rendering and
captured control replay share the same prepared coordinate contract. The exact
network revision, authored table, control targets and field identity participate
in graph preparation and retained-body ownership. A saved surface map can assign
actual complete supported contacts to separate left/right observers; each side
admits one owner, contact end holds its last observation, and old contacts remain
with the original ringing body during replacement. Future manual pickup automation
must finish before physical handoff. No preparation command creates a note.

Felt Bridge now includes an explicit signed x-varying response field, manual left
and right observation controls, renderer-reported position inspection and a staged
observed-contact map. Its y field is deliberately invariant. Both content and UI
label the weights as authored response data, not solved geometric mode shapes.
Manual controls disable under physical ownership; arbitrary networks without a
prepared table decline position controls. The two authored loss masks retain their
independent per-contact maximum aggregation and positive-loss contract.

Fixtures cover unchanged internal state under movement, silence, unit observation
bounds, independent positions, in-flight restoration, foreign-grid rejection,
unsupported tables, future manual automation, pickup owner capacity, retained-body
replacement and hold-last release. They are authored but unrun. Formatting,
syntax/provenance and the limited critical typecheck remain the checks for this
frontloaded development pass. Geometric foundry-derived pickup fields, the complete
Three Hands lesson, measured spectra, listening and device qualification remain
pending.


### Continuation 192 — bounded nested-mesh foundry comparison (#1217, #1239)

Original bar refinement now preserves the exact curated strike/pickup positions;
the finer shoulder had previously moved to another coordinate. The refined source
is revision three. A dedicated fixed comparison profile covers all eight lowest
elastic modes, with declared 5% fine-reference frequency error, mass-weighted MAC
at least 0.9, and a separate near-degenerate-subspace policy. These are authored
numerical tolerances, not measured material, hearing or device-capacity promises.

The comparator verifies both immutable modal artifacts and actual model identity,
scale, material, constraints and source sites. It matches every coarse vertex to
one fine coordinate, requires each fine tetrahedron inside one coarse parent and
checks complete parent-volume coverage. It then reassembles each elastic system
and recomputes full-vector residuals, mass orthogonality and Rayleigh damping;
forged converged metadata plus a recomputed content hash is insufficient. Correlation
uses the common coarse lumped-mass metric. A bounded global one-to-one assignment
handles changed mode ordering; unobservable fine modes are reported explicitly.
Nearly degenerate modes require future subspace comparison and cannot receive an
individual-vector qualification by selecting a favorable basis.

A shared-admission worker performs both real original-source solves and comparison.
The foundry binds the result to its exact existing coarse body, document/draft,
actual worker build, profile and receipt digest. Stale/canceled/unknown producer
outcomes retain the old body and comparison; retained receipt metadata is budgeted
and retired with its stage. UI displays comparison separately from compilation,
audition and durability. It changes no sound, saved pack or resource tier.

`npm run qualify:shape-refinement -- --name=rook` writes content-addressed complete
coarse/fine inputs and a comparison package under dist, with a publication lock,
atomic current-result head and complete cleanup. Out-of-tolerance or inconclusive
results remain inspectable and return nonzero. No foundry pack is installed or
promoted. Exact solver/comparison closures, domain, sites, tolerances, correspondence,
errors and unqualified acoustic/listening/device dimensions remain in the receipt.

Metric, global-assignment, real nested-domain, forged-eigenpair, stale owner and
cancellation fixtures are authored but unrun. Neither the CLI nor the new numerical
fixtures has executed in this frontloaded pass. Only format, syntax, provenance
and limited critical typecheck checks are used. An observed comparison result,
degenerate-subspace support, larger refined shape families, geometric pickup fields,
physical scene lessons and listening/device qualification remain pending.


### Continuation 193 — observed travel audio into private modal bodies (#1216, #1233)

The ordinary owned sampler now supports a second explicit one-way body template:
canonical signed journey travel drives frozen audio into a private modal body.
The existing sample cursor owns direction, reflection, rest, missing coverage and
frame segments. Only actual cursor motion can admit body input; there is no time
oscillator, invented travel accumulator or periodic source. Rest closes the drive
and clears only the exciter DC memory; existing modal state continues its decay.
Semantic end admits the existing bounded four-second body tail. Same-pitch actors
retain separate cursor, DC, calibration, modal and retirement state.

This source uses the sampler reader's verified peak normalization rather than a
fictional finite-energy budget for an indefinitely held gesture. Each modal
injection is (1-r)/(2*sqrt(2)*inputPeak), combining the DC filter's L1 bound of two
with a bounded stereo input. Positive radii contract and the signed L1 pickup
remains bounded. A violated input-peak contract latches further body input off,
retains the tail and reports the fault; the dry path remains independent.
Finite sample grafts retain their energy-capped support policy. Exact cuts include
the actual semantic release frontier and reject another prepared source policy.
No per-sample allocation or extra semantic source is introduced.

Typed descriptors distinguish observed audio, detector and sealed-feedback ports.
The compiler produces an ordinary saved sampler patch with pinned source/body/
observation references, exact traversal binding and EXCITE/BODY/DAMP/MIX macros.
The seed lab selects a committed local sustained signed-axis journey mapping and
an explicit source-frames/world-pixel scale. A physical-editor helper stages that
mapping for review; it does not move actors or start output. New body tuning stays
separate from source varispeed. Original frozen PCM and baked ancestry are retained.
The selected derived rebuild path carries the exact traversal binding into its
separate branch instead of silently replacing the source's physical contract.

Sampler source/profile revisions and its worklet's actual runtime identity advance
together. Fixed footprints, source/voice admission, command transport, cue ownership,
old-tail replacement and offline/state-cut rendering keep their existing owners.
Authored fixtures cover silence without motion, input after the finite-support
window, motion/rest/tail, independent actors, peak violation, exact restored PCM,
typed rejection, canonical mapping and ordinary pack compilation. They remain
unrun. Only formatting, syntax/provenance and limited critical typecheck checks
are used in this development pass. Procedural sand/cloth-to-body variants, sealed
bow/reed outer-body templates, the complete Nursery scene, matched-level spectra,
listening and device qualification remain pending.


### Continuation 194 — explicit component printing and selected rebuilds (#1170, #1178, #1236)

The seed lab now prints creative recombinations of the existing immutable linked
stereo transient/sustained/residual outputs. Explicit branch gain/mute/solo,
transient drive, sustained one-pole lowpass, residual one-pole highpass and output
gain are prepared through a worker-only admitted job. Input checks bind all three
component hashes to one decomposition recipe, original source, rate, generation,
zero delay and exact frame crop. The original frozen PCM remains selectable.
No analysis rerun is required to change only composition controls.

The printed recipe preserves all parent references, processing equations, source
rate, filter terminal state and explicit end crop, normalization policy and
original printed-effect annotation. Actual neutral reconstruction and creative
output difference are reported independently. The new asset is labeled printed
processing with no new semantic onsets; it is not presented as live independent
layers, perceptually isolated sources or an acoustic receipt. The owner joins all
four source-window/producer retirements, preserves previous output on failure and
retains unresolved ownership instead of releasing accounting early. Worker output
transport can transfer the actual seed component and waveform buffers. Seed-window
release now acknowledges synchronously as required by the shared worker service;
returning an async callback previously made otherwise completed preparation retain
an unknown admission lease. The new ownership fixture uses the real paged service
and endpoint with an explicit test-only build identity, rather than bypassing that
release contract in a direct kernel stub.

Selection, fitting, compilation, audition, save and Apply use existing owners.
Edited controls invalidate prepared descendants; Stop, Escape, suspension and
ordered disposal cancel/join the new work. Rebuild plans add the exact selected
composition closure before any fitted body or patch; fitted grafts explicitly
depend on both material and body nodes. New branches preserve original artifacts
and other project references. Cue copy now distinguishes separate-device cue
(excluded from capture) from live-output rehearsal (included).

Neutral PCM equivalence, creative branch equations, filter/mute, mixed-parent and
crop rejection, cancellation, four-reader retirement and composed rebuild-plan
fixtures are authored but unrun. Only formatting, syntax, provenance and limited
critical typecheck checks are used in this development pass. Live Hammer/Cloud,
Bowed Scrap and Hollow Tool layer templates, independent warp qualification,
matched-level/listening/browser/device evidence and the complete combined runtime
validation pass remain pending.


### Continuation 195 — solved bar-edge pickups and common-reference excitation (#1215, #1217)

The original pocket bar now produces an optional shared eight-mode edge field in
the existing admitted foundry worker. It verifies the immutable asset, reassembles
the elastic system and recomputes all retained eigenpair residuals and mass
orthogonality. Four actual connected top-edge vertices supply signed z-displacement
observations. Piecewise-linear edge interpolation uses the existing bounded
bilinear kernel with duplicated y rows: x is edge position, y is explicitly
invariant. A single maximum-L2 pickup reference preserves relative site response.
The field receipt stores actual meter positions, direction, full source/mesh/body/
solver identities, selected modes, normalizations and algebraic evidence, and is
included as a generated-data parent in the normal content pack.

The shared modal network adds an explicit signed excitation vector and common
reference norm. This preserves sign and differences between the three solved
strike sites instead of independently renormalizing each site's response. Its
contractive bound, no per-sample allocation, old-tail ownership, state cuts and
ordinary effect graph owners remain intact. Configuration identity advances to
v4 and includes the complete new input policy. This is normalized complex-mode
audio excitation, not a force-calibrated second-order elastic response. Three
nonnegative squared-site mode masks are labeled positive diagonal approximations,
not full rank-one point-damping operators. Unsupported shapes/refinements or exact
tiers decline without hidden frequency, decay or mode substitutions.

The foundry offers its selected strike to Shared bodies. The UI owns a charged
independent candidate copy, then prepares the actual selected source bus through
the existing graph owner. Its two pickup positions read the same ringing state;
manual loss, observed-contact ownership, Save defaults, Panic and replacement
use existing owners. The foundry pack and shared route remain distinct explicit
actions. Field/candidate storage follows complete or unknown retirement rather
than being released with a still-held reference.

Actual-node projection, common-reference/sign preservation, silent observation,
independent pickup movement with identical modal state, state-cut continuation,
forged-vector rejection, cancellation and normal content-closure fixtures are
authored but unrun. Only format, syntax/provenance and limited critical typecheck
checks are used. Full two-dimensional solved surface fields, physical force/point
loss calibration, refined families, Three Hands and Pocket Foundry performance
lessons, mesh/listening/device qualification and combined runtime validation remain
pending.


### Continuation 196 — authored realization profiles with explicit unknown evidence (#1239, #1131)

Canonical recipe sources can declare bounded realization groups. Profiles bind
actual compiled patches, immutable renderer/schema receipts, definition/render and
normalized effective-input hashes, dimensions and structural cost. They name
required/preserved invariant claims, changed audible properties and fallback
transitions rather than a universal quality number. Alternatives must share the
actual macro-unit, pitch-expression, causal-binding and source articulation/frame/
traversal interface. Cycles, missing recipes, incomplete invariants, unexplained
sound differences and unowned mid-voice/cost-free transitions are rejected. A
next-onset transition explicitly retains and charges the previous source tail.

The optional metadata uses typed-recipes-v13; sources without profile groups
retain v12 output. Pack admission independently rederives profile records from
archived actual patches, rejecting changed hashes/dimensions or imported runtime
qualification claims. Every imported profile remains authored/unqualified for
numerics, listening, device cost and automatic admission. Requested, prepared and
effective admitted identities are separate. Explicit alternative selection asks
the existing patch owner to prepare/apply; metadata never downgrades an active
voice or changes physical timing. Partial exports retain only complete groups so
missing alternatives cannot be advertised as available.

Initial FM, struck-modal, granular-biome and circular-travel content now states
honest single-profile limits, as do generated shape instruments and finite/motion
seed grafts. No cheaper operator, arbitrary first-N mode set, altered spatial
pulse density, per-actor replacement of shared state or reduced circular illusion
is represented as qualified equivalence. The sound library shows selected profile
claims, limits and missing evidence. Fixtures cover actual compiled alternatives,
legacy output, different effective sound, structural mismatch, fallback cycles,
transition/overlap rejection, import tampering and selected export retirement.
They remain unrun. Only format, syntax/provenance and limited critical typecheck
checks are used. Device/rate-scoped measured profiles, source admission/history
integration, pressure boundaries, same-take comparison and listening qualification
remain pending before automatic profile transitions or comprehensive acceptance.


### Continuation 197 — finite practice scores and an actual zero-note control (#1097, #1110, #1151)

The installed score catalog now adds One Foot, One Sound, Space Becomes Rhythm
and Quiet Control when the exact bound owned pluck renderer is available. They
use a visible world-anchored swept pickup and explicit local patch references.
The first score admits one finite entrant; the second admits two attempts with
explicit lane phases at ticks 1 and 13. Actual paths still determine crossing
intervals. Quiet Control starts with paused birth admission and no actors; running
transport/display cannot produce physical crossings or new attacks. Missing pluck
support leaves these scores unavailable and preserves the existing crossing
scores rather than silently changing instruments.

Physical score recipes can pin an initial normalized release gesture. The world
constructor validates and installs it before any cohort exists, without a forged
manual command or a default extra cohort. Later live changes retain the existing
next-cohort intervention path. Finite attempts, capacity misses, generation
invalidation, birth facts and checkpoint continuation keep existing population
owners. Boot installs the same policy before its initial recovery anchor. The
scene adapter checks the exact unspent gesture and empty initial world before
rehearsal or publication; the saved project carries the same authored defaults.
Fresh Load resets an attempt; pickup edits and new performed release gestures
use existing physical authoring. Output and transport remain explicit.

Fixtures cover initial finite/paused releases, exact actual birth ticks, absence
of fabricated requested-command facts, rejection of late initialization, complete
scene preflight, a separate restored checkpoint, genuine crossing intents, no
actor/no-attack control and unchanged original tick-zero state. They are authored
but unrun. Only format, syntax/provenance and limited critical typecheck checks
are used. Installed-terrain/browser audition, the full teach-and-assess owner,
progress persistence, reset/back/skip/reopen journeys, the remaining work/path/
harmony lessons and larger authored physical scenes remain pending.


### Continuation 198 — owned motion-gated procedural material textures (#1179, #1216)

A separate owned texture source now implements sand/cloth/crackle/foam without
sample loops or a time-driven birth oscillator. Complete canonical signed-axis
travel uses the existing bounded coordinate validator and output-frame frontier;
its 128-pixel internal coordinate scale is not a pitch cycle. Scope, actor/world/
generation/mapping, source IDs, precision and coverage stay bound. At rest no new
noise field samples or pulse births are admitted. Reversal revisits actual spatial
cells in the same source. Tiny filter/modal states are flushed at a declared
floor; no per-sample object, timer or buffer allocation is introduced.

The actor-seeded spatial hash supplies jittered bipolar pulses or linearly
interpolated cloth noise. Thirty-two child slots per actor and a shared 32-birth
budget per absolute 128-frame bucket cap work independently of callback size.
Crackle has 1–4 source-owned offspring, 2–12 ms spacing and no births outside the
admitted span. Motion/end cancels children not yet started, including exact-boundary
starts; finite active Hann bursts may finish. Explicit speed/density and offspring
energy references, positive spectral filters and contractive modal injection bound
the signal. Foam uses two Q0.9 bands around 700/1600 Hz with correlated input gain;
its BODY meaning is distinct from sand/cloth/crackle amplitude-T60 control.

The normal owned backend, quota/admission, output routes, generation/epoch/token
commands, Stop/Panic, retirement, display health and causal rendering own this
source. The source footprint includes every pulse/mode/state array; eight actor
slots remain an implementation capacity, not a measured device tier. Eleven
immutable engine artifact profiles now include its actual transitive code. The
compiler and library expose four original ordinary saved recipes with explicit
onset-only GRAIN/DRAG/SHADE/BODY mappings and honest single-profile limits. A fixed
audition/render uses the same kernel with an eight-pixel/40ms authored control
program followed by rest, explicitly not physical evidence. Real use requires a
compatible held canonical travel mapping; no independent note-pitch bend is offered.

The profile explicitly supports semanticResume and rejects exact audio-state
transfer before mutation. Original filter, burst and modal history are not claimed
to survive that resume. Authored fixtures cover stationary silence, source cardinality,
render-block invariance, rest/reverse, independent seeds, absolute bucket/slot
caps, exact-boundary cancellation, canonical ownership rejection, compiled recipes
and the common live/offline control program. They are unrun. Only format, syntax/
provenance and limited critical typecheck checks are used. Physical-scene/browser
integration, measured pulse/spectral/alias/cost evidence, matched-level listening,
Material Ribbon, fitted external-body variants, exact texture state transfer and
sealed bow/reed families remain pending before comprehensive acceptance.


### Continuation 199 — spatial texture → private body grafts (#1216, #1233, #1179)

The owned texture source now has an explicit one-way external-body port. Its
80-scalar onset binds 1–8 positive-decay modal rotations, fixed onset body tuning,
EXCITE, intrinsic BODY T60, DAMP and independent dry/body MIX. Audio input comes
from the actual spatial exciter after its spectral filters, without the original
short material resonator. Only observed motion replenishes the external body;
finite burst/filter dry tails do not sneak excitation across a rest or END.
Signed pickup weights share one maximum-L1 reference. Injection uses the declared
peak bound and (1-r)/(2 sqrt(2)), with 0.4 observation gain; invalid/overflowing
input stops replenishment while existing modal state retains positive decay.
All modes and observation arrays are preallocated and included in source bytes.
No detector envelope or extracted bow/reed feedback port is accepted.

The seed lab exposes all four spatial exciters paired with the original tin/wood
body or a reviewed fitted body. The ordinary compiler, immutable archive,
audition, save, undoable lane apply and exact-target/stale-draft owners handle the
result. Frozen material is body-analysis/regeneration ancestry, never sampled by
this instrument. Fitted frequencies/decays/weights and original hashes remain
visible in the contract. Tin pollen is a named sand/tin starting combination.
The selected source, fitted/composed parents and texture selection also join the
explicit revoice rebuild plan. A failed replacement leaves the original patch.

This tier is next-onset only: existing actors retain their body, coefficients and
observation. The separate four-second linear owned release envelope and final
cutoff are explicit; changing BODY never overwrites intrinsic loss with exciter
support. Live body position, force calibration, exact texture snapshots, shared
world bodies and feedback-family extraction are not claimed. Fixtures cover
motion/rest/end contraction, silent excitation, invalid preparation without
mutation, complete retirement, all four compiled choices, fitted ancestry,
macro equations, bounds and absence of audio sample playback. They are authored
but unrun. Format, syntax/provenance and limited critical type checks are used;
runtime/render/listening/device acceptance and complete nursery/comparison scene
journeys remain deferred with the rest of the development batch.


### Continuation 200 — observed physical practice lessons (#1110, #1097, #1151)

Versioned LessonDefinition content now binds exact installed setup and zero-note
scene hashes, prediction, allowed intervention, expected physical/musical
comparison, separate optional hearing evidence, hints and a fresh zero-tick reset
policy. The installed catalog authors the first two actual practice scenes;
unsupported work/path/harmony and advanced journeys are not substituted with
fictional setups. The scene browser exposes Learn this physical cause only for
those installed definitions.

One small lesson owner observes the existing complete causal batch stream. It
requires a genuinely empty/no-onset control before each attempt, then an explicit
prediction, unchanged baseline and actual source-linked pickup begins after the
allowed physical change. Pickup lessons compare the real geometry; spacing
lessons require both different actual birth intervals and different observed
arrival intervals for new actors. Changed requested settings alone cannot pass.
Arrival comparison is explicitly completed-tick precision. Source IDs must join
current-world MotionCommitted facts and live snapshot actors. Stale documents,
generations, gaps, incomplete batches and unrelated graph/sound changes cannot
produce success. Evidence and receipt sets remain bounded; no tutorial timer,
autoplay, hidden intervention, extra actor or independent sound source is added.

The panel uses existing staged world preparation/publication and paused transport
for explicit empty/setup/reset loads, plus Back/Skip/Close/re-entry. Epoch-fenced
cancellation keeps obsolete prepares and receipts from grading another attempt.
It does not enable local audio, MIDI, recording or any permission. Physical
success, backend acceptance and user-reported hearing remain separate; accepted
intents do not claim rendered PCM or human hearing. Visual evidence is available
without audio. Small versioned progress persists under an independent local key,
never inside musical projects; denied storage leaves a session-only result and
replay still requires new evidence. Closing retains the user's playable world.

Fixtures cover zero control, prediction and actual variation; unrelated/foreign
causes, stale epochs/generations, missing batches, incomplete coverage; requested
spacing without changed physical results; sound-off/rejected/stale receipts;
separate progress reopening/denied storage; exact catalog references and observed
Reset/Back/Skip/Close/re-entry. They are authored but unrun. Runtime/browser,
controller and usability qualification, the remaining three authored lesson
worlds, save/reopen/fossil/memory journeys and genuine human prediction/listening
results remain pending. Only format, syntax/provenance and limited critical type
checks are used during this development pass.


### Continuation 201 — retain texture travel across causal receipts and revoice (#1179, #1111)

The dispatcher now retains the typed textureTravel receipt for owned begin and
canonical travel updates alongside their exact intent, batch, source IDs and
sink epoch. It previously projected only circular/sample travel, discarding this
new source's canonical receipt from live delivery history and take capture.
Revoice manifests now name texture spatial travel and semanticResume explicitly,
without labeling coordinates as circular pitch cycles. Source-specific preflight
and continuity failures use the texture label; circular render metadata remains
unchanged. Authored fixtures cover dispatcher/callback/history retention and an
actual causal-engine movement/rest/reversal sequence rendered as one owned source.
They remain unrun with the combined runtime acceptance pass. Only formatting,
syntax/provenance and limited critical type checks are performed here.


### Continuation 202 — owned texture source-state cut implementation (#1179, #1001, #1045)

The texture kernel now joins the existing owned-source state envelope as a new
kind, rather than implementing a separate checkpoint owner. Its five exact-size
Float64 arrays retain exciter/filter/correlation/cursor state, all modal states,
finite pulses (including actual birth frame), signed observation weights and the
shared absolute-128-frame admission quota. Output scalars, queued parent commands,
release, mix and lane-routing/core ancestry share the existing CRC and exact
artifact/patch/graph pins. This supersedes the semanticResume-only implementation
of continuations 198–201 at the kernel API boundary; arbitrary live-host/audio
checkpoint preservation remains a separate integration and qualification task.

Validation runs before any target mutation. It checks complete storage shapes,
retired zero state, source/core token/epoch/generation/pitch/release frontiers,
contiguous rendered-frame cursor, bounded spatial spans, native coefficient
reconstruction, positive external modal loss/register/injection, signed L1
observation, state energy/peak bounds, finite burst membership/amplitudes and
absolute-frame quota. Bankless original texture state is pinned by the core
artifact and patch identities; no synthetic sample-bank hash is introduced.
The extension preserves older source kinds and their byte layouts. Runtime build
identity advances while the 80-scalar command ABI remains unchanged.

Authored fixtures cover all four exciters at 44.1/48/96 kHz, independent restored
buffers and varied render partitions; queued begin/reverse/end, at-rest/private
body tail, completed retirement, future crackle offspring and preserved quota;
plus valid-checksum forged arity/coefficient/core/quota, wrong identity, corrupt
checksum and aliased/incorrect transfer rejection without target mutation. They
are unrun. Only formatting, syntax/provenance and limited critical type checks
are performed. Profile and manifest text explicitly retain pending PCM/browser
qualification; this implementation does not promote a measured device tier or
cross-browser/listening guarantee.


### Continuation 203 — bounded authored scene terrain compilation (#1097, #1110, #1099)

A versioned initial-source geometry format now describes 1–8 ordered physical
lanes, at most eight 128-pixel chunks per lane, 64–128-pixel lane height and at
most 64 ordered half-open solid/air/steel rectangles per lane. Explicit opaque
packed colors share exact cells with collision and steel; top profiles come
from those same final cells. Initial empty air and ordered clears remain actual
voids, not decorative images over another collision source. This is original
source geometry, not a fake applied intervention or simulated player gesture.

The compiler is registered in the existing worker-only shared admission path.
It checks complete raster/collision/hash peak capacity before allocation, reports
bounded chunk units and supports cancellation/current-source fences. All planes
for all chunks occupy one exact-size transferable buffer. The endpoint transfers
that allocation once; clients create immutable view descriptors over its
independently owned result rather than cloning hundreds of planes. Canonical
layout SHA-256, storage SHA-256, explicit native byte order and exact storage
shape are verified before adoption. Larger hidden backing buffers and foreign
byte-order buffers are rejected. There is no heavy main-thread fallback.

Fixtures cover final solid/steel/raster agreement, ordered air cuts and seams,
source immutability/reproducibility, real geometry hash changes, malformed and
oversized sources, peak denial, chunk-boundary cancellation, corrupt/foreign
identity/byte-order/backing storage and a one-buffer endpoint ownership transfer.
They are authored but unrun. Only formatting, syntax/provenance and limited
critical type checks are used. The next dependency is the actual staged terrain
provider, checkpoint source-profile compatibility and authored lesson/world
layouts; this compiler alone does not yet replace installed world geometry or
qualify the remaining scene/lesson journeys.


### Continuation 204 — staged owned terrain source and checkpoint profile (#1097, #1110, #1045)

The optional initialTerrainLayout score recipe now resolves through an actual
owned ProcgenScoredTerrain provider. Boot compiles its original rectangles in the
shared bound worker before constructing the world, installs exact collision and
raster chunks before any actor/recovery anchor, and retains the complete result
lease for the source lifetime. Dimension/source/byte-integrity checks reject an
unavailable or mismatched candidate without changing the active world. Reopening
a source scene recompiles the exact embedded initial geometry before restoring
its state; it does not replace geometry with an approximate procedural floor.

All terrain query channels use the same immutable compiled planes in the bounded
initial extent. Existing sparse world edits retain their own overlay. Lane seeds
bind explicit installed themes; unknown lanes cannot borrow a different scored
chunk. No procedural physical objects or fine-growth appearance schedule is
inserted inside the initial source. Outside its finite extent the original base
source remains available, with the declared static source/growth policy. The
provider exposes original source/layout/storage hashes and charged typed bytes,
not an invented musical cause or measured performance tier. Geometry hashes also
join physical-authoring/junction source-compatibility checks.

Scored checkpoint assignments use component codec 2, preserving codec 1 for
ordinary terrain. Restore checks the source profile, exact layout hash, actual
lane seeds, theme assignments and original terrain settings before mutating any
world owner. Foreign/future source profiles cannot be restored through ordinary
terrain, and a scored source cannot accept an unrelated ordinary checkpoint.
The existing staged scene adapter verifies the actual bound worker result before
publication. This is optional source support; authored work/path/harmony score
layouts and their complete lesson journeys remain the next development batch.

World teardown now has explicit reader → source → provider dependencies through
the existing retirement scope. A renderer/world failure keeps geometry results,
assets, provider leases and candidate reservations owned. Boot failure cleanup
uses the same path. This fixes the previous concurrent release ordering, which
could return a new source lease while a renderer still owned a read. Producer
retirement and synchronous result-release acknowledgements remain mandatory.

Fixtures cover the production paged worker transport, collision/raster agreement,
source reset/rebinding, unbound/already-canceled preparation, confirmed ordered
read/result/base/provider retirement, false result acknowledgement, unknown
readers, and actual world checkpoint continuation with unchanged target state on
forged settings/seeds/future/plain-source restore. They are authored but unrun.
Only format, syntax/provenance and limited critical type checks are performed;
world/renderer/browser, visual/playability, CPU/heap and recovery qualification
remain deferred to the combined acceptance pass.

Continuation 204 ownership follow-through: top-level world replacement also retains the active-world allocation and provider owners until the complete asynchronous reader/source chain confirms retirement. Unresolved source retirement retains the charge; the outer owner cannot infer completion from a requested Stop. An authored deferred-reader allocation fixture is added with the other pending runtime cases.


### Continuation 205 — complete authored five-lesson development pass

- Added three distinct bounded initial geometry scores: a finite two-entrant
  changed-material work bench, one-entrant direct/stepped junction route, and
  three-entrant formation field. All use the bound-worker source provider and
  start paused with explicit finite releases. The new recipe assist policy is
  manual-only; initial junction definitions are installed before the recovery
  anchor. No scene invents an applied skill or junction command.
- Installed all five versioned lesson manifests on the existing scene owner.
  The advanced observer is read-only and bounded to 16 entrant tracks, 64 manual
  command links and the small assessment records. Work requires a quiet actual
  walking baseline plus two distinct version-2 changed-solid contact operations
  rooted in an accepted manual skill. Route delay requires a current admitted
  junction configuration, a new post-switch entrant, accumulated actual motion
  and a changed observed arrival duration at the unchanged pickup. Formation
  requires changed actual birth/spatial spread and qualified pitch assignment,
  followed by a later onset carrying the changed declared timbre macro.
- Added an explicit work-change policy to causal mappings: solid, appearance or
  attempted contact. Existing mappings retain their behavior when absent. New
  teaching maps select changed solid cells so a repaint cannot masquerade as a
  productive brick. No operation is multiplied into a roll or inferred from SFX.
- The formation field declares ratios 1,9/8,5/4,3/2,5/3 with its 220 Hz reference
  represented at 6900 semantic cents. It uses actual bounded formation assignment;
  BRIGHTNESS is an onset-only typed pluck macro. Sound/physical identity checks,
  backend acceptance and explicit reported hearing remain separate.
- Scored checkpoint assignments now retain the complete bounded original layout
  alongside its digest, allowing independent inspection/rehearsal to compile its
  own owned source. The inspection reader/source/provider dependency chain keeps
  both source results and its outer world reservation charged until confirmed
  retirement. Exact source/settings verification still precedes restoration.
- Authored grouped fixtures cover exact source/catalog/dependency identities,
  manual work/operation phases and solid-versus-appearance filtering, actual
  direct/stepped traversal, changed formation and subsequent macro onset,
  independent checkpoint continuation and invalid/unrelated cause rejection.
  Shared explicit base fixtures do not substitute for installed asset or browser
  qualification; initial source cells use the production worker/compiler.
- Runtime tests/builds/browser/audio/listening/performance and usability sessions
  remain deferred in accordance with the development-first request. The full
  Builder-Miner Workshop, Glass Orbit and other large named scenes, advanced
  learning journeys and their acceptance remain open. Five implemented lesson
  observers do not establish completed issue #1110 acceptance.


### Continuation 206 — retain and reconstruct acknowledged spectral windows

- Added typed processor capture metadata with actual observed request frame,
  exclusive N-frame interval, profile/grid/rate identity, monotonic capture serial
  and original energy/attenuation evidence. The kernel cut retains its new
  request frontier under the bumped spectral algorithm identity. No captured PCM
  or native node is serialized.
- Routed dedicated acknowledgments through the native graph, current owner arm,
  bounded session observers and existing effect-performance capture/journal.
  The worklet admits four outstanding metadata receipts and requires matching
  source-epoch credits; exhaustion quarantines that graph. A conservative 128 KiB
  transport estimate is charged in the prepared source profile. Diagnostics remain
  separate from this acknowledgement; no per-frame capture serialization occurs.
- Published spectral graphs mark the new evidence policy. Revoice validates
  complete serial/request-window coverage, same-frame replacement, one clock
  owner, original sample rate and exact analysis grid. It stages capture at the
  original window frontier and checks the new owned graph actually captured the
  complete interval. Missing prehistory/acknowledgments, late render traversal,
  unavailable input and changed rate/grid fail rather than fabricating readiness.
  An early explicitly canceled request creates no capture. Interval matching is
  linear after chronological sorting, with no audio-thread history search.
- The original metadata and new realization remain distinct: this re-analyzes
  rendered input from cleared memory, not original spectral/PCM/host restoration.
  Earlier command-only histories retain their limited disclosure. General
  multi-graph/lifecycle replay, native convolution command replay, arbitrary live
  audio cuts, content/play-scene work and their acceptance remain pending.
- Authored the 44.1/48/96 kHz × 512/1024/2048 grouped window/reference fixtures,
  exact final-frame boundary, invalid/missing/foreign/uncovered/rate cases, early
  thaw, unavailable/late source, state-cut metadata, capture-owner clock and
  four-credit worklet containment cases. No runtime/numerical/browser/audio test
  has been executed in this frontloaded pass. Static checks precede the commit;
  consolidated validation and real listening/cost results remain pending.


### Continuation 207 — original sealed friction model foundation

- Added bounded Hairline, Glass Drag and Rosin Grain source specifications: signed
  observed bow velocity, normalized pressure/contact/body controls, explicit
  110–660 Hz root domain and two provisional source slots. The original model is
  not yet registered as a selectable engine; its owned source adapter, typed patch
  compiler/profile, travel receipts, exact cuts and ordinary recipes follow in the
  next dependency batch. This does not mark #1136 implemented or qualified.
- Added a preallocated sealed relative-velocity nonlinear feedback kernel with
  positive modal midpoint integration, exact digital-pole frequency/T60 coefficient
  conversion, sixteen bounded bisections and a declared uniqueness bound. Actual
  bow motion supplies work; friction/linear losses are nonnegative, and a numerical
  energy-defect guard contains invalid state before output. Rest/end remove input
  work while the existing body relaxes. Two signed common-reference observations
  and DC blocking read the same independently owned body; no oscillator or attack
  clock supplies hidden friction motion.
- Rosin roughness is a positive four-pixel spatial field, with the time-correlation
  interpretation explicitly restricted to the stated observed speed interval.
  Invalid future/span/frontier changes, shared/overlapping state and corrupt energy
  are rejected or quarantined under the bounded source contract.
- Authored unrun grouped rate/family energy balances, stationary silence, rest/end,
  pressure, reversal, render partition, future motion, invalid input/alias and
  independent-source containment fixtures. Primary research was inspected for the
  energy/relative-velocity background; the source defines its own original scalar
  model. No numerical probe, runtime, listening, stability map or device cost
  measurement has run. Long sustain and full engine/content acceptance remain open.


### Continuation 208 — owned friction travel, content and exact kernel cuts

- Integrated the original sealed model as `worklet-friction`: typed conditional
  pressure/contact controls, onset-only body tuning, bounded two-slot owned source,
  static source-cost policy, existing gate/lease/release, cancellation and panic.
  Canonical completed signed-axis microsegments retain actor/scope/event ancestry;
  rest supplies no bow work, reversal reuses the parent source, and unsupported
  live pitch bends fail. No public graph feedback or additional MIDI owner opens.
- Added exact kernel state transport with independent storage and pre-mutation
  validation of positive modal coefficients, source/core identities, reserved
  fields, motion frontier, pressure, solver/cumulative energy and readout state.
  Future commands and parent release remain owned by the existing core. Arbitrary
  live host restoration and PCM-equivalent continuation remain unqualified.
- Added three ordinary original recipes, DRAG/PRESS/EDGE/BODY macros, realization
  interfaces, library preparation, explicit 78-pixel/650-ms control audition and
  owned offline/physical-take revoice receipts. Control movement is not a physical
  take and slot/cost limits are not measured device capacity or qualified tiers.
- Authored grouped rate/family integration, queued/active/reverse/rest/end/retired
  cuts, forged valid-checksum state, two same-pitch opposing sources, canonical
  ancestry, control renders and one-gate physical revoice fixtures. Added an
  unrun sixty-second speed/pressure/rest/reversal runner with numerical, DC,
  autocorrelation and process-cost observations; it makes no automatic acoustic
  qualification claim. Runtime tests, browser/device, full stability region,
  alias/tone/listening and the Bow Orchard proof scene remain pending for #1136.
- Static-only checks are performed before this commit. No numerical runner,
  runtime test, build, browser/audio/listening or CI qualification has run here;
  the consolidated validation and repair pass remains deferred as requested.


### Continuation 209 — authored Bow Orchard physical score

- Installed Bow Orchard only with the exact sealed friction/canonical travel
  capability. Its worker-compiled 1024-pixel route and far steel stops are shared
  by collision/pixels/surface; two finite staggered entrants drive Hairline and
  Glass Drag with signed held journey motion. The score binds world/engine/schema,
  embedded patches, observation and recipe hashes through existing scene owners.
- Added explicit manual assistance policy, paused loading, no PCM/backing pattern,
  one onset PRESS macro per patch and the separate held channel-pressure contract.
  No missing source is replaced by an oscillator; authored slot/cost bounds remain
  unmeasured. The informational scene control names its onset boundary honestly.
- Authored unrun origin/dependency closure, unavailable-source, committed
  movement/rest/reversal/one-gate and actual compiled-terrain physics fixtures.
  Stability, sound/continuity, browser, device and listening acceptance remain
  pending; the scene is an authored score, not an acoustic qualification result.
  Runtime validation continues to wait for the remaining implementation pass.


### Continuation 210 — original sealed breath/modal wind foundation

- Added original Hollow Reed, Air Pipe and experimental Overblown Branch
  specifications with bounded AIR/BITE/LENGTH/LEAK/bell domains, distinct
  pressure/pitch limits, acoustic-size units and zero expression-pressure floor.
  They are artificial modal wind models, not measured clarinet/flute emulations
  or copied Faust components. They are not yet selectable engine profiles.
- Added preallocated positive-loss implicit modal integration and a saturating
  negative-resistance force port. Twenty fixed bisections solve a strictly
  increasing bounded scalar residual; a conservative slope-product bound admits
  the stated rate/control domain. The discrete energy balance separates actual
  source-port work and passive body loss, with finite/energy fault containment.
- Seeded filtered breath is subordinate to pressure, with 30/80-ms attacks and
  120/300-ms breath-release ramps. LENGTH changes acoustic size explicitly, not
  route geometry. The experimental branch uses threshold hysteresis and one
  energy-preserving register change per owned gesture, with no new source attack.
- Authored unrun grouped-rate energy, zero-pressure silence/relaxation, end/tail,
  partition/seed, register-hysteresis, invalid domain/frame/storage and independent
  fault-containment fixtures. Full pressure/pitch stability regions, long sustain,
  dropout/register/pitch/spectrum/DC/device measurements and levelmatched listening
  remain pending. Owned adapter/cuts, content, expression and Breathing Stairwell
  are the next dependency work for #1137, not completed acceptance here.


### Continuation 211 — owned wind expression, ordinary content and exact cuts

- Integrated `worklet-wind` with the existing two-slot gate/lease/lifecycle,
  per-actor channel pressure, typed patch schema/compiler, artifact/profile
  closure, lane preparation and owned control/offline/revoice paths. Conditional
  source domains validate the actual onset-Hz/acoustic-size ratio. Unsupported
  live bend fails; an internal register change retains its original token.
- Added independently owned exact kernel cuts and pre-mutation validation of
  source/core pins, positive coefficients, register/hysteresis banks, pressure,
  filter observations and cumulative energy. Deterministic noise age validates
  through an O(log age), bounded 32-bit linear jump rather than replaying samples.
  This API does not qualify an arbitrary live host checkpoint or PCM equivalence.
- Added three ordinary original recipes with AIR/BITE/LENGTH/LEAK onset macros,
  sealed semantic interfaces, honest single-profile limits and existing library
  preparation/audition/save/apply. Held channel pressure is distinct from onset
  macros. The explicit pressure fixture contains no physical-take claim and the
  source introduces no external feedback loop, PCM or additional MIDI owner.
- Authored unrun rate/family exact cuts, future queue/register/rest/end/retired
  boundaries, same-pitch pressure independence, cancellation/Panic, forged
  valid-checksum state, noise jumps, conditional onset admission and ordinary
  control-render fixtures. Added the unrun three-rate pressure/pitch/bite grid
  and sixty-second sustain runner, reporting numerical/DC/register/pitch/process
  observations separately from acoustic/device qualification.
- Breath scene/gesture proofs, full stability/dropout/register region review,
  alias/tone, actual device worklet cost, PCM continuation and levelmatched
  listening remain pending for #1137. Static-only checks precede the commit;
  runtime/build/browser/audio/CI qualification continues to wait for the combined
  validation pass after remaining development, as requested.


### Continuation 212 — authored Breathing Stairwell and pre-birth abilities

- Added bounded lane-indexed authored actor birth capabilities as a source policy,
  installed before any actor/action and emitted in ActorBorn ancestry. Scene
  recipes, stage preflight, Boot/session/independent inspection and checkpoint
  validation retain the exact policy. A mismatched source or forged graph/header
  policy rejects before world mutation; ordinary worlds keep no authored policy.
  This does not introduce a timed intervention program or automatic skill repair.
- Installed Breathing Stairwell only with its pinned sealed wind/held-pressure
  engine. Two finite climber/floater entrants use a worker-compiled 80-pixel rise,
  high shelf and descent/landing. Real action entry plus committed motion admits
  the held voice, observed world height shapes pressure, fall-to-float is legato,
  and walking/landing removes replenished breath through action exit ownership.
- Bound original Hollow Reed/Air Pipe patches, acoustic controls, manual assistance,
  source/recipe/observation closure and paused staged publication. Existing physical
  terrain/release editing changes actual route height/entry spacing; acoustic
  LENGTH remains separate. Static poll, transport or UI movement creates no onset.
- Authored unrun source/origin/preflight, motion-admission/height/legato/landing,
  lane-policy bounds, pre-first-birth checkpoint/resume/foreign-policy rejection
  and actual compiled-source climbing/floating/causal-expression fixtures. They
  provide no observed playability, PCM, device or user-listening result yet. The
  wind pressure/pitch stability map, sustained/tail/alias/cost acceptance and all
  other remaining backlog development continue before consolidated validation.


### Continuation 213 — captured ordinary effect lifecycle revoice

- Added captured mute/tail/neutral/Panic replay for one ordinary owned effect
  graph. Actual captured API frames drive the declared input/dry envelopes and
  immediate wet mute/clear policy; tail retirement uses the declared bounded
  transition-plus-maximum-tail frontier. A muted graph can retain controls; a
  detached graph cannot accept another command. Missed lifecycle frontiers fail.
- Shared return taps are explicitly before the owner output lifecycle gate. The
  new render is a cleared realization of API operations, not original live PCM,
  observed device application, exact host memory or polling-retirement timing.
- Processor-owned bodies/spectral state, body-only port Panic, owner-stop lacking
  tail disposition, native convolution command scheduling and multiple graph
  replacement still need their own lifecycle evidence and remain rejected.
- Authored unrun three-rate/four-mode scheduling parity against the actual owner
  host, muted controls/internal taps, detachment, late-frontier, pre-mutation and
  processor-boundary fixtures. Existing unsupported-lifecycle coverage now uses
  the still-unsupported owner-stop case. No runtime/browser/audio/CI validation
  has run; the combined validation/repair pass remains deferred.

Queued controls accepted before a detach keep their original submission ancestry:
neutral/Panic cancel them; tail retains those inside its declared deadline.
Commands actually submitted after detach still fail. The prepared replay records
canceled/retained sequence IDs and never mutates the captured history. These
additional scheduling fixtures are authored but unrun.
