<<<<<<< tmp_merge/ours_.agentInfo_notes_level-loader.md
=======
<<<<<<< tmp_merge/ours_.agentInfo_notes_level-loader.md
=======
# LevelLoader phases

tags: level-loading

`LevelLoader.getLevel` constructs a `Level` in five phases.

1. **Resolve** the index entry and download the base `.DAT` (and optional odd table).
2. **Parse header** with `LevelReader` to build a shell `Level` and populate properties.
3. **Fetch graphics** sets (`VGAGR`, `GROUND`, and optional `VGASPEC`) in parallel.
4. **Decode terrain/objects** using `GroundReader` and `GroundRenderer` to build the map.
5. **Build the `Level` instance** with ground image, mask, objects, palettes, and steel areas.
>>>>>>> tmp_merge/theirs_.agentInfo_notes_level-loader.md
>>>>>>> tmp_merge/theirs_.agentInfo_notes_level-loader.md
