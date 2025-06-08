<<<<<<< tmp_merge/ours_.agentInfo_notes_node-file-provider.md
=======
# NodeFileProvider note

tags: file-system, archives

`tools/NodeFileProvider.js` allows the rest of the project to read files from
regular directories or from archives. It maintains three caches so each archive
is parsed only once.

* **ZIP** files are opened with `AdmZip` in `_getZip`. The resulting `AdmZip`
  instance is cached in `zipCache` using the archive's absolute path as key.
* **TAR** and **TAR.GZ/TGZ** files are read via `tar.t` inside `_getTar`. Each
  file entry is captured as a `Buffer` inside a `Map` and the map is stored in
  `tarCache`.
* **RAR** archives are handled by `node-unrar-js` in `_getRar`. Files are
  extracted to a `Map` of `Buffer`s which is kept in `rarCache`.

Both `loadBinary` and `loadString` consult these caches so subsequent calls for
the same archive do not re-read the archive from disk.
>>>>>>> tmp_merge/theirs_.agentInfo_notes_node-file-provider.md
