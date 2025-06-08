tags: webmidi, browser

WebMIDI.js provides an easy interface over the Web MIDI API. Calling `WebMidi.enable()` initializes access to MIDI ports and returns a promise when ready. Starting with Chrome 77 the API only works on secure origins (`https://`, `localhost:` or `file:///`) and the user must grant permission via a browser prompt. Once granted, the library exposes inputs and outputs for sending or receiving messages. Use `WebMidi.disable()` to release ports and remove listeners when done.
