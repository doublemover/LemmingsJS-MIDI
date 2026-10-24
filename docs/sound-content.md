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

Native oscillator, sample and worklet renderers share the parameter contracts
used by `getNativeInstrumentCatalog`. Pinned engine descriptors are available
from an immutable browser generation and bind each renderer's transitive code;
their schema hashes include actual units, limits, defaults and capabilities.
An unbuilt source page retains preview playback but cannot claim matching pinned
engine artifacts. Engine identity and schema compatibility still do not prove
audible quality, gesture support or a successful render.

The build independently collects each renderer's complete static code closure,
including worklet modules and normalized build-identity source. Its artifact
hash excludes compiled sound catalogs, avoiding a circular content/engine pin.
The application identity binds those code vectors and their reviewed collection
recipe. A content-only edit therefore changes the application build while
preserving an unchanged renderer's artifact identity. Old browser generations
keep their previous identity recipe and remain explicitly without this catalog.

## Authored recipes

`content/sounds/*.json` contains non-executable `lemmings-sound-recipes/v1`
recipes. `npm run build:sounds -- --name=rook` resolves inheritance and explicit
unit conversions against allowlisted renderer templates, then emits immutable
canonical packs, parameter explanations, dependency inventories and review data
under `dist/sound-content/`. Publication changes `current.json` only after the
complete new catalog has been staged. A failed build preserves the prior head.

Parameters carry explicit units. Different units require a named conversion;
unsupported resonators, signal rewiring, modulation graphs or performance macros
fail at their recipe field. Compiler capabilities describe registered kernels.
They never authorize executing source from a pack. Inherited overrides remain
visible. Labels and rights have separate change classifications from effective
render keys, which bind engine/schema hashes and actual parameter/material maps.

The original foundation recipes author four concrete oscillator/envelope
variants. They contain no recordings. Their redistribution terms remain
`NOASSERTION`; compilation supplies no legal permission or listening verdict.
Audition manifests explicitly require a real causal take and effective render
evidence. Compilation alone does not qualify advanced sound families or DSP.

Browser recipe compilation uses the registered `compile-sound-content` job.
The fixed worker resolves renderer descriptors from its own immutable executing
catalog. Recipe data cannot provide an engine implementation or mint artifact
authority. Existing shared admission, cancellation and bounded small-input
fallback rules govern compilation and its retained result.

`SoundContentInstallation` uses a dedicated local audio owner for isolated
oscillator/worklet control auditions. It pins the staged definition, compares
the executing engine hashes, prepares the real backend and exercises pressure,
pan, pitch and release on an owned execution. Installation commits material
only; Apply requires a separate candidate for that exact locally auditioned
patch. Copying a receipt cannot grant this local authority.

The built-in audition is labeled an authored control fixture. Command admission
and an advancing audio clock establish neither physical-take coverage nor
independent render/listening qualification. Unsupported sample/gesture adapters
stay explicitly unavailable. Failed native retirement blocks new auditions and
retains its stage consumer while independent cleanup leaves still run.

`RoutedInstrumentBackend` assigns future lane attacks to prepared renderers.
Each admitted voice keeps its original renderer and opaque child execution for
updates and release. An unassigned renderer remains owned through its actual
voices and tails. Candidate pins protect asynchronous replacement preparation;
bounded retained-renderer capacity rejects excess work without cutting held
voices. A lane with missing pinned requirements rejects new attacks explicitly.
Execution inspection reports settlement without disclosing internal epoch keys.

Saved lane instrument references include the exact definition, its hash, pack
hash, engine/schema requirements and dependency hashes. Reopen verifies those
bytes before renderer admission. Missing engines, future patch schemas and
missing material remain explicit lane requirements. Choosing a factory palette
clears the installed reference as an explicit sound change.

Physical playback now owns routed lane renderers. Saved references prepare in a
bounded queue that coalesces superseded lane requests; held voices keep their
original renderer while future attacks use the committed selection. Periodic
execution-lease renewal sustains legitimate physical actions without creating
new attacks. Authored release times follow their voice owner. The workstation
Apply handler checks the selected lane and project revision before publishing
the prepared change and preserving Undo. Instrument changes during causal-take
capture/arming are rejected until effective-patch changes can be journaled.
