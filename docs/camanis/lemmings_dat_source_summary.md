# `lemmings_dat_source` contents

This archive from camanis.net provides **external C++ implementations** of the compression scheme used by the original DOS `*.DAT` files. Two files are present:

- **compression.h** – exposes `Decompressor` and `Compressor` classes. The header defines the 10‑byte compression header, a `compressed_data_section_t` structure, and methods for decoding or encoding byte streams.
- **compression.cpp** – implements the algorithm. `Decompressor` reads bits in reverse from the end of the data section and reconstructs bytes through raw blocks or references to previous output. `Compressor` searches for repeated sequences using a table of prior two‑byte patterns, builds reference chunks, and emits the bitstream with helper functions such as `pushnextbits` and `generaterawchunk`.

`compression.cpp` defines `MAXRAWCHUNKLEN`, `MAXREFCHUNKLEN` and `LENxMAXOFFSET` (normally provided by `general.h`) to limit chunk sizes and offsets.  Blocks can be raw or references and are written with helper routines such as `generateRefChunks` and `pushnextbits`. Checksums validate the data while decompressing, mirroring the behaviour of the DOS executable.

Overall the code demonstrates a custom LZ‑style encoder/decoder useful for understanding the original game files.  Our JavaScript packer/unpacker in `js/PackFilePart.js` and `js/UnpackFilePart.js` mimic the same bitstream but use a simpler search strategy and omit the C++ optimisations.
