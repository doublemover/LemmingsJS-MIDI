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
fractional collision/physics step. Cohorts repeat every 54 ticks.

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
or traps. Different groundsets are not mixed within one run. Real steel pixels
are protected from bashing/explosions. Assistance uses ordinary classic walking,
building, climbing and bashing; awkward steel lips can trigger a walk-back and
builder approach without teleporting an actor or changing action timing.

Physics uses bounded bit-packed collision chunks and direct-mapped per-lane
working sets. Color rasters are a separate bounded cache. Sparse shared edits
invalidate only affected display tiles; edits outside the viewport do not force
terrain redraws. Static terrain and unchanged object-animation frames are reused.
The raster/canvases never exceed the screen's pixel dimensions at far zoom.
Subpixel actors and objects aggregate into representative screen-pixel colors,
while every admitted actor still receives the same real simulation ticks.

Wheel or Z/X zooms, including far-out views down to 1/256 scale. Zoom keeps the
left edge and first-lane top edge pinned when the view is at the origin. Drag,
arrows, or Shift-wheel pans; Shift-arrows pans faster. Manual changes suspend
following. F or double-click resumes on the furthest-ahead living actor, including
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
retain a vertical previous-distance marker. Individual lane labels are suppressed
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
