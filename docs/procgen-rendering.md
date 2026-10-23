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
