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
import {
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
} from './E2EGameControls.js';
const getEditorState = (view, editorUi) => {
  const session = editorUi?.session || view?.editorSession || null;
  const controller = editorUi?.controller || null;
  const history = editorUi?.history || null;
  const level = session?.level || null;
  const issues = serializeIssues(validateLevel(level, editorUi?.assets || null));
  return {
    mode: !!view?.editorMode,
    playtest: !!view?.editorPlaytest,
    session: session
      ? {
        title: session.getTitle?.() || null,
        level: serializeEditorLevel(level)
      }
      : null,
    controller: serializeEditorController(controller),
    history: summarizeEditorHistory(history),
    ui: editorUi
      ? {
        activeTab: editorUi._activeTab,
        currentSavedId: editorUi._currentSavedId,
        playtest: !!editorUi._playtest,
        previewInFlight: !!editorUi._previewInFlight,
        previewQueued: !!editorUi._previewQueued,
        cursorPos: editorUi._cursorPos ? { ...editorUi._cursorPos } : null,
        pointerDown: !!editorUi._pointerDown,
        shiftKey: !!editorUi._shiftKey,
        altKey: !!editorUi._altKey,
        antsOffset: editorUi._antsOffset ?? 0,
        selectionCount: editorUi._selection?.length ?? 0,
        suppressHeader: !!editorUi._suppressHeader,
        suppressInspector: !!editorUi._suppressInspector,
        paletteSearch: editorUi.el?.paletteSearch?.value ?? ''
      }
      : null,
    assets: serializeAssets(editorUi?.assets || null),
    validation: issues,
    savedLevels: listSavedLevels()
  };
};
export {
  getEditorState
};
