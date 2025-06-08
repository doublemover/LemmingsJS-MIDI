tags: webmidi, doc, overview

The "Getting Started" guide introduces basic API usage:
- Call `WebMidi.enable()` and wait on the returned promise to access MIDI ports.
- Inspect `WebMidi.inputs` and `WebMidi.outputs` or call helpers like `getInputByName()` to locate a device.
- Add listeners on an `Input` (or a specific channel) to react to incoming events such as `noteon`.
- Retrieve an `Output` and send messages with helpers like `sendAllSoundOff()` or `playNote()`.
- Access channel objects via `output.channels[1..16]` when you need to target a specific MIDI channel.
