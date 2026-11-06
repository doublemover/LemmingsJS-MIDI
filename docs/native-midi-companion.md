# Native MIDI companion

Build the optional sidecar with npm run build:native-midi. Source lives in
native/midi-companion/; generated dependencies and executables live in
node_modules/.cache/lemmings-midi-companion/. Compilation opens no devices and
does not install or change system MIDI services.

The C++20 target builds libremidi at the immutable revision selected by
native/midi-codec/dependencies.json. The Windows SDK archive is separately
pinned by size and SHA-256 in sdk-dependencies.json. C++/WinRT comes from the
installed Windows SDK; unversioned NuGet downloads are disabled. This build uses
the RC2 Microsoft.Windows.Devices.Midi2 interface. Compilation does not establish
compatibility with another namespace, an in-box runtime, hardware or a DAW.
Compiled APIs, selected API and usable backend are distinct readiness data.

The private stdin/stdout protocol is lemmings-native-midi/v1. Commands are
bounded ASCII lines; output is bounded newline-delimited JSON. The loopback
bridge owns this protocol and must never forward arbitrary browser strings.
Each command carries a request ID and monotonic session epoch. Endpoint tokens
belong to the current native inventory; names are display labels. Enumeration
is read-only. Opening, virtual publication and message-class grants are explicit.
Windows virtual function blocks describe granted contiguous group spans, and
the SDK discovery processor remains installed before connection open.

Raw native receive callbacks copy bounded owned words and timestamp fields
into a preallocated concurrent handoff. A session thread frames packets, applies
permissions, reports loss boundaries and emits bounded column batches. Signed
source timestamps cross JSON as decimal strings; arrival time has a separate
companion monotonic domain. Source precision remains unknown when a backend
may translate upstream. Exactly one callback delivery path is installed.

The companion is the sole output deadline owner. It bounds queued words,
batches, per-endpoint control traffic and the future horizon, with reserved
release space. Unknown transport bandwidth stays unknown. Complete batches
are validated before writes. Individual raw pointer/count sends preserve Flex
and Stream widths. Receipts distinguish queued work, a driver-submitted prefix,
rejection and an unconfirmed failed packet. None establishes receiver processing
or audible output.

Cancelled executions cannot revive under the same grant. Channel ownership
protects replacement voices. Cleanup sends only owned note-offs. A five-second
application heartbeat lease independently retires sessions. Hotplug, native faults
and disconnect retire owned work before replacement. Unconfirmed cleanup or
native closure is reported.

The target compiles and links on the development Windows x64 machine. Native
execution, loopback, callback timing, cross-platform device behavior and DAW
recording remain reserved for consolidated validation.

Start the paired loopback service with npm run start:native-midi after building.
The launcher prints a single-use local pairing code, valid for two minutes.
Enter it only in the application. Local terminal commands pair, revoke and quit
rotate the code, revoke application sessions and stop the service. Credentials
are never placed in URLs or persisted. Configure exact comma-separated
--origins values when the application uses a different address; the default
grants only localhost:8080 and 127.0.0.1:8080. The socket binds to 127.0.0.1,
accepts only its literal Host and /midi path, and requires a granted Origin.

For an HTTPS application, supply both --cert and --key for a locally trusted
WSS endpoint. Browser security settings remain unchanged. A plain HTTP desktop
development application can use the default loopback WS URL.

NativeMidiBridgeClient exposes explicit connect, enumerate, open, publish,
sendBatch, cancelExecution and closeGrant operations. Batches use a versioned
40-byte little-endian header, declared complete UMP words and bounded causal
metadata. The native process owns scheduling; browser clock samples map
performance timestamps to its monotonic domain with a bounded freshness and
uncertainty policy. Queued receipts do not resolve driver-submission promises.
Reconnect always creates a new session and never replays prior queued work.
Socket heartbeats cannot replace application heartbeats or device sensing.

The bridge/client are implemented; application routing and final security,
browser and native integration qualification remain outstanding.

The ProcGen workstation's Music settings now include Native MIDI / DAW controls.
Pair, grant a named native device or publish a named performance source, then
assign a lane and explicit group/channel. A bulk action allocates dedicated
addresses without modulo reuse and reports overflow as local only. Route edits
are one project history transaction. Saved logical output IDs require a new
explicit grant after reconnect; they are never used as OS handles.

Canonical physical intents now feed a separate native sink. MIDI2 writes retain
16-bit attack velocity, 32-bit polyphonic pressure and 7.9 pitch attributes;
explicit MIDI1-in-UMP uses reduced wire resolution. Unsupported continuous
dimensions and unverified receiver protocol are reported as degradation.
Duplicate same-pitch voices are refused, because a local voice ID does not
establish independent same-pitch receiver behavior. Shared channel use requires
an explicit ensemble decision. Setup and onset share one prevalidated batch.

Shared Stop/Panic retires native executions as well as local/WebMIDI output.
Closing and unpublishing preserve native-close and owned-note cleanup uncertainty.
Save native wire trace exports actual acknowledged prefixes and separately
unconfirmed packets with original causal identities. Browser, device and DAW
functional validation is still deferred; no listening or hardware claim is made.

Completed-tick traffic is now grouped by session, grant, execution, source batch,
priority and target time before entering the bridge. Complete packet ranges map
each shared driver receipt back to its original intent. Setup/onset transactions
remain ordered, and cancellation removes unsent owned groups before requesting
native execution cleanup. In-flight groups retain their source ownership until
their receipts settle. Releases have reserved group/word capacity.

The browser queue bounds retained words, batches, jobs and metadata estimates.
Native physical admission allows 1024 owned voices; real receiver polyphony is
still unverified. This batching implementation awaits the consolidated functional
and throughput run. It is not a measured latency or sustained-throughput claim.

Native input now has an owned browser ingress boundary. It validates complete
column batches before publishing observations, preserves signed int64 source
timestamps as decimal strings, retains wire precision separately from unknown
hardware precision, and invalidates multipart state at queue losses or sequence
gaps. Bounded SysEx/Flex/Stream collectors expire through application heartbeats.
The connection panel shows packet/loss counters and exports a separate original
native input trace.

All incoming channel packets are read-only observations. Explicit quiescent
observation scopes can consume report bodies before ordinary observers; they
expire or revoke on loss and connection replacement. This provides the ingress
boundary for application CI/report owners. Profile/Property Exchange and
live controller mapping remain outstanding.

The companion now links the immutable ni-midi2 dependency for MIDI-CI constructors
and views. Authorized CI encode/decode requests require an explicit directional
SysEx grant. They validate bounded 7-bit messages, preserve the selected CI
version and use NI's discovery, endpoint, status, invalidation and Process Inquiry
layouts. Native readiness advertises this codec separately from backend readiness.

The connection panel provides explicit Discover device features, endpoint
information and Process Inquiry actions. Choose a SysEx input connection and an
owned output, then discover. The application owns bounded peers/requests,
correlation, message-size negotiation, freshness, discovery windows, MUID collision
recovery, invalidation and async teardown. Old transaction epochs cannot resume
encoder or driver work. CI writes share the actual wire trace and use reserved
low-priority native control budgets. Ordinary performance grants remain separate.

The application advertises zero advanced CI categories. Its development identity
uses the non-commercial SysEx identifier, with no registered manufacturer claim.
The pinned library implements CI v1.2; v1.2.1 errata and platform/interoperability
qualification remain outstanding. Profiles, Property Exchange and native
live-controller mapping remain separate feature work.

The connection panel now reads selected-channel controller/program state through
isolated Message Report transactions. It probes Process Inquiry support and report
categories before requesting values. Only a matching begin/body/end sequence in
the current peer/input epoch can atomically publish a read-only observation.
Missing values remain unknown; raw MIDI1/MIDI2 widths and unverified CC-pair
interpretations remain separate. Newer local edits are preserved with conflicts.

The performer explicitly confirms device idleness. Ordinary WebMIDI input must be
disconnected before the read, and cannot be activated while it holds isolation.
Owned native notes and queued attacks must be quiescent; new attacks are held off
while releases remain available. Report bodies never reach learn, Thru, recording,
macro gestures or physical actors. Ambiguous traffic, loss, cancellation, malformed
brackets or timeout invalidate the observation. The panel offers cancellation and
a bounded values display. This feature still awaits consolidated functional and
independent-peer qualification.


Profile Configuration is now available from the same selected CI connection. The
panel queries channel, group or function-block profiles, including bounded
multi-reply inventories across granted input groups. It keeps advertised support,
reported enablement, channel-allocation details and requested changes separate.
Unknown profile IDs remain read-only. The reviewed catalog currently identifies
MPE M2-120 v2.0.3; profile-specific musical lowering is still a separate adapter.

An explicit profile change requires stopped/quiescent owned output, disconnected
ordinary input and confirmation of its affected device. A route-scoped mutation
holds new attacks, retires only that grant's application executions and invalidates
old device revisions. Only the matching receiver enabled/disabled report commits
reported state; refusal, partial allocation, timeout and cancellation remain
visible. Reassign affected lanes after reviewing the accepted state. External
profile changes invalidate old native routing and retire only app-owned notes.
No unrelated hardware state is restored automatically. Functional/peer
qualification remains deferred.

Profile framing follows the pinned NI implementation, [MIDI-CI v1.2 section 7](https://amei.or.jp/midistandardcommittee/MIDI2.0/MIDI2.0-DOCS/M2-101-UM_v1-2_MIDI-CI_Specification.pdf)
and [Common Profile Rules v1.1](https://amei.or.jp/midistandardcommittee/MIDI2.0/MIDI2.0-DOCS/M2-102-U_v1-1_Common_Rules_for_MIDI-CI_Profiles.pdf).


The MPE adapter now binds a receiver-reported allocation and queried optional
features to a selected native lane. It distinguishes CI MPE from plain UMP routes,
legacy MPE and MIDI2 per-note controllers. Every active note owns an available
member channel; the lowest allocated manager never receives notes. Exhausted
members are refused rather than sharing away independent expression. Granted
groups and route overlap are checked explicitly.

Manager-only setup establishes the shared 48-HCU bend range and cohort expression.
Members receive initial bend/pressure/third-axis values before onset and retain
independent updates until release. Queried support selects either classic
Channel Pressure/CC74 or bipolar RPN/Registered Controllers, with no duplicate
axis messages. MIDI1-in-UMP and MIDI2 retain separate wire resolution. Lane gain
updates drive manager expression as bounded coalesced cohort controls. Program
recall remains a separate device mutation, and MPE never unlocks native per-note
rotation. Profile loss or changed semantics retires affected owned executions.
This source implementation is still unqualified against an independent receiver.


Property Exchange now has a device-resource panel and owned client. It negotiates
peer concurrency, loads ResourceList before other resources, supports bounded
GET/list pagination, explicit full/partial SET and subscription start/end. Results
retain peer, connection, device revision, resource ID, cache metadata and byte
provenance. Device replies and subscription updates are immutable observations;
they do not rewrite the project or echo setters. Partial/notify updates coalesce
into bounded refresh reads. Resource schemas/references remain inert data.

The client implements the [published Common Rules v1.2](https://amei-music.github.io/midi2.0-docs/amei-pdf/M2-103-UM_v1-2_Common%20Rules_for_MIDI-CI_Property_Exchange.pdf),
including resource-declared flow control, ACK waits, bounded retries of only the
most recent SET chunk, timeout extensions and transaction termination. It
separates device acknowledgement from an asynchronous accepted/unknown result.
Every request owns a native control execution; cancellation fences its remaining
chunks before a mutation releases its hold. Unconfirmed cancellation quarantines
the output grant. Settled writes invalidate intermediate cached observations and
resource descriptors.

ASCII with escaped Unicode, Mcoded7 and zlib+Mcoded7 are available only when
advertised by the resource. Wire, decoded, JSON nesting/item, cache, peer, queue,
subscription and deadline limits are enforced separately. HTML/script/XML/SVG
media are refused; binary data remains opaque. The native codec constructs and
validates PE frames with NI views while the application owns JSON and transaction
policy. Device/peer conformance, compression fixtures, musical deadline and memory
qualification remain deferred to the consolidated validation pass. This is not a
claim that a hardware patch or parameter has been independently verified.


The hardware-sound browser now uses [ProgramList v1.01](https://amei-music.github.io/midi2.0-docs/amei-pdf/M2-107-UM_v1-01_Property_Exchange_ProgramList_Resource.pdf)
and [Foundational Resources v1.1.1](https://amei-music.github.io/midi2.0-docs/amei-pdf/M2-105-UM_v1-1-1_Property_Exchange_Foundational_Resources.pdf).
It first reads ChannelList and follows only the selected channel's advertised
ProgramList collection IDs. Bounded pages, category/tag search and bank/program
identities keep duplicate names distinct. A project can save a content-digested
patch intent with device identity, collection and exact zero-based bank/program.
No MUID, live handle or permission is persisted; the local instrument stays the
preview approximation.

Recall is a separate explicit stopped-boundary device mutation. The user selects
the exact current native group/channel and declares its relationship to the
chosen ChannelList entry. That mapping is user-supplied; it is not independent
function-block metadata. Setup is validated as one native batch and the wire
trace retains the actual driver prefix. Readback must report the same bank/program
on the selected PE channel. Partial submission, unsupported readback, mismatch,
cancellation and uncertain cleanup remain visible.

Binding a recalled patch is another explicit lane action. Imported or reopened
patch intent cannot authorize hardware, and native attacks refuse an unconfirmed
current binding. Once bound, the sink uses the selected patch without replaying
bank/program setup at every new execution. Device revisions, peer loss and
external program observations invalidate old authorization. Patch/property writes
invalidate prior profile semantics; MPE must be reviewed and rebound after recall.
The browser UI shows the accepted/reporting boundary separately from audible
sound. Independent endpoint mapping and hardware/peer qualification remain open.


Endpoint control now uses owned input/output registries. The companion exposes NI
Stream discovery/configuration constructors and bounded Endpoint Info, identity,
configuration and Function Block views. Windows grants include the SDK's declared
endpoint/protocol/function-block metadata and opaque same-endpoint association
tokens. Function Blocks take precedence over USB terminal blocks; inactive blocks
do not contribute routable groups. Names do not define endpoint identity.

The endpoint panel distinguishes supported protocols from a notified active
protocol, displays block number/direction/group span, and requests a protocol
change only at an explicit stopped boundary. Discovery is rate/time/queue bounded
and does not activate note output. Unknown metadata remains visible. Changes to
declared endpoint semantics retire the current affected endpoint grants rather
than applying old route assumptions after reconfiguration.

Dedicated and MPE allocation consult current direction, protocol and group
evidence. ChannelList mapping can use the CI peer's actual Function Block number,
then translate its relative channel through that block's first group. Patch recall
refuses a conflicting declared mapping. OS-associated endpoint evidence remains
distinct from a manually selected input/output pair. Private Product Instance IDs
are not exported by the registry state.

This implementation follows [UMP v1.1.2](https://amei-music.github.io/midi2.0-docs/amei-pdf/M2-104-UM_v1-1-2_UMP_and_MIDI_2-0_Protocol_Specification.pdf)
and the pinned NI Stream APIs. Fine-grained retirement within an already granted
endpoint and native JR timestamp realization remain separate development work.
JR-required receiver configuration currently holds performance admission; the
panel's explicit protocol request selects a configuration without JR. Native
compilation and formatting pass; no functional/device/interoperability pass is
claimed before the final consolidated run.


### Native JR timing and SDK submission observations

Eligible native backends can adopt a confirmed receiver JR policy at a stopped endpoint boundary. The companion owns independent 200 ms JR clocks, 32 µs modulo timestamps and monotonic ordering repair on its existing steady-clock deadline queue. Stream changes fence every companion-owned grant on the endpoint until matching notification and timing-policy adoption; unconfirmed changes require reopening. SDK-call traces include original packets, JR envelopes, owned-note cleanup, acceptance uncertainty and native call intervals. These observations prove neither receiver delivery nor acoustic timing.

Windows MIDI Services owns endpoint discovery/protocol negotiation and [explicitly forbids applications from requesting or supplying JR timestamps](https://microsoft.github.io/MIDI/kb/midi2-implementation-details/). The Windows adapter consumes OS-declared metadata, refuses application protocol requests/JR generation, and refuses performance on known JR-required endpoints. No Windows JR support or native timestamped-send qualification is claimed. Other native backends retain companion deadline scheduling; JR/device/timing qualification is deferred.


### Discovery-backed device expression

The device-expression panel consumes AllCtrlList, ChannelList-linked ChCtrlList and CtrlMapList from [Controller Resources v1.0](https://amei.or.jp/midistandardcommittee/MIDI2.0/MIDI2.0-DOCS/M2-117-UM_v1-0_Property_Exchange_Controller_Resources.pdf). It preserves significant resolution, distinct transmit/recognize forms, exact channel/function-block scope, parameter paths and declared ranges/enumerations. Unknown units remain unnamed. Incoming changes and isolated reports are observations; neither missing reports nor relative increments invent an absolute baseline. Manual writes require current observed revision and a quiescent owned output; native SDK submission remains separate from receiver value confirmation.

Saved lane mappings retain a cached descriptor and device fingerprint, with explicit activation on the current route after discovery/reconnect. Pressure, onset impact, authored spacing expression, completed movement/height and terrain work can drive bounded curves with source-domain smoothing, deadband and pickup. Physical changes use the existing causal native execution and batch deadline, never a timer-generated replacement rhythm. MIDI1 conversion occurs at the wire adapter and keeps whole CC/RPN transactions together. Note-scoped controls require an owned note. Channel momentary/toggle physical bindings currently refuse activation until controller-release leases and shared-pedal ownership are implemented; manual stopped-boundary control remains explicit.


### Physical percussion roles and reviewed hardware maps

Percussion lanes now save semantic hit roles and action-specific role choices separately from an explicit hardware map. The native panel supports the receiver-reported [Default Drum Note Map Profile v1.0](https://amei-music.github.io/midi2.0-docs/amei-pdf/M2-125-UM_v1-0_Default-Drum-Note-Map-Profile.pdf), an explicitly selected unverified GM map, or a named custom map with unique role/note addresses. Profile bindings require the exact accepted group/channel and current note-availability details. Neither a drum lane nor channel10 activates a map. Map changes retain physical onset identities and local kit selection. Native same-note overlap is refused without rotating an instrument into another drum; accepted profile mutually exclusive sets suppress later controls on receiver-choked voices while preserving their matching Note Off obligations.

The profile detail decoder follows the ten semantic bytes explicitly enumerated in Table11 and accepts only bounded zero extension. The published v1.0 reply example disagrees on payload length (20 in the length field, 11 in prose, ten tabulated semantic bytes); no receiver interoperability or erratum resolution is claimed before the consolidated validation pass. Optional per-note control support is recorded independently of note-map support; ordinary pressure is not guessed as a drum control. Patch recall remains a separate reviewed device mutation.


### Onset-bound orchestral articulation

The orchestral panel authors version-pinned M2-123 v1.0 classification/subclass choices, variations and physical-action recipes separately from hardware activation. It reads the exact 130-byte feature/variation report, gates optional mute/playing-position/release controls and requires an enabled single-channel profile plus observed active MIDI2 Stream configuration. Native onsets carry one validated articulation attribute with direction, round-robin and string fields; no keyswitch notes are synthesized. Unsupported variations and a pitch7.9 attribute conflict are refused explicitly. There is no implicit per-note-pitch fallback.

The source intent, physical onset identity, exact attribute and raw SDK words remain separate trace facts; raw MIDI Clip packets preserve their complete attribute fields. Profile/patch changes invalidate live authorization. Note Off uses the profile’s default midpoint release velocity unless a supported authored release is selected; companion-owned MIDI2 cleanup also uses the neutral midpoint. Instrument categories are authored context: the standard has eight articulation classifications and nine advisory instrument-family columns, not a wire-level category-negotiation mechanism. No audible category equivalence or independent receiver qualification is claimed.


### Owned performance pedals

The native companion now tracks accepted or uncertain performance writes to sustain (CC64), sostenuto (CC66) and una corda (CC67) by protocol/group/channel and owning execution. Storage is a fixed 1536-slot array per grant with a constant-time empty check. Confirmed zero writes release ownership. Execution cancellation and grant/session retirement lift only pedals set by that performance before sending its matching Note Offs; they do not issue Reset All Controllers or blanket channel panic. Control-plane/manual parameter writes remain explicitly requested device state and do not silently acquire a performance pedal lease.

Cleanup receipts and driver traces distinguish unconfirmed notes from unconfirmed controllers, and browser owners quarantine either failure. Protocol/JR policy changes require pedal ownership to be empty as well as notes and queued work. Pedal cleanup is SDK-submission evidence; it cannot certify a remote instrument’s acoustic response. The companion advertises ownedPedalCleanupVersion1 for profile adapters that depend on this behavior.


### Piano Profile dynamics and shared part pedals

The Piano adapter pins M2-126 v1.0 (2026-07-08) from the [official specification and implementation-guide archive](https://midi.org/midi-ci-profile-for-piano). The inspected normative PDF SHA-256 is d43fb830d041f9a751d19da2fc17fb42b22f9790566994cc8afe3e3fe0d69ce2. Only that small document archive was fetched into the ignored research cache; the 753 MB reference-audio archive is not bundled or downloaded.

A saved piano policy selects an authored dynamic or a normalized physical-impact range over the standard Silent–ffff velocity table. The native sink retains 16-bit attack/release data until explicit MIDI1 lowering, checks the receiver’s declared playable range and refuses unqualified fractional-note attributes. Optional scale temperament/tonic and release damping require declared receiver support. The target0x40 31-byte details decoder keeps sender and receiver features distinct, including continuous sustain, sostenuto, una corda, note range and raw rendering-delay declarations. A sender-only profile is not a receiving piano.

One native part aggregates held actor sustain contributions and owns shared pedal controls; actor release removes only that actor’s contribution. Sostenuto is sent as a real part transition, allowing the receiver to capture only notes held then. Accessible pedal strips save separate override intent and show native-submitted versus observed values. Device pedal changes arm pickup and cancel stale UI drafts; isolated Message Reports supply current baseline evidence. An absent baseline remains unknown. Source smoothing advances only on source samples, independently of UI refresh. Stop/seek/disconnect use the companion’s scoped pedal cleanup. Local recipes remain explicitly unqualified approximations. Independent receiver, pedal, tuning, replay and listening qualification is deferred.


### Independent drawbar-organ and rotary profiles

Organ/rotary policies bind the independent [Drawbar Organ v1.0.2](https://amei-music.github.io/midi2.0-docs/amei-pdf/M2-121-UM_v1-0-2_Drawbar-Organ-Profile.pdf) and [Rotary Speaker v1.0.2](https://amei-music.github.io/midi2.0-docs/amei-pdf/M2-122-UM_v1-0-2_Rotary-Speaker-Profile.pdf) profiles at their accepted single-channel scope. Nine drawbars use the standard discrete controller values; percussion, click and leakage require reported organ feature bits. Rotary slow/fast is independent of organ support. Optional brake and acceleration require current recognized PE controller descriptors on the same peer/scope; no optional rotary feature inquiry or physical seconds mapping is invented.

The compact drawbar bank supports keyboard and exact numeric entry, requested/native/observed state, authored density registrations and explicit hardware activation. A parallel rotary-only output has its own sink/execution and keeps the lane’s local or native note output. It emits controls without fictitious Note On/Off packets. Actual cohort positions/displacements drive a bounded circulation estimate; missing positional evidence remains unknown. Cohort controls are calculated once after the completed physical tick, and source smoothing does not depend on UI refresh.

Registration restoration is an explicit stopped-part action. It restores only a previously observed original whose fresh isolated current readback still matches the app’s last submitted value at the declared wire resolution. Unknown/conflicting controls are skipped. Successful submission suspends that part until explicit rebind, and receiver confirmation remains separate. Cached report indexes avoid repeated full value scans; actual native controller writes expire baseline reuse only on the affected grant/group/channel. No whole-device reset, implicit audition rollback or local acoustic equivalence is claimed. Qualification remains deferred.


The hardware sound browser also exposes advertised StateList/State resources (M2-111 v1.0). Read-only captures are bounded to four entries, 512 KiB each and 1 MiB aggregate, and remain private to the connection. Normal project exports contain no state bytes. Explicit private JSON export includes the vendor payload and its SHA-256 digest; import verifies both bounds and digest. Restore requires the same manufacturer/family/model/software identity, a fresh exact CI/output preview and an explicit stopped boundary across all owned native outputs. Device state may affect all groups and global configuration. A status-200 setter acknowledgement alone is not presented as restoration: a bounded subsequent State readback must match the captured digest. Device normalization may produce a reported mismatch; acoustic state remains unverified. Primary specification: https://amei-music.github.io/midi2.0-docs/amei-pdf/M2-111-UM_v1-0_Get_and_Set_Device_State.pdf


Incoming JR context is scoped to each owned input grant and activated only by current endpoint configuration evidence. It unwraps clocks, retains the most recent timestamp across simultaneous messages, and invalidates on input loss, clock expiry or reversed/ambiguous context. Sender timestamp reconstruction uses an explicitly bounded ±7813-tick proximity window around the latest clock, with a 500 ms receive-context age limit; values outside that implementation window remain unknown. The eight recent clock-arrival offsets supply a diagnostic native-time estimate and observed jitter range, not a qualified one-way time mapping. Original backend timestamps and native arrival times remain intact. No JR input observation creates an onset, changes physical timing or grants input playback.


Current companions advertise groupRetirementVersion 1. An OS function-block change narrows only affected groups from a live grant and retires executions that actually depend on them; endpoint removal/global protocol changes still retire the grant. Native performance executions are separated by group, with cross-group MPE allocations retained as indivisible dependencies. Input collectors discard only affected group streams. Group revalidation is an explicit current-inventory action, limited to the originally authorized mask and current nonconflicting spans; affected lanes and CI sessions require fresh activation. Names/UI hints do not define native routing epochs. Confirmed automatic cleanup receipts are reused instead of issuing duplicate cancellation requests; unknown cleanup retains the existing whole-grant retirement behavior.


The native score-context panel saves an explicit authored lane policy for tempo/meter, key, chord, composition name and annotation. Tempo/meter come from the actual physical timeline/project meter; inferred tonal labels are never promoted to authored facts. Semantic ScoreContextEvents retain physical coordinates and provenance separately from standard UMP words. Native transactions place context before dependent onsets and use the same deadline; completed source batches update held parts without a new note or replacement beat. Group context is shared, while harmony/text use the explicitly chosen group/channel scope.

Flex text is UTF-8, up to 384 bytes / 32 packets, with byte-based segmentation and contiguous native batch ordering. Chord lowering uses the inspected UMP v1.1.2 Figure75 layout, including four main alterations, two bass alterations and reserved padding. Read-only incoming metadata has a separate 128-entry bounded view. The MIDI1 conversion helper reports tempo precision loss and unsupported key-mode/chord/address representations. Clip-level legal tempo/meter boundary projection and full native accepted-output take export are still separate integration work; real-time physical changes do not move onsets onto clock cells. No receiver or independent latest-source qualification is claimed.


Native output recording is an explicit independent owner, sourced only from validated SDK-call observations. It stores up to65536 packets in fixed512-record typed pages, with a16MiB reservation covering retained pages, one snapshot and binary export copies. It records accepted and unconfirmed packets, native begin/end microseconds, driver sequence, execution, native batch and cleanup/JR kind. It does not duplicate logical batch receipts. Routing/session changes stop the recording; Stop records an observation boundary and adds no future events.

The exact .nativeump observation artifact begins with8 ASCII bytes LMUMPSDK, a big-endian32-bit JSON-header byte length, then UTF-8 metadata and fixed column pages. Header layout entries declare each column’s name, element count, type and byte length; column bytes use little-endian encoding. Only the header’s count records are live; final-page padding is zero. This is an application observation artifact, separate from a standard MIDI Clip. Exact captured data can include configuration/SysEx bytes. Unknown/held start/end boundaries and unconfirmed/omitted packets remain explicit.


A stopped native output recording can prepare a standard MIDI Clip through an explicit export plan. The source is accepted SDK calls from one captured connection/output; it is never reconstructed authored intent or input+Thru duplication. Timing is explicitly projected from native SDK call starts, with original call intervals in attribution. This is distinct from physical deadlines, JR render time and acoustic timing.

The default selectable fixed-seconds plan uses a declared60BPM Clip timebase and preserves original channel words while omitting captured tempo/meter from the file; their original values/words remain in the sidecar. The alternate strict plan selects one group and retains qualified original tempo/meter, refusing off-clock or unknown bar changes. Both preserve packet order and report actual piecewise projection error. Multipart text uses one event time, contiguous equal-time packets and original per-packet call timestamps in attribution. No Note Off, receiver preset or unknown baseline is invented. Unknown/open note ranges and raw relative-controller replay require explicit selection.

Clip preparation excludes unconfirmed packets, transport timestamps and setup/control-plane data with a precise loss report. The original .nativeump artifact remains available for exact observation preservation. The SHA-256-bound sidecar identifies source scope, packet identities, omissions, note boundaries, timing changes and receiver-state uncertainty. Prepared files retain an owned artifact lease until discarded/view disposal; generation cancellation releases source and workspace leases. Files are data only and are not submitted to a device.


Companions with controllerCleanupVersion1 accept bounded, typed performance release policies. A policy identifies one complete CC, CC-pair, RPN or NRPN transaction and its explicit release value; structural channel controls, legacy MPE configuration and automatically owned pedal addresses cannot be registered. Limits are256 policies per grant,4096 globally and64 policy IDs per native batch. Binary flag1 wraps provenance and a separate policy-ID list; legacy flag0 retains its existing encoding.

Registration sends no controller data. Native execution ownership arms only after a matching accepted or uncertain SDK write. Partial MIDI1 selector-only submission acquires selector cleanup, not permission to alter an untouched parameter. Confirmed exact release disarms the property; cancellation and policy retirement use only the registered release transaction. Retirement cancels complete dependent batches, and uncertainty quarantines the grant. Toggle release restores the input trigger level only: the receiver’s latched property remains unknown and toggle replay requires explicit baseline-dependent selection.


Browser release jobs retain bounded dependencies on the actual onset or prior part control, and remain cancellable while waiting. Matching Note Offs travel separately from shared pedal transitions, so an actor ending cannot turn a positive shared-control update into an invalid release packet. Equal native deadlines preserve admission order; release priority reserves capacity without moving a release ahead of its own onset. A failed release retires its affected group execution. Confirmed native grant retirement also clears the browser owner; unconfirmed cleanup remains visible in native retirement diagnostics.
