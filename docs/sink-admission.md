# Pattern output admission

`ProcgenPatternEngine` keeps authored patterns separate from output admission.
`emit` and `emitCC` return a typed `accepted`, `rejected` or `deferred` result with
a sink ID. Boolean, numeric, absent and throwing callbacks cannot create active
notes or commit controller deduplication. A deliberate multi-sink callback returns
`{schema: 'lemmings-sink-admissions/v1', outcomes: [...]}` with at most eight
distinct sinks. Producers honor `meta.targetSinkId` for resume and
`meta.targetSinkIds` for controller retries before submitting to their drivers.

`SinkAdmissionRegistry` seals each transition with a receipt ID, version and
sequence. It preserves supplied world/generation/batch/intent/onset/voice/event
identity, sink/connection/route identity and target clock domain. Unknown physical
batch identity stays null; generated pattern event IDs do not invent physical
facts. Accepted/scheduled is admission evidence. Later explicit acknowledgements
may add driver-submitted, applied or receiver-observed stages, an applied frame
or an acknowledgement time with its own clock domain. They require the current
receipt and matching version/identity. Stale replies and backwards stages cannot
replace a newer receipt. These records do not establish audibility.

A deferred producer supplies both `completion` (a promise for its final typed
admission) and `cancel(reason)`. The engine owns a bounded pending entry separate
from active notes. It checks the captured generation, lane audibility, pattern
slot, route key and note deadline again before accepting completion. Pause/flush,
reset, route changes, mute, removed lanes and changed controller definitions
cancel pending work. The canceller must retire its own queued/prepared work and
acknowledge with `true`, an accepted result or a complete standard retirement
receipt; promises and retirement completion are awaited. A throw, refusal or
unacknowledged cancellation retains an explicitly uncertain bounded owner and
continues to consume capacity. A late completion cannot revive it.

Controller caches commit independently for each accepted sink and route. A sink
that accepted the current value is excluded from retry; a refused sink gets the
latest current value on a later bounded pulse. A pending identical controller
value is not resubmitted. A newer value cancels its obsolete deferred predecessor,
and the predecessor's late reply cannot overwrite the newer value. Work budgets
are spent on attempts independently from accepted active-note accounting.

Snapshots expose pending admission/cancellation diagnostics but do not restore
those entries as sound. Accepted active notes retain their sink identity for
explicit resume, and a changed route refuses that old continuation. Checkpoint
cursors keep receipt/event sequences from colliding after restoration. History
and live registries have explicit bounds; unresolved admissions are not evicted
to make a diagnostic list appear clear.

The current workstation's selected preview/MIDI backend returns frozen receipts
with captured route identity. It cancels pending work at transport, project and
port ownership boundaries. The physical causal dispatcher retains its separate
per-sink delivery records. Unifying its remaining acknowledgement/deferral paths
and qualifying actual combined-device operation are tracked in `docs/roadmap.md`.

Physical completed-tick output uses the same immutable registry through
`CausalSinkAdmissions`. Each dispatcher sink captures world/onset/event identity,
connection epoch, route revision and its own target clock. Semantic observations
with `outputRequested: false` retain an accepted semantic result and
`ackState: none`; they do not claim scheduled or applied output.

Reserve a bounded pending slot before invoking the backend, including reentrant
calls. A deferred backend supplies `completion` and `cancel(reason)`. Source,
generation, execution, route, enabled state and deadline are rechecked before
settlement; cancellation cannot revive work through a late reply. Unknown or
throwing cancellation retains its slot. Authored facts remain independent of
output receipts and inferred sounding state.

Backend begin/update/end calls receive an optional owned acknowledgement context.
Its bounded early acknowledgement buffer handles synchronous callbacks and driver
submission before deferred settlement. Public `dispatcher.acknowledge(receipt,
update)` requires the current receipt/version, matching identity and a monotone
stage. Real MIDI scheduler attack, expression and explicit release submission
advance driver-submitted receipts with a separate performance clock. A route or
connection change rejects late acknowledgements. Neither adapter return nor
driver-submitted establishes receiver processing or audibility.

Physical playback counts each initial admission and deferred settlement once.
Later acknowledgements do not increase accepted/rejected totals. Dispatch history
uses a bounded circular buffer; snapshots retain chronological order.
