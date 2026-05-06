# E2E Harness State

Enable the harness by adding `?e2e=1` to the URL. The page exposes a stable
API at `window.__E2E__` for Playwright to read state and drive time travel.

## API
- `window.__E2E__.getState()` returns a JSON-safe snapshot.
- `window.__E2E__.getDiagnostics()` returns deterministic environment diagnostics
  (runtime profile, rollout/capability snapshots, feature flags, and active
  cache snapshots).
- `window.__E2E__.getCanvasMetrics()` returns canvas/stage sizing diagnostics.
- `window.__E2E__.getCaptureRects(options?)` returns page-space CSS rectangles
  for visual capture tooling.
- `window.__E2E__.getBuffer(name)` returns one heavy buffer at a time.
- `window.__E2E__.stageWorldFromPage(point)` converts a page point to a game
  world point.
- `window.__E2E__.stagePageFromWorld(point)` converts a game world point to a
  page point.
- `window.__E2E__.centerStageOn(point)` centers the stage on a world point.
- `window.__E2E__.getMinimapPagePoint(options?)` returns a usable page point in
  the minimap.
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
- `window.__E2E__.getDelta(tickIndex)` and
  `window.__E2E__.getDeltas(fromTick, toTick, maxTicks?)` return history deltas.
- `window.__E2E__.setEditorPlaytest(enabled)` toggles editor playtest.
- `window.__E2E__.getEditorHistoryEntry(index)` returns one editor history
  entry with full text.
- `window.__E2E__.selectLemmingById(id)` selects a lemming by ID (returns
  `true` on success).
- `window.__E2E__.midiGetProject()` returns the current MIDI project.
- `window.__E2E__.midiGetRuntimeConfig()` returns the lowered runtime MIDI
  config used by the existing MIDI router and scheduler.
- `window.__E2E__.midiDispatchProjectIntent(intent)` dispatches a MIDI project
  intent.
- `window.__E2E__.midiResetProject(templateId)` resets the project from the
  factory template or a saved template.
- `window.__E2E__.midiExportProject(options)` returns a sanitized MIDI project
  export payload.
- `window.__E2E__.midiImportProject(payload)` imports a sanitized MIDI project
  or template payload.
- `window.__E2E__.midiSaveProjectTemplate(options)` stores the current project
  as a user template.
- `window.__E2E__.midiGetProjectTemplates()` returns saved MIDI templates.
- `window.__E2E__.midiGetUiMetrics()` returns MIDI UI render metrics.
- `window.__E2E__.midiStartLearn()` / `midiConfirmLearn()` /
  `midiCancelLearn()` drive MIDI learn.
- `window.__E2E__.midiCaptureLearnNote(note, velocity, channel)` injects a
  learned note into the active learn capture.
- `window.__E2E__.midiStartRecording()` / `midiCommitRecording()` /
  `midiCancelRecording()` drive MIDI clip recording.
- `window.__E2E__.midiCaptureRecordMessage(message)` injects a MIDI message into
  the active recording capture.
- `window.__E2E__.midiAudition(request)` triggers project audition through the
  live MIDI router.

## getCaptureRects(options?)

`getCaptureRects` returns:

```js
{
  version: 1,
  rects: {
    canvas: { x, y, width, height }
  },
  diagnostics: {
    route,
    mode,
    missing,
    available
  }
}
```

Runtime rectangle ids are omitted when the current route cannot provide them.
Known ids include:

- `canvas`: `#gameCanvas` or `#editorCanvas`.
- `stageCanvas`: the Stage canvas element.
- `game`: the rendered game image rectangle.
- `gui`: the rendered HUD image rectangle.
- `minimap`: the minimap area inside the HUD.
- `editorCanvas`: the editor canvas element.
- `editorSelection`: current editor selection bounds when a selection exists.

For world-space capture, pass a world rectangle and optional padding:

```js
window.__E2E__.getCaptureRects({
  worldRect: {
    id: 'lead-area',
    rect: { x: 0, y: 0, width: 320, height: 160 },
    padding: 8
  }
});
```

All returned rectangles are finite positive CSS-pixel rectangles suitable for
the Playwright visual capture helper. The helper writes disposable screenshots
under ignored `temp/e2e-captures/`; no manifests, baselines, or generated images
are checked in.

`diagnostics.missing` explains omitted ids. Missing surfaces are expected on
routes that do not expose that surface.

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
- `profile`: runtime profile (`classic`, `midi`, `editor`, `e2e`, `perf`,
  etc.). Legacy `gameplay` query values are normalized to `classic`.
- `rolloutFlags`: active staged-rollout/rollback flags.
- `capabilities`: runtime/browser capability matrix for WebMIDI and render
  paths.
- `featureFlags`: normalized boolean flag snapshot from `GameView`.
- `caches.fileProvider`: `memoryEntries`, `localStorageBytes`,
  `indexedDbBytes` when available.
- `caches.cacheStorageKeys`: sorted Cache Storage keys (`null` in
  `getState()`, populated by `getDiagnostics()`).
- `serviceWorker`: `supported`, `controlled`.
- `location`: `protocol`, `hostname`, `pathname`.

### midi
- `enabled`: current MIDI enabled state.
- `hasRouter`: whether the runtime MIDI router is attached.
- `outputName`: selected MIDI output device name (or `null`).
- `projectId`: current MIDI project id.
- `selectedTrackId`: selected MIDI track id.
- `selectedSourceId`: selected MIDI source id.

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
