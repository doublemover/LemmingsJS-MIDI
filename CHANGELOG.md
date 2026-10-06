# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Non-overwriting `export-all-levels` JSON archive tooling with pack identities, hashes and classic semantic roundtrip verification.
- Mobile MIDI Studio opt-in via `?midi=1`; without it, MIDI and local note preview remain hidden and inactive while saved projects stay intact.
- Browser-only game listening and per-sound preview with exclusive local/hardware destinations, bounded Web Audio voices, and cancellable user-gesture unlock.
- Opt-in spawn/landing events and major/minor/chromatic gameplay-event palettes with event-stepped notes or bounded, adaptive game-clock phrases.
- `NodeFileProvider` can load files from `.zip`, `.tar.gz`, `.tgz`, and `.rar` archives and exposes `clearCache()`.
- Node tools export sprites and package levels.

### Fixed
- Await asynchronous editor harness operations in the MCP bridge so mutation results and export resources are returned correctly.
- Remove nonexistent fifth levels from the Xmas 1991 and 1992 pack menus.
- Complete Mocha test suite with GitHub Actions workflows.
- Bench mode shows a color-coded overlay and recovers speed dynamically.
- Progressive Web App support via `site.webmanifest`, touch icons, and a service worker cache.
- New docs under `docs/` cover CI, testing and sprite export tools.
- MIDI device hot-plug listeners refresh input/output lists while preserving selections.

### Fixed
- Remove duplicate MIDI enabled/disabled status, explain inactive device selectors, and prevent stale hardware-enable completion from overriding a later local-preview choice.
- Debounced stage resize updates to avoid redundant canvas layout work.
- MIDI enable failures now surface in the UI and the error display resets cleanly.
- `DisplayImage.drawDashedRect` now handles the RGB signature used by the editor overlay.

### Changed
- Replace the default MIDI control catalogue with readable game events and one sound inspector; separate Devices, Project, and Expert workspaces, show active key truthfully, and dock the editor beside the game.
- Move game selectors and saved-level tools above the play surface, place level arrows in a right-side touch rail, and size the canvas to the remaining responsive space.
- Start MIDI Studio with event palettes and collapse detailed routing by default; reuse unchanged derived MIDI configs instead of rebuilding them per input message.
- MIDI Studio now starts hidden on every page load, with explicit open/close controls, grouped transport and advanced settings, and named note pitches. Saved MIDI routing remains independent of workspace visibility.
- `patchSprites.js` can slice sprite sheets using `--sheet-orientation`.
- `packLevels.js` creates DAT archives from 2048-byte level files.
- These tools rely on `NodeFileProvider` to read packs from folders or archives.
- `FileProvider` now prefers IndexedDB caching with localStorage fallback and chunked base64 conversion.
 
### Removed
- Agent-focused search/index tooling and related metrics tracking.

## [0.0.3] - 2025-06-08
### Added
- HQX and xBRZ scaling options for smoother graphics.
- Frame step controls for debug playback.
- Bench mode records spawn totals, spawns entrances near originals, randomizes direction and shows TPS.
- Optional custom crosshair cursor.

### Fixed
- Zoom near the level origin centers on the pointer.
- Bench timers, overlay color and text spacing.
- Zoom direction, pan clamping and bottom clamp issues.
- Viewport panning and centering calculations.
- Crosshair transparency and HUD alignment during resize.
- Stage and GUI alignment.
- Stage layout reserves a bottom margin for the HUD.

### Changed
- Project now requires Node.js 20+.

## [0.0.2] - 2025-06-04
### Added
- Keyboard shortcuts to adjust speed and game functions.
- Right-click actions for quick release-rate changes and debug toggle.
- Support for levels with multiple entrances and animated traps.
- Minimap with zoom and click-and-drag repositioning.
- Original crosshair cursor sprite.
- WebMIDI integration with device selection and error display.
- On-screen speed control UI.
- Frying, jumping and hoisting animations.
- Minimap viewport box and death markers.
- Level packs for Xmas '91/'92 and Holiday '93/'94.
- Skill selection and speed changes while paused.
- Asynchronous Blob loading for BinaryReader.
 - Mouse wheel zoom centers on the cursor and keeps the world point under the cursor fixed.

### Fixed
- Switching the game type refreshes level resources automatically.
- Numerous crashes and invisible blockers when lemmings die.
- Corrected fall height and trap cooldown behavior.
- Arrow trigger animation and explosion sprite alignment issues.
- Crash when floating and other action reapply bugs.
- Bomb counters persisting after trap deaths.
- Prevent wasted skill actions while falling.
- Log resource loading failures for easier debugging.

### Changed
- Optimized performance to handle thousands of lemmings per tick.
- Improved steel terrain detection and arrow wall functionality.

## [0.0.1] - 2025-06-03
### Added
- Displayed speed indicator with keyboard shortcuts and right-click reset.
- Instant min/max release rates and crosshair cursor sprite.
- Multi-entrance levels, trap animations with cooldowns, and arrow walls.
- Minimap with drag-to-pan, zoom, and skill usage while paused.
- Extended debug controls via Nuke toggle and URL parameters.

### Fixed
- Various crashes and invisible blockers after blocking ends.
- Actions consumed by dead lemmings and lingering bomber triggers.
- Trap sprite misalignment, arrow wall animations, and fall height.
- Missing trap cooldown and redundant or wasted actions.

### Changed
- Optimized hot loops and memory usage with typed arrays and caching.
- Grid-based trigger management and requestAnimationFrame timing.
- Better error propagation, modular code, and partial JSDoc coverage.

## [0.0.0] - 2025-05-31
### Added
- First playable JavaScript port with level and sprite assets.
- PWA manifest, icons and mobile layout improvements.
- Early WebMIDI integration with device selection.
- Basic minimap prototype and debug logging toggles.
- Initial documentation including file format notes.

### Fixed
- Crash fixes for floating lemmings and arrow triggers.
- Early steel detection and trap collision issues.

### Changed
- Removed incomplete sound and music code.
- General performance and CSS tweaks.

<!-- Keep this changelog updated with future changes. -->
