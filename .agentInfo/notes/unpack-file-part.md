# UnpackFilePart note

tags: unpack-file-part

`UnpackFilePart` represents a single compressed chunk inside a container. It
stores metadata such as offsets and sizes and performs the actual decompression
when `unpack()` is called. Decompression uses `BitReader` and `BitWriter` and the
resulting buffer is cached for subsequent calls.
