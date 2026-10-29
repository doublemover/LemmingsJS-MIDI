# Native MIDI codec qualification

Run `npm run qualify:native-midi-codec` with CMake 3.24+, Ninja, Git and a C++20
compiler. Windows defaults to `clang++`; other platforms default to `c++`. Set
`CXX` before the first configuration to select a compiler. Dependencies and build
products live in `node_modules/.cache/lemmings-native-midi/<platform>-<arch>/`.
The command writes `.tmp/native-midi-codec-qualification.json` and fails when
configuration, compilation, corpus checks, dependency identity or source identity
cannot be qualified. CI runs the same command on Windows and Linux.

`native/midi-codec/dependencies.json` pins ni-midi2, cmidi2 and libremidi to full
commit hashes. Configuration and post-run checks reject a different revision,
tracked changes or untracked dependency files. External source is fetched into
the dependency cache and remains unchanged. Only ni-midi2 is built as a library;
cmidi2 and libremidi supply independent codec/header comparisons. The peer checks
the real libremidi raw pointer/count method shape at compile time and does not
instantiate an operating-system transport.

The executable uses a bounded ASCII line protocol. It checks integer ranges,
complete command consumption and the entire batch before invoking a controlled
synchronous sender. `UmpBatchGuard.hpp` owns a private snapshot, applies the
application's strict supported-packet rules and preserves an acknowledged prefix
when a later callback rejects or throws. The failed packet remains unconfirmed.
The sender must consume or copy the packet before returning. This target does
not establish an asynchronous driver buffer-lifetime contract.

The corpus compares typed note/controller/parameter constructors across all
groups and channels, typed scaling boundaries, signed relative values, literal
asymmetric parameter values, packet widths, complete/truncated/malformed batches,
seeded admission cases, source mutation and each later-send failure position.
Its output distinguishes expected upstream limitations from application failures:

- The pinned libremidi typed packet and iterator report zero words for Flex Data
  and Stream. The guarded raw pointer/count path uses the actual four-word width.
- cmidi2's fallback width for reserved message types cannot frame arbitrary UMP.
  The guard and ni-midi2 use the full sixteen-entry width table.
- cmidi2 lowers small nonzero MIDI 2 Note On velocities to MIDI 1 velocity zero.
  The application lowering keeps Note On velocity at least one.
- ni-midi2's convenience MIDI 1 conversion does not lower registered parameters.
  The application retains its explicit parameter lowering policy.

The receipt includes source hashes, dependency pins, compiler identity, executable
size/hash, corpus input/output hashes, width comparisons and converter probes.
Peer-process wall time includes process startup and protocol handling; it is not
a device latency or scheduling benchmark. A successful receipt qualifies this
codec and controlled callback boundary only. OS/device I/O, native ingress
filtering, timestamp scheduling, MIDI-CI/Property Exchange and hardware behavior
remain separate qualification requirements in `docs/roadmap.md`.
