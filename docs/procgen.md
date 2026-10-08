# Procedural shared-world mode

`procgen.html` is a full-viewport, left-to-right world. A small top tab pulls a
compact drawer down; it is closed and inert by default. The drawer contains the
shared visual character selector, 15 action-music presets, optional short phrases,
explicit local listening, speed, pack, restart, and an integer 1–1024 cohort/lane
stepper. It never connects or sends to a hardware MIDI port.

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
traffic can cause incidental interactions and casualties; routes are screened
and tested independently without relying on neighboring lanes.

The generator retains [mined real-art assembly recipes](procgen-terrain-analysis.md)
as small source ingredients, then composes deterministic 128-pixel chunks at each
lane's frontier. It does not prepare a finite route or repeat one whole-lane span.
The permitted frontier margin is 64–191 pixels. Panning or zooming into the future
does not generate distant terrain. Chunk seeds include lane, run and position;
a seeded phase changes the piece pool, spacing, density and arrangements every
four chunks. Every nonempty terrain and object entry in the selected theme is
eligible, including pieces the former width/solidity filters excluded.

Source-colored connected foundations form shelves, slopes, abrupt climbs and
drops; stamped pieces add overhangs and steel, while gaps require bridges.
Background terrain decorations and animated object artwork are noncolliding.
Objects in this endless composition are scenery, not operational exits, entrances
or traps. Each lane keeps one available groundset from the selected pack. A seeded permutation spreads starting themes evenly across lanes; a new generation rotates this order. Assets from other packs are never borrowed. Unavailable themes are omitted rather than substituted. Real steel pixels
are protected from bashing/explosions. Climbers enter the actual wall column before climbing; tunnel ceilings make them turn and fall instead of hoisting through the underside. Non-climbers retain their normal turnaround. Assistance uses ordinary classic walking,
building, climbing and bashing; awkward steel lips can trigger a walk-back and
builder approach without teleporting an actor or changing action timing.

Physics uses bounded bit-packed collision chunks and direct-mapped per-lane
working sets. Color rasters are a separate bounded cache. Sparse shared edits
invalidate only affected display tiles; edits outside the viewport do not force
terrain redraws. Static terrain and unchanged object-animation frames are reused.
The raster/canvases never exceed the screen's pixel dimensions at far zoom.
Subpixel actors and objects aggregate into representative screen-pixel colors,
while every admitted actor still receives the same real simulation ticks.

At maximum zoom-out, the lane stack fits above a reserved Lemmings CCTV band. Up to eight small live views reuse terrain, sprite and object caches from the running world; they add no simulation, sound dispatch or independent timers. Close-ups refresh at most ten times per second, with 128-by-at-most-64 buffers and at most 64 actors drawn per window. Slots retain their lane until a challenger leads by more than 24 pixels; labels show current actual rank, distance and action. Fewer lanes, empty lanes, pause, resize, appearance changes and new generations retain their normal lifecycle. Zooming in exits the overview.

The persistent upper-right count reports current active actors across all lanes, excluding failed actors. Its callback updates only when the cached population changes; metrics remain on the existing one-second cadence.

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
spawn count since its last advance. The fixed top score and visible lane distances use the exact main-game
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

Generated gadget presentation now respects source roles: triggered traps and nonlooping structures stay on their idle frame, continuous hazards keep their authored loop, and ground objects require full supporting terrain. Water occupies a bounded open cavity with side walls and a floor. One-way artwork is clipped to the original terrain and disappears from pixels removed or replaced by construction. These generated objects remain scenery; this change does not add drowning, trap activation or one-way collision rules to the shared lane world. Authored levels continue to use their existing object/trigger owners.

The common run controls stay in the topbar while the details drawer is closed or scrolled: seed, Regenerate/New seed, lanes, pack, speed, Pause/Step, zoom, Follow (F), Listen locally, local master gain and Panic. Regenerate repeats the visible seed; New seed explicitly chooses another. The details drawer retains appearance, scenery, music preset and sharing. The canvas backing size excludes the measured topbar height and uses at most 2× device pixel density. Gain reuses the saved main-game local master preference (70% if absent), with the same 0–400% range; listening still requires a click.

The frame loop accumulates real elapsed milliseconds, including fractional-speed ticks spanning several frames. An eight-millisecond execution budget bounds each frame without capping the requested finite speed. Tick-rate diagnostics saturate only at the JavaScript numeric representation limit; returning from an extreme speed to normal or slow speed drains a finite backlog.

Overview CCTV retains an explicit Eight leaders mode. Director mode uses the same eight render views and actual cached lane activity: builders/bashers, established sparse surviving crews, observed forward progress and changes in distance lead. Views keep at least three seconds of dwell plus score hysteresis; one unpinned slot rotates through less-seen lanes every six seconds while the simulation advances. Up to four pins remain fixed and persist across Regenerate in the current session; the drawer supports exact lane numbers and accessible per-view pin buttons. Labels state the observed reason and rank. Pause keeps selection static; restart/rewind clears transient director history. No second simulation, predictor, audio subscriber or per-frame DOM layout is added.

Population easing uses a run high-water mark and a bounded four-times-base interval; it does not accelerate during a run or depend on render speed. Seeded sparse scouts gain climbing/floating only after 180 simulation ticks and when the real action needs it. Cached lane summaries expose actual live/peak counts, surviving identity, action counts and terrain work to CCTV/music without extra actor scans. Sustained piles require at least four old nonprogressing actors, observed growth, conservative difficulty/transit/probe grace and no actual recent work. They reuse the existing single all-lane OHNO/explosion/reset lifecycle; pending terrain work has an explicit bounded completion hook. Assistance can still retry an impossible tunnel route before that recovery: advanced mining/digging/turning remains future work.
