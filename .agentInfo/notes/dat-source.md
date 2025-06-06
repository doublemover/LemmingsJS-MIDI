# Camanis DAT compression sources

tags: dat-source compression cpp

`compression.cpp` and `compression.h` from camanis.net detail the algorithm for DOS `.DAT` files. The code implements a small LZ-style compressor and decompressor with variable-length bit commands and back-references. It tracks prior two-byte sequences to form `refchunk` structures and optimizes them before writing. Our JavaScript `UnpackFilePart` and `PackFilePart` mirror the same bitstream but use a naive search without these optimisations. Studying the external source may inspire enhancements to our compressor or confirm that our output is compatible with the historic format.
