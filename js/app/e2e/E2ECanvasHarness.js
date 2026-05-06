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
const getStageCanvasScale = (stage, rect = getStageCanvasRect(stage)) => {
  const canvas = stage?.stageCav || null;
  const width = Number(canvas?.width);
  const height = Number(canvas?.height);
  return {
    x: rect && Number.isFinite(width) && width > 0 ? rect.width / width : 1,
    y: rect && Number.isFinite(height) && height > 0 ? rect.height / height : 1
  };
};
const stageCanvasToPageRect = (stage, rect) => {
  const stageRect = getStageCanvasRect(stage);
  if (!stageRect || !rect) return null;
  const scale = getStageCanvasScale(stage, stageRect);
  return {
    x: stageRect.left + Number(rect.x) * scale.x,
    y: stageRect.top + Number(rect.y) * scale.y,
    width: Number(rect.width) * scale.x,
    height: Number(rect.height) * scale.y
  };
};
const stageCanvasToPagePoint = (stage, point) => {
  const stageRect = getStageCanvasRect(stage);
  if (!stageRect || !point) return null;
  const scale = getStageCanvasScale(stage, stageRect);
  return {
    x: stageRect.left + Number(point.x) * scale.x,
    y: stageRect.top + Number(point.y) * scale.y
  };
};
const pageToStageCanvasPoint = (stage, point) => {
  const stageRect = getStageCanvasRect(stage);
  if (!stageRect || !point) return null;
  const scale = getStageCanvasScale(stage, stageRect);
  return {
    x: (Number(point.x) - stageRect.left) / scale.x,
    y: (Number(point.y) - stageRect.top) / scale.y
  };
};
const getStageWorldPointFromPage = (view, point = {}) => {
  const stage = view?.stage;
  const image = stage?.gameImgProps;
  const canvasPoint = pageToStageCanvasPoint(stage, point);
  const x = Number(point?.x);
  const y = Number(point?.y);
  if (!image?.viewPoint || !canvasPoint || !Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  const localX = canvasPoint.x - (image.x ?? 0);
  const localY = canvasPoint.y - (image.y ?? 0);
  return {
    x: image.viewPoint.getSceneX(localX),
    y: image.viewPoint.getSceneY(localY)
  };
};
const getStagePagePointFromWorld = (view, point = {}) => {
  const stage = view?.stage;
  const image = stage?.gameImgProps;
  const viewRect = stage?.getGameViewRect?.();
  const x = Number(point?.x);
  const y = Number(point?.y);
  const scale = image?.viewPoint?.scale ?? 1;
  if (!viewRect || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(scale)) {
    return null;
  }
  return stageCanvasToPagePoint(stage, {
    x: (image?.x ?? 0) + (x - viewRect.x) * scale,
    y: (image?.y ?? 0) + (y - viewRect.y) * scale
  });
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
  const miniMap = view?.game?.getLemmingManager?.()?.miniMap || null;
  if (!gui || !display || !miniMap) return null;
  const scale = gui.viewPoint?.scale ?? 1;
  const offsetX = Number.isFinite(options?.offsetX) ? Number(options.offsetX) : 2;
  const offsetY = Number.isFinite(options?.offsetY) ? Number(options.offsetY) : 2;
  const bottomInset = Number.isFinite(options?.bottomInset) ? Number(options.bottomInset) : 1;
  const destX = display.worldDataSize.width - miniMap.width;
  const destY = display.worldDataSize.height - miniMap.height - bottomInset;
  return stageCanvasToPagePoint(stage, {
    x: (gui.x ?? 0) + destX * scale + offsetX,
    y: (gui.y ?? 0) + destY * scale + offsetY
  });
};
const isFinitePositiveRect = (rect) => (
  rect
  && Number.isFinite(rect.x)
  && Number.isFinite(rect.y)
  && Number.isFinite(rect.width)
  && Number.isFinite(rect.height)
  && rect.width > 0
  && rect.height > 0
);
const normalizePageRect = (rect) => {
  if (!rect) return null;
  const x = Number(rect.x ?? rect.left);
  const y = Number(rect.y ?? rect.top);
  const width = Number(rect.width);
  const height = Number(rect.height);
  const normalized = { x, y, width, height };
  return isFinitePositiveRect(normalized) ? normalized : null;
};
const addRect = (rects, diagnostics, id, rect, missingReason) => {
  const normalized = normalizePageRect(rect);
  if (normalized) {
    rects[id] = normalized;
    return true;
  }
  if (missingReason) diagnostics.missing[id] = missingReason;
  return false;
};
const getCanvasElementRect = () => {
  const canvas = document.getElementById('gameCanvas') || document.getElementById('editorCanvas');
  const rect = canvas?.getBoundingClientRect?.();
  if (!rect) return null;
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height
  };
};
const getStagePageRect = (stage) => {
  const rect = getStageCanvasRect(stage);
  if (!rect) return null;
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height
  };
};
const getStageImagePageRect = (stage, image) => {
  const width = Number(image?.canvasViewportSize?.width ?? image?.width);
  const height = Number(image?.canvasViewportSize?.height ?? image?.height);
  if (!image || !Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }
  return stageCanvasToPageRect(stage, {
    x: Number(image.x) || 0,
    y: Number(image.y) || 0,
    width,
    height
  });
};
const getMinimapPageRect = (view) => {
  const stage = view?.stage;
  const gui = stage?.guiImgProps;
  const display = gui?.display;
  const miniMap = view?.game?.getLemmingManager?.()?.miniMap || null;
  if (!gui || !display || !miniMap) return null;
  const scale = gui.viewPoint?.scale ?? 1;
  const width = Number(miniMap.width) * scale;
  const height = Number(miniMap.height) * scale;
  const destX = display.worldDataSize.width - miniMap.width;
  const destY = display.worldDataSize.height - miniMap.height;
  return stageCanvasToPageRect(stage, {
    x: (gui.x ?? 0) + destX * scale,
    y: (gui.y ?? 0) + destY * scale,
    width,
    height
  });
};
const getWorldPageRect = (view, rect, padding = 0) => {
  const x = Number(rect?.x);
  const y = Number(rect?.y);
  const width = Number(rect?.width);
  const height = Number(rect?.height);
  const pad = Number.isFinite(padding) ? Math.max(0, Number(padding)) : 0;
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  const start = getStagePagePointFromWorld(view, { x, y });
  const end = getStagePagePointFromWorld(view, { x: x + width, y: y + height });
  if (!start || !end) return null;
  const left = Math.min(start.x, end.x) - pad;
  const top = Math.min(start.y, end.y) - pad;
  const right = Math.max(start.x, end.x) + pad;
  const bottom = Math.max(start.y, end.y) + pad;
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  };
};
const getEditorSelectionPageRect = (view, editorUi, padding = 0) => {
  const ctx = getEditorContext(view, editorUi);
  const bounds = ctx?.controller?.getSelectionBounds?.() || null;
  if (!bounds) return null;
  return getWorldPageRect(view, bounds, padding);
};
const getCaptureRects = (view, editorUi, options = {}) => {
  const rects = {};
  const diagnostics = {
    route: typeof location !== 'undefined' ? location.pathname : null,
    mode: editorUi ? 'editor' : (view?.editorMode ? 'editor' : 'game'),
    missing: {}
  };
  const stage = view?.stage || null;

  addRect(rects, diagnostics, 'canvas', getCanvasElementRect(), 'missing #gameCanvas/#editorCanvas');
  addRect(rects, diagnostics, 'stageCanvas', getStagePageRect(stage), 'missing stage canvas');
  addRect(rects, diagnostics, 'game', getStageImagePageRect(stage, stage?.gameImgProps), 'missing stage game rect');
  addRect(rects, diagnostics, 'gui', getStageImagePageRect(stage, stage?.guiImgProps), 'missing stage gui rect');
  addRect(rects, diagnostics, 'minimap', getMinimapPageRect(view), 'missing minimap');

  const editorCanvas = document.getElementById('editorCanvas')?.getBoundingClientRect?.();
  addRect(rects, diagnostics, 'editorCanvas', editorCanvas
    ? {
      x: editorCanvas.left,
      y: editorCanvas.top,
      width: editorCanvas.width,
      height: editorCanvas.height
    }
    : null, 'missing #editorCanvas');
  addRect(
    rects,
    diagnostics,
    'editorSelection',
    getEditorSelectionPageRect(view, editorUi, options?.editorSelectionPadding),
    'missing editor selection'
  );

  if (options?.worldRect || options?.rect) {
    const spec = options.worldRect || options;
    const id = String(spec?.id || options?.id || 'worldRect');
    const padding = Number.isFinite(spec?.padding)
      ? Number(spec.padding)
      : (Number.isFinite(options?.padding) ? Number(options.padding) : 0);
    addRect(
      rects,
      diagnostics,
      id,
      getWorldPageRect(view, spec?.rect || spec, padding),
      'invalid or unavailable world rect'
    );
  }

  diagnostics.available = Object.keys(rects).sort();
  return {
    version: 1,
    rects,
    diagnostics
  };
};
export {
  getBuffer,
  getEditorLevelText,
  getStageCanvasRect,
  getStageWorldPointFromPage,
  getStagePagePointFromWorld,
  centerStageOn,
  getMinimapPagePoint,
  getCaptureRects,
  getWorldPageRect
};
