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
const isE2EEnabled = () => {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return params.has(E2E_QUERY_KEY);
};
const normalizeBufferName = (name) => {
  const raw = String(name || '').trim();
  if (!raw) return '';
  return raw
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
};
const toByteView = (array) => {
  if (!array) return null;
  return new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
};
const encodeBase64 = (bytes) => {
  if (!bytes || typeof btoa !== 'function') return null;
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    const chunk = bytes.subarray(i, i + BASE64_CHUNK);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
};
const packBuffer = (name, array, meta = {}) => {
  if (!array) return null;
  const bytes = toByteView(array);
  if (!bytes) return null;
  const dtype = DTYPE_MAP.get(array.constructor) || 'u8';
  const data = encodeBase64(bytes);
  if (!data) return null;
  return {
    name,
    encoding: 'base64',
    dtype,
    byteLength: bytes.byteLength,
    length: array.length,
    ...meta,
    data
  };
};
const cloneEntry = (entry) => {
  if (!entry) return null;
  return {
    uid: entry.uid ?? null,
    props: entry.props ? { ...entry.props } : {},
    order: Array.isArray(entry.order) ? entry.order.slice() : [],
    unknownLines: Array.isArray(entry.unknownLines) ? entry.unknownLines.slice() : []
  };
};
const cloneTerrainGroup = (group) => {
  if (!group) return null;
  return {
    props: group.props ? { ...group.props } : {},
    order: Array.isArray(group.order) ? group.order.slice() : [],
    terrains: Array.isArray(group.terrains) ? group.terrains.map(cloneEntry) : [],
    unknownLines: Array.isArray(group.unknownLines) ? group.unknownLines.slice() : []
  };
};
const cloneUnknownSection = (section) => {
  if (!section) return null;
  return {
    name: section.name ?? '',
    lines: Array.isArray(section.lines) ? section.lines.slice() : []
  };
};
const serializeEditorLevel = (level) => {
  if (!level) return null;
  const skillset = {};
  if (level.skillset?.forEach) {
    level.skillset.forEach((value, key) => {
      skillset[key] = value;
    });
  }
  return {
    header: { ...(level.header || {}) },
    headerOrder: Array.isArray(level.headerOrder) ? level.headerOrder.slice() : [],
    skillset,
    terrains: Array.isArray(level.terrains) ? level.terrains.map(cloneEntry) : [],
    gadgets: Array.isArray(level.gadgets) ? level.gadgets.map(cloneEntry) : [],
    steel: Array.isArray(level.steel) ? level.steel.map(cloneEntry) : [],
    terrainGroups: Array.isArray(level.terrainGroups)
      ? level.terrainGroups.map(cloneTerrainGroup)
      : [],
    unknownSections: Array.isArray(level.unknownSections)
      ? level.unknownSections.map(cloneUnknownSection)
      : [],
    unknownLines: Array.isArray(level.unknownLines) ? level.unknownLines.slice() : []
  };
};
const serializeSelectionEntry = (selected) => {
  if (!selected) return null;
  return {
    type: selected.type,
    index: selected.index,
    uid: selected.entry?.uid ?? null,
    entry: cloneEntry(selected.entry)
  };
};
const serializeEditorController = (controller) => {
  if (!controller) return null;
  const selection = Array.isArray(controller.selection)
    ? controller.selection.map(item => ({ type: item.type, index: item.index }))
    : [];
  const selectedEntries = controller.getSelectedEntries?.() || [];
  const selectionEntries = selectedEntries.map(serializeSelectionEntry);
  return {
    tool: controller.tool,
    gridSize: controller.gridSize,
    snapEnabled: controller.snapEnabled !== false,
    brushSize: controller.brushSize,
    eraseGadgets: !!controller.eraseGadgets,
    selectedTerrainId: controller.selectedTerrainId,
    selectedGadgetId: controller.selectedGadgetId,
    selectedTriggerId: controller.selectedTriggerId,
    handleSize: controller.handleSize,
    selection,
    selectionEntries,
    selectionBounds: controller.getSelectionBounds?.() || null,
    marqueeBounds: controller.getMarqueeBounds?.() || null,
    drag: controller._drag
      ? {
        label: controller._drag.label || null,
        entries: Array.isArray(controller._drag.entries)
          ? controller._drag.entries.map(entry => ({ ...entry }))
          : []
      }
      : null,
    resize: controller._resize ? { ...controller._resize } : null,
    marquee: controller._marquee ? { ...controller._marquee } : null,
    steelDraft: controller._steelDraft ? { ...controller._steelDraft } : null,
    strokeChanged: !!controller._strokeChanged,
    lastBrushPos: controller._lastBrushPos ? { ...controller._lastBrushPos } : null,
    pasteOffset: controller._pasteOffset ?? 0,
    pointerDown: !!controller._pointerDown,
    pointerButton: controller._pointerButton ?? 0,
    previewDelay: controller._previewDelay ?? 0,
    clipboard: controller._clipboard
      ? {
        minX: controller._clipboard.minX,
        minY: controller._clipboard.minY,
        items: Array.isArray(controller._clipboard.items)
          ? controller._clipboard.items.map(item => ({
            type: item.type,
            offsetX: item.offsetX,
            offsetY: item.offsetY,
            entry: cloneEntry(item.entry)
          }))
          : []
      }
      : null,
    stampCount: controller._stampSet?.size ?? 0
  };
};
const summarizeEditorHistory = (history) => {
  if (!history) return null;
  const entries = history.entries || [];
  return {
    cursor: history.cursor,
    count: entries.length,
    stats: typeof history.getStats === 'function' ? history.getStats() : null,
    entries: entries.map(entry => ({
      label: entry.label || '',
      time: entry.time || 0,
      bytes: entry.bytes || 0,
      textLength: entry.text?.length || 0
    }))
  };
};
const getEditorHistoryEntry = (history, index) => {
  if (!history || !Number.isFinite(index)) return null;
  const entries = history.entries || [];
  const idx = Math.trunc(index);
  const entry = entries[idx];
  if (!entry) return null;
  return {
    index: idx,
    label: entry.label || '',
    time: entry.time || 0,
    text: entry.text || ''
  };
};
const serializeIssues = (issues) => {
  if (!Array.isArray(issues)) return { hasErrors: false, issues: [] };
  const sanitized = issues.map(issue => ({
    severity: issue.severity,
    message: issue.message,
    fixLabel: issue.fixLabel || null,
    hasFix: typeof issue.fix === 'function'
  }));
  const hasErrors = sanitized.some(issue => issue.severity === 'error');
  return { hasErrors, issues: sanitized };
};
const serializeAssets = (assets) => {
  if (!assets) return null;
  return {
    styleName: assets.styleName || null,
    groundSet: assets.groundSet ?? 0,
    entranceId: assets.entranceId ?? null,
    exitId: assets.exitId ?? null,
    terrain: Array.isArray(assets.terrain) ? assets.terrain.map(item => ({ ...item })) : [],
    gadgets: Array.isArray(assets.gadgets) ? assets.gadgets.map(item => ({ ...item })) : [],
    triggers: Array.isArray(assets.triggers) ? assets.triggers.map(item => ({ ...item })) : []
  };
};
const getActionType = (manager, action) => {
  if (!manager || !action) return null;
  if (manager.actionTypeByAction?.has(action)) {
    return manager.actionTypeByAction.get(action);
  }
  return action.actionType ?? null;
};
const serializeLemming = (manager, lem) => {
  if (!lem) return null;
  return {
    id: lem.id,
    x: lem.x,
    y: lem.y,
    lookRight: !!lem.lookRight,
    frameIndex: lem.frameIndex,
    state: lem.state ?? null,
    actionType: getActionType(manager, lem.action),
    canClimb: !!lem.canClimb,
    hasParachute: !!lem.hasParachute,
    removed: !!lem.removed,
    disabled: !!lem.disabled,
    countdown: lem.countdown ?? 0,
    countdownActive: !!lem.countdownAction,
    hasExploded: !!lem.hasExploded,
    lastTriggerType: Number.isFinite(lem.lastTriggerType) ? lem.lastTriggerType : null
  };
};
const serializeTrigger = (trigger) => {
  if (!trigger) return null;
  return {
    id: trigger.__historyId ?? null,
    type: trigger.type,
    x1: trigger.x1,
    y1: trigger.y1,
    x2: trigger.x2,
    y2: trigger.y2,
    disableTicksCount: trigger.disableTicksCount,
    disabledUntilTick: trigger.disabledUntilTick,
    soundIndex: trigger.soundIndex,
    ownerId: trigger.owner?.id ?? null,
    ownerKind: trigger.owner?.__historyKind ?? trigger.owner?.historyKind ?? null,
    ownerData: trigger.owner?.__historyData ? { ...trigger.owner.__historyData } : null
  };
};
const serializeMapObject = (obj) => {
  if (!obj) return null;
  return {
    id: obj.obID ?? obj.ob?.id ?? null,
    x: obj.x,
    y: obj.y,
    triggerType: obj.triggerType,
    animation: obj.animation
      ? {
        firstFrameIndex: obj.animation.firstFrameIndex,
        isFinished: !!obj.animation.isFinished,
        loop: !!obj.animation.loop,
        frameCount: obj.animation.frames?.length ?? 0
      }
      : null
  };
};
const isGameReady = (view) => {
  const game = view?.game;
  const stage = view?.stage;
  if (!game || !stage || !game.level) return false;
  const timer = game.getGameTimer?.();
  if (!timer || typeof timer.tick !== 'function') return false;
  const viewRect = stage.getGameViewRect?.() || null;
  if (!viewRect || viewRect.w <= 0 || viewRect.h <= 0) return false;
  return true;
};
const getViewState = (view) => {
  if (!view) return null;
  return {
    gameType: view.gameType,
    levelGroupIndex: view.levelGroupIndex,
    levelIndex: view.levelIndex,
    gameSpeedFactor: view.gameSpeedFactor,
    scale: view.scale,
    bench: !!view.bench,
    bench2: !!view.bench2,
    benchReverse: !!view.benchReverse,
    benchSequence: !!view.benchSequence,
    endless: !!view.endless,
    extraLemmings: view.extraLemmings,
    preserveHistory: !!view.preserveHistory,
    cheatEnabled: !!view.cheatEnabled,
    debug: !!view.debug,
    performanceAPI: !!view.performanceAPI,
    perfMetrics: !!view.perfMetrics,
    includeSavedLevels: !!view.includeSavedLevels,
    editorMode: !!view.editorMode,
    editorPlaytest: !!view.editorPlaytest,
    midiEnabled: !!view.midiEnabled,
    configName: view.gameResources?.config?.name ?? null,
    configPath: view.gameResources?.config?.path ?? null
  };
};
const getGameState = (view) => {
  const game = view?.game;
  if (!game) return null;
  const timer = game.getGameTimer?.() || null;
  const manager = game.getLemmingManager?.() || null;
  const victory = game.getVictoryCondition?.() || null;
  const skills = game.getGameSkills?.() || null;
  const commandManager = game.getCommandManager?.() || null;
  const history = game.history || null;
  const timeTravel = game.timeTravel || null;
  const level = game.level || null;
  const triggerManager = game.triggerManager || null;
  const soundEvents = game.soundEvents || null;
  const bench = getBenchMetrics(view);

  const lemmings = Array.isArray(manager?.lemmings)
    ? manager.lemmings.map(lem => serializeLemming(manager, lem))
    : [];
  const activeCount = manager?.activeLemmings?.length ?? 0;
  const nukeTargets = Array.isArray(manager?._nukeTargets)
    ? manager._nukeTargets.map(lem => lem?.id).filter(id => Number.isFinite(id))
    : [];

  const triggers = triggerManager?._triggers
    ? Array.from(triggerManager._triggers).map(serializeTrigger)
    : [];
  const dynamicCount = triggers.filter(trigger => trigger && trigger.ownerId != null).length;

  const objects = Array.isArray(level?.objects)
    ? level.objects.map(serializeMapObject)
    : [];

  const minimap = manager?.miniMap
    ? {
      width: manager.miniMap.width,
      height: manager.miniMap.height,
      scaleX: manager.miniMap.scaleX,
      scaleY: manager.miniMap.scaleY,
      liveDotCount: Number.isFinite(manager.miniMap.liveDotsLength)
        ? manager.miniMap.liveDotsLength / 2
        : (manager.miniMap.liveDots?.length ? manager.miniMap.liveDots.length / 2 : 0),
      deadCount: manager.miniMap.deadCount ?? 0,
      selectedDot: manager.miniMap.selectedDot || null
    }
    : null;

  return {
    ready: isGameReady(view),
    finalGameState: game.finalGameState ?? null,
    inputEnabled: game.inputEnabled !== false,
    state: game.getGameState?.() ?? null,
    timer: timer
      ? {
        tickIndex: timer.tickIndex,
        speedFactor: timer.speedFactor,
        frameTime: timer.frameTime,
        tps: timer.tps,
        running: timer.isRunning?.() ?? false
      }
      : null,
    history: history?.getHistoryStats?.() ?? null,
    timeTravel: timeTravel
      ? {
        isReversing: !!timeTravel.isReversing,
        playbackDirection: timeTravel.playbackDirection
      }
      : null,
    victory: victory
      ? {
        releaseRate: victory.releaseRate,
        minReleaseRate: victory.minReleaseRate,
        leftCount: victory.leftCount,
        outCount: victory.outCount,
        survivorCount: victory.survivorCount,
        isFinalize: !!victory.isFinalize
      }
      : null,
    skills: skills
      ? {
        selectedSkill: skills.selectedSkill,
        cheatMode: !!skills.cheatMode,
        skills: Array.isArray(skills.skills)
          ? skills.skills.map((_, idx) =>
            typeof skills.getSkill === 'function' ? skills.getSkill(idx) : skills.skills[idx]
          )
          : []
      }
      : null,
    commandManager: commandManager
      ? {
        scheduledCount: Object.keys(commandManager.runCommands || {}).length,
        loggedCount: Object.keys(commandManager.loggedCommads || {}).length
      }
      : null,
    lemmingManager: manager
      ? {
        selectedIndex: manager.selectedIndex,
        spawnTotal: manager.spawnTotal,
        releaseTickIndex: manager.releaseTickIndex,
        mmTickCounter: manager.mmTickCounter,
        activeCount,
        totalCount: manager.lemmings?.length ?? 0,
        nukeTargets
      }
      : null,
    lemmings,
    level: level
      ? {
        name: level.name,
        width: level.width,
        height: level.height,
        screenPositionX: level.screenPositionX,
        releaseRate: level.releaseRate,
        releaseCount: level.releaseCount,
        needCount: level.needCount,
        timeLimit: level.timeLimit,
        isSuperLemming: !!level.isSuperLemming,
        entrances: Array.isArray(level.entrances)
          ? level.entrances.map((entrance, index) => ({
            index,
            x: entrance.x,
            y: entrance.y,
            opened: !!entrance._opened
          }))
          : [],
        triggerCount: level.triggers?.length ?? 0,
        objectCount: level.objects?.length ?? 0
      }
      : null,
    triggers: {
      totalCount: triggers.length,
      dynamicCount,
      entries: triggers
    },
    objects: {
      count: objects.length,
      entries: objects
    },
    minimap,
    bench,
    soundEvents: soundEvents
      ? {
        queuedCount: soundEvents._queue?.length ?? 0,
        sequence: soundEvents._sequence ?? 0,
        queueLimit: soundEvents._queueLimit ?? 0
      }
      : null
  };
};
export {
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
};
