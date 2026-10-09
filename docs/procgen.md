# Procedural shared-world mode

`procgen.html` is a full-viewport, left-to-right world. A small top tab pulls a
compact drawer down; it is closed and inert by default. The drawer contains the
shared visual character selector, 15 action-music presets, optional short phrases,
explicit local listening, speed, pack, restart, and an integer 1–1024 cohort/lane
stepper. New sessions start with eight lanes; an explicit saved lane count or URL choice takes precedence. The centered arrow handle slightly overhangs the topbar edge and retains keyboard/Escape behavior. It never connects or sends to a hardware MIDI port.

## Shared terrain and simulation

All lanes occupy the same coordinate space and one visible-region renderer.
Logical lanes are 96 pixels apart, with no collision wall at their boundaries.
A cohort has one actor per lane. Births are distributed deterministically over
12 integer game ticks; a fractional presentation phase is metadata only, never a
fractional collision/physics step. The default cohort interval starts at 54 ticks, or 81 ticks above 64 lanes, and eases upward at cohort boundaries as the run population grows. Explicit test/benchmark intervals remain exact.

The sparse world calls the actual `Lemming` and Walk, Fall, Jump, Bash, Build,
Climb, Hoist, Shrug, OHNO and Explosion systems with the pack's real MAIN.DAT masks.
The headless harness uses these same systems, terrain and schedule. It does not
use the simplified synthetic solver. Multiple actors modify shared terrain, so
traffic can cause incidental interactions and casualties. Actors falling or climbing across a 96-pixel stripe continue in the neighboring terrain; their current lane ownership changes without spawning a replacement or changing action state. Original spawn identity remains separate from current occupancy. Global world bounds and ordinary unsafe-fall deaths still apply.

The generator retains [mined real-art assembly recipes](procgen-terrain-analysis.md)
as small source ingredients, then composes deterministic 128-pixel chunks at each
lane's frontier. It does not prepare a finite route or repeat one whole-lane span.
The permitted frontier margin is 64–191 pixels. Panning or zooming into the future
does not generate distant terrain. Chunk seeds include lane, run and position;
a seeded phase changes the piece pool, spacing, density and arrangements every
four chunks. The source catalogue retains every nonempty terrain and object entry. Generated eligibility separately excludes dig-direction arrows, word-owned glyphs and unsupported component placements.

Source-colored connected foundations form shelves, slopes, abrupt climbs and
drops; stamped pieces add overhangs and steel, while gaps require bridges.
Admitted canonical decorative terrain uses its real source collision. Cosmetic word artwork and animated object artwork remain separate from terrain collision.
Supported source traps, water and lethal/fire objects use shared contact/action owners. Exits and entrances remain presentation-only. Each lane keeps one available groundset from the selected pack. A seeded permutation spreads starting themes evenly across lanes; a new generation rotates this order. Assets from other packs are never borrowed. Unavailable themes are omitted rather than substituted. Real steel pixels
are protected from bashing/explosions. Climbers enter the actual wall column before climbing; tunnel ceilings make them turn and fall instead of hoisting through the underside. Non-climbers retain their normal turnaround. Assistance uses ordinary classic walking, building, climbing and bashing. Source routes use the bounded hazard-aware planner described below; rejected proposals continue normal movement without teleporting actors or changing action timing.

Physics uses bounded bit-packed collision chunks and direct-mapped per-lane
working sets. Color rasters are a separate bounded cache. Sparse shared edits
invalidate only affected display tiles; edits outside the viewport do not force
terrain redraws. Static terrain and unchanged object-animation frames are reused.
The raster/canvases never exceed the screen's pixel dimensions at far zoom.
Subpixel actors and objects aggregate into representative screen-pixel colors,
while every admitted actor still receives the same real simulation ticks.

At maximum zoom-out, the lane stack fits above a reserved Lemmings CCTV band. Up to eight small live views reuse terrain, sprite and object caches from the running world; they add no simulation, sound dispatch or independent timers. Close-ups refresh at most ten times per second, with 128-by-at-most-64 buffers and at most 64 actors drawn per window. Slots retain their lane until a challenger leads by more than 24 pixels; labels show current actual rank, distance and action. Fewer lanes, empty lanes, pause, resize, appearance changes and new generations retain their normal lifecycle. Zooming in exits the overview.

Distance, Best and current active actors share compact topbar text; the overall score no longer overlays the first lane. Metrics update on the existing one-second cadence or explicit control changes. Seed and regeneration controls open from the secondary Seed disclosure without resizing the canvas.

The RAF loop reuses the completed frame when simulation, terrain, raster origin,
zoom, canvas size, appearance and HUD are unchanged. Follow-camera easing still
runs each frame, with its live leader cached only for the current tick. Explicit
render requests (including pan, zoom, resize and manual steps) always redraw.
An assisted walking column can be consumed once by the immediately following
action, provided its coordinates and terrain revision still match. Collision-only
chunk generation skips the decorative pixel pass entirely. Default actor loggers
are shared; injected log handlers remain independently constructed.

MIDI send-rate warnings request totals without allocating per-sound, track and
output breakdown maps. Detailed snapshots and priority shares retain their normal
contract. A synchronous reservation prunes its rolling window once and discards
already-expired entries; separate calls still prune at their own timestamps.
These source-level cleanups have correctness/operation-count tests, not a new
browser performance measurement.

Wheel or Z/X zooms down to the fit of the actual lane stack and usable canvas height. Zoom keeps the
left edge and first-lane top edge pinned when the view is at the origin. Drag,
arrows, or Shift-wheel pans; Shift-arrows pans faster. Deliberate panning suspends
following; zoom and pointer jitter keep following. F or double-click resumes on the furthest-ahead living actor, including
its current lane. V resets the zoom, Space pauses, ] steps while paused, Backspace
restarts, and +/- changes speed (Shift applies five steps). Existing overrides in
keybindings.json apply to these actions. Editing a control never triggers game
shortcuts. The speed buttons use the main-game bitmap glyphs and step sizes;
procgen has no upper speed dropdown cap. The runtime still reports actual achieved
throughput separately from the requested multiplier. Frame work is limited by an
eight-millisecond CPU budget, rather than a fixed 32-tick ceiling; an expensive
tick always completes atomically and overload is visible in achieved throughput.

## Distance and stall recovery

Each lane retains a rightward high-water mark, previous/best distance, and actual
spawn count since its last advance. The compact topbar distance and visible lane distances use the exact main-game
bitmap HUD glyphs. Labels use supported A-Z, digits, space and hyphen; punctuation
not present in MAIN.DAT is not substituted with a browser font. Visible lanes also
retain a vertical previous-distance marker at the saved distance plus the 36-pixel spawn origin. Its black/white dashes use screen-space sizing; phase advances with game ticks and is fixed while paused or under reduced motion. Individual lane labels are suppressed
in far-out views to avoid overlap, while the top score remains readable. Records survive explicit restart/page reload
through local storage; unavailable storage leaves the current session usable.

Default policy data lives in `ProcgenStallPolicy.js`:

- A base 90 simulated seconds without progress, plus spawn-to-frontier transit
  time. The estimate uses observed action delays and at least two ticks per pixel,
  multiplied by a 1.75 safety margin. The first fresh probe after progress receives
  that full window; continuous spawning cannot reset the deadline forever.
- At least 12 actual new spawns since that advance, adding 4 per 1200 pixels
  reached, capped at 64. Scheduled/skipped spawns do not count.
- Every relevant lane must satisfy both conditions before a cohort-wide reset.
  One trapped lane cannot kill another that is progressing. An early unsuccessful
  first cohort does not immediately restart the generation.
- OHNO starts one or two whole ticks apart in stable actor order, followed by
  real explosions. New spawning stops during the cascade. Restart occurs once,
  after every remaining actor is gone, retaining each lane's distance marker.
- The next run derives a fresh deterministic terrain seed from run number.

A 16,384-actor soft admission limit prevents indefinite live-population growth.
If progress stalls at that limit, bounded reserve births allow the required
actual-spawn criterion to finish; they are never fictitious counter increments.
Reserve capacity is at most 64 additional births per lane. The compact status
explicitly reports paused ordinary admission. Large cohorts and long cascades
have real costs; 1024-lane browser smoothness is not asserted from headless tests.

## Character and audio stability

Actors use their lane index for a seeded cyclic appearance assignment. Each
finite shape/color list is distributed within one count, including at 1024 lanes;
palettes necessarily repeat. Closing/reopening controls or rendering does not
reroll assignments. One accessory plus independent eyewear is preserved. Live
appearances share canonical palette skins even after eviction from the bounded
256-entry strong working set. Weak ownership releases retired actors/history and
preferences; recolored animation and particle frames materialize only on demand.

The shared world also uses the bounded character-particle pool. Terrain chips
sample the sparse world’s actual RGB pixels before each cut and confirm removal
afterward; explosion and unsafe-fall deaths eject the selected wearables. A
single pool serves all lanes, advances only on fixed ticks, and is cleared on
restart/disposal. The renderer culls offscreen particles and draws changing
particle colors directly rather than caching a mutable one-pixel sprite. The
headless scaling harness omits sprites and this cosmetic pool.

Local music uses the same immutable preset catalog and router as the studio.
Audio starts only on the Listen button, stops on explicit stop, blur, hidden
page, explicit restart or disposal, and never auto-enables hardware MIDI. Polyphony/event
limits still apply to dense cohorts; not every simultaneous event is audible.
Procgen events use the RAF wall timestamp and the speed-adjusted nominal tick
duration, avoiding future-time drift. Pause/visibility changes silence notes while
preserving tick-based phrase tails; restart clears the old clock and phrases.
Manual stepping uses the current wall time rather than scheduling far-future audio.

## Regression and measurement commands

- `npm run bench-procgen-optimization`: reproducible simulation/render/cache matrix;
  mocked Canvas calls are explicitly not browser FPS.
- `npm run bench-procgen-midi-clock`: actual accepted/planned/dispatched note and
  cancellation counters with fake timers and a stub MIDI output.
- `npm run bench-character-palettes`: live identity, allocation and GC lifecycle.
- `npm run procgen:mine-recipes`: rebuild the bounded all-pack analysis and book.
- `npm run procgen:check-recipes`: verify exact checked-in reproduction.
- `npm run bench-procgen-lanes -- --lanes=32 --ticks=3000 --seed=42`: real-art,
  repeated-cohort headless run. Output includes actual throughput, survival,
  stalls, failure reasons, distance, memory in MB and admission state.
- Add `--cohorts=false` for an isolated first-cohort scaling probe or
  `--analytic=true` for the original simple test-terrain comparator. Neither is
  the default browser workload; report the selected mode with measurements.
- `npm run bench-procgen-behavior`: compare the unchanged 059a4cab AI against the
  revised legacy controller on real Level/LemmingManager blocker/pit fixtures.
  The original policy is preserved only in a test fixture.

The old controller no longer blocks at every downward pixel. It reassesses
blockers after a safe-route check, makes legal skill transitions (removing owned
blocker triggers), tracks high-water progress in pits, and waits until barriers
are in reach instead of wasting repeated bashes and then digging into void.

`window.__PROCGEN_LANES__` is installed only with `?e2e=1`; it exposes pause,
resume, bounded step and compact state. `window.procgenDebugState()` reports the
shared-world state. Tests cover real mask equivalence, deterministic replay,
independent routes, all source recipes, stall growth/pause/cascade/reset,
character balance, drawer interactions and local-only controls. Browser E2E and
visual QA require a permitted browser environment; unit/headless results alone
are not a live-rendering or listening pass.

## Shareable configuration

Share run reveals a URL for the current configuration. Explicit, validated URL
values override stored appearance preferences. Missing or invalid values retain
the normal defaults/preferences. Body color defaults to stable random for a new
procgen session; each actor keeps its color identity. The generated random-shape
icon and actual original lemming are included in the compact selector. Every body,
accessory and eyewear preview is drawn from runtime sprites using the selected
colors, including stable per-preview random colors.

Supported parameters:

- seed: existing integer, hexadecimal, or free-form deterministic seed semantics
- lanes: integer 1-1024 (larger valid values clamp to 1024)
- pack: existing numeric pack ID 1-6
- speed: finite multiplier >=0.1, without a procgen-specific maximum
- shape: mixed, classic, or a body ID from assets/characters/catalog.json
- bodyColor, propColor, eyewearColor: random or a native palette hex value
- accessory and eyewear: native catalog IDs (none is explicit)
- appearanceSeed: seed for stable appearance/color identities
- preset: a shared game-event music preset ID
- musicMode: steps or phrase
- cameraX, cameraY: finite nonnegative world coordinates
- zoom: scale from 1/256 to 6; follow: 0/1 or false/true

Compatibility aliases include appearance, body, accessoryColor, frameColor,
musicPreset, phrases, x, y and scale. Supplying camera coordinates/zoom without
follow starts a manual view. Explicit follow=1 starts tracking instead. Share links
preserve the selected preset, but never enable or request audio automatically.
The recipient still starts local listening with an explicit click. Links describe
configuration, not live simulation state or another user's saved distance records.

Generated gadget presentation now respects source roles: triggered traps and nonlooping structures stay on their idle frame, continuous hazards keep their authored loop, and ground objects require full supporting terrain. Water occupies a bounded open cavity with side walls and a floor. Generated dig-direction arrows are disabled for now. Supported generated traps, water and lethal/fire objects activate through the shared owners described below. Authored levels continue to use their existing object/trigger owners.

The common run controls stay in the topbar while the details drawer is closed or scrolled: seed, Regenerate/New seed, lanes, pack, speed, Pause/Step, zoom, Follow (F), Listen locally, local master gain and Panic. Regenerate repeats the visible seed; New seed explicitly chooses another. The details drawer retains appearance, scenery, music preset and sharing. The canvas backing size excludes the measured topbar height and uses at most 2× device pixel density. Gain reuses the saved main-game local master preference (70% if absent), with the same 0–400% range; listening still requires a click.

The frame loop accumulates real elapsed milliseconds, including fractional-speed ticks spanning several frames. An eight-millisecond execution budget bounds each frame without capping the requested finite speed. Tick-rate diagnostics saturate only at the JavaScript numeric representation limit; returning from an extreme speed to normal or slow speed drains a finite backlog.

Overview CCTV retains an explicit Eight leaders mode. Director mode uses the same eight render views and actual cached lane activity: builders/bashers, established sparse surviving crews, observed forward progress and changes in distance lead. Views keep at least three seconds of dwell plus score hysteresis; one unpinned slot rotates through less-seen lanes every six seconds while the simulation advances. Up to four pins remain fixed and persist across Regenerate in the current session; the drawer supports exact lane numbers and accessible per-view pin buttons. Labels state the observed reason and rank. Pause keeps selection static; restart/rewind clears transient director history. No second simulation, predictor, audio subscriber or per-frame DOM layout is added.

Population easing uses a run high-water mark and a bounded four-times-base interval; it does not accelerate during a run or depend on render speed. Seeded sparse scouts gain climbing/floating only after 180 simulation ticks and when the real action needs it. Cached lane summaries expose actual live/peak counts, surviving identity, action counts and terrain work to CCTV/music without extra actor scans. Sustained piles require at least four old nonprogressing actors, observed growth, conservative difficulty/transit/probe grace and no actual recent work. They reuse the existing single all-lane OHNO/explosion/reset lifecycle; pending terrain work has an explicit bounded completion hook. Assistance can still retry an impossible tunnel route before that recovery: deep excavation and switchback turning remain future work.

The collapsed Output capture section in Details shares the main MIDI observer and
report controls. Capture remains separate from Listen locally, retaining a finite
ring of actual lane event requests, accepted note calls, synth schedules, releases
and thinning reasons. Its initial context includes seed/generation, selected
pack/preset, tempo, scale, speed and bounded ensemble/track references. Inspect
and local exports are demand-only; capture adds no simulation or playback clock.
See `docs/midi-ui.md` for timing domains and evidence limits.

Ordinary walkers retain the shared walk action's wall bounce and move away on the following tick. The generated baseline has a visible empty strip at x0..7. A returning grounded walker recognizes an open or unsafe edge and becomes a real blocker around x20; its actor-owned directional triggers turn followers through normal contacts. When the actual flat rear corridor is fully revealed, hazard-free and contains a solid wall, the walker reaches that wall and bounces through the shared walk action instead. The bounded edge cache follows only local terrain/trigger revisions; unrelated lane work does not rescan it. If a coincident returning actor is already behind a newly created primary blocker's real contact rectangle at the unsafe edge, it enters the shared blocking action itself. Its position/direction remain unchanged and its triggers retain normal actor ownership. This can leave an additional stationary blocker; it prevents the exposed fall, rather than counting that actor as a forward arrival. Leftward walking through the former x36 turnaround remains ordinary walking. Foundation shelves and partially cut tunnels use actual masks and steel checks. Bashers and builders complete their real action before another task is assigned. Sparse scouts retain their delay; failed task footprints have a bounded retry delay and release on reset/disposal.

CCTV uses taller preferred 2:1 scene boxes and reserves at most 52% of the canvas height. The bounded raster is fitted with one uniform scale, including any integer rounding or size cap; it is never stretched between axes. Main-camera maximum zoom and following remain separate from the overview views.

Verified canonical pack loading fingerprints decoded terrain and object art once. Small observed route/decor groups and attached assemblies retain exact source transforms, alpha and revision evidence. Conditional overwrite roles, unsupported attachments, protected terrain, gaps, words and gadget footprints are screened. Ambiguous components are suppressed.

Future terrain materializes as whole source motif sections and individual supported placements, followed by attached details. Source contact graphs order assembly members from the actual admitted support outward; ambiguous attachment ordering stays one connected section. Active job bits gate terrain alpha, steel, basin geometry, render pixels and hazard activation together. This changes actual geometry rather than wiping across a completed static bitmap. At most 32 jobs belong to a chunk; normal ticks prepare up to 16 plans and activate at most one job per active lane, capped at 1024 jobs. Time-to-reach priority accounts for the two-pixel forward action step, service rounds and a 64px safety reserve. Cross-stripe arrivals materialize only their local footprint and prerequisite supports, without generating distant intervening chunks. Partial geometry uses filtered samplers; completed tiles return to existing collision/color caches. Pending ready work clears after completion/reset, and pause creates no work.

## Generated hazard contacts

Generated traps, water and lethal/fire gadgets now use the shared Trigger and MapObject owners, including source cooldowns, exact contact bounds and existing terminal actions. The complete source footprint and support must be revealed before activation; terrain edits can disable unsupported gadgets. Rendering only observes created owners and their real activation frames. The live lane/chunk cache is bounded and resets with the run. Exits, hatches and unrelated scenery remain presentation-only; ordinary unsafe-fall timing is retained.

## Editable musical tension

Details exposes Musical tension for the existing Iron ensemble and a lane status selector. The compact controls set thinning amount, healthy crew and fade; Thresholds also exposes establishment, collapse/recovery ratios and breakthrough distance/hold. Completed game ticks supply cached real population and frontier signals. An established crew's collapse gradually leaves its surviving lead voice, while actual recovery or progress restores the supporting layers. Small developing crews do not count as a collapse.

Policy edits persist across regeneration and reload independently of the Listen locally switch. They preserve the ensemble's instruments and manual assignments. Times are base game seconds and share the simulation clock; no extra sequencer, timer or MIDI clock is introduced. Paused/rewound/reset runs and empty lanes release observation state.


## Musical spans

Details shares the studio span editor and existing note router. Choose Musical beats or Actor world distance, a supported target and Add span, or enable Draw on lanes to draw a lane/group interval directly. Beat rectangles use a 16-beat screen timeline; distance rectangles follow world X. Move/resize commits once at pointer release. Hiding rectangles disables drawing; Escape returns pointer control to the camera.

Intervals support constant/ramped values, repetition, source filters, track scope, priority and distinct matching-event/bar/span-pass conditions. Higher priority wins per target; equal priorities follow list order. Span edits persist locally across regeneration/reload while Listen remains a separate explicit action. The shared renderer draws bounded rectangles without an additional frame loop or DOM layout. Status uses the router's cached last observation, and queued cells use completed actor positions when available. See docs/midi-ui.md for timing and output semantics.


## Construction crews and remaining routing limits

Per-lane worker limits default to two bashers, two diggers and two builders. Details stores integer limits from 0 to 16 and applies them to new jobs immediately; lowering a limit lets current work finish. Independent jobs coexist, while overlapping task footprints remain exclusive. Digging uses the shared action lifecycle, actual nine-pixel row removal, steel stops and global world bounds. Active claims migrate with actors crossing stripes; destination limits apply to new jobs without cancelling work already underway. Blocker triggers release on falling, reassignment, removal, reset and disposal.

Automatic assistance preserves complete build/bash actions. Bashing into an unsupported edge naturally enters FALLING; this ordinary shared behavior remains intact, including travel into adjacent lanes. Generated routes are not guaranteed solvable. The 32-lane/5,000-tick checks retain exact admission/death/lane accounting, observed forward progress, actual skill activity and memory/source-geometry bounds. Stationary blockers and source-hazard deaths are valid observed outcomes. Catalogue coverage verifies every source ingredient; generated vocabulary separately respects the fire theme's curated word glyph exclusions.

Music reads a bounded completed-tick actor-position cache in O(1). Two reused slots per live actor publish after the complete step; removal, reset and disposal clear stale identities. This adds no actor scan or playback clock.


## Safe starts and local route proposals

The initial 256 world pixels protect the spawn/drop/landing and early travel corridor against full source sprite and trigger envelopes, including overhead hazards. Small gaps and modest elevation changes precede the hazard ramp; difficulty reaches its full range at 2048 pixels. Later supported hazards retain their ordinary shared contact timing.

Source assistance compares feasible stairs to nearby ledges with excavation leading to supported local continuation. Scores include resulting elevation, crew throughput, action time, materials, ceilings, steel and hazard envelopes. A proposal must fit one ordinary 12-brick builder, a supported shared basher route, a thin-roof dig with a known safe landing and onward passage, or at most four actual mining cycles within 40 revealed pixels. Mining follows both real masks and their movement frames, rejects protected terrain, and shares the digging crew cap. Each evaluation has a 1024-probe ceiling, at most one per lane/tick and eight lane slots per tick; rejected or deferred work leaves ordinary walking, bouncing and scout abilities active. Deep mining, switchbacks and routes requiring unobserved distant geometry remain outside this planner.

A longer supported horizontal tunnel has a separate bounded cold preflight. It runs the real bashing/walking actions on private observed cells, proving rear containment, uninterrupted natural completion and eight continued walking columns. Ground, steel, arrows, revealed growth state, enabled hazard envelopes and active construction claims remain authoritative. The entire observed return/clearing/exit footprint is reserved. This keeps the 40-pixel local proposal bound, 1,024 observations per lane and eight evaluated lanes per tick unchanged. Cached proofs follow local terrain revisions and reveal limits, which govern enabled source hazards, and recheck live claims before admission. A real 64-pixel wall finishes one basher naturally at tick 197; fresh shared-action replays carry all eight and sixteen ordinary actors through without deaths, hazards, abilities or a permanent blocker. A 96-pixel proposal exceeds the observation budget and remains rejected. This assistance preflight is distinct from independent route certification.

Cross-stripe arrivals prepare only their immediate physical footprint and local reveal lead. Trigger buckets, live work claims, completed music positions, phrase metadata and current lane budgets follow the actor; instrument, pitch, gate ownership and already-charged budget history remain intact. Admission counts distinguish births from transfers, so leaving a stripe does not manufacture a death/collapse observation. Camera and CCTV consume the resulting current occupancy.

Fresh procgen spawn mappings use velocity 32 and event priority 0 through the existing project/router, placing births among the lowest event priorities. Explicit saved event velocity/priority remains deliberate. Other event palettes, master gain, external MIDI limits, fair admission and note-off/Panic ownership retain their existing controls.

## Authored attachments and route qualification

The offline assembly miner covers 16 configured classic pack/ground scopes, with strict terrain/object hashes, source-level identities, exact offsets, source flags and alpha contact evidence. The bounded catalogue records confidence and usage shares before quarantining exclusively attached components from standalone selection; ordinary foundations remain eligible. The Chameleon source pair retains its body, head and evidenced terrain anchor, including the authored head/body offset (+32,-20). Unsupported NeoLemmix/archive inputs are reported rather than claimed as covered.

Route candidates remain local proposals. Shared-action fixtures exercise walking, bridges, tunnels and grounded construction under actual masks, hazards, protected terrain and worker claims. These checks do not certify every generated run or import port-specific timings. An eight-walker dig→natural fall→walk→bash replay uses actual shared masks, keeps upper steel intact and preserves every admitted walker without climbing/parachutes. A separate real mining→fall→walk→bash replay preserves protected terrain and qualifies the bounded local descent. Wider whole-population replay and an independent procgen solver without intended-route hints remain the next qualification step; the synthetic fixture solver supplies no such guarantee.
