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

The workstation Lane inspector opens a persistent Sound library dialog. It
stages local imports, compiles the original recipes in the fixed worker,
auditions, installs, applies and prepares selected exports through the same
owners. Reviewing credits grants no permission when provenance is incomplete.
Anchor delivery remains a request; file-handle delivery reports acknowledged
close separately. Installed packs can be archived and restored without deleting
project material. Reopening an already-minimal complete pack preserves its
immutable ID/hash, and subset exports preserve only selected compilation data.
The v1 inventory rejects unrelated opaque fields instead of bundling private
project state inside a nominal sound pack.

Prepared delivery lifetimes retire automatically, including when no UI polls
metadata. Expiry notifies active deliveries and blocks new borrowing. Blob
storage remains accounted while native hashing or a borrowed reader is active.
Replayable delivery leases retain accepted iterator reads and cancellation
until their actual promises settle; an unknown source close remains explicit.
Expiry and a failed clock are reported separately from user cancellation.

Anchor delivery retains its source lease through actual object-URL revocation.
The bounded native URL inventory counts pending sources and failed revocations;
an unacknowledged revoke keeps ownership instead of freeing its budget early.
The delivery receipt still records only an anchor request, independently of
whether a browser ultimately saves the file.

File delivery has bounded native owners. Cancellation/deadline settlement does
not release an accepted open, write, close or source-read promise. Late opened
writables are aborted under the same owner. Source storage retires after actual
native settlement and a terminal close/abort acknowledgment. A failed cleanup
keeps its owner visible and consumes capacity. Delivery receipts include the
native-retirement snapshot; a known close acknowledgment remains authoritative
even when cancellation or a deadline raced it.

Causal archive output encodes owned, frozen JSON in bounded UTF-8 chunks with
cooperative yield points. It preserves Unicode, escaped strings and negative
zero without a complete encoded checkpoint line. Each source record is hashed
through shared background admission before its private storage read, then stays
leased through encoding. New chunk indexes include exact canonical byte sizes;
older indexes use a conservative bounded admission. Returning a replayable
iterator aborts its source signal, including queued record-hash work.

The offline sound publisher retains a bounded, content-addressed identity
ledger independently of the current catalog. Removed packs and patch revisions
remain protected against changed bytes. Effective compiler render mappings are
part of patch identity. Initial adoption checks every retained immutable catalog;
unreadable or conflicting history blocks publication. Concurrent publications
share an exclusive output lock, and the new catalog and ledger must both exist
before the atomic head update. A crashed lock requires explicit recovery.

Causal archive inspection copies bounded byte-line fragments without repeated
carry-string scans. A registered worker verifies manifests, source hashes,
canonical byte inventories and chunk record indexes. Only compact verified
metadata returns to the UI; checkpoint and chunk bodies remain in the worker.
Decoding begins after shared job admission, supports cancellation, and keeps
the source-line reservation through conversion. An entry that exceeds available
shared parsing capacity is explicitly rejected without changing stored work.

Native oscillator/sample schemas bind their actual 64-voice capacity and supported
`reject` policy. Definitions requesting unimplemented stealing, continuous macros,
modulation graphs or causal bindings remain unavailable instead of silently
losing those behaviors. Direct renderer preparation enforces the same boundary.
The native foundation pack is now version 1.1.0 with patch revisions 2; its
explicit rejection policy replaces the earlier unrealized stealing declaration.

The sound library offers **Render controls WAV** for the pinned sine renderer
at 44.1, 48 or 96 kHz. It runs the actual worklet kernel in an admitted fixed
worker without opening audio or hardware output. The source is the same
pressure/pan/pitch control fixture used for isolated audition. This is an audio
reference, not an editable replacement or physical-take audition.

The float32 stereo WAV includes a canonical `lmjs` RIFF chunk naming the exact
pack/definition/engine/build, fixture, PCM hash, sample rate, signal statistics,
finished release tail and render tap. The tap precedes the shared owner master
and limiter; normalization and resampling are absent. The render grants no new
redistribution rights. Source and output memory overlap are admitted before
rendering; cancellation retires the worker and staged consumer, and the result
uses the existing expiring artifact/delivery owners. Listening, device output
and a real physical gesture remain separate qualifications.

**Prepare FM Forge** compiles four original data recipes through the same staged
archive, audition, installation and explicit Apply flow: Glass Rivet, Copper Tine,
Alarm Bloom and Rubber Bolt. The fixed native FM adapter owns two/four operator
sources per voice, plus a pitch-settle source where requested. The selected model
shows authored ratios and index timing. Index is dimensionless; deviation is Hz.
Compiler revision `typed-recipes-v2` adds that unit and the fixed FM template;
archived v1 explanation data remains readable without executing an old compiler.

These recipes remain unqualified. Register-dependent index reduction is a
conservative sideband estimate, and feedback/effect sends are unavailable. This
pass has not produced PCM, spectral, dense-mix or listening qualification. Source
rights are `NOASSERTION` with redistribution unknown; a recipe is not a rights grant.

Compiler `typed-recipes-v3` carries effective macro curves into the patch itself.
Native oscillator/FM adapters support onset-sampled macros: replacements run
first, then additions/scales ordered by stable macro ID, followed by one final
engine-domain clamp. Units, default amounts, discrete steps and audible intent
are validated. Duplicate replacement owners are rejected. Accepted native API
receipts report effective values and their frame; this is not a PCM receipt.
FM Forge revision 2 adds HARDNESS, RING and ALLOY. Saved lane overrides affect
the next causal onset and enter captured intent data. Existing voices retain
their authored excitation and envelope; continuous macros are unavailable.

Compiler `typed-recipes-v4` preserves bounded identity/event variation and typed
onset physical bindings. Composition is base → macros → identity/event variation
→ completed-fact mapping → final engine clamp. Variation algorithm
`fnv1a32-utf16-le-latents-v1` hashes an ordered JSON array as UTF-16 little-endian
code units, then avalanches its 32-bit result. Keys include patch revision,
musical seed, captured world/generation/actor identity or stable onset identity,
purpose and named latent factor. Bounded factor weights express correlation.
There is no simulation RNG consumption or retained identity cache. Missing actor
identity uses a named event-only fallback; missing both identities is rejected.

FM Forge revision 3 adds slight ratio/decay siblings, per-strike index variation
and an onset scale driven by actual `changedSolidCells`. The physical input
allowlist includes committed cell counts, motion distance and observed wall-step
height with explicit units. No force/energy estimate is inferred. Missing source
measurements leave the prior composition intact with `no-qualified-source`.
Lane Amount/Reroll changes only future musical controls and records one normal
history action. Actor-specific locks and continuous control/noise remain pending.

**Prepare struck materials** stages Timber, Slate, Glass, Sheet metal and an
explicit Unclassified recipe. Compiler `typed-recipes-v5` adds the fixed
`native-modal` template. One logical voice owns 4–8 native damped sine modes;
every actual oscillator is charged before allocation. At onset, two authored
gain-site vectors interpolate, then fixed L1 normalization bounds their sum.
This is a musical impulse-response design without continuous force input,
feedback, geometric pickup, exact native DSP snapshots or material-tag inference.

Each actual mode receipt states frequency, gain and `modeT60Seconds`.
Amplitude decays as `exp(-ln(1000) * seconds / modeT60Seconds)`: T60 is −60 dB
amplitude, independent of frequency. Native gain scheduling reaches −120 dB at
two T60s and holds that declared floor until host release. A one-shot holds for
1.5 times the longest selected mode, bounded to four seconds, then releases.
Onset attack and host release remain separate. The upper register tapers/omits
modes under the declared bend profile; this is not a measured alias gate.
MASS scales authored body frequency, HARDNESS changes onset time, DAMPING changes
T60 and HOLLOW blends gain sites. No current PCM or listening result is claimed.

**Prepare plucked garden** stages Burrow Thumb, Wire Ladder, Moss Nylon and
Suspended Zither through compile/audition/install/Apply. BODY blends two bounded
body modes, PICK changes virtual excitation position, DAMP changes target decay
and SPARK changes excitation bandwidth. They are onset controls. Noise is keyed
by patch, actor/event and saved musical seed, and normalized once under a bounded
energy/peak law before excitation. It does not consume physics RNG.

The first-party worklet uses preallocated fractional-delay feedback strings and
an allpass interpolator with fundamental phase/loss compensation. Model target
T60 is not a measured decay guarantee. See [first-order allpass interpolation](https://www.dsprelated.com/freebooks/pasp/First_Order_Allpass_Interpolation.html)
for the reference structure; no external executable DSP is imported. The shared
command ABI, application receipts, owned release, Panic and measured display
transport remain authoritative. Six registered engine profiles are now allowed.

The live pluck profile admits 50–2000 Hz onsets, ±200-cent expression and
44.1/48/96 kHz contexts. Sixteen logical slots are an upper structural limit;
shared quotas and a 65,536-operation excitation budget per absolute 128-frame
bucket can reject a request with an actual kernel receipt. Optional body modes
add declared source cost. Delay/scratch/state and enlarged command storage are
reserved before construction. Exact pluck restore/offline output are unavailable.

For an already owned pluck, `damping01` updates string/body loss over the shared
control ramp without a new note, new seed or reset delay line. The current sound
macro panel still labels DAMP as a next-onset control. Held causal plucks can
receive motion-derived damping through their existing voice identity; detached
one-shot tails are outside the held-actor index. Pitch, tail, spectral, dense-mix, CPU and
listening fixtures remain unexecuted with the consolidated validation pass.

The registered `worklet-choir` source has eight logical slots and three charged
source layers per voice: voiced table, optional detuned sibling and seeded
breath. Three formant filters use original landmarks [350,900,2200],
[700,1200,2600], [300,2200,3000] Hz, logarithmic vowel interpolation and nominal
bandwidths [70,110,160] Hz scaled by SIZE. These are musical choices. The voiced
exciter selects and blends eight phase-aligned harmonic levels (1–128 harmonics)
under a pitch-dependent 0.4-sample-rate limit that includes chorus/vibrato range.
The pinned table generator uses common normalization across levels; no voice
recordings are loaded. The four original recipes are staged with Prepare
artificial choir; VOWEL, BREATH, SIZE and CHORUS currently affect the next onset.

The filter equations follow the trapezoidal SVF derivation in
[Andrew Simper's technical paper](https://cytomic.com/files/dsp/SvfLinearTrapOptimised2.pdf).
Each voice owns its filter integrators and noise state. Filter controls retain
that state, use at least 8 ms of smoothing and refresh coefficients at a bounded
eight-frame cadence. Fundamental pitch stays separate from vowel/size settings.
Rapid control, 60-second hold, spectral/pitch, density and listening qualification
remain deferred. Source identity is pinned through the existing immutable engine
artifact; native DSP libraries and complete MIDI synthesizers are not imported.

Pluck and choir display samples use their own source IDs, report unclipped RMS/
peak and clamp only the normalized visual envelope. The sine oscillator phase
quantity is omitted because these sources do not expose that kernel state.

Continuous physical bindings declare a separate `causalLiveSafe` target contract.
Choir vowel/breath/size/chorus/vibrato/bandwidth and pluck damping are realized;
envelope and excitation edits remain onset-only. Completed measurements are
held until another qualified observation and recomputed from the onset's
macro/identity/onset-binding baseline in stable binding-ID order. Missing values
hold the last qualified controls and report no output request. Live slew uses
the shared audio-frame command queue and at least the source minimum smoothing.
No future position is predicted. Held identities retain their captured source
kinds across patch replacement and semantic checkpoints. The per-batch bound is
2048 physical updates; overflow releases the affected held owner explicitly.
Native renderers without continuous mappings record semantic observations only.
Take checkpoints now retain bounded lane performance inputs separately from DSP
state, and committed edits record changed lanes at the actual world boundary.
Re-performance restores numeric/stable lane addressing and applies those edits
before subsequent onsets. A combined mapping/control edit has one journal
admission record. Runtime replay acceptance remains deferred.
