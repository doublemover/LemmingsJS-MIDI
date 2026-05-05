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
} from './E2EGameControls.js';
const getBenchMetrics = (view) => {
  if (!view) return null;
  const timer = view.game?.getGameTimer?.() || null;
  const active = !!(view.bench || view.bench2 || view.benchReverse || view.benchSequence);
  const mode = view.benchReverse
    ? 'reverse'
    : view.benchSequence
      ? 'sequence'
      : view.bench2
        ? 'catchup'
        : view.bench
          ? 'bench'
          : null;
  return {
    active,
    mode,
    steps: view.steps ?? 0,
    tps: view.tps ?? timer?.tps ?? null,
    speedFactor: timer?.speedFactor ?? null,
    benchMaxSpeed: view._benchMaxSpeed ?? null,
    benchIndex: view._benchIndex ?? null,
    benchCounts: Array.isArray(view._benchCounts) ? view._benchCounts.slice() : [],
    benchExtraList: Array.isArray(view._benchExtraList) ? view._benchExtraList.slice() : [],
    benchExtraIndex: view._benchExtraIndex ?? null,
    benchStartTime: view._benchStartTime ?? null,
    benchMeasureExtras: !!view._benchMeasureExtras,
    benchStartupFrames: timer?.benchStartupFrames ?? 0,
    benchStableFactor: timer?.benchStableFactor ?? 1
  };
};
const toSortedStringList = (values) => {
  if (!Array.isArray(values)) return [];
  return values
    .map(value => String(value))
    .sort((a, b) => a.localeCompare(b));
};
const getRuntimeDiagnostics = (view) => {
  const fallback = {
    profile: view?.startupProfile || 'gameplay',
    rolloutFlags: view?.rolloutFlags ? { ...view.rolloutFlags } : null,
    capabilities: view?.runtimeCapabilities ? { ...view.runtimeCapabilities } : null,
    featureFlags: {
      performanceAPI: !!view?.performanceAPI,
      perfMetrics: !!view?.perfMetrics,
      perfOverlay: !!view?.perfOverlay,
      debug: !!view?.debug,
      cheatEnabled: !!view?.cheatEnabled,
      endless: !!view?.endless,
      midiEnabled: !!view?.midiEnabled,
      editorMode: !!view?.editorMode,
      editorPlaytest: !!view?.editorPlaytest,
      preserveHistory: !!view?.preserveHistory,
      includeSavedLevels: !!view?.includeSavedLevels,
      bench: !!view?.bench,
      bench2: !!view?.bench2,
      benchReverse: !!view?.benchReverse,
      benchSequence: !!view?.benchSequence
    },
    caches: {
      fileProvider: view?.gameFactory?.fileProvider?.getCacheStats?.() || null,
      midiOverrideKeys: Object.keys(view?._midiOverrides || {}).sort()
    }
  };
  const diagnostics = view?.getRuntimeDiagnostics?.() || fallback;
  return {
    profile: diagnostics.profile || fallback.profile,
    rolloutFlags: diagnostics.rolloutFlags
      ? { ...diagnostics.rolloutFlags }
      : (fallback.rolloutFlags ? { ...fallback.rolloutFlags } : null),
    capabilities: diagnostics.capabilities
      ? { ...diagnostics.capabilities }
      : (fallback.capabilities ? { ...fallback.capabilities } : null),
    featureFlags: {
      ...fallback.featureFlags,
      ...(diagnostics.featureFlags || {})
    },
    caches: {
      fileProvider: diagnostics.caches?.fileProvider ?? fallback.caches.fileProvider,
      midiOverrideKeys: toSortedStringList(
        diagnostics.caches?.midiOverrideKeys ?? fallback.caches.midiOverrideKeys
      )
    }
  };
};
const getCacheStorageKeys = async (cacheStorage = getRuntimeDependency('caches', null)) => {
  if (!cacheStorage?.keys) return [];
  try {
    return toSortedStringList(await cacheStorage.keys());
  } catch {
    return [];
  }
};
const getEnvironmentDiagnostics = (view, { cacheStorageKeys = null } = {}) => {
  const runtime = getRuntimeDiagnostics(view);
  const location = typeof window !== 'undefined' ? window.location : null;
  const serviceWorker = typeof navigator !== 'undefined' ? navigator.serviceWorker : null;
  return {
    version: 1,
    profile: runtime.profile,
    rolloutFlags: runtime.rolloutFlags,
    capabilities: runtime.capabilities,
    featureFlags: runtime.featureFlags,
    caches: {
      ...runtime.caches,
      cacheStorageKeys: Array.isArray(cacheStorageKeys)
        ? toSortedStringList(cacheStorageKeys)
        : null
    },
    serviceWorker: {
      supported: !!serviceWorker,
      controlled: !!serviceWorker?.controller
    },
    location: location
      ? {
        protocol: location.protocol || null,
        hostname: location.hostname || null,
        pathname: location.pathname || null
      }
      : null
  };
};
const getStageState = (stage) => {
  if (!stage) return null;
  const viewRect = stage.getGameViewRect?.() || null;
  return {
    panEnabled: stage.panEnabled !== false,
    cursor: { x: stage.cursorX, y: stage.cursorY },
    viewRect: viewRect ? { ...viewRect } : null,
    gameScale: stage.gameImgProps?.viewPoint?.scale ?? null,
    guiScale: stage.guiImgProps?.viewPoint?.scale ?? null,
    rawScale: stage._rawScale ?? null,
    gamePosition: {
      x: stage.gameImgProps?.x ?? null,
      y: stage.gameImgProps?.y ?? null
    },
    guiPosition: {
      x: stage.guiImgProps?.x ?? null,
      y: stage.guiImgProps?.y ?? null
    }
  };
};
const getCanvasMetrics = (view) => {
  const canvas = document.getElementById('gameCanvas');
  if (!canvas || typeof canvas.getBoundingClientRect !== 'function') return null;
  const rect = canvas.getBoundingClientRect();
  const stage = view?.stage || null;
  const gameRect = stage?.gameImgProps?.canvasViewportSize
    ? {
      x: stage.gameImgProps.x,
      y: stage.gameImgProps.y,
      width: stage.gameImgProps.canvasViewportSize.width,
      height: stage.gameImgProps.canvasViewportSize.height
    }
    : null;
  const guiRect = stage?.guiImgProps?.canvasViewportSize
    ? {
      x: stage.guiImgProps.x,
      y: stage.guiImgProps.y,
      width: stage.guiImgProps.canvasViewportSize.width,
      height: stage.guiImgProps.canvasViewportSize.height
    }
    : null;
  return {
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    size: { width: canvas.width, height: canvas.height },
    gameRect,
    guiRect
  };
};
export {
  getBenchMetrics,
  toSortedStringList,
  getRuntimeDiagnostics,
  getCacheStorageKeys,
  getEnvironmentDiagnostics,
  getStageState,
  getCanvasMetrics
};