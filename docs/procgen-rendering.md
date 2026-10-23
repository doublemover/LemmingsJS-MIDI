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

The animated scenario still exposes the existing full actor draw-bounds refresh:
200 frames scanned 1,600, 25,600 and 204,800 actors at 8, 128 and 1024 total lanes.
Cached clipping does not resolve that separate projection optimization.

`e2e/procgen-render-recovery.spec.js` passed three production-layout checks on the
installed Edge browser: an injected terrain upload exception restored identical
canvas PNG bytes and physical/event hash; a synthetic `contextlost` event kept
transport/Panic controls available and recovered on the original canvas; and a
disposed renderer ignored late recovery while all owned surfaces stayed zeroed.
The tests attach hash/ownership receipts to Playwright results. These are fault
injection tests, not evidence of an operating-system GPU reset or support across
other browsers. The bundled Playwright Chromium executable was unavailable.

## Completed lane action facts

The existing completed actor publication now includes pooled per-lane action
masks, counts and numeric first-seen label order. Eleven action labels use 54
bytes per lane for these typed arrays, with no new arrays per completed tick.
Musical observations reuse the semantic leader and action facts, keeping contact
sampling lazy and reusing observation slots. Terrain-only edits do not rebuild
the fallback actor index. Label order matches the previous actor traversal order.

Renderer, camera and musical observation entry points defer an unfinished
physical tick. A previously returned lane observation is frozen and remains
unchanged while that tick runs. Tests compare indexed leaders/order/counts with
reference traversal over deterministic transfers, removals and equal-X ties at
8/128/1024 lanes, and cover same-tick generation/action-owner replacement.

This does not yet provide leased immutable render buffers for workers, nor
remove the full draw-bounds pass recorded above. Contact queries still use the
world's authoritative terrain reads, which can recompose an evicted collision
cache entry; an explicit read-only residency/unknown API is a separate remaining
part of the shared projection work.
