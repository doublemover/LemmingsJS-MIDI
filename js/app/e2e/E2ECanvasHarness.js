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
const getBuffer = (view, name) => {
  const normalized = normalizeBufferName(name);
  const game = view?.game || null;
  const level = game?.level || null;
  const manager = game?.getLemmingManager?.() || null;
  const minimap = manager?.miniMap || null;

  switch (normalized) {
  case 'ground-mask': {
    const mask = level?.groundMask?.mask || null;
    return packBuffer('ground-mask', mask, {
      width: level?.width ?? null,
      height: level?.height ?? null,
      stride: level?.width ?? null,
      format: 'mask8'
    });
  }
  case 'ground-image': {
    const image = level?.groundImage || null;
    return packBuffer('ground-image', image, {
      width: level?.width ?? null,
      height: level?.height ?? null,
      stride: level?.width ? level.width * 4 : null,
      format: 'rgba8888'
    });
  }
  case 'minimap-terrain':
    return packBuffer('minimap-terrain', minimap?.terrain || null, {
      width: minimap?.width ?? null,
      height: minimap?.height ?? null,
      stride: minimap?.width ?? null,
      format: 'u8'
    });
  case 'minimap-fog':
    return packBuffer('minimap-fog', minimap?.fog || null, {
      width: minimap?.width ?? null,
      height: minimap?.height ?? null,
      stride: minimap?.width ?? null,
      format: 'u8'
    });
  case 'minimap-live-dots':
    return packBuffer('minimap-live-dots', minimap?.liveDots || null, {
      pairStride: 2,
      count: minimap?.liveDots?.length ? minimap.liveDots.length / 2 : 0,
      format: 'xy'
    });
  case 'minimap-dead-dots': {
    const count = minimap?.deadCount ?? 0;
    const data = minimap?.deadDots?.subarray(0, count * 2) || null;
    return packBuffer('minimap-dead-dots', data, {
      pairStride: 2,
      count,
      format: 'xy'
    });
  }
  case 'minimap-dead-ttls': {
    const count = minimap?.deadCount ?? 0;
    const data = minimap?.deadTTLs?.subarray(0, count) || null;
    return packBuffer('minimap-dead-ttls', data, {
      count,
      format: 'u8'
    });
  }
  default:
    return null;
  }
};
const getEditorLevelText = (view) => view?.getEditorLevelText?.() || '';
const getStageCanvasRect = (stage) => {
  const rect = stage?.stageCav?.getBoundingClientRect?.();
  if (!rect) return null;
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height
  };
};
const getStageWorldPointFromPage = (view, point = {}) => {
  const stage = view?.stage;
  const image = stage?.gameImgProps;
  const rect = getStageCanvasRect(stage);
  const x = Number(point?.x);
  const y = Number(point?.y);
  if (!image?.viewPoint || !rect || !Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  const localX = (x - rect.left) - (image.x ?? 0);
  const localY = (y - rect.top) - (image.y ?? 0);
  return {
    x: image.viewPoint.getSceneX(localX),
    y: image.viewPoint.getSceneY(localY)
  };
};
const getStagePagePointFromWorld = (view, point = {}) => {
  const stage = view?.stage;
  const image = stage?.gameImgProps;
  const rect = getStageCanvasRect(stage);
  const viewRect = stage?.getGameViewRect?.();
  const x = Number(point?.x);
  const y = Number(point?.y);
  const scale = image?.viewPoint?.scale ?? 1;
  if (!rect || !viewRect || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(scale)) {
    return null;
  }
  return {
    x: rect.left + (image?.x ?? 0) + (x - viewRect.x) * scale,
    y: rect.top + (image?.y ?? 0) + (y - viewRect.y) * scale
  };
};
const centerStageOn = (view, point = {}) => {
  const stage = view?.stage;
  const viewRect = stage?.getGameViewRect?.();
  if (!stage || !viewRect || !stage.gameImgProps) return false;
  const x = Number(point?.x);
  const y = Number(point?.y);
  const scale = Number.isFinite(point?.scale)
    ? Number(point.scale)
    : (stage.gameImgProps?.viewPoint?.scale ?? 1);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(scale)) return false;
  stage.applyViewport(
    stage.gameImgProps,
    x - viewRect.w / 2,
    y - viewRect.h / 2,
    scale
  );
  stage.redraw?.();
  view?.render?.();
  return true;
};
const getMinimapPagePoint = (view, options = {}) => {
  const stage = view?.stage;
  const gui = stage?.guiImgProps;
  const display = gui?.display;
  const rect = getStageCanvasRect(stage);
  const miniMap = view?.game?.getLemmingManager?.()?.miniMap || null;
  if (!gui || !display || !rect || !miniMap) return null;
  const scale = gui.viewPoint?.scale ?? 1;
  const offsetX = Number.isFinite(options?.offsetX) ? Number(options.offsetX) : 2;
  const offsetY = Number.isFinite(options?.offsetY) ? Number(options.offsetY) : 2;
  const bottomInset = Number.isFinite(options?.bottomInset) ? Number(options.bottomInset) : 1;
  const destX = display.worldDataSize.width - miniMap.width;
  const destY = display.worldDataSize.height - miniMap.height - bottomInset;
  return {
    x: rect.left + (gui.x ?? 0) + destX * scale + offsetX,
    y: rect.top + (gui.y ?? 0) + destY * scale + offsetY
  };
};
export {
  getBuffer,
  getEditorLevelText,
  getStageCanvasRect,
  getStageWorldPointFromPage,
  getStagePagePointFromWorld,
  centerStageOn,
  getMinimapPagePoint
};