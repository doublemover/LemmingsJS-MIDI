import {
  BASE64_CHUNK,
  BinaryReader,
  DTYPE_MAP,
  E2E_QUERY_KEY,
  EditorTools,
  LevelReader,
  LevelWriter,
  createClassicLevelData,
  createEditorLevelFromClassic,
  createGadgetEntry,
  createSteelEntry,
  createTerrainEntry,
  ensureEntryUid,
  ensureLevelEntryUids,
  findEntryAt,
  getEntryBounds,
  getRuntimeDependency,
  listSavedLevels,
  loadSavedLevel,
  removeEntryAt,
  saveLevel,
  setEntryProp,
  validateLevel
} from './e2eShared.js';
import {
  isE2EEnabled,
  normalizeBufferName,
  toByteView,
  encodeBase64,
  packBuffer,
  cloneEntry,
  cloneTerrainGroup,
  cloneUnknownSection,
  serializeEditorLevel,
  serializeSelectionEntry,
  serializeEditorController,
  summarizeEditorHistory,
  getEditorHistoryEntry,
  serializeIssues,
  serializeAssets,
  getActionType,
  serializeLemming,
  serializeTrigger,
  serializeMapObject,
  isGameReady,
  getViewState,
  getGameState
} from './E2EStateSerialization.js';
import {
  getBenchMetrics,
  toSortedStringList,
  getRuntimeDiagnostics,
  getCacheStorageKeys,
  getEnvironmentDiagnostics,
  getStageState,
  getCanvasMetrics
} from './E2EDiagnostics.js';
import {
  getEditorState
} from './E2EEditorState.js';
import {
  getEditorContext,
  getListForKind,
  getPrefixForKind,
  resolveEntryRef,
  cloneEntryForApply,
  normalizeBounds,
  boundsIntersect,
  applyEditorOps
} from './E2EEditorApply.js';
import {
  getBuffer,
  getEditorLevelText,
  getStageCanvasRect,
  getStageWorldPointFromPage,
  getStagePagePointFromWorld,
  centerStageOn,
  getMinimapPagePoint
} from './E2ECanvasHarness.js';
const getMidiOverrides = (view, midiUi) => {
  if (midiUi?.getMidiOverrides) return midiUi.getMidiOverrides();
  return view?._midiOverrides || null;
};
const pauseGame = (view) => {
  const timer = view?.game?.getGameTimer?.();
  if (!timer) return false;
  timer.suspend?.();
  return true;
};
const resumeGame = (view) => {
  const timer = view?.game?.getGameTimer?.();
  if (!timer) return false;
  timer.continue?.();
  return true;
};
const stepGame = (view, count = 1) => {
  const game = view?.game;
  const timer = game?.getGameTimer?.();
  if (!game || !timer) return false;
  if (timer.isRunning?.()) timer.suspend?.();
  const steps = Math.trunc(count);
  if (!steps) return true;
  if (steps > 0) {
    if (game.timeTravel?.isReversing) game.timeTravel.stopReverse?.();
    game.history?.truncateAfter?.(timer.tickIndex);
  }
  timer.tick(steps);
  if (game.gameGui) {
    game.gameGui.gameTimeChanged = true;
  }
  game.render?.();
  return true;
};
const seekGame = (view, tickIndex) => {
  const game = view?.game;
  const timer = game?.getGameTimer?.();
  if (!game || !timer) return false;
  if (timer.isRunning?.()) timer.suspend?.();
  if (game.timeTravel?.seekToTick) {
    game.timeTravel.seekToTick(tickIndex);
    return true;
  }
  return false;
};
const setEditorPlaytest = (view, editorUi, enabled) => {
  const desired = !!enabled;
  if (editorUi && editorUi._playtest !== desired && editorUi._togglePlaytest) {
    editorUi._togglePlaytest();
    return true;
  }
  if (view?.setEditorPlaytest) {
    view.setEditorPlaytest(desired);
    return true;
  }
  return false;
};
const setSpeed = (view, speedFactor) => {
  if (!view) return false;
  const value = Number(speedFactor);
  if (!Number.isFinite(value) || value <= 0) return false;
  view.selectSpeedFactor?.(value);
  return true;
};
const selectLemmingById = (view, lemmingId) => {
  const manager = view?.game?.getLemmingManager?.();
  const id = Number(lemmingId);
  if (!manager || !Number.isFinite(id)) return false;
  const lem = manager.getLemming?.(id);
  if (!lem || lem.removed || lem.disabled) return false;
  manager.setSelectedLemming?.(lem);
  return true;
};
const centerViewOnLemming = (view, lemmingId) => {
  const stage = view?.stage;
  const manager = view?.game?.getLemmingManager?.();
  const lem = manager?.getLemming?.(Number(lemmingId));
  if (!stage || !lem) return false;
  const rect = stage.getGameViewRect?.();
  const point = stage.gameImgProps?.viewPoint;
  if (!rect || !point) return false;
  point.x = lem.x - rect.w / 2;
  point.y = lem.y - rect.h / 2;
  view?.render?.();
  return true;
};
const startReverse = (view) => {
  const timeTravel = view?.game?.timeTravel;
  if (!timeTravel?.startReverse) return false;
  timeTravel.startReverse();
  return true;
};
const stopReverse = (view) => {
  const timeTravel = view?.game?.timeTravel;
  if (!timeTravel?.stopReverse) return false;
  timeTravel.stopReverse();
  return true;
};
const toggleReverse = (view) => {
  const timeTravel = view?.game?.timeTravel;
  if (!timeTravel?.toggleReverse) return false;
  timeTravel.toggleReverse();
  return true;
};
const flushSoundEvents = (view) => {
  const soundEvents = view?.game?.soundEvents;
  if (!soundEvents?.flush) return false;
  soundEvents.flush();
  return true;
};
const getHistoryDelta = (view, tickIndex) => {
  const history = view?.game?.history;
  const t = Math.trunc(Number(tickIndex));
  if (!history?.getDelta || !Number.isFinite(t)) return null;
  return history.getDelta(t) || null;
};
const getHistoryDeltas = (view, fromTick, toTick, maxTicks = 0) => {
  const history = view?.game?.history;
  if (!history?.getDelta) return [];

  const start = Math.trunc(Number(fromTick));
  const end = Math.trunc(Number(toTick));
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];

  const step = start <= end ? 1 : -1;
  const limit = Number.isFinite(maxTicks) && maxTicks > 0 ? Math.trunc(maxTicks) : Infinity;

  const deltas = [];
  let n = 0;
  for (let t = start; ; t += step) {
    if (n >= limit) break;
    const delta = history.getDelta(t);
    if (delta) deltas.push(delta);
    n += 1;
    if (t === end) break;
  }
  return deltas;
};
const startBenchSequence = async (view) => {
  if (!view?.benchSequenceStart) return false;
  await view.benchSequenceStart();
  return true;
};
const startBench = async (view, entrances = 1) => {
  if (!view?.benchStart) return false;
  const count = Math.max(1, Math.trunc(Number(entrances) || 1));
  await view.benchStart(count);
  return true;
};
const stopBench = (view) => {
  if (!view) return false;
  view.bench = false;
  view.bench2 = false;
  view.benchReverse = false;
  view.benchSequence = false;
  return true;
};
export {
  getMidiOverrides,
  pauseGame,
  resumeGame,
  stepGame,
  seekGame,
  setEditorPlaytest,
  setSpeed,
  selectLemmingById,
  centerViewOnLemming,
  startReverse,
  stopReverse,
  toggleReverse,
  flushSoundEvents,
  getHistoryDelta,
  getHistoryDeltas,
  startBenchSequence,
  startBench,
  stopBench
};