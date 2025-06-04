# TODO review

tags: todo, cleanup, code-review

This note lists lines across the repository containing TODO-like markers. They can guide future work.

## Locations
- `js/webmidi.js` lines 3597, 3640, 3760, 3831, 4626 – improvements for passing MSB/LSB values.
- `js/BinaryReader.js` line 62 – async Blob reading not implemented.
- `js/UserInputManager.js` line 205 – zoom should center on the pointer.

`AGENTS.md` and `.agentInfo/index.md` mention TODOs in documentation and can be ignored for code cleanup.

## Priority suggestions
1. **BinaryReader Blob support** – affects loading assets in modern browsers.
2. **UserInputManager zoom fix** – improves user experience.
3. **WebMIDI value passing** – lower priority; library works without it.
