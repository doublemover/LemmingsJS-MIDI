<<<<<<< tmp_merge/ours_.agentInfo_notes_binary-reader.md
=======
# BinaryReader note

tags: binary-reader

`BinaryReader` abstracts sequential and random-access reads from a `Uint8Array`.
It accepts arrays, ArrayBuffers or another reader and exposes methods like
`readByte`, `readInt`, `readWord` and `readString`. Offsets and lengths define a
logical window so multiple readers can share data. Position setters/getters allow
seek-like access when decoding resource files. The constructor also accepts a
`Blob`; when provided, it loads the blob asynchronously and the `ready` promise
resolves with the resulting `Uint8Array`.
>>>>>>> tmp_merge/theirs_.agentInfo_notes_binary-reader.md
