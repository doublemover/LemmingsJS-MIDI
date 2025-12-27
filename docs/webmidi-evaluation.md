# WebMidi Evaluation

## Intent
Identify which WebMidi.js classes and APIs can replace or simplify our custom MIDI plumbing, and document what would change in behavior.

## Library inventory (from js/vendor/webmidi.js)
- WebMidi (singleton)
  - enable()/disable(), inputs/outputs arrays, getInputById()/getOutputById()
  - events: enabled, disabled, connected, disconnected, portschanged
  - time base: WebMidi.time (performance.now alias)
- Input / Output ports
  - Input.addListener()/addOneTimeListener() for noteon, noteoff, controlchange, pitchbend, clock, start, stop, continue, midimessage
  - Output.channels[1..16] (OutputChannel) for channel-scoped senders
- OutputChannel
  - sendNoteOn(), sendNoteOff(), playNote()/stopNote(), sendControlChange(), sendPitchBend(), sendPitchBendRange(), sendProgramChange(), sendAllNotesOff()
  - options.time to schedule events relative to WebMidi.time
- Note
  - Note identifier parsing (C#4, Db3) and rawAttack/rawRelease velocity helpers
- Utilities
  - Note conversions (note name <-> number), 7-bit <-> float helpers

## What we can leverage directly
- Input event routing
  - Use Input.addListener('noteon'/'noteoff'/'controlchange'/'pitchbend') with the WebMidi channel filters instead of manual parsing in MidiInputController.
  - Prefer InputChannel filtering when we move away from Omni input (still keep Omni support by listening without channel filters).
- Output channel helpers
  - Replace direct MIDI message construction with OutputChannel.sendNoteOn/sendNoteOff/sendControlChange/sendPitchBend/sendPitchBendRange.
  - Use playNote()/stopNote() when duration-based scheduling is desired.
- Scheduling alignment
  - Pass options.time using our computed schedule timestamps (based on WebMidi.time) so WebMidi handles timestamped sends.
  - Keep our queue and rate limiting; only change the send call site.
- Note parsing utilities
  - Use Note or Utilities conversion for user-entered note strings to reduce custom parsing surface.

## What should remain custom
- Rate limiting and queue management
  - WebMidi does not provide per-second rate limiting or queue thinning, so MidiScheduler and MidiEventRouter remain required.
- Mapping and musical logic
  - Scale/key/chord/arp mapping is unique to this project and should stay in MidiMapping and MidiEventRouter.
- MPE channel allocation strategy
  - WebMidi provides channel APIs but does not manage MPE voice allocation or per-note channel pools.

## Behavior differences to account for
- Velocity semantics
  - WebMidi Note/OutputChannel allow float 0..1 or raw 0..127. Our code uses 0..127, so always pass rawAttack/rawRelease or map to 0..1 explicitly.
- Scheduling semantics
  - options.time expects absolute time based on WebMidi.time, not relative offsets.
  - If we continue to schedule via our own timers, use options.time for exact device scheduling and keep our own queue for thinning.
- Error handling
  - WebMidi throws if not enabled or if devices are missing; our wrappers should guard with enabled checks.

## Recommended integration steps
1) Input: switch MidiInputController to Input.addListener() with channel filters, keep Omni default.
2) Output: wrap OutputChannel in our output adapter so MidiScheduler only calls sendNoteOn/sendNoteOff/sendControlChange/sendPitchBend.
3) Scheduling: use options.time with WebMidi.time for every send; keep MidiScheduler queue and limits.
4) Notes: optionally accept Note identifiers in mapping config and normalize via WebMidi Note/Utilities.

## Non-goals
- Replacing MidiScheduler or MidiEventRouter.
- Changing mapping semantics or UI behavior.
- Modifying vendor/webmidi.js directly.
