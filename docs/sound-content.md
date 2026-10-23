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
the imported pack cannot grant itself a trusted review receipt. Missing creator,
source, terms or permission yields a reference-only plan. Private playback and
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
