# ProcGen display resources and recovery

The physical world and musical transport remain authoritative when graphics are
unavailable. A failed paint does not step, restart or restore the world, resume
output, or replay notes. The runtime contains exceptions only around its paint
call; a failure from a physical step remains a simulation failure.

`ProcgenLaneRenderer.getDisplayState()` reports `ready`, `recovering`, `lost`,
`unavailable` or `disposed`, together with an error reason, retry count, raster
quality and resource estimates. `onDisplayState` reports transitions. A main
canvas context loss waits for its restoration event or an explicit `recover()`.
Other paint failures retry at most three times, after 250, 500 and 1000 ms. Each
attempt uses a coarser raster. Exhaustion requires an explicit retry. A retired
renderer ignores late restoration events, paint, resize and recovery requests.

The default resource ledger permits 64 MiB in total, including the main surface,
terrain, object, scenery, decoration and CCTV canvases, retained image arrays,
terrain clipping masks and cached sprite/object bitmaps. Bitmap caches have a
16 MiB LRU sublimit. Canvas dimensions are bounded at 8192 per axis. Large main
surfaces use a smaller backing resolution; remaining pressure increases the
raster sampling step. Both preserve logical camera coordinates. Main and cropped
row presentation use the accepted raster sampling step when copying pixels.

These are estimates of RGBA backing stores and explicitly retained pixel arrays,
not measurements of browser heap or driver allocations. Diagnostics expose live
and peak estimates, cache bytes, allocations, evictions and failures. An optional
`renderBudget.budgetAdapter` can join shared accounting through synchronous
`reserve({token, owner, bytes, previousBytes, kind, cache})` and
`release({token, owner, bytes})` hooks. Reservations replace the prior byte count
for the same token. The private cap continues to apply.

Retirement attempts width and height independently. If a browser rejects both
zero-dimension writes, diagnostics retain `unreleasedEstimatedBytes` and increment
`retirementFailures`; disposal continues through the remaining surfaces. An
unknown backing store is not reported as a confirmed zero-byte retirement.
Shared accounting retains that token with `unreleased: true`; its release is
reported only after the backing dimensions accept retirement.

Disposal zeros every owned canvas, retires cached bitmaps, removes context and
pointer listeners, releases retained arrays, and drops world/assets/frame
callbacks. CCTV eviction releases only its own three canvases and image array;
shared sprite art remains available to the main view. Runtime construction
failure also retires its renderer, world, visibility listener and asset lease.

Object placement geometry is cached separately from animation. Its key records
the generation, relevant source images and local terrain/materialization/reveal
revisions for every participating tile. Cross-chunk clip samples query the
corresponding canonical tile, including edit patches. Distant terrain changes
reuse geometry and masks. Object caches retain at most 512 tiles and 2 MiB of
clip masks; clipped frame canvases also participate in the bitmap LRU. Eviction
rebuilds presentation from world facts without generating collision terrain.
Replacement keeps the old tile and its clipped-frame ownership until the new
candidate is completely sampled and admitted. The2MiB mask ceiling includes
retained plus staged candidate bytes. Unrelated LRU entries may retire to make
room; if the protected old tile plus its candidate cannot fit, replacement
refuses before mask allocation. Sampling or shared-budget refusal preserves the
old tile. Diagnostics report staged bytes, peak mask bytes and mask allocations;
invisible masks count toward the allocation peak before retirement.

Camera following uses a 130 ms exponential time constant and a maximum 50 ms
presentation delta per update. Explicit Follow snaps immediately; reduced motion
also snaps. While paused, ordinary visible frames may settle the camera. Direct
pan and zoom remain immediate. Hidden/visible transitions and recovery reset the
presentation clock, so elapsed hidden time does not advance follow motion.
Backward timestamps do not move that clock backward. Camera state saves logical
coordinates and scale, without retaining presentation time or frame count.

The focused Node fixtures cover null contexts, image allocation failures, bounded
retries, late callbacks, construction cleanup, 100 resize/retirement cycles,
cross-chunk mask dependencies and bounded scrolling residency. These fixtures do
not constitute browser fault injection, retained-heap measurement, screenshots,
or cross-browser motion qualification.

Continuation331 passes57 grouped Node cases, including aggregate exact-limit/
limit-plus-one, invisible masks, retained-plus-candidate pressure, failed sampling/
reservation with the prior entry intact, cross-chunk dependencies, reveal/reset,
bounded scrolling and real optimized/scalar physics. Five distinct native desktop
cases pass across the recovery cohort and two new cache cases. Native source-art
clips retain identity after a distant edit, rebuild only affected dependency
tiles after a real visible-cell mutation, and match a fresh uncached repaint.
An actual checkpoint restore also matches uncached pixels and preserves the
physical checkpoint hash across painting. The dense clip fixture uses supplied
fully revealed geometry and actual installed animated images; it is not a claim
about unmodified scene density or GPU performance.

The new100-iteration probe uses1920x1080 and the same eight visible rows. For
distant edits, retained versus uncached p50/p95/p99 milliseconds are:

| Total lanes | Retained | Uncached reference |
| ---: | --- | --- |
|8|0.149 /0.272 /0.466|5.599 /6.671 /8.352|
|128|0.133 /0.184 /0.246|10.056 /10.482 /10.595|
|1024|0.130 /0.263 /0.490|9.767 /10.222 /10.418|

Retained distant/animated scenarios allocate zero masks and sample zero clip
pixels. Each uncached row allocates2400 masks and samples2880000 pixels. The100
local edits rebuild100tiles and sample120000pixels, retaining28800mask bytes
with a30000-byte publication peak. Full distributions, resource/bitmap/heap-delta
counters, source/art hashes and qualification limits are in continuation331 of
the canonical validation receipt. A concurrent local Node validation cohort and
other host load were not isolated; these are work-removal observations, not
browser frame-time or retained-heap release gates.

## Recorded cache probe and browser recovery

Run `node --expose-gc scripts/bench-procgen-render-cache.mjs --name=Rook
--iterations=200 --output=render-cache-results.json`. The checked-in
[receipt](procgen-render-cache-results.json) records Node v26.12.1, Windows x64,
an AMD Ryzen 7 5800X3D, source hashes and source art identity. It measures
production JavaScript and typed arrays with mocked canvas submission, using a
controlled dense source-art clipping fixture. It does not measure browser GPU
time, interaction latency or retained heap after a long soak.

For two hundred distant edits, with eight visible rows and a stationary camera:

| Total lanes | Retained p50/p95/p99 (ms) | Uncached reference p50/p95/p99 (ms) |
| ---: | --- | --- |
| 8 | 0.128 / 0.552 / 5.060 | 6.594 / 22.748 / 57.768 |
| 128 | 0.095 / 0.144 / 0.199 | 4.971 / 7.955 / 13.584 |
| 1024 | 0.092 / 0.226 / 0.447 | 4.895 / 11.918 / 19.717 |

Every retained row sampled zero clip pixels, allocated zero image arrays and
rebuilt zero placement tiles during those distant edits. Each uncached reference
row sampled 5,760,000 clip pixels and allocated 4,800 image arrays. Both modes
retained an estimated 6,410,880 bytes after the scenario. This demonstrates work
removal in this fixture; the distributions are one short local run on a shared development host with concurrent agent work; they are not release gates.

The earlier animated scenario exposed a separate full actor draw-bounds refresh:
200 frames scanned 1,600, 25,600 and 204,800 actors at 8, 128 and 1024 total lanes.
Continuation329 moves draw-row construction into the completed actor publication.
Cached clipping and completed actor projection address separate work.

`e2e/procgen-render-recovery.spec.js` passed three production-layout checks on the
installed Edge browser: an injected terrain upload exception restored identical
canvas PNG bytes and physical/event hash; a synthetic `contextlost` event kept
transport/Panic controls available and recovered on the original canvas; and a
disposed renderer ignored late recovery while all owned surfaces stayed zeroed.
The tests attach hash/ownership receipts to Playwright results. These are fault
injection tests, not evidence of an operating-system GPU reset or support across
other browsers. The bundled Playwright Chromium executable was unavailable.

## Completed lane action facts

The completed actor publication includes immutable per-lane action masks, counts
and numeric first-seen label order. Eleven labels have a logical packed size of
54 bytes per lane; the structured-cloneable frozen JavaScript arrays are included
in the conservative projection admission estimate. Each publication owns its
arrays until every lease releases.
Musical observations reuse the semantic leader and action facts, keeping contact
sampling lazy and reusing observation slots. Terrain-only edits do not rebuild
the fallback actor index. Label order matches the previous actor traversal order.

Renderer, camera and musical observation entry points defer an unfinished
physical tick. A previously returned lane observation is frozen and remains
unchanged while that tick runs. Tests compare indexed leaders/order/counts with
reference traversal over deterministic transfers, removals and equal-X ties at
8/128/1024 lanes, and cover same-tick generation/action-owner replacement.

Draw rows and wide-sprite membership now share the completed immutable frame;
there is no second live-actor scan when drawing. Native pixel/effect/recovery
fixtures and real physical-batch/music/checkpoint parity pass. This does not
provide pooled transferable raster buffers for workers.

Contact observations use `peekGroundAt`/`peekSteelAt`. Edits are read directly from
resident arrays, raw cold arrays or a binary search of sorted cold runs. Sourced
collision reads use an already resident bitset, retained descriptor or active
growth plan; they do not invoke descriptor generation, chunk composition, edit
restoration or retention-order updates. Authored score terrain reads its prepared
mask. Missing source data returns `null`, while a known empty cell returns `false`.
An observation with unavailable requested contacts has `terrainCoverage: 'partial'`;
unavailable samples cannot establish a gap. Readiness follows the actor's physical
row even when musical lane ownership differs. Completed projection revision also
invalidates same-tick observation caches; stale ownership under lease pressure
cannot return a cached observation as current.

## Presented world inspection (#1029)

`renderer.presentation` publishes one immutable snapshot after an accepted canvas
paint. It includes world/generation/completed tick, projection revision, the
logical canvas size, backing resolution, actual DOM **content** rectangle and
per-row source crop/destination rectangle. Selection outlines, support-contact
marks, hit queries and explicit keyboard Reveal use those same row transforms.
The content-rect reader accounts for borders, padding, translation and axis-aligned
CSS scaling. Rotated or skewed canvases are outside this contract.

`procgenScreenToWorld` and `procgenWorldToScreen` convert between CSS pointer
coordinates and logical/world coordinates without multiplying a pointer by DPR.
Strips between cropped rows and the CCTV band are excluded. Pure fixtures cover
an 800×608 logical canvas in a 400×304 content rectangle, fractional DPR 1/1.25/1.5/2,
zoom 0.5/1/2, crop boundaries, border/padding and translated/scaled boxes. Accepted
round trips stay within **0.001 CSS pixel** in those floating-point fixtures; the
practical presentation tolerance is **0.5 CSS pixel**. Actor bounds use the actual
raster-rounded submitted sprite rectangle or downsampled dot cell.

The visible spatial index uses 48-logical-pixel cells. Actor IDs sort numerically
before contacts, source objects and zones; stable IDs break ties. Repeated clicks
within six CSS pixels cycle the same overlap order. A paged native-button list
exposes the same identities to keyboard users, with at most 32 buttons mounted.
Queries visit one cell plus wide entities, never scan all physical actors on
pointer movement. At most 16,384 visible entities are admitted; a truncated list
reports its display limit.

`createProcgenWorldInspector({renderer,document,window,parent,getLaneInfo,
onRevealLane})` appends an isolated section to the inspector dock. It returns
`select`, `clear`, `cycle`, `reveal`, `refresh`, `getState` and idempotent `dispose`.
Selection pins exact world/generation/entity identity without enabling camera
follow or paging every frame. An offscreen actor retains its identity and exposes
Reveal. Reveal applies a numeric one-shot camera/crop anchor and explicitly pages
the lane; later pan, zoom or Follow clears that anchor. A terminated selected actor
retains its observed final reason and offers a nearest **visible** surviving actor
as a separate action. A new generation clears the selection and outline. The
component reads the project lane role; it never issues musical/terrain edits,
transport changes or note events merely by selecting or revealing.

Inspection requires a successfully presented, visible snapshot. `acquire(owner,
{purpose:'inspect'})` returns a bounded lease; a pointer gesture retains its frozen
mapping and exact identity across ordinary actor/camera motion. DOM content-rect,
page/layout, backing resolution, generation, display loss and disposal invalidate
admission. Only the owning pointer can finish a gesture, and a four-pixel drag
cancels inspection. The host rejects **every edit lease** with the dock's explicit
inspection-only explanation. Future field/gate engines must publish their actual
selectable bounds and render capability before obtaining editing authority.

Snapshots are demand-driven and retain no live actor references. A ledger
reservation estimates strings, entity/row records, region records, spatial cells
and memberships. Retained leases preserve that accounting until release; at most
32 leases may exist and normal frames retire their unleased predecessor. Budget
denial disables inspection while canvas painting continues. Private estimates
and optional shared `ResourceBudget` admission both apply. Strict replacement and
reentrant eviction fixtures cover uncertain canvas retirement/reuse and protect
the cache token currently being resized.

Canonical support contacts and rendered source objects are currently inspectable.
The renderer does not fabricate gate/field mechanics, causality, hover state or a
sounding-actor marker where the owning engine supplies no such presentation fact.
The snapshot schema accepts future gate/zone bounds, but those engine integrations
remain separate work. The legacy automation overlay retains its own unavailable
editing admission; this inspection host does not grant it hidden edit authority.

The production `e2e/procgen-world-inspection.spec.js` fixture passed four checks on
installed Microsoft Edge: natural source-art actors selected by pointer and native
keyboard button at DPR 1 and 2; a translated half-size CSS host with stale-rect
cancellation; and synthetic display loss/retry plus generation identity reset.
The fixture advances the real world until a visible spawn, then pauses before
recording physical tick/terrain/event sequence, document and transport receipts.
Inspection leaves those receipts unchanged. Playwright attaches the selected
canvas screenshot and geometry/identity receipts. This is one installed browser,
not cross-browser, retained-heap, acoustic-sync or rotated-host qualification.

The host also offers `presentation.suspend(owner, reason)`, returning an idempotent
release callback. A fullscreen/layout owner can hold admission across its DOM
transition, apply final layout/resize, release, then request a renderer paint.
Suspension immediately cancels gestures and prevents publication until all owners
release (at most eight holds). `presentation.getSnapshot()` reports unavailable
until a coherent visible frame is accepted, with its accepted generation/tick,
projection, content rect, logical/backing sizes and capabilities.

Camera qualification also compares a completed piecewise-constant target trace
at 30/60/90/144 Hz and irregular intervals at common timestamps (including target
boundaries): positions agree within 1e-8 world pixel. The fixture caps a one-second
stall at one 50 ms interval, verifies paused settling, lane/page/selected-lane
changes, no-target reentry, DPR logical restore and reduced-motion Follow, with
unchanged world data. CSS-scaled pointer pan uses the shared content rectangle
and owning pointer ID. These are deterministic controller checks; before/after
motion clips and the full browser cadence matrix remain unqualified.

## Owned CCTV construction and native retirement qualification

CCTV construction owns each native surface as soon as it is created. A failed
allocation, null context or throwing context releases all partial surfaces before
the error reaches the render host; shared parent canvases and immutable art remain
owned by their original renderer. A physical step exception propagates as a
simulation failure and never becomes a recoverable paint error.

The required workstation browser selection now includes the render-recovery
fixtures. They preserve production projection ownership while injecting main,
terrain, object and scenery context failures, a paint callback exception and
CCTV construction failure at the owned frame callback. DPR1/2 cases compare exact
native RGBA hashes and physical/event hashes, including a real actor CCTV raster.
The separately scheduled DOM cause layer must become visible and retain its text
and geometry before comparison; its100ms cadence is not part of canvas paint.
Retries under a persistent fault remain degraded; restoring the API permits
explicit recovery without notes or world changes. Synthetic contextlost coverage
remains labelled separately from a native GPU reset.

A separate native Chromium journey replaces display resources and resizes desktop
rasters100 times, checks the same repeated layout does not allocate or clear again,
and samples JavaScript heap after explicit CDP garbage collection. It also expands
the actual viewport from1920×1080 to3840×2160 and restores the source pixels.
RGBA ledger estimates are checked against64MiB. Heap samples exclude native/GPU
allocations and do not establish a process-wide memory bound. Exact results and
source hashes are retained in the canonical continuation364 qualification.
