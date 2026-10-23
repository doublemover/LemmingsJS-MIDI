# ProcGen resource budget

`createResourceBudget()` provides synchronous admission for allocations that
have a known size before they begin. The default tab profile is 512 MiB of
accounted memory. Canvas and export staging carry explicit overhead factors
because their native or duplicated storage cannot be measured as exact JavaScript
heap. The diagnostic reports resident bytes, estimated overhead, category totals,
peak, denials, evictions, and backing stores whose retirement could not be
confirmed.

Each subsystem owns a stable token. `reserve({token,owner,generation,kind,bytes})`
atomically admits or denies a new allocation; a replacement supplies the same
token and `previousBytes`. `release` removes only the matching owner's token.
`transfer` changes an owner generation without charging the same allocation
again. Registered evictors can retire reconstructible cold caches under pressure;
they must actually release their tokens before a waiting reservation is admitted.
Pinned physics, unsaved edits, active voices, and in-progress writes are not
eviction candidates.

The renderer uses this shared adapter in addition to its 64 MiB local cap. Its
backing-store reservations cover canvases, retained image arrays, and object
clip arrays. If browser canvas dimension retirement fails, its estimated bytes
stay charged. Prepared browser exports reserve staging before Blob construction
and keep that reservation until the last delivery lease releases. Both paths
still need combined-scene qualification with asset, audio, checkpoint, and
candidate-world allocations. Those categories must use the same service before
the full #1162 memory outcome can be claimed.
