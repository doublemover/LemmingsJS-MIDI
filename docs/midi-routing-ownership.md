# MIDI route ownership and submission evidence

Device discovery is passive. `ProcgenMidiPorts.setNoteOutputs(ports)` updates the
catalog without initializing a device, sending notes or clearing queues. The
selected default becomes active through `setNoteOutput(port)`. Explicit lane
routes use `setActiveNoteOutputs([{ outputId, laneIndices, role }])`; a note or
channel event with an explicit output ID may activate a discovered destination
that has never been retired. Merely looking up an endpoint grants no routing
permission. Clock selection remains a separate transport role.

`outputRoutes` reports selected, authorized, active, available and discovered
states, along with the activation epoch and route revision. `authorized` means
that routing permission exists; `active` additionally requires successful MPE
setup. A failed setup reports `state: 'setup-rejected'`, `mpeFailure` and optional
`activationFailure`. `authorizedNoteOutputIds` and `activeNoteOutputIds` expose
the same distinction without requiring UI code to infer it from device names.
Optional `channels` restricts the
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

Stop and queue clearing cancel unsent reservations while retaining recent
submitted traffic until it expires. Disabling and re-enabling a route cannot
refund a physical link's already submitted bytes. Whole-device and exclusive
scope resets count every accepted message, including accepted prefixes before a
later failure. Disposal frees the retired scheduler's accounting storage.

## Capacity and setup

DIN defaults to 3,125 data bytes per second, including serial framing.
Endpoint budget profiles can override byte capacity without inferring
transport from a device name. The default profile reports
`transport: 'unknown-webmidi'`, `protocol: 'midi1'` and
`confidence: 'conservative-default'`. A profile is configuration evidence;
declaring USB or a faster byte rate does not establish receiver capacity.
Native UMP profiles are refused by this MIDI 1 scheduler.

Configure profiles through `schedulerConfig.limits.endpointProfiles` and
`linkProfiles`, or an output adapter's `budgetProfile`. Explicit profile IDs
join endpoints onto a shared physical link:

```js
{
  endpointProfiles: {
    keyboard: { transport: 'usb', linkId: 'rack', maxMessagesPerSecond: 1000 },
    synth: { transport: 'usb', linkId: 'rack', maxMessagesPerSecond: 500 }
  },
  linkProfiles: { rack: { transport: 'din', maxBytesPerSecond: 3125 } }
}
```

Endpoint quotas count that endpoint's traffic. Declared link quotas count the
combined submitted traffic and pending reservations of every endpoint on that
link. An undeclared endpoint remains independent. `getTransportBudget(id)` and
route state expose the declared profile; pressure and rate snapshots include
the separate `sharedLink` totals. `maxPending` bounds each endpoint's planned
messages (at most 4,096); `queueHorizonMs` bounds future submissions (at most
60 seconds). Releases remain dispatchable beyond onset quotas.

Pending reservations retain their endpoint, connection epoch and route revision.
Binding a stale or different endpoint reservation is rejected;
canceling unused work refunds it without inventing sent traffic.
An evaluated plan is rechecked against intervening traffic and its original
route epoch before reservation. Closed reservations cannot be reopened by
reusing an old evaluation. Partial commits validate the endpoint, route revision
and remaining phase cost. `inspectReservation(id)` reports immutable pending
ownership and phase totals; pressure exposes the latest bounded
`lastReservationIssue` diagnostic.
Changing route budgets cancels old pending work before accepting a new revision.
Submitted history survives retirement. The 4,096-entry rolling history compacts
older messages into conservative endpoint totals rather than dropping their
cost. An aggregate expires after its latest constituent message. Extremely
high endpoint identity churn falls back to a bounded conservative charge across
all routes until expiry. Detailed lane attribution is unavailable for compacted
rows; `historyDetail` reports `conservative-endpoint-totals`.

Bank selection, program selection and required expression share the note's
admission plan. Bank changes resend an otherwise unchanged program selection.
Accepted state is cached by physical message/controller binding; raw manual
controls and binding changes invalidate that cache. Rejected setup does not
commit requested state or admit its dependent onset. MPE range initialization
reserves and counts its six RPN control messages plus pitch center per channel;
an accepted prefix remains charged after a later setup failure. Local audio
uses its voice/source admission rather than DIN byte or message quotas.
Ordinary `sendEvent({ type: 'bank', ... })` also admits both selectors together.
Final channel packets and schedule fields are validated before endpoint
activation; caller-provided event metadata cannot spend another reservation.

## Legacy MPE zone policy

MPE accepts a contiguous lower zone (manager 1, members ascending from 2) or
upper zone (manager 16, members descending from 15). Empty, duplicate,
noncontiguous, out-of-range and ensemble-reserved members are rejected.
`oppositeZoneMemberCount` can declare the other zone's occupancy; overlapping
zones are rejected. A newly reserved ensemble channel retires conflicting held
and future MPE voices before rejecting the replacement configuration.

`pitchBendRange` sets every member's range; `masterPitchBendRange` sets the
manager's independent range. Their defaults are 48 and 2 semitones respectively.
Ranges are validated through 96 semitones. `configuration: 'manual'` assumes a
receiver's zone was configured externally and sends only range/bend setup.
Explicit `configuration: 'send-zone'` admits the complete zone RPN, null
selection and range setup before dispatch. API acceptance reports
`zone-configuration-api-accepted`, with `verified: false`; no receiver response
or CI MPE Profile is implied. No speculative Reset All Controllers is sent.

`voicePolicy: 'steal-oldest'` deterministically replaces an owned member at the
new onset; `'reject'` preserves occupied members and rejects excess onsets at
dispatch. Route state reports expressive capacity and policy. Terminal receipts
retain the displaced actor and the stealing reason. No policy uses the manager
as a substitute note member. Ordinary bank/program selection targets the manager;
`programPolicy: 'member-mode4'` explicitly selects receiver Mode 4 behavior.
Custom pan or timbre controller mappings still require receiver-specific support.

These rules follow the MIDI Association's
[MIDI Polyphonic Expression specification](https://midi.org/mpe-midi-polyphonic-expression).
Zone layout, ranges and setup byte fixtures do not verify a physical receiver.

## Explicit MIDI 2 source lowering

The byte backend accepts an explicit MIDI 2 Channel Voice source through
`sendEvent({ umpWords: [word0, word1], outputId })` only when a lowering policy
is configured. This remains MIDI 1 delivery. A required `groupMap` assigns each
source UMP group to a destination channel mapping:

```js
ports.configure({ protocolLowering: { groupMap: { 0: 'preserve', 1: 5 } } });
// A lane route may provide its own protocolLowering policy.
```

`'preserve'` preserves source channels within that explicitly mapped group;
a number assigns a fixed channel. `{ channels: { 1: 2, 3: 4 } }` maps individual
source channels. Missing mappings are refused. Optional `noteIndexMode: 'rotating'`
requires sounding pitch in the source Pitch 7.9 attribute or `soundingPitch`
event field. Converted source note indices own the regenerated destination
pitch, so release and poly pressure address that pitch. A policy or route change
ends old ownership. Channel and policy descriptors are copied at activation.

Resolution conversion follows minimum/center/maximum scaling and the distinct
zero-extension rules for low-index registered controllers. MIDI 2 Note On at
zero velocity remains an onset at MIDI 1 velocity one. RPN/NRPN writes admit
selectors, data entry and optional null selection atomically; accepted prefixes
remain charged on a later rejection. Packed RPN fields ignore undefined low bits.
Bank selectors precede their program change.

Fractional pitch, unknown attributes, voice collisions and per-note pitch are
refused unless an explicit supported approximation is chosen (`pitchPolicy:
'round'`, `attributePolicy: 'omit'`, `samePitchPolicy: 'retrigger'`, or
`perNotePolicy: 'shared-channel'`). Approximation losses appear in `lastLowering`
and retained output records. Relative controllers, per-note sensitivity,
unsupported per-note messages and MPE source lowering are refused. The original
UMP words are frozen in the plan and retained as `sourceUmp` without rewriting
the source representation. `lastLowering` reports mode, reason, losses,
destination channel and accepted message count; it never claims native MIDI 2
delivery or per-note isolation on a shared MIDI 1 channel.

Reference vectors follow the MIDI Association / AMEI
[MIDI 2.0 Bit Scaling and Resolution v1.0.2](https://amei-music.github.io/midi2.0-docs/amei-pdf/M2-115-U_v1-0-2_MIDI%202.0%20Bit%20Scaling%20and%20Resolution.pdf)
and [UMP and MIDI 2.0 Protocol v1.1.2](https://amei-music.github.io/midi2.0-docs/amei-pdf/M2-104-UM_v1-1-2_UMP_and_MIDI_2-0_Protocol_Specification.pdf).
Tests validate emitted bytes with the vendored WebMidi message parser and its
actual output adapter in addition to independent numerical vectors.

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

Ordinary controller and onset dispatch account accepted bytes even when their
helper later throws or returns false. A rejected onset with no accepted bytes
does not fabricate a Note Off. Cancellation while an onset call is in progress
reports `submission-in-progress` uncertainty; a late accepted onset receives its
owned compensation afterward, including its local voice token or MPE reset.

Input Active Sensing arms only after a valid observed FE packet. Ordinary valid
traffic refreshes its 300 ms deadline; musical silence before arming is legal.
Filtered, backend-consumed and unavailable sensing remain explicit unknown
protection. A long host observation gap is distinct from an observed timeout.
Expiry ends only source-owned Thru notes and records a synthetic safety reason.
Stale source epochs and stale packets after expiry cannot rearm a gesture.
System Reset remains observable, follows an explicit input policy and is never
echoed as recovery. Musical clock loss is a separate transport condition.

Accepted scheduler/manual replacement of a MIDI 1 gate transfers its ownership;
an older Thru release or liveness expiry cannot end the replacement. Rejected
onsets do not transfer ownership. Thru releases keep their original destination
when the default selection changes. Input replacement inside an output callback
waits for that submission's result, and a newly accepted old-source onset is
released after its irrevocable deadline. Shared pedals and rejected releases
remain uncertain.

`onInputSafety(event)` and `lastInputSafety` expose immutable source route,
connection epoch, reason, evidence and cleanup outcome for temporary gesture
owners. Received System Reset under `release-owned`, source replacement and
sensing expiry produce distinct safety reasons. `data: []` distinguishes a
synthetic end from a received Note Off. A host observation gap is
`mode: 'unavailable'` / `reason: 'host-suspended'`; an observed sensing timeout is
`mode: 'expired'` / `reason: 'sensing-expired'`. Neither implies musical-clock
loss or bridge failure. A new source resets observed sensing visibility; an
explicit filtered/backend-consumed policy remains unknown protection.

Monitor, learning, recording, state and safety consumer exceptions cannot change
device admission or block source cleanup. `lastCallbackError` reports the latest
consumer failure separately from output failure. Ingress and callback byte
evidence are immutable; source epochs are revalidated after callbacks before
forwarding any packet to Thru.

Run the finite capture benchmark with
`node --expose-gc scripts/bench-midi-submission.js --name=midi`. It submits a
fixed fake-adapter workload, asserts the 4,096-event capture limit and reports
throughput and retained heap. Capture appends bounded records during dispatch;
full trace copies occur only on an explicit inspection request.

These fixtures cover browser MIDI 1 APIs, explicit source lowering and configured
link budgets using fake outputs. Native UMP delivery, measured physical link
capacity, acknowledged MPE negotiation, JR timestamps and real cable failure
measurements require their backend qualification.
## Reconfiguration under a channel grant

The port owner prepares the normalized MPE manager/member plan against every
active route's immutable channel grant before changing scheduler configuration.
An incompatible or invalid candidate is rejected as a whole, with the prior
configuration and its accepted independent routes retained. No candidate setup
bytes are sent. `lastConfigurationFailure` reports the reason and affected
outputs; each affected route exposes `configurationFailure` separately from the
readiness of its retained configuration. Expanding a grant requires an explicit
route activation. Narrowing retires that route's queued work under its old grant
before installing the new one.

The scheduler keeps a channel scope with each output, rejects incompatible
direct configuration calls, and checks both note admission and the final channel
submission boundary. An accepted MPE mode change retires old owned voices and
updates route revisions before new setup. Setup failure remains a distinct
non-ready route state. New scope and queue regression fixtures are deferred
until the backlog implementation phase is complete.

## Future-note replacement frontier

Queued reservations do not own a sounding voice. At dispatch, ordinary MIDI and
independent local gates revalidate route/source capacity and required setup
methods before selecting victims. Canceled future notes and known preflight
refusals leave the sounding owner intact.

At the requested onset, victim releases precede replacement controller/program
setup and Note On. Shared-channel controller edits also retire affected voices
before changing their channel state. Terminal evidence names budget, same-pitch
or shared-controller replacement rather than treating it as natural completion.

An adapter can refuse setup or onset after the release frontier. The failed
replacement is contained, pending ownership is removed, and the old gate is not
reconstructed automatically. This is a partial dispatch outcome; a Boolean
adapter return does not prove receiver processing or acoustic output. Controller
cache values are committed only after accepted submissions, so a refused setup
can be retried without suppressing its unsent values.
