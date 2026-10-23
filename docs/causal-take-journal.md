# Causal take journal

The causal journal is the durable source for physical takes. The workstation
session database upgrades from version 3 to version 4, preserving `sessions` and
`projectMetadata` and adding `takeManifests`, `takeChunks` and `takeCheckpoints`.
There is no second take database. Each append transaction compares the manifest
revision and atomically stores its immutable chunk/checkpoint and new durable
prefix. A repeated commit ID must have identical manifest content. Concurrent
writers cannot both extend the same revision.

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

`branch({parentTakeId, throughSequence, takeId, takeName})` shares immutable source
chunk references with explicit per-reference cutoffs, then appends a new chain.
Each ancestor cutoff survives subsequent branches. The initial checkpoint stays
at sequence zero; a branch must replay its prefix rather than relabeling an old
checkpoint as state at the fork boundary. Original take records remain intact.

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
deliver anything. Portable archive encoding/import and the actual qualified
re-performance executor are separate integrations; journal completeness never
claims source mechanics or delivery evidence that were not observed.
