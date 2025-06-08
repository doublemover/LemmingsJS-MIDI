<<<<<<< tmp_merge/ours_.agentInfo_notes_ground-renderer.md
=======
<<<<<<< tmp_merge/ours_.agentInfo_notes_ground-renderer.md
=======
<<<<<<< tmp_merge/ours_.agentInfo_notes_ground-renderer.md
=======
<<<<<<< tmp_merge/ours_.agentInfo_notes_ground-renderer.md
=======
# GroundRenderer note

tags: render, ground

`js/GroundRenderer.js` builds the bitmap used as the level background. `createGroundMap` allocates a `Frame` using the level's width and height then loops over `levelReader.terrains`, drawing each terrain image with `_blit`. `_blit` copies pixels from a `PaletteImage` frame, skipping transparent entries (`ci & 0x80`). The `drawProperties` flags affect how each pixel is drawn:
- `isUpsideDown` flips the source image vertically so the inner loop has no branches.
- `isErase` clears pixels instead of setting them, erasing terrain.
- `noOverwrite` and `onlyOverwrite` are forwarded to `Frame.setPixel` to control mask updates.

`createVgaspecMap` simply reuses a predecoded frame for VGASPEC levels.
After rendering, `GroundRenderer.img` holds the complete ground bitmap and its mask, which the loader passes to `Level.setGroundImage` for display.
>>>>>>> tmp_merge/theirs_.agentInfo_notes_ground-renderer.md
>>>>>>> tmp_merge/theirs_.agentInfo_notes_ground-renderer.md
>>>>>>> tmp_merge/theirs_.agentInfo_notes_ground-renderer.md
>>>>>>> tmp_merge/theirs_.agentInfo_notes_ground-renderer.md
