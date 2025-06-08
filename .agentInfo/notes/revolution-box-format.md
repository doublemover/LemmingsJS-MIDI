<<<<<<< tmp_merge/ours_.agentInfo_notes_revolution-box-format.md
=======
<<<<<<< tmp_merge/ours_.agentInfo_notes_revolution-box-format.md
=======
<<<<<<< tmp_merge/ours_.agentInfo_notes_revolution-box-format.md
=======
# Revolution BOX archive

tags: revolution-box, archives

The BOX file used by **Lemmings Revolution** stores every game asset in one uncompressed container. The format has a 14-byte header followed by three variable-sized sections:

1. a directory listing the UTF-8 file names,
2. a table of offsets for each file,
3. a table of file lengths.

The tables all start with the file count and then include one 32-bit little-endian integer per entry. The file bytes themselves follow immediately after the tables.

Because offsets are absolute, the file data can appear in any order. The structure is trivial to parse and would be easy to adapt for custom packs, though it lacks compression or per-file metadata.
>>>>>>> tmp_merge/theirs_.agentInfo_notes_revolution-box-format.md
>>>>>>> tmp_merge/theirs_.agentInfo_notes_revolution-box-format.md
>>>>>>> tmp_merge/theirs_.agentInfo_notes_revolution-box-format.md
