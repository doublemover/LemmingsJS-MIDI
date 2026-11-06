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
