# Live blocker rectangle index

Blocker ownership remains authoritative in the trigger manager. A sparse map of
32-pixel X cells stores each directional rectangle in every intersecting cell of
its owning physical row. Queries retain the original row and hazard precedence,
then choose the earliest inserted eligible rectangle. A wide-rectangle overflow
set bounds storage for unusual imported geometry without truncating collisions.

Add, movement, row transfer, action exit and removal update the index synchronously
inside the sequential physical pass. Reverse membership and swap removal avoid
scanning crowded rows. Explicit proposal observers receive bounded snapshots in
insertion order; visual completed-tick indexes do not own collision decisions.

The index and diagnostic counters are derived data, excluded from checkpoints.
Restore rebuilds them from validated owner/row membership and preserved insertion
identities. The candidate-world resource reservation includes worst-case index
headroom for the actor cap. Diagnostics expose candidates, exact bounds tests,
membership updates, retained/peak cells and estimated bytes. `queryAllocations`
counts explicit query scratch containers; JavaScript engine iterator allocations
are not instrumented.

Differential and work-count fixtures are added for edges, overlap, hazard priority,
movement, transfer, removal and 1–1,024 distant owners. Their execution, real-world
tick percentiles, dense overlap and allocation profiling remain deferred with the
backlog validation pass. No measured speedup is claimed by this implementation.
