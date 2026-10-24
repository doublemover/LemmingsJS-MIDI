# Asset acquisition and cache contract

`FileProvider` owns transport requests and optional reconstructible disk data.
It does not own mutable terrain, simulation clocks, recordings or sessions.

## Readers, handles and generations

`loadBinary(path, filename, options)` deduplicates an acquisition and returns a
fresh `BinaryReader` cursor to each consumer. `BinaryReader.data`, `ready` and
`copyBytes()` return owned copies; constructing a subreader keeps its cursor
independent and does not expose shared backing storage through `ready`.
`copyBytes()` copies only the logical window. Read-only parsing shares private
backing bytes. A mutating decoder or worker must explicitly copy bytes before
changing or transferring them.

Binary acquisition and XHR text acquisition have separate representation keys.
Text uses the browser's XHR text decoding. For an explicit encoding, acquire a
binary handle and call `handle.decodeText('utf-8')` (fatal decoding). Compatible
binary consumers share a request and a SHA-256 calculation.

`resolveAsset(urlOrPathAndFilename, options)` returns a frozen `RawAssetHandle`.
Its frozen `identity` contains `contentHash`, `generation`, `requestedUrl`,
`sourceRevision`, `verification` and `providerEpoch`. The content hash identifies
the byte generation; a locator is not a content identity. `createReader()` shares
private source bytes and creates a new cursor. Existing handles remain pinned
after the locator refreshes. SHA-256 availability is required for this API.
The hash authenticates an imported requirement only when checked against an
independently supplied `expectedHash`.

`forceReload: true` (or `cachePolicy: 'reload'`) explicitly requests a new
generation. Only the newest successful, required-hash-verified refresh publishes
for future ordinary reads. A failed refresh leaves the last accepted generation
available. `probeOnly: true` fetches without publishing or changing another
refresh's generation. `cachePolicy: 'no-store'` bypasses memory and disk caches;
HTTP `Cache-Control: no-store` also prevents admission. Existing readers do not
change when a refreshed locator publishes. There is no automatic world rebuild.

Disk hits with a stored hash are checked before use. Corrupt data is discarded
only when its generation still matches, then fetched once. Version 2 metadata and
payload generations must agree. Legacy records become misses and are removed by
reconciliation rather than trusted as current data. A warm memory hit with a
different required manifest hash fails integrity; callers explicitly refresh or
retain their previously pinned handle.

`cachePolicy: 'revalidate'` performs a conditional GET of the current generation.
Disk hits may also revalidate in the background. `If-None-Match` takes precedence
over `If-Modified-Since`; absent validators require a normal GET. A conditional
304 keeps the same content generation and updates IndexedDB freshness metadata
without rewriting its payload. An unsolicited 304 cannot create an empty asset.
HTTP failure retains the last accepted generation. Legacy internal probes without
cached bytes retain a bounded HEAD compatibility path; HEAD errors do not prove
freshness. `max-age` suppresses automatic probes until its lifetime expires.
Refreshes coalesce by representation, locator and required hash. An intervening
explicit generation invalidates an old probe's publication. A decoded asset
registry remains separate follow-up work.

## Required terrain closure

`loadProcgenMixedTerrain` prepares the unique families in explicit
`laneAssignments` with at most three concurrent collection preparations by
default (`maxConcurrentCollections` may select 1–8). It reports unselected
families in `unpreparedThemes`; selecting them in a later candidate prepares
their bytes then. Tooling that omits `laneAssignments`, or explicitly sets
`prepareAll: true`, prepares the full catalog. Failure of an unselected optional
collection does not discard already supported work.

Imported checkpoints supply `requiredFamilies`, an ordered array taken from
`checkpoint.assets.map(asset => asset.family)`. This preserves the exact saved
closure and theme order, including inactive declared families in older saves.
Unknown families, duplicate declarations and a closure missing an assigned
family fail before any asset read. A missing required collection reports its
`collection`, typed transport cause and operation identity; a different family
is never substituted.

Preparation accepts the candidate's `signal` and emits
`{phase: 'collection', collection, state, completed, total, operationId}`.
`AssetPreparationScope` registers each manager/terrain cleanup as it is acquired,
aborts siblings on required failure, retires already prepared siblings and
reconciles resources registered by a late branch. Known asynchronous cleanup is
awaited before rejection. Progress observers cannot fail preparation.

`EditorAssetCache` coalesces pending decode work within one cache, with separate
consumer cancellation and an identity-safe cache epoch. Clearing or losing the
last consumer cancels sibling raw loads and prevents late decoding/publication.
Cache identities include provider/root/epoch, style, ground set, source revision
and declared resource pins. Each declared terrain pin verifies the exact root
and SHA-256 before decode, and source provenance is retained in the payload.

Decoded image frames and palettes still belong to each manager and can be
mutable. They are **not** globally shared or made immutable with `Object.freeze`.
Warm rebuilds therefore still repeat decoded art fingerprinting/compilation.
A future shared decoded registry needs a deliberate read-only representation
and lifetime/memory reservations before allocation; the raw content-handle
boundary and reduced required closure do not claim to implement that registry.

## Lifetime and failure policy

Every acquisition has a provider epoch, request identity, consumer count,
controller, phase and deadline. Cancellation belongs to that acquisition. The
last canceled consumer retires its cache probe, queued request and transport;
canceling one shared consumer preserves the others. A cache probe cannot start
late network work after its consumer retires. An old rejection cannot remove a
newer acquisition. Consumer verification also has a deadline.

Defaults are 16 active requests, 128 queued requests, 15 seconds per acquisition
and consumer, 64 MiB per response, and a 300 ms optional cache probe. XHR progress
rejects an advertised or observed oversized body before completion when possible.
Text response admission uses a conservative UTF-16 length check. There are zero
automatic network retries: HTTP failure is never retried merely because a cache
is enabled. A caller can explicitly retry a `retryable` outcome under its owning
world operation.

Errors expose `kind`, `status`, `requestedUrl`, `cause`, `retryable` and
`operationId`; human messages and routine logs omit URLs and payloads. HTTP
404/410 are absence. Denied, rate-limited, server, network, timeout, cancelled,
integrity and decode failures are distinct and do not select a substitute pack.
Only typed absence (or Node ENOENT) advances LevelLoader's ordered fallback roots.
Pinned resources use exactly their declared root and hash. Optional absent odd
tables retain base properties; `oddTableRequired: true` rejects missing entries.

Required verified bytes resolve independently of optional persistence. Open,
read, transaction and background bookkeeping attempts are bounded; a late open
closes its connection. Disposal prevents reopening, aborts owned transactions
and requests, and retires queued persistence and revalidation.

`acquireLease()` returns `{provider, release()}`. A candidate acquires its lease
before preparation, transfers it to the committed runtime, and releases it on
failure. `dispose()` requests retirement; outstanding leases keep their provider
usable. The final idempotent `release()` performs retirement. New leases cannot
be acquired after retirement is requested. ProcGen runtime teardown releases the
transferred lease even if another cleanup step fails.

### Raw storage reservations

Pass `{budgetAdapter, budgetOwner}` to `FileProvider`, or call
`setBudgetAdapter(sharedBudget)` before the first binary acquisition. The adapter
uses the synchronous ResourceBudget `reserve`, `release` and optional
`registerEvictor` methods. Owners must be unique when supplied explicitly.

`binaryTransport: 'auto'` uses Fetch streaming when a budget adapter and Fetch
are available and no XHR adapter was injected. `stream` explicitly selects this
path, including an injected Fetch adapter; `xhr` keeps the legacy transport.
Streaming reserves its first buffer before sending. The initial buffer defaults
to 64 KiB (`binaryChunkBytes`, capped at 1 MiB), bounded by `maxResponseBytes`.
Content-Length may reject an advertised oversized response but never reduces
admission or proves the decoded body size.

The streaming reader prefers BYOB: the platform fills an admitted view and
transfers its buffer back, preserving previous bytes. Growth reserves both old
and replacement capacities before allocating/copying. An admitted one-byte probe
distinguishes EOF from necessary growth or excess, including an exact ceiling.
The final exact-size buffer is also admitted before copying. There is no
`response.arrayBuffer()` materialization. Missing or lying small lengths and
compressed bodies follow the same observed decoded-byte limit. A denied first
buffer fails with `kind: 'budget'` before Fetch is called; a later denial cancels
the read before the requested allocation and preserves active generations.

`requireByob: true` rejects an unavailable BYOB boundary without retrying another
transport. Otherwise an ordinary stream reader is an explicitly estimated
fallback because its platform-created chunks cannot be admitted before delivery.
`byobResponses` and `estimatedStreamResponses` distinguish the two. Legacy XHR
reserves the configured response ceiling before construction/send and shrinks
to the completed count. Its native buffering remains estimated. These
conservative reservations may refuse a small response near the shared limit.

One raw allocation has one stable budget token. `BinaryReader.release()` and
`RawAssetHandle.release()` are idempotent; each fork keeps its own reference to
the same allocation. Released readers/handles reject further reads or forks.
Cache eviction, replacement, clear and provider disposal remove cache references;
active readers and older pinned generations remain readable and charged until
their last reference releases. Editor preparation releases temporary handles,
compressed readers and unpacked readers after synchronous decoding, including
late sibling completions. Decompression releases BitReader's private source
fork on success and failure. FinalizationRegistry is a fallback for legacy callers;
prompt recovery of budget capacity requires explicit release.

Hash copies reserve twice the logical byte count before copying (including a
digest-input estimate). IndexedDB binary reads reserve declared payload bytes
before requesting the payload, writes reserve their structured-clone estimate,
and reconciliation scans payload keys without cloning each body. Binary
localStorage decoding and serialization also reserve their transient expansion.
An asynchronous hash or persistence attempt retains its bytes until the actual
attempt settles, even when optional bookkeeping has already timed out. The
budget therefore continues to show unresolved native work after cancellation.

`getRawAssetStats()` reports storage count and resident, pinned and cache bytes.
It also reports cumulative reservations/denials, retired storage, evicted storage
and bytes, peak reserved bytes, binary network responses/bytes and SHA input
copies/bytes. The copy count tracks provider-created digest inputs; caller-owned
copies and native browser copies are excluded. Forking readers does not increment
it. Peak reserved bytes include response headroom and transient estimates.
Stream buffer allocations, copies and copied bytes are counted separately.
These include reserved response ceilings and transient estimates while work is
pending. Cancellation returns an unused pre-header reservation immediately;
an allocated buffer held by an uncooperative pending read stays charged until
that read actually settles. Browser network buffering, XHR, crypto and IndexedDB
internal copies remain estimates;
XHR does not expose chunk admission, and native buffering may overshoot a limit
before a progress callback observes it. These reservations are not a measured
browser heap ceiling. In particular,
malformed IndexedDB records can only be validated after the browser has cloned
them. Caller-owned `copyBytes`/`data`/`ready` copies, primitive text lifetimes and
decoded mutable art are outside this raw-storage accounting. This adapter does
not claim pre-admission coverage for decoder expansion or the combined
1024-lane/audio/recovery benchmark.

### Container and decoder consumers

`FileContainer` owns a separate source cursor, preserving the caller's offset.
Its `dispose()` releases that cursor and the private unpacked-part caches.
`UnpackFilePart.unpack()` returns an independent reader on the first call and
every later call. Releasing a returned part cannot poison the cached part, and
returned part readers remain readable after container disposal. Source identity,
filename and folder provenance follow the decoded reader separately from its
decoded bytes.

`GameResources.dispose()` aborts its MAIN.DAT consumer and retires its container,
including late completion. It does not close the provider or dispose already
prepared sprite/mask/HUD objects. Temporary preparation views call it after
transferring those objects and their provider lease. A surviving GameResources
owner can continue reading the same raw generation. Sprite/mask helpers release
their temporary part cursors after synchronous construction.

`LevelLoader.getLevel(mode, index, {signal, operationId})` owns its raw readers,
containers and part cursors until level construction finishes. Success or failure
retires them, aborts unfinished sibling consumers and releases late results. It
rejects cancellation before the first read. Pinned browser resources consume the
verified raw handle rather than making a second digest copy. The resulting level
owns its decoded maps and object data; disposing raw cursors does not change it.

## Disk budgets and recovery

IndexedDB admits at most 50 MiB of raw binary bytes plus UTF-8 encoded text bytes.
This accounting deliberately excludes browser-internal index/metadata overhead;
browser quota is a separate fallible limit. Metadata and payload overwrite,
budget eviction and `totalBytes` update occur in one readwrite transaction.
Recency updates read the current metadata within their transaction and coarsen
touches to once per locator per 30 seconds. Stats publish after commit and report
the last total observed by that provider, not an instantaneous cross-tab query.
Oversized entries bypass admission before opening or evicting the cache.

`reconcilePersistentCache()` scans at most 10,000 records within the cache
transaction deadline, removes incompatible/partial records and orphan payloads,
recalculates the total and enforces the cap. An absent or incompatible accounting
record triggers reconciliation during admission. Existing malformed entry data
also triggers reconciliation before overwrite. Aborted transactions do not
publish successful writes or change visible byte stats.

The localStorage fallback admits at most 4 MiB using twice the UTF-16 code-unit
count of owned keys and serialized JSON values. That includes base64 expansion
and metadata. Oversized raw data is rejected before expensive serialization.
Warm reads perform one key lookup, zero payload writes and zero origin scans.
Recency is coarse insertion/replacement order. Scans happen on admission/eviction,
not on reads. Only `lem-cache:` keys may be evicted. No user session or unrelated
application key is removed.

Production fallback writes take the shared exclusive `lem-cache:admission` Web
Lock with `ifAvailable: true`. Admission, eviction and write occur synchronously
inside that lock, so participating tabs cannot race the cap. A busy/unavailable
lock or expired grant skips the optional write; it never delays required bytes.
Existing fallback records remain readable on browsers without Web Locks. The
private synchronous store helper requires its caller to hold the admission lock.

## Focused evidence

`test/fileprovider-revalidation.test.js` covers conditional 304, validator
precedence, missing validators, shared cancellation, racing generations and
refresh failure. `test/fileprovider-ownership.test.js` covers consumer/epoch races, blocked opens,
verification cancellation, independent cursors and windows, transfer copies,
pinned refresh failure, competing refreshes, probe isolation, no-store, hash
reuse and corrupted disk data. Existing provider fixtures cover cache admission,
stale metadata touches, delayed prune totals and transaction settlement.
`test/fileprovider-budget.test.js` checks denial before XHR, shared fork charges,
old/current generations, explicit release, 304 refresh pins, no-store ownership,
digest completion after disposal, cache retirement and late/busy lock grants.
`test/fileprovider-stream.test.js` checks BYOB growth/final-copy admission,
unknown/lying lengths, exact-ceiling EOF, four concurrent oversized bodies,
timeout and late cancellation, strict/estimated boundaries, 304 reuse and typed
HTTP failure without automatic retry.

`e2e/asset-resilience.spec.js` serves the real absent seasonal resource over HTTP,
compares fallback terrain and steel to an explicitly pinned source, checks denied,
rate-limit/server responses, and exercises real IndexedDB/localStorage warm reads,
cross-provider writes, injected quota refusal and reconciliation, real raw-budget
warm reads and simultaneous fallback writes from separate tabs. It also verifies
that real terrain decoding leaves no pinned compressed cursors. A two-owner
GameResources/LevelLoader fixture verifies immediate retirement while another
raw owner and previously returned decoded readers keep working. Annotations
report warm operation counts and maximum observed read duration. These are small
browser fixtures, not a full instrument startup or 1/8/1024-lane memory benchmark.
