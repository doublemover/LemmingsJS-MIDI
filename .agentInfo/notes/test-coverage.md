<<<<<<< tmp_merge/ours_.agentInfo_notes_test-coverage.md
=======
<<<<<<< tmp_merge/ours_.agentInfo_notes_test-coverage.md
=======
# Export scripts test coverage

tags: tests, tools, exports

Small Mocha tests create dummy packs and run the export tools via `node`.
Each script is patched to avoid bootstrapping and verifies a PNG file
is written before the temporary directories are removed.

# Test coverage notes

tags: tests, nodefileprovider, listsprites

Additional tests ensure NodeFileProvider resolves RAR paths without relying on the external rar command. Another test exercises the listSprites tool using a temporary pack and verifies that it writes the sprite list file.

# Test coverage note

tags: tests, solidlayer, geometry

Additional unit tests cover `SolidLayer`, `Range`, and `Rectangle` classes. The
new suites validate mask updates, sub layer cropping, and mask-based clearing.
Constructor fields for the geometry helpers are also verified.

# Test coverage note

tags: tests, stage, gameresult

New tests cover `StageImageProperties.createImage`, zoomed pointer event handling in `Stage`, and the `GameResult` data container.

# GameTimer test coverage

tags: tests, gametimer

Additional tests validate that `GameTimer` pauses automatically when the
`visibilitychange` event reports a hidden document and resumes once visible
again. They also verify the private speed adjustment logic through bench and
catch-up modes by driving the timer with `fakeTimers`.

# Test coverage note

tags: tests, groundreader, vgaspec

Added unit tests for `GroundReader` and `VGASpecReader` covering palette parsing,
steel detection and basic RLE decoding. This increases confidence in the binary
parsers for ground data and VGASPEC levels.
>>>>>>> tmp_merge/theirs_.agentInfo_notes_test-coverage.md
>>>>>>> tmp_merge/theirs_.agentInfo_notes_test-coverage.md
