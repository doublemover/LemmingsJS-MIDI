# MIDI route ownership and submission evidence

Device discovery is passive. `ProcgenMidiPorts.setNoteOutputs(ports)` updates the
catalog without initializing a device, sending notes or clearing queues. The
selected default becomes active through `setNoteOutput(port)`. Explicit lane
routes use `setActiveNoteOutputs([{ outputId, laneIndices, role }])`; a note or
channel event with an explicit output ID may activate a discovered destination
that has never been retired. Merely looking up an endpoint grants no routing
permission. Clock selection remains a separate transport role.

`outputRoutes` reports selected, active, available and discovered states, along
with the activation epoch and route revision. Optional `channels` restricts the
allowed MIDI channels. An MPE route must authorize its configured master and
members before setup. Optional `exclusiveChannels` permits channel resets on
the raw byte path. Names are labels; duplicate names do not merge identities.

A lost active destination retires its pending and sounding voices while
independent destinations continue. `lastRouteLoss` identifies its output and
affected lanes. An unused disconnect changes only the catalog. Replacing a
handle under the same output ID creates a new connection. Background discovery
cannot rearm a retired ID; an explicit user action passes `{ rearm: true }` to
the default or lane activation setter. Authored lane routes should remain in
the intent list while their device is unavailable.

## Cleanup scope

Scheduler stop and the default Panic operation release owned note tokens with
explicit Note Off. Pending onsets remain in the application until dispatch, so
canceling them removes their timer and reservation without touching a device.
Member allocation occurs at MPE onset; admitting a distant future note does not
steal its current member. Zone reconfiguration releases old owned members and
invalidates their pending work before initialization.

Shared hardware channels receive no speculative sustain, All Notes Off,
All Sound Off or bend reset from generic cleanup. MPE member release resets its
owned member bend. Local audio outputs with independent gates own their local
graph and are cleared immediately. `allNotesOff({ wholeDevice: true })` and
`ports.panic({ wholeDevice: true })` are explicit broad hardware operations.

Raw byte routes retain accepted note ownership and future release times.
Queue cancellation is qualified by the actual `clear()` result. If a future
onset has already been submitted and cannot be cleared, its replacement Note
Off follows that onset rather than preceding it. `lastCleanup` reports
`queuedRemoved`, `releaseSubmitted`, `uncertain` and `effectiveBoundary`.
A release return proves adapter acceptance only. A shared sustain pedal can
hold a released voice; cleanup reports that uncertainty instead of lifting
another sender's pedal. The scheduler cannot distinguish independent senders
of the same MIDI 1 channel and pitch without an isolated route.

## Capacity and setup

DIN defaults to 3,125 data bytes per second, including serial framing.
Endpoint budget profiles can override byte capacity without inferring
transport from a device name. Pending reservations retain their endpoint and
connection epoch. Binding a stale or different endpoint reservation is rejected;
canceling unused work refunds it without inventing sent traffic.

Bank selection, program selection and required expression share the note's
admission plan. Bank changes resend an otherwise unchanged program selection.
Accepted state is cached by physical message/controller binding; raw manual
controls and binding changes invalidate that cache. Rejected setup does not
commit requested state or admit its dependent onset. MPE range initialization
reserves and counts its six RPN control messages plus pitch center per channel;
an accepted prefix remains charged after a later setup failure. Local audio
uses its voice/source admission rather than DIN byte or message quotas.

## Capture and input liveness

The scheduler observes the active output instance's synchronous byte boundary.
This captures expanded RPN messages, the adapter's pitch rounding and actual
release velocity after member allocation. Receipts include output identity,
connection epoch, route revision, target time and submission time. Accepted
bytes are recorded in order, including accepted prefixes before an exception.
The byte observer is removed in `finally` and handles nested dispatch without
duplicating messages. Test adapters without a byte method expose the separate
`adapter-method-contract` encoding evidence. Neither form proves receiver
processing or audible output. Offline intent rendering remains explicitly
labelled as `intent-render`.

Input Active Sensing arms only after a valid observed FE packet. Ordinary valid
traffic refreshes its 300 ms deadline; musical silence before arming is legal.
Filtered, backend-consumed and unavailable sensing remain explicit unknown
protection. A long host observation gap is distinct from an observed timeout.
Expiry ends only source-owned Thru notes and records a synthetic safety reason.
Stale source epochs and stale packets after expiry cannot rearm a gesture.
System Reset remains observable, follows an explicit input policy and is never
echoed as recovery. Musical clock loss is a separate transport condition.

Run the finite capture benchmark with
`node --expose-gc scripts/bench-midi-submission.js --name=midi`. It submits a
fixed fake-adapter workload, asserts the 4,096-event capture limit and reports
throughput and retained heap. Capture appends bounded records during dispatch;
full trace copies occur only on an explicit inspection request.

These fixtures cover browser MIDI 1 APIs and fake outputs. Native UMP delivery,
shared physical link budgets, acknowledged MPE negotiation, JR timestamps and
real cable failure measurements require their native backend qualification.
