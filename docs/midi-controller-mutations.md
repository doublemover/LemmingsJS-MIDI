# Ordered controller mutations

`MidiControllerMutations` retains authoritative local controller state in raw
32-bit units. It shares the existing UMP codec and port scheduler. It owns no
transport, sequencer, timer or automation graph.

The address includes endpoint ID, connection epoch, group, source channel,
registered/assignable kind, bank and index. A baseline requires explicit
`local-authored` or `device-report` provenance, a source reference and a descriptor
declaring absolute/relative support, significant bits, raw bounds and quantization.
Replacing a baseline requires its current revision. A submitted output value is
not sufficient evidence to establish a baseline; receiver value remains unknown.
Groups use 0–15; public source channels use 1–16, with the codec's wire channel
converted at this boundary.

Each relative packet is decoded as a signed increment and saturated in arrival
order. The full raw accumulator survives display quantization, step and enum
projection. Opposite increments are never summed across saturation or absolute
resets. A prepared mutation carries an opaque, one-shot revision ticket; a newer
baseline or mutation invalidates older tickets. Sequence and timestamp regressions
refuse explicitly. Capacity pressure refuses new addresses without evicting an
existing authoritative baseline. Default capacity is 256 addresses, with no
pending queue or retained gesture history.

The [UMP v1.1.2 section 7.4.8](https://amei-music.github.io/midi2.0-docs/amei-pdf/M2-104-UM_v1-1-2_UMP_and_MIDI_2-0_Protocol_Specification.pdf)
defines the two's-complement field and matched controller address space. The
[MIDI Association's relative controller guidance](https://midi.org/midi-2-0-protocol-using-relative-registered-assignable-controls)
recommends retaining fine increments and recording resolved values to avoid
replay drift. Tests also retain the boundary-sensitive arithmetic illustrated by
the [pinned ni-midi2 controller value helper](https://github.com/midi2-dev/ni-midi2/blob/26e008c10b18e2397d7b65e184b71da3327e78d1/inc/midi/types.h).
The codec accepts the complete signed 32-bit representation; this resolver does
not introduce a new reserved-value rule based on the guidance article's prose.

## Explicit MIDI1 lowering

The stateless MIDI2-to-MIDI1 codec continues to refuse relative packets. An active
port route may opt into `protocolLowering.relativeControllers =
'resolve-verified-baseline'`. Its trusted parameter owner must then call
`ports.bindControllerBaseline` with the current route's `connectionEpoch`, source
address, descriptor, raw value, authority and source reference. A delayed report
must also supply the revision captured when that report began. The call must not
be used to infer a device value from a successful send.

`ports.sendEvent({umpWords, controllerSequence?, baselineRevision?, timeMs?})`
resolves that explicitly bound state to an absolute controller packet, then uses
the existing group/channel policy, rate reservation and RPN/NRPN data-entry path.
It does not emit CC96/97 or claim standards-equivalent relative translation.
An unknown baseline, unsupported operation or old sequence/time sends nothing.
Each accepted packet advances the raw baseline only after its complete API
submission; a partial/uncertain submission invalidates the baseline. Panic,
reconnect, route/policy replacement, explicit invalidation and untyped program or
compound-controller writes also retire the appropriate baseline. Rejected rate
admission leaves it intact because no write was attempted.

Recorded output carries absolute `umpWords`/`sourceUmp` and `controllerOperation:
'set'`. `rawRelativeGesture` retains the original relative words as diagnostics.
Replaying the absolute record twice cannot apply its increment twice. This is a
local requested-value contract: `receiverValue` remains null, and API submission
does not prove receiver acceptance or acoustic output.

Native UMP transport, PE-derived descriptors, isolated MIDI-CI state reports and
live expressive input mapping retain their separate ownership and availability.
This implementation supplies no guessed remote baseline or implicit device grant.
