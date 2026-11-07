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
and keep that reservation until the last delivery lease releases. Workstation
candidate worlds reserve an estimated lane and actor envelope before construction
while the old world remains charged. The token transfers on commit and releases
on retirement or failed preparation. This initial envelope does not measure
subsequent terrain growth. Asset, audio, and checkpoint allocations still need
integration and combined-scene qualification before the full #1162 memory
outcome can be claimed.

The checkJs boundary is declared in
`js/app/resources/ResourceBudgetContracts.d.ts`. A leaf adapter acknowledges
reserve/release synchronously; an exact-token inspection is either an immutable
owned reservation or explicit `null` for absence. A Promise is never admission
or proof of absence. Initial background admission captures adapter methods before
calling them, retains attempted allocations through rollback and keeps the shared
charge until external uncertainty retires. Defensive rollback can join an
unexpected asynchronous release without advertising async admission support.

Eviction callbacks run synchronously and must release actual owned reservations
before returning. A returned Promise is counted as a failed callback and its
rejection is contained; its eventual result cannot grant the waiting admission.
Diagnostics detach and freeze nested category, eviction and bounded owner
observations. They report accounting and estimated pressure, not native-resource
retirement or acoustic/device delivery.

The checked ownership helper uses
`js/app/resources/OwnedResourceReservationContracts.d.ts`. A required owner/kind
admits a numeric byte count and returns an immutable observation with
`reserved`, `released` or `failed-or-unknown` state. `release()` is a synchronous
acknowledgment, separate from a producer's asynchronous retirement completion.
Failed acknowledgment prevents later resize/reuse; an ordinary budget refusal
leaves the previous admitted reservation intact. Catalog factories preserve their
argument/result types through the workspace wrapper; cached values remain
`unknown` until their domain owner validates them. Critical checkJs covers both
implementations, and boundary fixtures reject missing identity, display-text byte
counts, asynchronous budget acknowledgments and unvalidated cache reads.
