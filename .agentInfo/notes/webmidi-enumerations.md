<<<<<<< tmp_merge/ours_.agentInfo_notes_webmidi-enumerations.md
=======
# WebMIDI.js enumerations

tags: webmidi, enumerations, doc

`js/webmidi.js` defines several tables describing MIDI message codes.

- **CHANNEL_MESSAGES** lists the 4-bit numbers for channel messages such as `noteoff`, `noteon`, `controlchange` and `pitchbend`.
- **CHANNEL_MODE_MESSAGES** maps channel mode commands like `allsoundoff`, `resetallcontrollers` and `polymodeon` to their numeric value.
- **CONTROL_CHANGE_MESSAGES** is an array of 128 entries. Each object includes a `number`, a `name` (e.g. `bankselectcoarse`), a short `description`, and optionally a `position` (`msb` or `lsb`).
- Deprecated getters `MIDI_CHANNEL_MESSAGES`, `MIDI_CHANNEL_MODE_MESSAGES` and `MIDI_CONTROL_CHANGE_MESSAGES` alias the new constants and print a warning when used.

Refer to the WebMIDI.js source for the complete listings.
>>>>>>> tmp_merge/theirs_.agentInfo_notes_webmidi-enumerations.md
