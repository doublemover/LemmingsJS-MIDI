# Survey evidence and controls

The Node survey runs real isolated worlds. A computed result, an acknowledged
transfer, and committed evidence are different stages. `SurveyWorkerPool`
publishes their identities and outcomes separately in `computations` and
`persistence`; result presence alone does not imply a saved original.

## Transfer and persistence

Workers first advertise the exact JSON byte length and SHA-256 of a result.
The host reserves both a count credit and a byte credit before permitting its
transfer. A worker waits for acknowledgement before admitting more work or
producing another result. At most one computed result per execution worker
waits outside the host queue. Retained committed results are governed by the
declared trial and evidence limits, separately from pending transfer limits.

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

This protocol requires local filesystem support for exclusive directory
creation and atomic same-filesystem hard-link creation. NTFS on Windows and
ordinary local POSIX filesystems support those primitives; the tests exercise
the actual host filesystem. Network, removable, synchronizing and virtual
filesystems require separate qualification. Unsupported hard links fail the
write; there is no overwrite fallback. Publication does not promise power-loss
durability: file and directory flushes are not part of this protocol.

## Canonical identity and retained history

Canonical numeric encoding version 2 distinguishes signed zero, NaN and both
infinities in scalars and typed arrays. Typed views include their element type,
logical length, byte length and byte offset. DataView includes the exact
selected bytes. Big integer views use decimal strings. These portable evidence
checksums remain separate from cryptographic source and asset verification.
Terrain activity permits its legitimate negative-infinity sentinel and rejects
NaN or positive infinity before issuing a state snapshot.
Snapshots, milestones and telemetry reject an in-progress or failed physical
tick. The source manifest records canonical encoding and physical state schema
versions separately, and labels its loaded execution identity as unbound.

Survey state schema 3 stores compact immutable terminal records. A first death
observation preserves arrival, qualification and cause accounting immediately;
the actor reference is released only after a committed `ActorTerminated` fact
or an explicit generation reset. Death animations remain runtime owned until
their lifecycle ends. Missing actors remain unknown and invalidate accounting.
Terminal records retain final position, action, action instance, lifecycle tick,
causal order and termination reason. Full historical checkpoint export can
still cost work proportional to retained history; ordinary observation visits
the active set and consumes the runtime's completed actor projection.

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

These receipts qualify bounded survey consistency. They do not provide release,
hardware, physical MIDI or acoustic qualification, and they do not implement a
reusable branch-prefix cache.
