# Survey evidence and controls

The Node survey runs real isolated worlds. A computed result, an acknowledged
transfer, and committed evidence are different stages. `SurveyWorkerPool`
publishes their identities and outcomes separately in `computations` and
`persistence`; result presence alone does not imply a saved original.

Canonical evidence reads intrinsic numeric view slots and native collection
entries. Array accessors, unsupported objects and cycles are refused; sparse
holes differ from undefined and null. Every own world data owner is classified.
Future unclassified owners and root accessors refuse projection, while admission,
assistance, birth, junction, feedback and terrain-score state bind continuation.

Controlled terrain uses private source proofs to omit unchanged query caches.
Actual cached pixel edits remain visible; injected chunks without a source proof
are refused. This does not qualify every generated-terrain cache or archived
execution environment. Earlier state3/state4 and canonical2 receipts remain legacy evidence.

## Transfer and persistence

Workers first advertise the exact JSON byte length and SHA-256 of a result.
The host reserves both a count credit and a byte credit before permitting its
transfer. A worker waits for acknowledgement before admitting more work or
producing another result. At most one computed result per execution worker
waits outside the host queue. Retained committed results are governed by the
declared trial and evidence limits, separately from pending transfer limits.

The result acknowledgement carries the actual storage outcome, its result
digest and a digest of any publication receipt returned by the callback. The
worker validates that envelope and acknowledges receiving it before admitting
more work. `workerReceiptStatus` records acknowledged, sent-but-unacknowledged,
unavailable or synthetic delivery separately from persistence success. A worker
crash can leave a committed original with an unacknowledged delivery. Failed and
unknown outcomes are acknowledged explicitly; receiving them never turns them
into committed evidence. Attempt records retain run and worker generations and
the worker's outcome digest. Callback-reported artifact references/checksums
remain identified as such and do not promise stronger filesystem durability.

`maxPendingResultCount` and `maxPendingResultBytes` cap reservations, including
the result whose callback is running. An individual oversized result fails
with an explicit transfer receipt. Identical repeated delivery is idempotent;
a different digest for the same assigned trial and attempt is an infrastructure
conflict. Every message is bound to its assigned worker, attempt and run and
worker generations.

Worker readiness is separate from trial admission. `maxStartupMs` bounds module
loading and shared mask preparation. A generation-qualified readiness receipt
precedes each trial's `preparing` and `admitted` receipts. `maxTrialMs` also
bounds per-world asset preparation, and a host watchdog can terminate a worker
whose physical slice stops cooperating. Failed preparation remains explicitly
unadmitted. Admission records include the last verified tick, preparation time,
worker and attempt identities, and deadline cause. Stage-qualified admission
and persistence receipts survive report resume.

An unexpected worker exit is an infrastructure error even if its last result
arrived first. That original retains its own committed or unknown persistence
receipt. Identical repeated delivery commits once; conflicting delivery retains
both outcome digests. The Node API's optional native `workerFactory` supports
real-thread diagnostic fixtures with the same production protocol and supplied
resource limits. Pause/step acknowledgements report barrier and preparation
latency independently of their actual selected-trial ticks.

The third result-callback argument contains `signal`, `deadline`,
`runGeneration` and the receipt. Cooperative stores check that signal before
publication. A callback deadline reports `unknown-after-timeout`: an arbitrary
promise cannot be canceled and an already published filesystem operation
cannot be undone. A late callback cannot upgrade the retired run's receipt.
Reconcile by the immutable original or attempt identity before retrying.

Cancellation stops new simulation admission and drains received evidence
within the persistence and total deadlines. `maxTotalMs` includes asset
startup, pauses, computation, transfer and storage. `maxTrialMs` measures
per-world preparation and admitted wall time, including pauses and time waiting behind other residents'
transfers. Each executing callback has `maxPersistenceMs`, further bounded by
remaining total time. Callback latency and peak queue count/bytes are reported.
Presentation callback failures are isolated from physics and storage status.
Lease acquisition and directory reconciliation cooperate with the callback's
abort signal. Canceling a waiter leaves the active writer's lease intact and
removes its retry timer. Completed run controls are retired; a run with no
queued or resident trials returns an explicit empty Step receipt and never
claims to have reached a checkpoint.

## Step receipts

A Step selects each worker's current resident set. When that worker has no
resident world, it leases only its bounded next resident set, including an
admission already preparing assets. The preparation receipt fixes the exact
trial and attempt identities. Repeated Step, Pause and Resume supersede the
older lease by control ID; newly finishing asset preparation remains associated
with a newer selection that includes that trial. Persistent paused mode does
not admit the rest of the queue.

`stepReceipt` aggregates every worker's actual acknowledgement. A short-horizon
trial stays visible as `terminal-before-target` even when another worker reaches
the target. Only an aggregate with actual progress for every selected trial can
claim `reachedCheckpoint`. Empty workers do not invent progress. Worker-level
diagnostic callbacks remain available, while the coordinator's display state
uses the aggregate receipt and clears stale reached fields when a new command
arrives. A Step requested before coordinator startup is dispatched when its
execution controls become available.

`maxControlMs` independently bounds startup, selection, stepping and receipt
delivery for one Step. A deadline retires that control generation and sends a
new Pause. Its receipt reports `timed-out`, the workers still unacknowledged and
their last verified observations; those observations do not claim the workers'
current ticks. Late acknowledgements cannot turn that receipt into a reached
checkpoint. Resume can continue the same worlds. Each run and report retains at
most 128 completed, superseded, canceled or timed-out control receipts, with an
explicit count of retired history. Control receipts survive report resume and
remain separate from per-trial computation and persistence outcomes.

## Filesystem publication

One writer operation owns the experiment directory through an exclusive
directory lease. Other writers wait; readers verify checksum envelopes without
acquiring the lease. Dead owners are recovered through a reservation inside
the stale lease before its directory is quarantined. A crash during that
recovery reservation requires inspection of the reserved stale lease instead
of allowing another process to remove a potentially active owner's lease.

Original files publish through a same-filesystem hard link, which fails if the
destination exists. Equal checksums are idempotent. Conflicting content leaves
the original unchanged and retains the attempted value under `conflicts/`
when quota permits; the typed conflict always includes both checksums.
Derived reports use expected generations and may replace an older derivative.
Envelope version 2 binds file ownership, generation and the existing payload
checksum with a separate metadata checksum. Corrupt generation headers and
counter overflow fail explicitly. Legacy checksum envelopes remain readable
without being rewritten; a newly published derivative uses version 2.
Quota includes the old report and its complete staged replacement at their
peak. Reopening resets accounting and cleans only app-owned UUID staging
files while holding the lease.

Initialization runs under that same writer owner. Existing originals without
`manifest.json` cannot be attached silently to a new experiment. A verified
`report.json` containing the identical manifest can restore that missing
manifest through ordinary immutable publication. Without that backup, or when
the backup is corrupt or names a different experiment, the store returns a
typed recovery-required outcome and preserves the originals for read-only
review. Later direct writes cannot bypass this check. Restoring a missing
manifest does not replace or rewrite the report or its original evidence.
The coordinator also compares its execution declaration with this owned
manifest before admitting a worker. A changed experiment declaration or an
explicit legacy state/encoding version fails before simulation; it is never
normalized silently into current qualification.

Publishing an attempt, checking any preceding deterministic outcome and
publishing its completed original now share one writer lease. Equivalent
concurrent attempts retain the first original and both attempts even when their
additional capture metadata differs. Disagreeing physical hashes, crew records,
accounting or validity retain both attempts and return a typed outcome conflict
with their references and checksums.

If a process dies after publishing a complete attempt and before publishing its
result, `recoverCompleted()` can restore the result from that verified attempt
under the same owner. Recovery checks every retained complete attempt for that
trial and rejects disagreement instead of selecting a favorable outcome. It
holds at most one candidate result and the currently read attempt in memory.
Coordinator resume performs this reconciliation before admitting replacement
simulation and retains the recovery references in its report. Explicitly
incomplete and unsupported attempts remain attempts; they cannot become scored
resume originals. Legacy status-only evidence remains readable, while current
versioned result records require an explicit completed-episode flag.

This protocol requires local filesystem support for exclusive directory
creation and atomic same-filesystem hard-link creation. NTFS on Windows and
ordinary local POSIX filesystems support those primitives; the tests exercise
the actual host filesystem. Network, removable, synchronizing and virtual
filesystems require separate qualification. Unsupported hard links fail the
write; there is no overwrite fallback. Publication does not promise power-loss
durability: file and directory flushes are not part of this protocol.

## Canonical identity and retained history

Canonical numeric encoding version 3 distinguishes signed zero, NaN and both
infinities in scalars and typed arrays. Typed views include their element type,
logical length, byte length and byte offset. DataView includes the exact
selected bytes. Big integer views use decimal strings. These portable evidence
checksums remain separate from cryptographic source and asset verification.
Terrain activity permits its legitimate negative-infinity sentinel and rejects
NaN or positive infinity before issuing a state snapshot.
Snapshots, milestones and telemetry reject an in-progress or failed physical
tick. The source manifest records canonical encoding and physical state schema
versions separately, and labels its loaded execution identity as unbound.

Survey state schema 5 stores compact immutable terminal records. A first death
observation preserves arrival, qualification and cause accounting immediately;
the actor reference is released only after a committed `ActorTerminated` fact
or an explicit generation reset. Death animations remain runtime owned until
their lifecycle ends. Missing actors remain unknown and invalidate accounting.
Terminal records retain final position, action, action instance, lifecycle tick,
causal order and termination reason. Full historical checkpoint export can
still cost work proportional to retained history; ordinary observation visits
the active set and consumes the runtime's completed actor projection.

Terrain edits use sorted logical nonzero runs across resident, compressed cold
and raw cold patches. Projection never rehydrates or reorders the live storage.
Compaction and ordinary query restoration preserve identity; changed edit bytes
change it. Duplicate keys, malformed/overlapping spans and accessor-backed patch
records refuse projection.

Workers defer optional telemetry projection until a checkpoint or requested
publication. `observationWork()` exposes actor visits, finalizations and
telemetry projections without adding presentation work to deterministic
outcomes. The actor record cap remains explicit.

Exact replay requires current state and canonical schemas, complete identities,
trial/scenario/source/budget hashes bound to their declared payloads, a completed declared horizon, complete retention
accounting, ordered checkpoints and matching initial/final checkpoint hashes.
Complete event logs must reconstruct their declared event digest, and the
per-actor crew evidence participates in comparison alongside scalar totals.
Empty, legacy, malformed or truncated evidence is invalid/incomplete. A valid
complete comparison with different outcomes reports mismatch. The coordinator
keeps those outcomes separate from invalid or incomplete replay evidence.
Coverage lists common checkpoints and intervals; interior ticks are not
individually observed. Fetching source files with valid hashes does not prove
which module instances executed a browser replay. Compatibility receipts keep
active execution unbound and never promote themselves to exact qualification.

Current replay evidence also binds physical checksum boundaries, each retained
checkpoint's event-prefix digest and telemetry identity, the declared policy
seed, and complete crew/lifecycle accounting. Matching empty crew arrays cannot
qualify a populated trial. Duplicate actor identities, nonfinite final positions,
inconsistent death counts or unaccounted retained lifecycles are incomplete
evidence. The declared goal outcome must agree with that accounting. Coverage distinguishes logical state, physical state and event
checksum disagreements at their shared checkpoints. These structural checks
establish retained-record consistency; they do not attest which loaded module
instances produced a record or promote separate policy-validity gates.

These receipts qualify bounded survey consistency. They do not provide release,
hardware, physical MIDI or acoustic qualification, and they do not implement a
reusable branch-prefix cache.
## Worker ingress failure evidence

Node worker/host envelopes now declare schema version 1. The host validates
envelope shape, generation, message type and assignment before decoding result
graphs. A new result requires its worker's transfer reservation; duplicate
delivery must match the existing assigned receipt. Supported JSON graphs are
checked for cycles, unsupported values, depth, entry and byte bounds before
hashing or freezing. Control and telemetry messages have separate 64 KiB limits.
No process-wide exception handler is installed.

Message, decode, host-send and worker event failures produce bounded structured
worker-failure receipts and cancel the affected run's admission. The failed
worker is retired; transfer reservations and control barriers settle through the
existing owner. Previously committed result bytes/digests remain authoritative.
New subprocess fixtures cover null/scalar envelopes, unknown and missing fields,
unreserved and reserved cycles, BigInt, failed host sends and a fault after an
independent original commit. They are implemented but unexecuted during the
backlog development pass.
