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

Revalidation uses bounded HEAD followed by GET when validators differ or are
absent. ETag takes precedence over Last-Modified. HEAD failures do not establish
freshness. `max-age` suppresses probes until its lifetime expires. Refresh work
coalesces by locator; an intervening explicit generation invalidates an old
probe's publication. Conditional GET/304 and a decoded asset registry remain
separate follow-up work.

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

## Focused evidence

`test/fileprovider-ownership.test.js` covers consumer/epoch races, blocked opens,
verification cancellation, independent cursors and windows, transfer copies,
pinned refresh failure, competing refreshes, probe isolation, no-store, hash
reuse and corrupted disk data. Existing provider fixtures cover cache admission,
stale metadata touches, delayed prune totals and transaction settlement.

`e2e/asset-resilience.spec.js` serves the real absent seasonal resource over HTTP,
compares fallback terrain and steel to an explicitly pinned source, checks denied,
rate-limit/server responses, and exercises real IndexedDB/localStorage warm reads,
cross-provider writes, injected quota refusal and reconciliation. Its annotations
report warm operation counts and maximum observed read duration. These are small
browser fixtures, not a full instrument startup or 1/8/1024-lane memory benchmark.
