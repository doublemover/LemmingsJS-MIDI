# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
### Changed
- Project now requires Node.js 16+ (tests use Node 18 in CI).

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
- Mouse wheel zoom centers on the cursor.

### Fixed
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
