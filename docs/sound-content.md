# Sound content data

`SoundContentPack` uses `lemmings-sound-content/v1`. It records an immutable
version, per-file content hashes, asset ancestry, exact patch revisions,
required engine artifact/schema hashes, and hashed license-text snapshots.
Engine code, patch recipes and recorded/derived material retain separate rights
records. An engine license cannot supply missing sample rights.

`prepareSoundContentPack` bounds and freezes declarative input, validates known
patch definitions against application-provided engine descriptors, checks
license text hashes and rejects unsafe paths, executable asset kinds, cyclic
ancestry and conflicting inventory identities. Unknown engines retain an
inspectable definition. Imported data never registers an engine or evaluates
source code. Unordered inventory traversal produces one canonical content hash.

`planSoundContentSelection` follows the selected saved patch revisions and
their declared asset ancestry. Unrelated files are excluded. Credits remain
per dependency; the pack's display license never overrides a mixed set of
recording licenses. A local review callback supplies redistribution decisions;
the imported pack cannot grant itself a trusted review receipt. Each local
review decision binds both the exact content hash and the rights
record hash; a name or copied preparation label grants no authority. Archive
review references remain untrusted evidence on a receiving installation.
Missing creator, source, terms or permission yields a reference-only plan. Private playback and
redistribution eligibility are separate decisions.

Preparation is an inventory/rights preflight. Definition admission, available
asset bytes, backend preparation, isolated audition, durable installation and
export delivery are distinct boundaries. These APIs do not certify a renderer,
claim legal clearance, change a performing lane, fetch declared source URLs,
or install content into a project. Their fixtures remain unexecuted during the
frontloaded backlog implementation pass.

The existing instrument-patch registry now admits whole bounded batches before
publishing any definitions. Identical pinned definitions deduplicate; a reused
ID/revision with different definition or engine hashes conflicts. Future
read-only archives retain the same immutable conflict rule. Resolution compares
the current application engine with its registered artifact/schema requirements
instead of silently accepting a changed engine under the same version label.
Registry limits count canonical archive bytes separately from actual heap use.

`SoundContentArchive` prepares an immutable selected-material artifact for the
existing export-delivery API. Reference-only mode embeds definitions, dependency
references and credits without opening asset sources. Portable preparation
requires local rights decisions and known engine definitions, reads only the
selected closure under byte/deadline limits, and verifies every included hash.
The binary container has a fixed magic, bounded canonical JSON header and exact
ordered payload lengths; it does not extract files or carry executable modules.

Staging reserves shared memory before source reads. A canceled nonabortable
source keeps its reservation and operation slot until the actual callback
settles. Completed artifacts transfer to the caller's delivery owner. The
artifact's digest also retains its reservation until native hashing finishes.
Material integrity is separate from backend preparation and render/listening
qualification. Archive preparation does not install a pack or apply a lane.

`SoundContentReader` accepts bounded local Blob archives. It checks the fixed
signature, exact canonical header, manifest hash, payload inventory, lengths,
trailing bytes and each included content hash before returning an owned stage.
Reference archives preserve missing-engine/material requirements for inspection.
Foreign review references never grant local redistribution permission.

Stages have explicit consumer leases and expiration. Discard or cancellation
invalidates access immediately; accepted native reads and borrowed consumers
retain their shared reservation until settlement or release. Staging changes no
project, performing lane, output permission or durable registry record.

`SoundContentRegistry` commits the verified manifest, immutable origin/version,
patch identities, content-addressed blobs, headers and storage counters in one
IndexedDB transaction. Matching data deduplicates. Conflicting pack versions or
patch revisions abort the entire transaction. Reference imports can later gain
verified local bytes without changing saved definitions. Storage limits count
encoded material and canonical manifests separately from memory reservations.

Library pages read headers only. Full manifests and material use explicit owned
read leases. Archiving hides a pack from browsing while preserving its material
and stable project references; restoring it is reversible. This first registry
boundary records material integrity, with render qualification still separate.
Native IndexedDB integration fixtures cover concurrency, immutable conflicts,
connection reopening and archived project material; they are deferred with the
rest of runtime validation.
