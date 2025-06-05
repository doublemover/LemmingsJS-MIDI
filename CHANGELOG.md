# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `NodeFileProvider` can load files from `.zip`, `.tar.gz`, `.tgz`, and `.rar` archives and exposes `clearCache()`.
- Node tools export sprites and package levels.
- Complete Mocha test suite with GitHub Actions workflows.
- Bench mode shows a color-coded overlay and recovers speed dynamically.
- Progressive Web App support via `site.webmanifest` and touch icons.
- Detailed `.agentInfo` indexes aid navigation.

### Changed
- Project now requires Node.js 16+ (tests use Node 18 in CI).
- `patchSprites.js` can slice sprite sheets using `--sheet-orientation`.
- `packLevels.js` creates DAT archives from 2048-byte level files.
- These tools rely on `NodeFileProvider` to read packs from folders or archives.


## [0.0.2] - 2025-06-04
### Added
- `.agentInfo/` directory for searchable design notes.
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

<!-- Keep this changelog updated with future changes. -->
