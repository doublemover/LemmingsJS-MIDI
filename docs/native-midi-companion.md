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
