# BitWriter note

tags: bit-writer

`BitWriter` builds an output buffer backwards while reading bits from a
`BitReader`. Its `copyRawData` and `copyReferencedData` helpers mirror the
LZ-style format used by Lemmings files. `getFileReader` returns a `BinaryReader`
over the decompressed data.
