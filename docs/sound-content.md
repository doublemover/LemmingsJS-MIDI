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

The sound library offers **Render controls WAV** for the five owned sources
(sine, pluck, choir, spectrum and granular) and the three asset-free native
sources (oscillator, FM and modal) at 44.1, 48 or 96 kHz. Owned sources run their
actual kernels in an admitted worker. Native sources run the live backend in an
isolated OfflineAudioContext and lend its PCM to the admitted encoding worker.
Neither path enables live audio or hardware output. The source is the same
pressure/pan/pitch control fixture used for isolated audition. This is an audio
reference, not an editable replacement or physical-take audition.

The float32 stereo WAV includes a canonical `lmjs` RIFF chunk naming the exact
pack/definition/engine/build, fixture, PCM hash, sample rate, signal statistics,
finished release tail and render tap. The tap precedes the shared owner master
and limiter; normalization is absent and the manifest names the source-specific
resampling profile. Granular playback retains its explicit linear source-rate
conversion; it does not claim qualified alias rejection. The render grants no new
redistribution rights. Source and output memory overlap are admitted before
rendering; cancellation joins the worker, any accepted native producer and staged
consumer before releasing their reservations, and the result
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
That scope remains suppressed through later motion/control observations until
its lifecycle or mapping/source boundary, including after semantic restore.
Active plus suppressed scope records share the held-owner capacity bound.
Native renderers without continuous mappings record semantic observations only.
Take checkpoints now retain bounded lane performance inputs separately from DSP
state, and committed edits record changed lanes at the actual world boundary.
Re-performance restores numeric/stable lane addressing and applies those edits
before subsequent onsets. A combined mapping/control edit has one journal
admission record. Runtime replay acceptance remains deferred.

The `worklet-spectrum` source provides 16 original phase-aligned Fourier frames
with five harmonic-limited levels (1/2/4/8/16 harmonics), and a separate additive
mode with 1–16 ratios/gains/T60 scales. The offline generator pins the source
coefficients, common table normalization and 2048-sample linear interpolation.
FLOW blends neighboring frames; adjacent harmonic levels blend under the current
0.4-sample-rate pitch limit. Additive partials taper above 0.36 sample rate and
are omitted at 0.4; their decay and phase stay independent under one parent gate.
BODY weights lower components, EDGE applies spectral tilt/additive weighting
and a bounded one-pole low-pass, and scan/body/edge update over at least 8 ms.

The declared live profile is eight logical slots, 20–2000 Hz onsets, ±200 cent
bends, and 44.1/48/96 kHz. Admission charges four source units for table blending
or the declared partial count for additive mode, before allocating the voice.
Table mode rejects customized additive layouts. Typed bank/voice/queue bytes
and conservative JavaScript bank/state estimates are reserved before construction.
Oscillators use actor/event-seeded double-precision phase accumulation. Arbitrary
reset, negative frequency, PWM, phase distortion, sync and complete spectrum DSP
state cuts remain unavailable. Control-reference and causal-take spectrum output
use the same kernel with forward reconstruction from a covered silent boundary. Spectral/alias, register, long
hold, CPU and listening qualification remain deferred. The design uses original
Fourier data; the [Web Audio specification](https://webaudio.github.io/web-audio-api/#PeriodicWave)
and [Faust oscillator documentation](https://faustlibraries.grame.fr/libs/oscillators/)
provide algorithm context, without importing their complete instruments.

Prepare liquid tables / drawbars stages Bubble Reed, Prism Pad, Acid Current
(dry table), Pipe Crew, Glass Drawbars and Falling Stars. BODY, EDGE, FLOW and
RING are executable onset controls; RING changes dry release. SPACE/shared sends
and Acid Current resonance/drive are not implemented. Completed motion supplies
world height directly from `positionAfter.y`; the authored 0–512 world-pixel
domain contributes a clamped ±0.2 FLOW offset to already held actors. Camera
position and substitute payload coordinates are excluded. The source bank pins
a SHA-256 over generator metadata and little-endian Float32 frame coefficients,
sine samples and normalized tables, in that order. All generated source data
and new recipe/browser fixtures remain unqualified by runtime/listening tests.


## Authored sample maps

Compiler `typed-recipes-v11` accepts an immutable `sampleMap` on a native-sample
patch. The map uses schema `lemmings-sample-instrument-map/v1`, has its own ID and
revision, and names declared required sample hashes. It admits at most 128 zones,
16 gesture labels and 32 source assets, within 48 KiB and 6,144 metadata nodes.
These limits preserve the existing patch/reference archive bounds.

Zones declare source-frame onset/end, root cents, supported pitch range and
maximum transposition, velocity bounds, alternate group/index, gain trim and
tuning correction. Velocity intervals include their lower edge and exclude their
upper edge, except that a final upper edge of 1 includes full velocity. Pitch
selection chooses the nearest authored root and the lower root on an exact tie.
An out-of-range onset is unsupported. Playback-rate transposition changes both
pitch and duration; independent time stretching is not part of this map.

`selectionPolicy` declares algorithm `stable-semantic-onset-fnv32-v1`, an explicit
seed, `advanceOn: semantic-onset`, `rootSelection: nearest-lower-tie`, and an
unknown-gesture policy of `neutral` or `reject`. Each alternate group has contiguous
indexes from zero. Selection hashes the original world/generation/actor/onset,
map/patch revisions and candidate sample identities. It stores no acceptance or
browsing counter. Rejection, rewind and actor-array traversal do not change the
selected region for that original onset. Event-only fixtures use their stable onset
identity rather than a fresh playback execution generation; kit ownership remains
scoped to that execution. This is deterministic alternate selection,
not a promise to cycle through every alternate before repeating.

Causal instrument rules may explicitly author `sampleGesture` and `sampleKitId`.
The emitted intent retains those mapping tags without claiming a newly measured
physical gesture. Missing tags select the declared neutral gesture. A requested
unknown gesture either rejects or records the declared neutral fallback; a known
gesture with no covering zone rejects. Choke ownership includes exact world,
generation, lane, kit and map identities; different rules share a kit only through
an explicit common kit tag. Release consumes the onset's selected immutable region
and optional release child, rather than selecting another attack.

Native maps accept forward/sustain loops with `crossfadeFrames: 0`. Advanced seam
crossfades, reverse and position-driven traversal require their own renderer
implementation and qualification. Every mapped region must fit the actual pinned
source before activation. Trims are authored values, with an optional immutable
normalization evidence reference; no per-hit normalization or listening result is
inferred. Gesture display labels and evidence/credit references stay separate from
the effective render key, while trims, source regions and selection policies
participate in that identity.

The compiler/selector contract is implemented. Mapped sample lane preparation and library audition use the actual sample
backend. Preparation checks all regions against pinned source frames and reserves
map metadata until retirement. The library's gesture selector auditions an authored
articulation with an explicit 200 ms control fixture; physical rule controls persist the gesture and explicit kit tag.
Audition and causal sink receipts name the actual zone, layer, alternate and seed
as selection-API evidence, without claiming an applied sample or acoustic receipt. Authored chokes are
included in interval admission before changing an existing voice. One-shot hold
uses selected-region duration at the onset varispeed ratio, capped at four seconds;
held gestures retain their owned gate policy. Sample loops/releases, UI and combined
resource behavior remain subject to qualification. The original tactile proof pack
remains in development. Native sample control and causal-take output now use the same mapped backend and pinned material through an isolated OfflineAudioContext. Source/selection metadata fixtures are authored and unexecuted.

Causal take rendering currently supports the five owned sources and four native
sources listed above. It preserves immutable intent times and identities, with
forward preroll from a known empty boundary. Dry lane taps are simultaneous with
the full graph: native rendering supports fifteen stereo lane taps within the
portable 32-channel graph, and owned kernels support sixteen. Protected live master
processing and shared effect returns are excluded. Native producer cancellation
retains the shared background execution slot until bounded rendering has actually
settled. Native sample preparation can borrow an explicitly owned offline decode
context through the shared asset cache; joined cancellation prevents its owner
from retiring while an accepted decode still runs. These implementation contracts
remain subject to the deferred runtime, browser, PCM and listening acceptance pass.

Mapped sample offline output uses source-frame regions and native varispeed,
including per-onset region-duration hold and owned release children. Causal
planning bounds a child tail using the minimum captured pitch ratio; it may
include conservative trailing silence. Same-kit chokes shorten the planned
gate/source intervals without changing the captured end intent. Controls after
a new realization's choke reject explicitly. The render manifest retains at
most 64 actual selected-zone API receipts with selected/retained/omitted counts;
this summary is separate from immutable intent history and rendered PCM. Exact
native playhead snapshots and cross-browser bit identity are unavailable.

### Original tactile contacts

`content/sounds/tactile-contacts.json` authors one C4 root, two discrete intensity
layers and two semantic-onset alternates for open/muted contacts. Eight original
integer-DDS/noise sources each contain independently faded center, edge and brush
regions. The map exposes six gesture labels and 24 zones; the neutral fallback
is open center. All zones declare a maximum plus/minus six-semitone varispeed
range; out-of-range requests reject. A 0.5 velocity selects the firm layer.

Choose **Prepare original tactile contacts** in the existing sound library, then
choose the authored audition gesture. Physical rules retain the corresponding
`sampleGesture` and `sampleKitId` tags. Same-kit body chokes share exact map and
execution ownership; other kit instances survive independently. No automatic
physical gesture classification is inferred from those tags.

The checked-in authoring script generates identities and recipes, not binary
recordings. The admitted material worker regenerates the fixed source on demand
and verifies its SHA-256, complete WAV layout and source bounds. The publisher
uses the same generator. Encoded inventory totals 384,352 bytes. Eight mono
sources hold 768,000 decoded float bytes at their 32 kHz source rate, or 2,304,000
at 96 kHz native decode, before cache metadata and native graph estimates.
These are declared storage counts, not measured browser capacity. Sixteen frames
of pre-silence and 256-frame region fades remain part of the authored source.
Gain trims are authored; pitch/transient error, resampling aliases, combined
resource behavior and listening remain unqualified. The three-root extension,
loop crossfades and release-trigger sample content await their specific work.

### Custom-source state cuts

Owned pluck, choir, spectrum and granular kernels implement `stateByteLength()`,
`snapshotInto(preallocatedBytes, identity)` and `restoreFrom(bytes, identity)`.
The bounded `owned-source-state-le-v1` format includes source memory, future
commands, interpolation and receipt frontiers. Source bank and PCM hashes bind
immutable assets; the payload never duplicates their PCM or serializes native
nodes. Independent restored mutable state cannot modify the original source.
CRC32 detects accidental transfer corruption; an enclosing persisted artifact
still needs the canonical journal's content hash and cursor custody. Engine,
patch, graph, rate and slot compatibility are checked before committing a cut.
Display observation is reset independently. Kernel adapters await the deferred
PCM equivalence pass and live block-boundary/cursor integration; these methods
do not yet enable an exact restore claim in the scrub interface.

The take-render dialog also offers experimental source-state reconstruction at
the range start for owned kernels. It first reconstructs covered history, then
stages a fresh kernel at the exact output frame and resumes the same immutable
plan and simultaneous stem routes. The render manifest names the cut frame,
ABI, state hash and planner cursor. Its transfer plus temporary second kernel
are admitted before rendering. Native sources retain forward history. This
worker-local path does not capture unsent live-host controls or publish a
portable persisted checkpoint, and PCM equivalence remains unqualified.

### Owner effect graphs

The source implementation now admits a bounded stereo `lemmings-effect-graph/v1`
DAG with source/output buses, explicit gain edges and a feedback-delay operator.
Creative delay remains distinct from declared fixed processing latency. Complete
path tails, buffer storage and compounded gain are checked before preparation.
Arbitrary graph feedback and unsupported audio/control port conversions reject.
The original delay kernel uses bounded linear fractional taps and either causal
tape glide or a two-tap linear jump crossfade; it makes no qualified alias or
pitch-preserving time-stretch claim. A jump during an existing jump refuses.

One prepared owner graph feeds the existing protected master or explicit cue
route. Input crossfades preserve old bounded tails; neutral, tail bypass, mute and
Panic remain distinct. At most two graph revisions own transition/tail resources.
Native producer acknowledgment precedes graph/route/channel resource retirement;
missing acknowledgment remains unknown and charged. Session preparation never
creates or enables another AudioContext. Current physical playback APIs expose
this owner rack; persisted UI controls, content recipes, shared convolution,
sidechain detectors and offline effect integration remain in development. Native
source outputs and existing dry stem manifests do not yet claim effect returns.

The workstation's **Quarry Echo…** dialog prepares the physical owner's original
source/dry/send/echo/return graph. Hold THROW to admit source audio, then release
to stop new excitation while the return decays. TIME chooses a bounded delay,
FEEDBACK stays inside its admitted ceiling and RETURN has its own gain. Neutral,
tail bypass, owner mute and tail clear remain explicit. Gain and delay controls
return native scheduling receipts with a route revision; an old gesture release
cannot modify a new rack. Requested values are not native applied-frame proof.

Saved owner-rack defaults roundtrip in procgen projects. Loading defaults does
not enable audio; Prepare is explicit. Live effect gestures are currently outside
causal-take persistence; use master audio capture for the played output. Complete
gesture replay, actor-specific send attribution, AGE/coloration, spring bodies,
matched A/B and effect-aware offline export remain implementation work.

Native convolution graph nodes consume `lemmings-impulse-response/v1` descriptors.
They identify exact encoded assets, mono/stereo/native true-stereo layout,
normalization mode, authored calibration gain and a conservative maximum linear
gain. The shared material cache supports four channels specifically for IRs.
Worker analysis verifies the actual decoded PCM gain bound before activation;
normalization is set before assigning a native buffer. Every body owns an
independent pin until the native convolver has been cleared and disconnected.

Unmeasured native latency is null. Such graphs require the explicit
`uncompensated-native` policy; a parallel dry path is not labeled delay-aligned.
Predelay is an authored creative delay. Native internal copy/algorithm storage
remains an estimate separate from decoded PCM, with at most four bodies and
64 MiB decoded IR per graph before shared-budget admission. Replacement overlap
uses the same two-revision owner. Convolution PCM/latency/listening acceptance,
offline convolution output and authored original body selection remain pending.

### Original reflection bodies

`ProceduralImpulseSources.js` authors three bounded original PCM16 bodies at
32 kHz: Hollow Spring (mono, 1.2 s), Stone Courtyard (stereo, 0.8 s) and Crossed
Gallery (four-channel native true stereo, 1.6 s). `author-impulse-bodies.mjs`
writes their immutable encoded-byte hashes and generator/source provenance;
there are no recorded sources or binaries in Git. The existing procedural
material worker generates these exact files on demand and verifies their
complete WAV layout/hash before the shared native decoder can activate them.

Quarry recipe selection prepares a replacement graph with explicit predelay,
`native-rms` normalization and separate authored reference gain. Actual decoded
L1/RMS analysis enforces the descriptor before activation. SPACE controls the
shared wet return; THROW releases only new source input. The prior body retains
its bounded tail. Native implementation latency is unknown and uncompensated;
source bounds and authored gains are not listening or native-rate acceptance.
The source metadata remains `NOASSERTION`; no clearance or publication claim
is inferred. These fixed original assets do not yet constitute a separately
compiled effect-content pack or implement causal gesture replay/offline effects.

### Original nonlinear chain and Quarry Tape

`NonlinearChainKernel` executes ordered cubic saturation/fold stages in JS
binary64 arithmetic/state with float32 worklet I/O. It supports direct or
first-order ADAA and real local 1x/2x/4x rate domains. The 2x/4x modes use pinned
33/65-tap Hann-windowed sinc filters for both zero-insertion interpolation and
phase-zero decimation. `author-nonlinear-filters.mjs` authors coefficient data,
not a render qualification. The exact coefficient hash/configuration must match
the live worklet ready message. Fixed filter-pair group delay is 16 output
frames, plus the nominal small-signal half internal sample per ADAA stage.
Frequency-dependent ADAA droop and HP phase remain; dry alignment does not
claim a broadband null or measured native compensation.

Each transfer clamps its declared input domain and subtracts its bias response,
so bias is not an independent zero-input sound source. Equal/near-equal ADAA
inputs use stable limits and factored polynomial differences. Drive is dB input
gain with an 8 ms one-pole slew in linear amplitude. Input highpass, output DC
block, trim and final output protection are separate stages. Corrupt/excessive
state quarantines this owned branch. The exclusive little-endian state buffer
retains all polyphase cursors, FIR/ADAA/filter histories and drive frontier with
an exact profile identity and CRC32; graph-wide host capture is still preroll.

Quarry Tape sends into a 100 Hz input-highpass/2x cubic ADAA preamp, then the
creative feedback delay. AGE requests 2–12 dB drive and 7–1.5 kHz feedback LP.
Tone coefficients slew over 8 ms; mode/filter changes require prepared graph
replacement. The authored 0.7 preamp trim is not a measured level match, and
there is no claim of tape hardware emulation or alias qualification.

Design references: [ADAA definitions and conditioning](https://faustlibraries.grame.fr/libs/aanl/)
and [Julius O. Smith, FIR window design](https://www.dsprelated.com/freebooks/sasp/Window_Method_FIR_Filter.html).
This is original JS code/data, not imported Faust/WASM. Native shaper comparison,
ADAA2, spectral/passband/latency/cost/listening gates and full-effect offline
rendering remain outstanding.

### Compiler v11 explanation admission

The pack reader validates both fields emitted by `typed-recipes-v11`: explicit
`cost.sampleZones` (integer 0–128, exactly the archived map zone count) and
`display.sampleMap` for mapped patches. The latter contains 1–16 unique bounded
articulation IDs/names and an explicit null-or-SHA256 normalization reference,
matching the archived map exactly. Unknown nested fields, contradictory metadata,
missing v11 counts, and sample metadata on an unmapped patch are rejected.

Supported v1–v10 compiler artifacts remain readable with an implicit zero sample
zone count; reading does not insert fields or alter their immutable bytes/hash.
Those revisions cannot declare the later sample-map capability. Display labels
and normalization evidence remain outside the render key; operative zone gain
and selection data remain inside. Reader admission is not DSP qualification.

### Shared owned-effect render path

`OwnedEffectGraphKernel` evaluates one complete stereo owner DAG with canonical
float32 signal boundaries, the actual delay/nonlinear kernels and owned linear
fractional alignment. Causal rendering feeds every preroll/source frame through
this graph once. Lane files remain original dry taps; shared effect node files
are simultaneous output taps of the same run. Nonlinear/shared returns cannot
be recreated by solo-rendering and summing processed lanes.

The admitted workspace includes graph state, tap PCM, encoding and metadata
overlap. Exact crops retain earlier effect input; bounded tails include the
whole path and record conservative truncation. A nonfinite/excessive source or
internal fault quarantines this graph and fails the new export. The previous
prepared artifact remains a separate owner. Graph manifests contain definition,
processor revisions/hash, latency/tail bounds and explicit source/tap scope.

This path currently accepts declarative owned gain/delay/nonlinear graphs with
one stereo input/output and up to eight unique node taps. Native oscillator/FM/
modal/sample PCM also uses this same effect path in the encoding worker. Native
IR body graphs remain explicitly refused pending their adapter. Static authored
defaults are an explicit new revoice, not reconstruction of live effect gestures.
Source-only state cuts retain the continued preroll effect graph and do not
claim an exported full-graph checkpoint. All live/offline PCM/listening
qualification remains pending.

The take-render dialog now exposes the owned-effect path as an explicit new
realization: choose dry, Quarry Echo, Quarry Tape or compatible active saved
defaults, set a constant source send, and optionally export the shared return.
It never edits the saved rack or claims live gesture replay. The public owner
admits complete graph/tap PCM, verifies graph definition/hash/revisions and
per-file tap identity, and retains the prior bundle if any replacement fails.
Native source postprocessing now uses the same owned graph kernels. Native IR
bodies still need their offline adapter.

Native source rendering retains the original full preroll master/dry planes,
then processes the complete master once in the admitted encoding worker. It
captures cropped processed master/shared returns simultaneously and preserves
the dry planes. No extra AudioContext is created for this effect pass. The
manifest verifies the executing graph/revisions and records actual processor
continuation, with final protection excluded.

Preflight includes native PCM retained across worker encoding, all output taps,
processing state and transfer/metadata overlap. Native sample material now
reports exact aggregate decoded bytes for this admission. The output context
allows up to 120 s of captured history plus 30 s of explicitly bounded effect
tail, subject to the existing memory/work limits. These are implementation
bounds, not measured device/browser throughput or listening qualification.


Seed components can be recombined into an explicitly printed new asset in the
seed lab. Transient, sustained and residual branches use the exact same frozen
frame ruler. Each branch has gain/mute and solo; transient drive, sustained
lowpass and residual highpass have explicit bypass settings. Preparing a new mix
reuses the three immutable decomposition outputs. The actual original remains
selectable, and selecting the printed composition is a separate action before
fitting, compiling, auditioning, saving or applying.

The composition recipe pins all three component hashes, original source, analysis
revision, gains, filters and source rate. It retains original printed effects and
annotates new processing separately. Neutral reconstruction error measures the
unprocessed sum even for a creative mix; the creative difference is a separate
measurement. No normalization, limiter, automatic latency correction or tail
extension is applied. Filters start at zero and terminate at the exact selected
end; their terminal state and possible crop are reported. This creates one
playable asset, not three live layer voices or a qualified source separation.
Selected revoice rebuilds preserve the exact composition dependency closure and
reprint a new branch before refitting or compiling its descendants.


The original bar foundry can offer a separate eight-mode shared edge body to the
Shared bodies surface. Its signed observation weights come from actual solved
nodal displacements along four connected Tet4 edges, projected onto the declared
z direction. Normalized x follows that edge; y is intentionally invariant. The
left and right pickups observe one retained ringing body and do not inject input,
retune it or change loss. All pickup locations share one maximum-L2 reference.
Signed strike-site vectors likewise share one reference across end, shoulder and
corner rather than automatically matching every site's level.

The field producer reassembles and rechecks the complete elastic eigensystem,
then retains source/body/mesh/build hashes, selected modes, actual vertex positions,
direction, normalization references and interpolation policy. The content pack
stores the generated field receipt beside the original solved asset. The shared
route still uses the bounded complex-mode audio network, whose excitation is not
a force-calibrated second-order elastic response. Three positive mode masks use
squared site projections as an explicitly diagonal loss approximation; they do
not claim full point-damping coupling. Other shapes, refinements and unsupported
frequency/decay tiers decline this path rather than substituting nearest nodes.
The ordinary frozen strike instrument remains available independently.


Recipe sources may declare bounded `realizationGroups`, compiled as
`typed-recipes-v13`; existing sources retain v12 metadata. Each alternative names
an actual concrete recipe, algorithm revision, preserved invariant claims,
explicit changed audible properties, named fallback and allowed transition.
The compiler binds actual definition/render/effective-input hashes, exact renderer
and parameter schema, dimensions and declared structural cost. Alternatives must
have the same macro input units, pitch-expression, causal-binding and sample
articulation/frame/traversal interface. Smaller dimensions do not prove audible
equivalence. Next-onset replacement must account for old tail and new source;
unqualified mid-voice crossfades are rejected.

The original FM, struck-modal, granular-biome and circular-travel recipes publish
honest single-profile limits. Generated shape instruments and seed grafts do the
same. No lower-cost or perceptually equivalent realization is invented. Imported
profile metadata cannot grant device, numerical, listening or automatic-admission
qualification; pack admission reconstructs the profile records against archived
actual patches. Requested, prepared and effective admitted profiles are separate
fields. Choosing an alternative remains an explicit ordinary patch preparation.
The library displays these claims and limits. A selected export retains a group
only when every alternative it advertises is included; it never leaves dangling
available profiles. Measured admission transitions and matched-take/listening
qualification remain separate required work.


The scene catalog includes three small practice scores when the bound pluck
renderer is installed: One Foot, One Sound; Space Becomes Rhythm; and Quiet
Control. A world-space pickup observes actual motion. The first two pin finite
birth attempts, with explicit tick phases for the two-entrant score; the quiet
control pins paused admission and no actors. Their initial release policy is
installed before the first cohort and retained in the same checkpoint used for
private rehearsal. No note timer or invented manual intervention creates sound.
Fresh Load restores the authored attempt. Use Physical authoring to move the
pickup and Release gestures to perform another finite phrase. These are practice
scores with factual captions, not completed lessons or verified hearing outcomes.


Procedural material textures use a separate owned source with no PCM assets or
sample loops. Sand, cloth, crackle and foam consume canonical completed signed-axis
travel for the declared journey/contact/action scope. Actor-seeded integer spatial
hashes determine jittered pulse sites or colored noise knots. Audio time alone
cannot advance the spatial field. Rest prevents new births; active 1–5 ms Hann
bursts finish, queued bursts that have not started are canceled, and positive
filter/modal state may decay. Reversal revisits actual spatial cells within the
same parent voice. Internal bursts are DSP children and add no semantic onsets.

The source reserves eight actor slots, 32 pulse slots per actor and 32 admitted
births per absolute 128-output-frame bucket shared by the source pool. Render
block partition does not reset the budget. Cluster offspring are capped at four
with 2–12 ms internal spacing inside admitted motion coverage. Pulse energy uses
a declared density/speed reference and offspring square-root factor; bounds are
implementation policies, not measured loudness equivalence. Cloth uses linear
spatial noise with 320 times GRAIN knots/world-pixel, not a pulse rhythm. A 120 Hz
highpass and positive spatially varied nominal 2.5–6 kHz lowpass color the input.
Foam uses two fixed Q0.9 bands at 700/1600 Hz and BODY gain-correlation seconds;
other materials use explicit positive modal amplitude T60. No force calibration
or measured material identity is asserted.

GRAIN, DRAG, SHADE and BODY are explicit onset-only macros. The library can stage,
audition, save and apply these ordinary compiled recipes through existing owners.
Its control audition/render moves eight authored pixels in 40 ms, then rests;
this is visibly separate from a physical take. Real playback requires the exact
canonical motion scope, axis, source identity and frame coverage. Missing facts,
discontinuities, excessive speed and unsupported tuning fail instead of starting
a backing sound. The initial profile supports 44.1/48/96 kHz, at most 512 observed
world pixels/second and signed coordinates within eight million pixels.

The owned texture kernel implements **exactSnapshot** cuts under the existing
artifact/patch/graph identity and checksum envelope. Spatial cursor, finite burst
birth/start/duration/amplitude, shared absolute-frame quota, correlation/filter
memory, modal state and signed pickup weights are copied into an independent
renderer. Restore validates every source array and its owned core gate before
mutation. Queued commands, release/retirement and the original parent envelope
remain part of the core cut. This kernel API is pending PCM-equivalence and
browser qualification; it does not certify an arbitrary live host checkpoint or
claim listening quality. A future/incompatible cut is rejected rather than
silently resumed with a new noise/body history.


Spatial texture body grafts use the seed lab's **Spatial texture → modal body**
transform. Select a committed sustained signed-axis journey mapping, the exciter,
a tin/wood or reviewed fitted body, and a declared body root. Compile, audition,
save and apply through the existing revision owner. The frozen seed is retained
only as analysis/regeneration ancestry. It is not an audible backing sample.
EXCITE scales body input, BODY sets intrinsic amplitude T60, DAMP multiplies that
T60 by (1 − 0.9 × DAMP), and MIX linearly blends the filtered spatial exciter and
0.4-gain signed body observation. Controls affect new voices. The body uses the
onset note and fixed ratios; live pitch bending is unavailable. The four-second
linear release envelope is independent of intrinsic T60 and is a declared owner
cutoff. A stopped spatial source cannot replenish the body through dry filter
or burst tails. This original relative audio template is pending runtime,
spectral, device and matched-level listening qualification.


The **Prepare bowed / friction bodies** library action stages Hairline, Glass Drag
and Rosin Grain from `content/sounds/friction-bodies.json`. These original recipes
use a sealed nonlinear modal force port inside `worklet-friction`; they introduce
no public feedback graph, PCM loop or MIDI allocator. DRAG calibrates observed
signed world-pixel speed, PRESS scales normalized contact pressure, EDGE chooses
the onset contact position, and BODY sets the signed body observation/injection
balance. They are onset controls; channel expression pressure can ramp the held
source through its existing gate. Pitch selects 110–660 Hz virtual body tuning at
onset, independent of route length. Live pitch bending is unavailable.

The source consumes exact completed microsegment motion for one actor and declared
journey/contact/action scope. A stationary actor supplies zero bow work; its
positive-loss body may ring. Reversal stays in the same owned source. The visible
control audition uses 78 pixels of authored travel over 650 ms followed by rest,
and is not physical evidence. Two source slots and a fixed sixteen-iteration
scalar solve are provisional policies within the shared resource budget. Invalid
motion, missing ancestry and unsupported controls fail admission. Exact kernel
snapshot support retains independently owned modal, spatial, gate and queue state;
PCM equivalence, browser device cost, stability/tone/alias review, Bow Orchard and
matched-level listening remain unqualified. The grouped numerical runner is
`scripts/qualify-friction-source.mjs --name=rook`, authored but not yet executed.


**Bow Orchard** is installed when the pinned friction engine is available. Its
finite two-actor score uses one long authored route per material, a solid steel
stop for physical reversal, and manual-only assistance. Hairline and Glass Drag
retain separate source bodies and signed motion ancestry. The PRESS macro affects
new actor bodies; existing channel pressure expression ramps a moving held body.
The scene exposes this distinction and starts paused through the existing staged
loader. Missing friction capability leaves the scene unavailable. Its authored
physics/voice fixtures, actual playback and listening remain unrun.


**Prepare breath / wind bodies** stages Hollow Reed, Air Pipe and experimental
Overblown Branch from `content/sounds/wind-bodies.json`. Their original sealed
nonlinear modal source is `worklet-wind`. AIR, BITE, LENGTH and LEAK prepare new
bodies; existing channel pressure ramps each owned held source to a zero floor.
LENGTH is an acoustic size ratio, dividing the onset frequency. Each kind rejects
unsupported actual root/pressure combinations rather than silently retuning. The
experimental branch has one threshold-hysteretic register change per held token,
not an extra semantic onset. No PCM, microphone or autonomous accompaniment is
introduced. The authored held-pressure control audition is explicitly not a
physical take. Missing source capability fails normal preparation.

The two slots and static work dimensions are provisional shared-budget policies.
Exact kernel snapshots validate independently owned modal/noise/filter/register,
core identities and queued controls before mutation. This does not establish
arbitrary host restoration or qualified PCM continuation. The grouped pressure,
pitch and bite map and sixty-second sustains are authored in
`scripts/qualify-wind-source.mjs --name=rook`; they and the integration fixtures
are unrun. Stability/dropout/register regions, alias/pitch, device cost, physical
Breathing Stairwell playback and levelmatched listening remain pending.


**Breathing Stairwell** is installed only with the exact sealed wind/pressure
capability. Its two finite climber/floater entrants own their declared abilities
before first birth and in checkpoints. A worker-compiled 80-pixel rise leads to a
high shelf and a long physical descent to the landing. Actual climbing, hoisting,
falling and floating action entry plus motion starts a held wind source; observed
world height calibrates pressure as `clamp(1 - Y/256, 0, 1)` across its two 128-pixel
lanes. Fall-to-float carries the original voice. Walking at the landing has no
wind mapping and ends replenished breath through the existing action owner; the
declared release may ring. There is no stored melody or accompaniment.

Use existing physical terrain editing to alter the rise/shelf, or finite Release
gestures to change entry spacing. Acoustic LENGTH remains a separate sound macro.
The scene starts paused and keeps manual assistance. Missing engine capability
leaves it unavailable; the physics, pressure, checkpoints, actual device playback
and listening fixtures are authored but unrun.


Resonator correspondence authoring is available through the bounded
`analyze-resonator-morph` background kernel and `ResonatorMorph.js` asset APIs.
Named endpoint modes retain exact source/body hashes, positive frequencies and
amplitude T60, signed site weights and a fixed common L1 reference. Candidate
matching combines log-frequency/decay distance with only explicitly corresponding
excitation/pickup signatures. A bounded global assignment admits unmatched modes,
shows alternatives and flags close/degenerate or incomplete signatures. It never
pairs changing sorted indexes during a morph. Publish requires explicit resolved
pairs and site review; missing signatures cannot become a playable coupling.

The original four-to-six-mode proof source is
`content/morphs/dry-bright-proof.json`. A resolved map can preview positive log
frequency/T60 and raised-cosine signed-weight interpolation, including explicit
unmatched observation/excitation fades. Applying the same weight window to all
slots preserves the common L1 bound without per-endpoint renormalization. Exact
endpoints and stable slot IDs are retained. This is synthetic parameter authoring,
not a mechanical energy projection or a claim of perceptual intermediacy.
Next-onset, prepared dual-body blend and paired held policies are different map
capabilities. A blend cannot be evaluated as an intermediate body. Live continuous graph/route application, compatible seed/foundry endpoint
adapters, real state/tail/admission/restore, Metamorphic
Bridge and listening qualification remain pending; the new fixtures are unrun.
Background reading: [Caetano and Rodet, DAFx 2010](https://dafx.de/paper-archive/2010/DAFx10/CaetanoRodet_DAFx10_P100.pdf).
This application's matching method is original and does not implement that paper.


The seed laboratory's **MORPH MAP** panel now imports bounded named endpoint JSON,
loads the original four/six-mode proof, performs worker analysis, displays paired
and unmatched IDs with ambiguity/alternatives, and requires explicit pair/site
review before preparing a next-onset map. Signed endpoint weights and exact source
hashes stay visible for review. The MORPH slider previews parameters; it does not
start audio or claim a held renderer. Changing an endpoint or reviewed draft
invalidates its map, while failed preparation retains the previous reviewed map.
The existing export owner delivers independently staged map JSON with a distinct
browser-request receipt. Canceled/stale completion cannot publish, and unresolved
producer/delivery retirement remains charged rather than claiming release.

Directly deriving compatible excitation/pickup observations from fitted/shape
bodies, applying maps to live fixed/held/dual-state graph owners, real scene
motion, state/tail/admission/restore and listening qualification remain pending.
The new owner/resource/UI fixtures are authored but unrun.

A map export is an independently copied immutable payload. Its known active
reader can outlive map-view metadata retirement under the existing export lease;
that copy remains charged until its reader/digest retires. Unknown producer or
export-budget acknowledgments still prevent a false complete receipt.


The MORPH MAP panel separates **Render body control reference**, **Play reference
on Prelisten** and **Download reference WAV**. Endpoint A/B use the same finite
forces. The moving out-and-back program requires an explicitly reviewed
experimental paired-held map; next-onset maps are not silently upgraded. A
three-entry immutable cache keys complete map/endpoint, renderer, program, rate
and executing-build inputs. Only the existing isolated cue route plays the
prepared WAV; a draft/route/clock change stops it and cannot cause a late attack.
Stopping during cue preparation keeps its source/storage until preparation
settles. Export owns a copied payload and a separate browser-request receipt.

These are authored control references, not physical takes, a live morph rack,
levelmatched listening results or device qualification. Actual route/graph
integration and Metamorphic Bridge remain pending. Controlled cache/publication/
cue/export fixtures use explicitly labeled contract envelopes, separate from the
unrun real DSP/kernel/reference fixtures and later browser/listening acceptance.


The reviewed paired-held map can also prepare one `paired-modal-body` in the
existing canonical owner graph. The authoring panel offers manual MORPH or one
selected sustained voice's actual committed signed travel. The route clamps at
its declared endpoints and retraces on signed reversal; rest adds no new control
motion. Source audio is the same upstream owner sum, normalized against the
existing absolute-32 bus profile, with a fixed quarter body readout. This is
synthetic retained modal state, not a mechanical object or new musical onset.

Full endpoint, map and derived profile hashes are verified before publication.
A source edit cancels pending preparation and prevents manual use of a stale
receipt; the existing frozen graph remains owned until a new graph publishes or
explicit tail/Panic retirement. Closing the panel does not dispose the canonical
audio owner. Native readiness, bounded automation, body containment and owned
revoice share the profile. Graph restoration currently uses deterministic preroll;
the private body cut does not certify a live host cut. Prepared dual-body blending, physical/perceptual continuity, moving-control cost
and device/listening qualification still require their separate work and evidence.


Metamorphic Bridge is an experimental installed finite score when the sealed
friction source is available. It starts paused with one entrant and a visible
far stop. Enable local audio while paused and wait for `scoreMorph.prepared`
before Play. The scene body prepares on the canonical owner; a source beginning
before readiness is reported unavailable and is not retriggered automatically.
The first admitted matching journey binds 512 actual signed pixels to MORPH.
The real stop reverses that coordinate through the same body. New actor timing,
extra attacks and simulated wall-clock motion are not introduced.

The initial mechanism is part of the exact scene recipe/origin. Preparation
checks the reviewed source hashes and mapping, counts one shared body and retains
all temporary storage until cancellation settles. An explicit performer graph
replacement stays in place. This score still needs browser, route, cost, PCM and
matched-level listening evidence; its private Prelisten rehearsal now renders the exact reviewed shared body,
actual private-source route controls and the complete declared body tail. The
recipe, graph/profile and control-schedule hashes remain in the retained WAV
manifest. This is a new isolated source prefix, not a reproduction of a prior
physical take or evidence about acoustic output. Other shared-body mechanisms
need their own complete rehearsal adapters.
