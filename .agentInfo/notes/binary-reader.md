# BinaryReader note

tags: binary-reader

`BinaryReader` abstracts sequential and random-access reads from a `Uint8Array`.
It accepts arrays, ArrayBuffers or another reader and exposes methods like
`readByte`, `readInt`, `readWord` and `readString`. Offsets and lengths define a
logical window so multiple readers can share data. Position setters/getters allow
seek-like access when decoding resource files.
