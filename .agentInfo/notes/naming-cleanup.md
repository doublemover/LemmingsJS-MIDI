<<<<<<< tmp_merge/ours_.agentInfo_notes_naming-cleanup.md
=======
<<<<<<< tmp_merge/ours_.agentInfo_notes_naming-cleanup.md
=======
<<<<<<< tmp_merge/ours_.agentInfo_notes_naming-cleanup.md
=======
<<<<<<< tmp_merge/ours_.agentInfo_notes_naming-cleanup.md
=======
# Ambiguous naming cleanup

tags: cleanup, naming

A running list of places where variable or method names are overly generic.
These could be renamed or wrapped in helper functions for clarity.

## Candidates for better names
1. `js/FileProvider.js` – `_fetchBinary()` and `_fetchText()` store the HTTP response in a local variable named `data`. Rename to `response` for clarity.
2. `js/NodeFileProvider.js` – `loadBinary()` reads a file into `data` before converting it to a `Uint8Array`. Use `buffer` or `fileBuffer` instead.
3. `js/PackFilePart.js` – `data` holds the reconstructed byte array from bit groups. A name like `byteArray` would match the contents.
4. `js/Level.js` – inside `load()`, the variable `info` represents an `ObjectImageInfo`. Consider `imgInfo` or `objectInfo`.
5. `tools/processHtmlFile.js` – variables called `info` store `sourceCodeLocation` details. Rename to `sourceInfo` to distinguish from other data.
6. `tools/search.js` – metrics are loaded into a variable named `data`. Rename to `metrics` when merging search statistics.
7. `js/Animation.js` and `js/ParticleTable.js` use `arr` for temporary arrays. More descriptive names like `frameArray` or `frameData` improve readability.

These spots can guide small refactoring tasks focused solely on naming.
>>>>>>> tmp_merge/theirs_.agentInfo_notes_naming-cleanup.md
>>>>>>> tmp_merge/theirs_.agentInfo_notes_naming-cleanup.md
>>>>>>> tmp_merge/theirs_.agentInfo_notes_naming-cleanup.md
>>>>>>> tmp_merge/theirs_.agentInfo_notes_naming-cleanup.md
