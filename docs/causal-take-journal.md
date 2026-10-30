# Causal take journal

The causal journal is the durable source for physical takes. The workstation
session database upgrades to version 5, preserving `sessions` and
`projectMetadata`. Immutable source headers, compact mutable heads, compact
browsing summaries and append-only chunk/checkpoint index rows have separate
stores. Existing version 4 manifests migrate atomically during upgrade, then
their old authoritative rows are removed. Chunk and checkpoint bytes retain
their original hashes and identities. There is no second take database.

Each append transaction compares the head revision and atomically adds only the
new bytes/index row and updates the compact head/summary. It never reads or
serializes earlier index rows or the source header. A repeated commit ID must
have identical compact metadata, index references and content hashes. Concurrent
writers cannot both extend the same revision. Lost-receipt reconciliation reads
only the compact head. The recorder retains its index in memory and appends to
it only after durable publication; explicit manifest inspection returns a copy.
Library browsing opens only `takeSummaries`. Full manifest reconstruction is an
explicit operation with cancelable index pages of at most 256 rows and a total
row budget; it rejects a revision change while materializing. Regression
fixtures for this layout are added but runtime execution remains deferred.

Finalized source revisions are qualified under journal-owned immutable objects.
A bounded LRU retains at most eight qualifications with a 16 MiB memory estimate.
Each query rechecks the compact head before and after I/O. Revision, commit
content or finalization changes invalidate qualification; mutable recordings are
qualified separately. Sequence windows use binary bounds, and repeated tick
windows use bounded cached interval indexes. Each fetched chunk still passes its
original byte/hash/record-index validator. Explicit `verify` or
`openTake(id, {force: true})` requalifies the persisted index for corruption
inspection; no caller-supplied object can act as a qualification handle.

New branch headers store versioned lineage, the parent root and captured chain
frontier, the source cutoff and a hash of the selected index range. They do not
copy ancestor reference arrays. Inspection/query/export resolves that lineage
under a 32-ancestor depth limit and the existing total index budget, preserving
each ancestor cutoff. Materialized archive manifests include the resolved range
and validate it against the lineage hash. Existing version 1 materialized
prefixes remain readable.

## Integration

Construct `createProcgenCausalJournal({storage, resourceBudget, onState})` using
`createProcgenSessionStorage` as storage and the shared `ResourceBudget` instance.
Then await `createCausalTakeRecorder({journal, takeId, takeName, documentId,
sourceVersions, captureProfile, boundaryState, initialCheckpoint, mapping,
assetRefs})`. `takeName` defaults to `Untitled take`, is trimmed and limited to
120 characters, and is immutable creation metadata.

`initialCheckpoint` holds the existing world checkpoint, causal engine snapshot
and score timeline. `sourceVersions` declares the generator, checkpoint, batch,
music, project and numeric canonicalization versions. `assetRefs` retain exact
asset family, identity and revision. `boundaryState` inventories actually known
voices, travel, contact spans and timeline; omitting a component does not claim
its capture. Generation and tick remain separate from the journal sequence.

After `PhysicalScoreClock.observe` and `CausalMusicEngine.processBatch`, call
`recordCommittedBatch({batch, intents, deliveryOutcomes})` synchronously. It admits
the physical batch and canonical intents together and returns an explicit
accepted/rejected receipt. Collect synchronous dispatcher receipts while that
batch is processed; append later backend evidence with `recordSinkOutcome`.
Inputs, commands, mappings, timeline changes and markers have dedicated methods.
Neither capture nor journal failure calls a physical or output sink.

`markGap({kind, firstTick, lastTick, generation, reason})` persists a typed gap
marker and updates `status().coverage` immediately. A missed physical boundary
cannot later finalize as a complete take; later valid boundaries can still record.

Call `stop({boundaryState, reason})` before replacing the document. A held voice
or planned future end is boundary state, not a synthetic original note event.
`status()` separates admitted sequence, durable sequence, pending bytes and
complete/partial state. A failed undurable tail remains owned until an explicit
`discardPending({reason})` after stop. `canReplaceDocument()` remains false while
that tail is retained. Unfinished on-disk recordings reopen as partial.

For final world-state comparison, pass `finalCheckpoint` to `stop`. It closes
recording admission synchronously, persists the full world/engine/timeline/replay
component checkpoint at the last admitted sequence, then finalizes. Live physics
can continue. A failed final checkpoint makes finalization partial. Repeated
different checkpoint content at one sequence is a conflict, not a replacement.

## Identity, storage and memory

Canonical data preserve nested finite Float64 values, negative zero, movement
arrays, expression and exact cause/actor/voice IDs. Object keys are sorted;
cycles, sparse arrays, unsupported prototypes and unsafe property keys fail
admission. SHA-256 binds immutable source metadata, sequential chunk content and
finalization evidence including chunk indexes, coverage and checkpoints. This
detects accidental corruption; it does not authenticate an external author.

`storage.listCausalTakes({limit, cursor})` uses the manifest primary-key index
and returns bounded summary `items`, `nextCursor` and explicit
`order: "take-id-ascending"`. The default page is 20, capped at 100; it does not
load every take or reactivate recording. Pass the returned cursor unchanged to
read the next page after a reload.

Default bounds are 1 MiB per record, 4 MiB per chunk, 64 records per chunk,
8 MiB pending and 4,096 chunks. Checkpoints are capped at 32 MiB and manifests at
8 MiB. Before canonical encoding/cloning, a bounded structural traversal estimates
storage and requests a conservative shared resource reservation. Small traversal
allocations occur before that reservation. Owner `causal-journal` holds pending
leases through durable commit or explicit discard and releases transient encoding
and checkpoint leases at completion. A rejected reservation is a typed partial
recording outcome and leaves live physics running.

## Inspection, replay and branches

`openTake(takeId)` returns a frozen, paused inspection manifest with recording,
hardware, MIDI thru and physical layers disarmed. `verify(takeId)` checks the
durable prefix, checkpoint and SHA-256 chain. `query` filters coarse chunk ranges
and returns bounded exact records with a continuation sequence. Revision and
cancellation checks reject stale requests. Queries do not step worlds or emit
intents.

`seek({takeId, sequence, sourceVersions, assetRefs})` returns a qualified
re-performance plan: checkpoint, exact following records, target sequence and a
continuation cursor when the bounded result cannot contain the whole range.
The caller must restore and execute the recorded inputs in a separate qualified
world. This API does not claim that reading records performed or verified that
simulation. `compareCausalRecords` reports the first divergent sequence, tick
and actual differing cause.

`createCausalReperformance({journal, createWorld, sourceVersions, assetRefs,
resourceBudget})` executes this comparison in a fresh isolated world. The
configured factory is trusted application code; no imported take supplies code,
module URLs, devices or output sinks. `preflight` checks source/assets and codec
availability before world allocation. `reperform({takeId, throughSequence,
executionEpoch, mode: "compatibility", signal})` restores the initial checkpoint,
replays recorded commands, tempo, speed, pause/resume observations and explicitly
observation-only external inputs, then compares physical batches and semantic
intents in their original mutation order. Unknown input effects refuse replay.
`initialCheckpoint.replay` declares `{version: 1, bpm, scoreTimeline}`; tempo and
speed changes must be recorded at their source boundaries.

Component checkpoints become reusable only after re-performance actually reaches
and matches their physical, engine and timeline state. The bounded validation
cache belongs to that service instance and original take hash. Imported integrity
claims alone never make a snapshot a trusted seek point. Final world parity is
reported as unknown when no matching final component checkpoint was captured.
`retainWorld: true` returns a paused owned session for a complete batch/intent
boundary; its `snapshot()` can supply a genuinely computed branch checkpoint.
The caller releases it with `dispose()`; disposing the service releases remaining
sessions. Shared workspace reservations use actual checkpoint byte inventories
and owner `causal-journal`, and live through retained session ownership. Source
metadata is read before workspace admission, with the manifest's 8 MiB bound.

Current runtime comparisons remain explicitly **execution unbound**: fetched or
filesystem source hashes do not attest the active imported module graph. Matching
facts/intents/state report `compatibilityMatch`, never `exactQualified`. Exact mode
refuses before world allocation until a trusted immutable build authority exists.
This is separate from verified archive/chunk integrity and from MIDI/acoustic
evidence. Execution epochs wrap historical IDs for future sink ownership without
rewriting original cause/voice IDs.

Checkpoint envelopes declare component codecs and numeric encoding. Explicit
legacy migration preserves the original and typed floating sentinels; ambiguous
legacy JSON nulls refuse migration. The authoritative state hash preserves actor
array order and physics state while excluding scenery, derived music position
buffers, ground-query counters and legacy wall time. Scenery remains a separate
presentation restore component.

`branch({parentTakeId, throughSequence, takeId, takeName})` shares immutable source
chunk references with explicit per-reference cutoffs, then appends a new chain.
Each ancestor cutoff survives subsequent branches. The initial checkpoint stays
at sequence zero; a branch must replay its prefix rather than relabeling an old
checkpoint as state at the fork boundary. Original take records remain intact.

`createCausalPhysicalBranch({journal, reperformance, parentTakeId,
throughSequence, takeId, takeName, executionEpoch})` coordinates physical
continuation. It re-performs the selected prefix, requires a complete batch and
intent boundary, stores the compared boundary qualification in immutable lineage,
and writes a genuinely computed component checkpoint. The parent revision/hash
must still match. Original source/event/voice IDs remain historical identity;
the new execution epoch is separate sink ownership. Exact mode remains refused
while active execution identity is unbound.

The returned branch starts paused without output sinks. `advance({ticks, signal})`
executes a bounded number of ordinary world steps. Commands, tempo, speed, mapping
changes and markers go through its dedicated methods into the same semantic
recorder. Prefix capture inventory comes from actually compared records: later
parent mapping revisions and gaps are clipped out of an earlier fork. Repeated
forks preserve every ancestor chunk cutoff. `stop()` persists final component
state; `dispose()` releases the isolated world and workspace after finalization.
An undurable active tail requires an explicit discard reason before ownership
can be released. Failed preparation has not activated physical continuation and
releases only its unperformed provisional metadata. Cancellation retains the
last committed source boundary, and runtime retirement is never captured as an
observed musical release.

## Semantic capture preflight

`createPhysicalScoreProjection({journal})` exposes `queryPhysicalScore` and
`queryCausalParent`. Score queries require take revision, generation, a physical
tick coverage range and request identity. They return immutable typed glyphs,
stable actor/voice strands, lane transfers, exact source pointers, cause ancestry,
captured clock segments and actual per-sink evidence. Actor/role filters and
generation/kind chunk indexes keep small queries bounded. Physical source time,
causal order and interpreted musical time are separate axis modes. A fact without
captured interpreted time has an unknown musical axis; the query never quantizes
or reruns its mapping.

Dense display aggregation retains exact event counts, first/last source identity,
precision counts and expansion handles back to the original source selection.
It creates no new musical event. Results include source gaps, unknown evidence
and continuation within a dense batch when the bounded window fills. Parent
lookup uses the glyph's journal sequence pointer rather than scanning a take.
Cancellation/superseded request IDs and stale take revisions reject explicitly.
Both query paths remain paused with hardware output disabled.

`planCausalReinterpretation` compares graph requirements to the capture profile,
actually inventoried state, captured range and typed coverage gaps. Each result
is `supported-directly`, `supported-by-verified-reconstruction`, `unavailable` or
`unknown`. Verified reconstruction must match the original take hash, source
versions, asset references and requested range. An endpoint-only motion record
does not satisfy exact segment-path articulation. Gate-only capture cannot claim
raw contact/movement reinterpretation.

`querySoundOnlyRevoice` retains original intent, voice, cause and ordering identity
and attaches a separate playback execution epoch and sound patch. It does not
deliver anything. Portable archive encoding/import has its own admission and
provenance checks; journal completeness never claims source mechanics or delivery
evidence that were not observed.

## Durability recovery

Stopping capture freezes its final boundary and prevents new admission. A failed
chunk, component checkpoint or finalization write leaves the durable manifest in
`recording` and exposes `recovery-required` on its owning writer. Retry uses the
same admitted immutable suffix and original stop boundary. Only a successful
finalization transaction makes the take terminal and permits world replacement.

The workstation offers Retry saving take and a separately confirmed Discard
unsaved tail action. Discard records the exact omitted source sequence and tick
range, releases its memory, and still requires a durable partial finalization.
It does not reopen terminal takes. Branch disposal obeys the same rule. Regression
fixtures include selective chunk failure with healthy manifest writes; runtime
execution is deferred during this implementation pass.

## Bounded coverage knowledge

Coverage intervals merge by kind, reason, generation and scope, including repeated
same-tick observations. Movement-path gaps are recorded once per physical batch.
Overlapping dropped counts retain an explicit lower bound rather than counting
one report repeatedly. At capacity, an open unknown suffix preserves uncertainty
across subsequent kinds and generations; legacy frozen overflow markers have the
same conservative interpretation. Known earlier ranges remain queryable.

The shared coverage query returns known-covered, known-missing or unknown.
Reinterpretation, replay/branch admission and score inspection use that result;
a declared capture profile alone never certifies a source range. The new interval
fixtures are staged for the deferred runtime validation pass.

PhysicalScore resolves captured semantic companions independently of its record
page. New records carry an explicit admission-group sequence range; older records
use a bounded same-tick companion lookup. Read count and workspace byte limits are
separate from glyph limits. An unresolved role join is reported as unavailable,
never silently treated as a role mismatch. Immediate grouped outcomes remain
distinct from later evidence outside the inspected window. Continuation cursors
are bound to take revision, source range, axis, filters and aggregation settings.

New physical worlds use stall-cascade decision policy 2. Each actor has a keyed
procedural seed derived from its lane seed and lane-local birth ordinal. Cascade
spacing uses that identity while causal ownership retains lifetime actor IDs.
Checkpoint state, checkpoint policy metadata and take source versions pin the
decision policy; existing policy-1 checkpoint queues retain their original times
and versioned continuation. Seed replay starts policy 2 and is not a claim of
byte-identical continuation of an older policy. The source audit found the cascade
modulo as the lifetime-ID-dependent procedural choice; lane policy exploration
already uses birth lane/ordinal, and other actor-ID uses retain ownership/order.

## Isolated take workbench

The Physical inspector offers current-runtime comparison and a paused branch
from an explicit record boundary (or the durable end). Re-performance compares
real physical batches, semantic companions and component checkpoints before a
branch is writable. Source versions and installed terrain identities must match.
This is current-runtime compatibility evidence; exact archived execution remains
unqualified. Inspection and branch stepping enable neither browser audio nor
hardware output, and do not replace or edit the live project.

Inspection worlds own fresh terrain, sprite/mask resources, provider leases and
candidate memory. They share immutable asset jobs while retaining separate
mutable readers and world state. Accepted asynchronous construction/disposal
holds replay workspace until actual settlement. Cleanup attempts independent
owners and keeps failed reservations counted. Store closure waits for branch
finalization. A stopped branch with an undurable tail remains retryable; discarding
that tail is a separate confirmed action preserving its omitted range.

New replay checkpoints use version 2, with explicit musical playback admission.
Paused manual world steps can therefore retain physical facts with no musical
intents; recorded resume/pause decisions are replayed at their source boundary.
Branches can explicitly enable or pause interpretation while output remains off.
Version-1 component fixtures retain their declared always-interpreting semantics.
The current workstation source contract names playback-admission version 1;
older incompatible source contracts are reported instead of silently relabeled.
Markers use the recorder's actual last committed physical boundary, independently
of whether its musical engine advanced. New workflow and retirement regressions
are authored but unexecuted during the frontloaded implementation pass.

Journal verification now uses the shared fixed `verify-causal-source` job before
loading each checkpoint or chunk. New references include exact UTF-8 bytes and
canonical object counts so admission can reserve parsing, hash and transfer
overlap without guessing from a filename. Legacy references use a conservative
bound and can be refused when it cannot fit the selected memory profile. The
worker verifies hash, canonical encoding, object inventory and chunk metadata;
verification receives compact chain receipts. The take head is rechecked after
asynchronous source verification to reject a changed revision.

`readChunkOwned` and `readCheckpointOwned` expose exclusive parsed snapshots with
explicit retirement. Their reservations survive cancellation of an accepted
storage read until that native operation actually settles. Old convenience reads
remain available for existing callers; replay/query adoption of owned readers is
the next integration step. The stored source is immutable; the exclusive parsed
copy does not grant authority to modify it. Storage-side native delivery overhead
remains an estimate, and malformed oversized stored records are rejected. New
admission, inventory and late-storage fixtures are authored and unexecuted.

`queryOwned` selects matching records in the source-verification worker. It
retains the selected result leases and a separate metadata/index reservation
until the caller releases the page. Sparse queries no longer retain or re-encode
every full chunk in the UI thread. A returned continuation names the first
matching record outside the page's record/byte bound. Private parsed edits cannot
change stored canonical bytes. Result retirement attempts every independent
source; failed releases stay charged and are not retried blindly. Qualification
cache retirement likewise attempts all entries and retains failed accounting.
The legacy convenience query deep-freezes its return for compatibility; runtime
consumers are being migrated to explicit owned pages and checkpoints.

Detached re-performance now uses owned checkpoint and page readers. Preflight
and checkpoint comparisons close their temporary readers after use; a retained
world keeps its initial checkpoint until native world retirement. Page readers
close independently at every replay page boundary. An accepted checkpoint read
that resolves after cancellation is still retired, and cannot start a late world.
Workspace accounting waits for actual source/world settlement; a logical timeout
does not release it early. Refused source retirement stays visible and is not
reissued. Retired session graph/replay/configuration access is fenced immediately.
Late-read, asynchronous-world and refused-release fixtures remain unexecuted.
Cancellation also waits for the replay loop to quiesce before retiring its source
and workspace. This covers a pending page, checkpoint comparison or native hash
that still has access to those objects after the world has stopped.

Owned data snapshots provide a fixed shared-worker path for publishing a bounded
canonical result independently of its preparation request. The producer declares
its held input footprint before clone/encoding overlap is admitted. Successful
publication detaches request cancellation; a canceled replacement therefore does
not retire an already published snapshot. Result lifetime ends at explicit reader
retirement. Shared resource reservations can grow before adoption, preserve their
prior bound on ordinary capacity denial, and cache unknown bookkeeping outcomes.
Background jobs also clear acknowledged producer callbacks instead of retaining
their captured input graphs after computation. Snapshot and refusal fixtures are
authored and unexecuted; score-view adoption follows.

PhysicalScore and causal-parent lookups now adopt owned query records under a
bounded view workspace, then publish an independent worker-prepared snapshot.
Cause-to-intent links reserve ahead in small blocks and have an explicit limit;
duplicate source references never become an excuse to deduplicate musical
intents. Companion byte counts come from worker inventories. Main-thread score
construction no longer re-encodes each companion or deep-clones its whole result.
Take metadata has an independent reader lease, and cached metadata/index estimates
include object counts plus bounded tick-tree capacity before building those trees.

The workstation keeps the displayed snapshot until a replacement succeeds, and
retires it on replacement, take selection or teardown. Canceled/stale results are
retired independently. A completed result survives cancellation of its original
preparation request. Cleanup faults remain charged, are shown explicitly, and do
not change the durable take. Owned score/cancellation and cause-link limit fixtures
are authored and unexecuted.

Sound-only revoice exposes an owned result API using the same page/workspace
contract. It pins the source revision/hash, caps intent count before flattening,
and publishes a worker-owned snapshot independently of request cancellation.
The requested patch is bounded and copied before asynchronous reads. Captured
intent times, causes and voice IDs are unchanged. Coverage and source-record
ranges accompany the result; generation-filtered, paged, cropped and inherited
prefix windows explicitly require boundary-state reconstruction. No attack is
invented to make a partial window playable. Reader authority is private and tied
to the same root budget; copied receipt fields cannot qualify an unowned source.
This prepares data for playback/rendering; it does not itself audition or prove
rendered PCM. Ownership, identity and capacity fixtures remain unexecuted.

Route-dependent reinterpretation requires `route-coordinate-history-v2` coverage
and the matching marker-bound route definitions captured at the initial component
boundary. The default physical capture profile is `physical-basic-v20`. Generic
physical-domain coverage alone cannot establish branch or lap history. Moving a
marker or requesting a route that was never captured returns
`route-definition-history-not-captured`; endpoint poses cannot qualify it.
Verified derived route reconstruction is not implemented by this boundary.

The actual scored-world route corpus records both a route-aware take and a take
that never requests route coordinates, closes/reopens native IndexedDB in
Playwright, seeks to tick 200 inside a loop, and resumes through tick 401. It
compares every future physical fact, musical intent and observer state while
preserving the durable original. Missing history and incompatible marker history
refuse transactionally. These are original controlled terrain fixtures using
production actors, masks and compilation; they do not qualify an installed-asset
matrix, acoustic output or hardware receivers.
