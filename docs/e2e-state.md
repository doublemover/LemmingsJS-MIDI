# E2E Harness State

Enable the harness by adding `?e2e=1` to the URL. The page exposes a stable
API at `window.__E2E__` for Playwright to read state and drive time travel.

## API
- `window.__E2E__.getState()` returns a JSON-safe snapshot.
- `window.__E2E__.getBuffer(name)` returns one heavy buffer at a time.
- `window.__E2E__.step(count)` steps forward/backward (negative allowed).
- `window.__E2E__.seek(tickIndex)` seeks via time travel (if available).
- `window.__E2E__.pause()` / `window.__E2E__.resume()` control the game timer.
- `window.__E2E__.setSpeed(factor)` sets `gameSpeedFactor`.
- `window.__E2E__.setEditorPlaytest(enabled)` toggles editor playtest.
- `window.__E2E__.getEditorHistoryEntry(index)` returns one editor history
  entry with full text.

## getState() structure

Top-level fields:
- `version`: schema version (currently `1`).
- `mode`: `game` or `editor`.
- `ready`: `true` when the game instance exists.
- `view`: top-level GameView state.
- `stage`: viewport/pan/scale info.
- `game`: game simulation state (null before load).
- `editor`: editor state snapshot (see `docs/e2e-editor-state.md`).
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

### stage
- `panEnabled`.
- `cursor` (screen coords).
- `viewRect` (game view rect in world coords).
- `gameScale`, `guiScale`, `rawScale`.
- `gamePosition`, `guiPosition` (screen offsets of stage images).

### game
- `ready`: `true` when the game instance exists.
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
