<<<<<<< tmp_merge/ours_.agentInfo_notes_unpack-file-part.md
=======
# UnpackFilePart note

tags: unpack-file-part

`UnpackFilePart` represents a single compressed chunk inside a container. It
stores metadata such as offsets and sizes and performs the actual decompression
when `unpack()` is called. Decompression uses `BitReader` and `BitWriter` and the
resulting buffer is cached for subsequent calls.
>>>>>>> tmp_merge/theirs_.agentInfo_notes_unpack-file-part.md
