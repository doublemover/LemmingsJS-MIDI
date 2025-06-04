# BitReader note

tags: bit-reader

`BitReader` reads bits in reverse order from a `BinaryReader`. It maintains a
small byte buffer and XOR checksum used by the decompression logic. The hot
`read` method pulls bits one at a time with minimal overhead.
