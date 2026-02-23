# E2E Harness State

Enable the harness by adding `?e2e=1` to the URL. The page exposes a stable
API at `window.__E2E__` for Playwright to read state and drive time travel.

## API
- `window.__E2E__.getState()` returns a JSON-safe snapshot.
- `window.__E2E__.getDiagnostics()` returns deterministic environment diagnostics
  (runtime profile, feature flags, and active cache snapshots).
- `window.__E2E__.getBuffer(name)` returns one heavy buffer at a time.
- `window.__E2E__.step(count)` steps forward/backward (negative allowed).
- `window.__E2E__.seek(tickIndex)` seeks via time travel (if available).
- `window.__E2E__.pause()` / `window.__E2E__.resume()` control the game timer.
- `window.__E2E__.setSpeed(factor)` sets `gameSpeedFactor`.
- `window.__E2E__.startReverse()` / `window.__E2E__.stopReverse()` toggle reverse playback.
- `window.__E2E__.toggleReverse()` flips reverse playback state.
- `window.__E2E__.flushSoundEvents()` clears the queued sound events.
- `window.__E2E__.getBenchMetrics()` returns bench-related metrics.
- `window.__E2E__.startBenchSequence()` starts the sequence bench run.
- `window.__E2E__.startBench(entrances)` starts a single bench run.
- `window.__E2E__.stopBench()` stops bench flags.
- `window.__E2E__.setEditorPlaytest(enabled)` toggles editor playtest.
- `window.__E2E__.getEditorHistoryEntry(index)` returns one editor history
  entry with full text.
- `window.__E2E__.selectLemmingById(id)` selects a lemming by ID (returns
  `true` on success).
- `window.__E2E__.midiGetIntentState()` returns the current MIDI intent state.
- `window.__E2E__.midiDispatchIntent(intent)` dispatches a MIDI intent action.
- `window.__E2E__.midiSetOverrides(patch)` applies MIDI override patches.
- `window.__E2E__.midiCaptureLearnNote(note)` injects a MIDI-learn capture note.
- `window.__E2E__.midiAuditionMapping(targetKey, id, entry?)` triggers mapping
  preview/audition through the live MIDI router.

## getState() structure

Top-level fields:
- `version`: schema version (currently `1`).
- `mode`: `game` or `editor`.
- `ready`: `true` when the level is loaded, the stage viewport is valid, and the
  game can advance without error.
- `view`: top-level GameView state.
- `stage`: viewport/pan/scale info.
- `game`: game simulation state (null before load).
- `editor`: editor state snapshot (see `docs/e2e-editor-state.md`).
- `bench`: bench metrics snapshot (if available).
- `diagnostics`: runtime profile + feature flags + cache snapshot summary.
- `midi`: midi enable/router summary.

### view
- `gameType`, `levelGroupIndex`, `levelIndex`.
- `gameSpeedFactor`, `scale`.
- `bench`, `bench2`, `benchReverse`, `benchSequence`.
- `endless`, `extraLemmings`, `preserveHistory`.
- `cheatEnabled`, `debug`.
- `performanceAPI`, `perfMetrics`.
- `includeSavedLevels`.
- `editorMode`, `editorPlaytest`.
- `midiEnabled`.
- `configName`, `configPath` from the active pack config.

### diagnostics
- `version`: schema version (currently `1`).
- `profile`: runtime profile (`gameplay`, `editor`, `perf`, etc.).
- `featureFlags`: normalized boolean flag snapshot from `GameView`.
- `caches.fileProvider`: `memoryEntries`, `localStorageBytes`,
  `indexedDbBytes` when available.
- `caches.midiOverrideKeys`: sorted list of active MIDI override keys.
- `caches.cacheStorageKeys`: sorted Cache Storage keys (`null` in
  `getState()`, populated by `getDiagnostics()`).
- `serviceWorker`: `supported`, `controlled`.
- `location`: `protocol`, `hostname`, `pathname`.

### midi
- `enabled`: current MIDI enabled state.
- `hasRouter`: whether the runtime MIDI router is attached.
- `outputName`: selected MIDI output device name (or `null`).
- `intentRevision`: current `MidiIntent` revision.
- `learnTarget`: active MIDI-learn target (or `null`).
- `featureFlags`: MIDI UI feature flags (`expressiveControls`,
  `legacyControls`, `audition`).

### stage
- `panEnabled`.
- `cursor` (screen coords).
- `viewRect` (game view rect in world coords).
- `gameScale`, `guiScale`, `rawScale`.
- `gamePosition`, `guiPosition` (screen offsets of stage images).

### game
- `ready`: `true` when the level is loaded and the stage viewport is valid.
- `finalGameState`, `state` (GameStateTypes values).
- `timer`: `tickIndex`, `speedFactor`, `frameTime`, `tps`, `running`.
- `history`: `minTick`, `maxTick`, `deltaCount`, `keyframeCount`, `spanTicks`.
- `timeTravel`: `isReversing`, `playbackDirection`.
- `victory`: `releaseRate`, `minReleaseRate`, `leftCount`, `outCount`,
  `survivorCount`, `isFinalize`.
- `skills`: `selectedSkill`, `cheatMode`, `skills` array.
- `commandManager`: `scheduledCount`, `loggedCount`.
- `lemmingManager`: `selectedIndex`, `spawnTotal`, `releaseTickIndex`,
  `mmTickCounter`, `activeCount`, `totalCount`, `nukeTargets`.
- `lemmings`: array aligned to `lemmingManager.lemmings` (null entries
  preserved). Each entry contains `id`, `x`, `y`, `lookRight`, `frameIndex`,
  `state`, `actionType`, `canClimb`, `hasParachute`, `removed`, `disabled`,
  `countdown`, `countdownActive`, `hasExploded`, `lastTriggerType`.
- `level`: `name`, `width`, `height`, `screenPositionX`, `releaseRate`,
  `releaseCount`, `needCount`, `timeLimit`, `isSuperLemming`, `entrances`,
  `triggerCount`, `objectCount`.
- `triggers`: `totalCount`, `dynamicCount`, `entries` (type + bounds + owner).
- `objects`: `count`, `entries` (position + trigger + animation state).
- `minimap`: `width`, `height`, `scaleX`, `scaleY`, `liveDotCount`,
  `deadCount`, `selectedDot`.
- `bench`: `active`, `mode`, `steps`, `tps`, `speedFactor`, `benchMaxSpeed`,
  `benchIndex`, `benchCounts`, `benchExtraList`, `benchExtraIndex`,
  `benchStartTime`, `benchMeasureExtras`, `benchStartupFrames`,
  `benchStableFactor`.
- `soundEvents`: `queuedCount`, `sequence`, `queueLimit`.

## getBuffer(name)

`getBuffer(name)` returns `{ name, encoding, dtype, byteLength, length, ... }`
with `data` base64 for the raw bytes. The `dtype` tells you how to interpret
that byte stream (`u8`, `u8c`, `u16`, `u32`, `i8`, `i16`, `i32`, `f32`, `f64`).

Supported names:
- `ground-mask`: `level.groundMask.mask` (`format: mask8`).
- `ground-image`: `level.groundImage` (`format: rgba8888`).
- `minimap-terrain`: `MiniMap.terrain`.
- `minimap-fog`: `MiniMap.fog`.
- `minimap-live-dots`: `MiniMap.liveDots` (`format: xy`, pairs).
- `minimap-dead-dots`: `MiniMap.deadDots` trimmed to `deadCount`.
- `minimap-dead-ttls`: `MiniMap.deadTTLs` trimmed to `deadCount`.

`getBuffer` returns `null` if the buffer is not available yet.
