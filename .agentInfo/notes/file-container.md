# FileContainer note

tags: file-container

`FileContainer` parses a resource file containing multiple compressed parts. Each
section becomes an `UnpackFilePart` instance. `getPart(index)` lazily unpacks the
requested part and returns a `BinaryReader` so callers access the decompressed
bytes.
