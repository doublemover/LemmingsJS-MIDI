import {
  getRuntimeDependency
} from './e2e/e2eShared.js';
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
} from './e2e/E2EStateSerialization.js';
import {
  getBenchMetrics,
  toSortedStringList,
  getRuntimeDiagnostics,
  getCacheStorageKeys,
  getEnvironmentDiagnostics,
  getStageState,
  getCanvasMetrics
} from './e2e/E2EDiagnostics.js';
import {
  getEditorState
} from './e2e/E2EEditorState.js';
import {
  getEditorContext,
  getListForKind,
  getPrefixForKind,
  resolveEntryRef,
  cloneEntryForApply,
  normalizeBounds,
  boundsIntersect,
  applyEditorOps
} from './e2e/E2EEditorApply.js';
import {
  getBuffer,
  getEditorLevelText,
  getStageCanvasRect,
  getStageWorldPointFromPage,
  getStagePagePointFromWorld,
  centerStageOn,
  getMinimapPagePoint
} from './e2e/E2ECanvasHarness.js';
import {
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
} from './e2e/E2EGameControls.js';
const createE2EApi = (context) => ({
  version: 1,
  _setContext: (next) => {
    context.view = next?.view || context.view;
    context.editorUi = next?.editorUi || context.editorUi;
    context.midiUi = next?.midiUi || context.midiUi;
  },
  getState: () => {
    const view = context.view;
    const editorUi = context.editorUi;
    return {
      version: 1,
      mode: editorUi ? 'editor' : (view?.editorMode ? 'editor' : 'game'),
      ready: isGameReady(view),
      view: getViewState(view),
      stage: getStageState(view?.stage),
      game: getGameState(view),
      editor: getEditorState(view, editorUi),
      bench: getBenchMetrics(view),
      diagnostics: getEnvironmentDiagnostics(view),
      midi: {
        enabled: !!view?.midiEnabled,
        hasRouter: !!view?.midiRouter,
        outputName: view?.midiOut?.name || null,
        intentRevision: context.midiUi?.getMidiIntentState?.()?.revision ?? null,
        learnTarget: context.midiUi?.getMidiIntentState?.()?.learn?.target ?? null,
        featureFlags: context.midiUi?.getFeatureFlags?.() || null
      }
    };
  },
  getCanvasMetrics: () => getCanvasMetrics(context.view),
  getBuffer: (name) => getBuffer(context.view, name),
  getEditorLevelText: () => getEditorLevelText(context.view),
  stageWorldFromPage: (point) => getStageWorldPointFromPage(context.view, point),
  stagePageFromWorld: (point) => getStagePagePointFromWorld(context.view, point),
  centerStageOn: (point) => centerStageOn(context.view, point),
  getMinimapPagePoint: (options) => getMinimapPagePoint(context.view, options),
  getEditorHistoryEntry: (index) => getEditorHistoryEntry(context.editorUi?.history || null, index),
  editorApply: (ops, options) => applyEditorOps(context.view, context.editorUi, ops, options),
  pause: () => pauseGame(context.view),
  resume: () => resumeGame(context.view),
  step: (count) => stepGame(context.view, count),
  seek: (tickIndex) => seekGame(context.view, tickIndex),
  setEditorPlaytest: (enabled) => setEditorPlaytest(context.view, context.editorUi, enabled),
  setSpeed: (value) => setSpeed(context.view, value),
  startReverse: () => startReverse(context.view),
  stopReverse: () => stopReverse(context.view),
  toggleReverse: () => toggleReverse(context.view),
  flushSoundEvents: () => flushSoundEvents(context.view),
  getDelta: (tickIndex) => getHistoryDelta(context.view, tickIndex),
  getDeltas: (fromTick, toTick, maxTicks = 0) =>
    getHistoryDeltas(context.view, fromTick, toTick, maxTicks),
  selectLemmingById: (id) => selectLemmingById(context.view, id),
  centerViewOnLemming: (id) => centerViewOnLemming(context.view, id),
  getBenchMetrics: () => getBenchMetrics(context.view),
  getDiagnostics: async () => getEnvironmentDiagnostics(
    context.view,
    { cacheStorageKeys: await getCacheStorageKeys() }
  ),
  startBenchSequence: () => startBenchSequence(context.view),
  startBench: (entrances) => startBench(context.view, entrances),
  stopBench: () => stopBench(context.view),
  midiGetOverrides: () => getMidiOverrides(context.view, context.midiUi),
  midiGetIntentState: () => context.midiUi?.getMidiIntentState?.() || null,
  midiDispatchIntent: (intent) => context.midiUi?.dispatchMidiIntent?.(intent) || null,
  midiSetOverrides: (patch) => context.midiUi?.setMidiOverrides?.(patch) || false,
  midiCaptureLearnNote: (note) => context.midiUi?.captureLearnNote?.(note) || false,
  midiAuditionMapping: (targetKey, id, entry) => context.midiUi?.auditionMapping?.(targetKey, id, entry) || false
});
const installE2EHarness = ({ view, editorUi, midiUi } = {}) => {
  if (!isE2EEnabled()) return null;
  const root = getRuntimeDependency('window', null) || {};
  if (root.__E2E__ && typeof root.__E2E__._setContext === 'function') {
    root.__E2E__._setContext({ view, editorUi, midiUi });
    return root.__E2E__;
  }
  const context = { view: view || null, editorUi: editorUi || null, midiUi: midiUi || null };
  const api = createE2EApi(context);
  root.__E2E__ = api;
  return api;
};
export { installE2EHarness, isE2EEnabled };