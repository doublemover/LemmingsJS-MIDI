# WebMIDI in browsers

tags: webmidi, browser

Browsers only expose WebMIDI on secure origins (`https:` or `localhost`). When `index.html` calls `WebMidi.enable()`, the user must grant permission for MIDI device access. See the MIDI section in `AGENTS.md` for quick setup details.
