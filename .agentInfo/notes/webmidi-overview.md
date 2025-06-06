
# WebMIDI.js quick start overview

tags: webmidi, doc, overview

This project bundles **WebMIDI.js** (`js/webmidi.js`). The official
`website/docs/getting-started/` pages highlight these basics:

* **Enable the library** with `WebMidi.enable()`. From v3 it returns a
  promise. To use system exclusive messages, call `enable({ sysex: true })`.
  Browsers display a permission prompt when the call is made.
* **List devices** via `WebMidi.inputs` and `WebMidi.outputs`. Retrieve a
  specific port using `getInputByName()` or `getOutputByName()`.
* **Listen for data** with `Input.addListener()` or per-channel helpers such as
  `input.channels[10].addListener("noteon", fn)`.  
* **Send data** through `OutputChannel` methods including `playNote()`,
  `sendControlChange()` and `sendPitchBend()`.

`supported-environments.md` notes that Edge 79+, Chrome 43+, Opera 30+ and
Firefox 108+ implement the Web MIDI API. Node.js support is available via
Jazz‑Soft's JZZ module.

`index.html` loads the library but the call to `WebMidi.enable()` is commented
out on lines 20‑24. Initialization assigns `WebMidi.outputs[0]` on line 61.

# WebMIDI.js usage overview

tags: webmidi, midi, doc

This project bundles WebMIDI.js (`js/webmidi.js`), a library for interacting with the Web MIDI API. The main classes are:

- **WebMidi** – singleton providing global access to MIDI. Key methods include `enable(options)`, `disable()`, `addListener()`, `getInputById()`, `getOutputByName()` and `waitFor()`. Properties like `inputs`, `outputs`, `octaveOffset` and `time` expose available devices and global settings.
- **Input** – represents a MIDI input port. It exposes `open()`, `close()`, `addListener()`, `addForwarder()`, `removeForwarder()` and event helpers such as `hasListener()` and `waitFor()`.
- **Output** – represents a MIDI output port. Important methods are `send()`, `sendNoteOn()`, `sendNoteOff()`, `sendControlChange()`, `sendProgramChange()`, `sendPitchBend()` and `clear()`. Each output owns multiple `OutputChannel` objects.
- **OutputChannel** – wraps channel‑specific operations. Methods include `playNote()`, `stopNote()`, `sendPitchBend()`, `sendProgramChange()`, `sendControlChange()` and helper functions like `waitFor()`.

`index.html` loads `js/webmidi.js` and defines an `onEnabled()` callback to populate MIDI input/output lists. The call to `WebMidi.enable()` is currently commented out at lines 22‑24. Game initialization assigns the first detected output to `lemmings.midiOut` at line 61.

### TODOs and limitations

`js/webmidi.js` contains several TODO markers about MSB/LSB handling:

* `sendMasterTuning()` wants to allow MSB/LSB pairs (line 3597).
* `sendModulationRange()` notes similar MSB/LSB support (line 3640).
* `sendPitchBend()` intends to standardize MSB/LSB parameters (line 3760).
* `sendPitchBendRange()` suggests accepting a single value or MSB/LSB pair
  (line 3831).
* `sendSongPosition()` could accept a two‑value array for MSB/LSB (line 4626).

The library also warns that `Output.clear()` is defined in the Web MIDI spec
but may be unavailable in some browsers. Calls to `enable()` mention that
requesting access to software synths is not implemented by browsers as of 2021.

