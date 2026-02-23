import { listSavedLevels, loadSavedLevel, saveLevel } from '../editor/EditorStorage.js';
import {
  createTerrainEntry,
  createGadgetEntry,
  createSteelEntry,
  ensureEntryUid,
  ensureLevelEntryUids,
  setEntryProp,
  removeEntryAt
} from '../editor/EditorEntryFactory.js';
import { createClassicLevelData } from '../editor/EditorLevelLoader.js';
import { createEditorLevelFromClassic } from '../editor/ClassicLevelConverter.js';
import { EditorTools } from '../editor/EditorTools.js';
import { findEntryAt, getEntryBounds } from '../editor/EditorHitTest.js';
import { BinaryReader } from '../data/BinaryReader.js';
import { LevelReader } from '../level/LevelReader.js';
import { LevelWriter } from '../level/LevelWriter.js';
import { validateLevel } from '../editor/EditorValidator.js';
import { getRuntimeDependency } from '../core/dependencies.js';

const E2E_QUERY_KEY = 'e2e';
const BASE64_CHUNK = 0x8000;
const DTYPE_MAP = new Map([
  [Uint8Array, 'u8'],
  [Uint8ClampedArray, 'u8c'],
  [Uint16Array, 'u16'],
  [Uint32Array, 'u32'],
  [Int8Array, 'i8'],
  [Int16Array, 'i16'],
  [Int32Array, 'i32'],
  [Float32Array, 'f32'],
  [Float64Array, 'f64']
]);

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
    entries: entries.map(entry => ({
      label: entry.label || '',
      time: entry.time || 0,
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
    ownerId: trigger.owner?.id ?? null
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
      liveDotCount: manager.miniMap.liveDots?.length
        ? manager.miniMap.liveDots.length / 2
        : 0,
      deadCount: manager.miniMap.deadCount ?? 0,
      selectedDot: manager.miniMap.selectedDot || null
    }
    : null;

  return {
    ready: isGameReady(view),
    finalGameState: game.finalGameState ?? null,
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

const getEditorContext = (view, editorUi) => {
  if (!editorUi) return null;
  const session = editorUi.session || view?.editorSession || null;
  const controller = editorUi.controller || null;
  const history = editorUi.history || null;
  if (!session || !session.level || !controller || !history) return null;
  return {
    session,
    controller,
    history,
    assets: editorUi.assets || null,
    editorUi
  };
};

const getListForKind = (level, kind) => {
  if (!level) return null;
  if (kind === 'gadget') return level.gadgets;
  if (kind === 'steel') return level.steel;
  if (kind === 'terrain') return level.terrains;
  return null;
};

const getPrefixForKind = (kind) => {
  if (kind === 'gadget') return 'g';
  if (kind === 'steel') return 's';
  return 't';
};

const resolveEntryRef = (level, ref) => {
  if (!ref || !level) return null;
  const kind = ref.kind || ref.type;
  const list = getListForKind(level, kind);
  if (!Array.isArray(list)) return null;
  let index = Number.isFinite(ref.index) ? Math.trunc(ref.index) : null;
  if (!Number.isFinite(index) && ref.uid) {
    index = list.findIndex(entry => entry?.uid === ref.uid);
  }
  if (!Number.isFinite(index) || index < 0 || index >= list.length) return null;
  return { kind, list, index, entry: list[index] };
};

const cloneEntryForApply = (entry, prefix) => {
  const props = entry?.props ? { ...entry.props } : {};
  const order = Array.isArray(entry?.order) ? entry.order.slice() : Object.keys(props);
  const unknownLines = Array.isArray(entry?.unknownLines) ? entry.unknownLines.slice() : [];
  const clone = { props, order, unknownLines };
  ensureEntryUid(clone, prefix);
  return clone;
};

const normalizeBounds = (x1, y1, x2, y2) => {
  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  const top = Math.min(y1, y2);
  const bottom = Math.max(y1, y2);
  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top)
  };
};

const boundsIntersect = (a, b) => {
  if (!a || !b) return false;
  return a.x <= b.x + b.width
    && a.x + a.width >= b.x
    && a.y <= b.y + b.height
    && a.y + a.height >= b.y;
};

const applyEditorOps = async (view, editorUi, ops = [], options = {}) => {
  const ctx = getEditorContext(view, editorUi);
  if (!ctx) {
    return {
      ok: false,
      error: {
        code: editorUi ? 'no_editor_session' : 'not_in_editor_mode',
        message: 'Editor session is not available.'
      }
    };
  }

  ensureLevelEntryUids(ctx.session.level);

  const atomic = options?.atomic === true;
  const dryRun = options?.dryRun === true;
  const historyOptions = options?.history || {};
  const previewOptions = options?.preview || {};
  const validateOptions = options?.validate || {};
  const returnState = options?.returnState || 'editor';
  const historyLabel = historyOptions.label || 'Editor Apply';
  const previewLabel = previewOptions.label || historyLabel;

  const results = [];
  const resources = [];
  let changed = false;
  let usedHistoryOp = false;
  const rollbackText = atomic && typeof view?.getEditorLevelText === 'function'
    ? view.getEditorLevelText()
    : null;

  const registerResource = (resource) => {
    if (!resource) return;
    resources.push(resource);
  };

  const applyError = (code, message, details) => ({
    ok: false,
    error: { code, message, details },
    results
  });

  const getLevel = () => ctx.session.level;

  const resolveSelectionFromRefs = (refs) => {
    if (!Array.isArray(refs)) return [];
    const next = [];
    for (const ref of refs) {
      const resolved = resolveEntryRef(getLevel(), ref);
      if (!resolved) continue;
      next.push({ type: resolved.kind, index: resolved.index });
    }
    return next;
  };

  const applySnap = (x, y, snapMode) => {
    if (!snapMode || snapMode === 'useCurrent') {
      return ctx.controller._snap ? ctx.controller._snap(x, y) : { x, y };
    }
    if (snapMode === 'none') return { x, y };
    const gridSize = Number(snapMode.gridSize);
    if (!Number.isFinite(gridSize) || gridSize <= 1) {
      return { x: Math.round(x), y: Math.round(y) };
    }
    return {
      x: Math.round(x / gridSize) * gridSize,
      y: Math.round(y / gridSize) * gridSize
    };
  };

  const validateAndFix = () => {
    if (validateOptions.run === false) return null;
    const issues = validateLevel(getLevel(), ctx.assets);
    if (validateOptions.autoFix && validateOptions.autoFix !== 'none') {
      let fixed = false;
      for (const issue of issues) {
        if (typeof issue.fix === 'function') {
          issue.fix();
          fixed = true;
        }
      }
      if (fixed) {
        changed = true;
      }
    }
    return serializeIssues(issues);
  };

  for (const op of ops || []) {
    const opId = op?.opId ?? null;
    const type = String(op?.type || '');
    const args = op?.args || {};
    let value = null;
    let ok = true;
    let errorCode = 'invalid_op';
    let errorMessage = 'Invalid op';
    try {
      switch (type) {
      case 'editor.ensure': {
        if (args?.enter && view?.enterEditorMode) {
          view.enterEditorMode();
        }
        value = { inEditor: !!view?.editorMode };
        break;
      }
      case 'level.new': {
        if (dryRun) break;
        view?.createBlankEditorLevel?.({ render: false });
        ctx.session = view?.editorSession || ctx.session;
        ctx.controller.session = ctx.session;
        ensureLevelEntryUids(ctx.session.level);
        if (args?.header && ctx.session.level) {
          for (const [key, val] of Object.entries(args.header)) {
            ctx.session.level.setHeader(key, val);
          }
        }
        if (args?.skillset && ctx.session.level?.skillset) {
          for (const [key, val] of Object.entries(args.skillset)) {
            ctx.session.level.setSkill(key, val);
          }
        }
        if (args?.resetHistory) {
          ctx.controller.resetHistory('New');
        }
        changed = true;
        value = { created: true };
        break;
      }
      case 'level.loadText': {
        if (dryRun) break;
        const text = String(args?.text || '');
        const level = view?.loadEditorLevelFromText?.(text, { render: false });
        if (!level) {
          ok = false;
          errorCode = 'invalid_op';
          errorMessage = 'Failed to load level text.';
          break;
        }
        ctx.session = view?.editorSession || ctx.session;
        ctx.controller.session = ctx.session;
        ensureLevelEntryUids(ctx.session.level);
        if (args?.resetHistory) {
          ctx.controller.resetHistory(args?.sourceLabel || 'Import');
        }
        changed = true;
        break;
      }
      case 'level.loadSaved': {
        if (dryRun) break;
        const text = loadSavedLevel(undefined, args?.savedId);
        if (!text) {
          ok = false;
          errorCode = 'invalid_ref';
          errorMessage = 'Saved level not found.';
          break;
        }
        const level = view?.loadEditorLevelFromText?.(text, { render: false });
        if (!level) {
          ok = false;
          errorCode = 'invalid_op';
          errorMessage = 'Failed to load saved level.';
          break;
        }
        ctx.session = view?.editorSession || ctx.session;
        ctx.controller.session = ctx.session;
        ensureLevelEntryUids(ctx.session.level);
        if (args?.resetHistory) {
          ctx.controller.resetHistory('Load Saved');
        }
        changed = true;
        break;
      }
      case 'level.save': {
        const name = String(args?.name || '');
        const text = view?.getEditorLevelText?.();
        if (!text) {
          ok = false;
          errorCode = 'invalid_op';
          errorMessage = 'Unable to serialize level.';
          break;
        }
        const savedId = saveLevel(undefined, {
          id: args?.overwriteId || undefined,
          name,
          text
        });
        if (!savedId) {
          ok = false;
          errorCode = 'internal_error';
          errorMessage = 'Failed to save level.';
          break;
        }
        value = { savedId, name };
        break;
      }
      case 'level.export': {
        const format = args?.format === 'classicLvl' ? 'classicLvl' : 'nxlv';
        if (format === 'nxlv') {
          const text = view?.getEditorLevelText?.() || '';
          const filename = String(args?.filename || 'level.nxlv');
          registerResource({
            name: filename,
            mimeType: 'text/plain',
            encoding: 'text',
            data: text,
            meta: { kind: 'export', format: 'nxlv', label: filename }
          });
          value = { filename };
        } else {
          const classic = createClassicLevelData(getLevel());
          if (!classic?.levelReader) {
            ok = false;
            errorCode = 'internal_error';
            errorMessage = 'Failed to export classic level.';
            break;
          }
          const writer = new LevelWriter();
          const payload = {
            levelProperties: classic.levelReader.levelProperties,
            screenPositionX: classic.levelReader.screenPositionX,
            graphicSet1: classic.levelReader.graphicSet1,
            graphicSet2: classic.levelReader.graphicSet2,
            isSuperLemming: classic.levelReader.isSuperLemming,
            objects: classic.levelReader.objects,
            terrains: classic.levelReader.terrains,
            steel: classic.levelReader.steel
          };
          const bytes = writer.write(payload);
          const filename = String(args?.filename || 'level.lvl');
          registerResource({
            name: filename,
            mimeType: 'application/octet-stream',
            encoding: 'base64',
            data: encodeBase64(bytes),
            meta: { kind: 'export', format: 'classicLvl', label: filename }
          });
          value = { filename };
        }
        break;
      }
      case 'level.importClassicLvl': {
        if (dryRun) break;
        const raw = String(args?.bytesBase64 || '');
        if (!raw) {
          ok = false;
          errorCode = 'invalid_op';
          errorMessage = 'Missing classic level bytes.';
          break;
        }
        const bytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
        const reader = new BinaryReader(bytes);
        const levelReader = new LevelReader(reader);
        const editorLevel = createEditorLevelFromClassic(levelReader);
        if (!editorLevel) {
          ok = false;
          errorCode = 'invalid_op';
          errorMessage = 'Failed to parse classic level.';
          break;
        }
        ctx.session.level = editorLevel;
        ensureLevelEntryUids(ctx.session.level);
        if (args?.resetHistory) {
          ctx.controller.resetHistory(args?.sourceLabel || 'Import LVL');
        }
        changed = true;
        break;
      }
      case 'level.patchHeader': {
        if (dryRun) break;
        const level = getLevel();
        if (!level) break;
        const set = args?.set || {};
        for (const [key, val] of Object.entries(set)) {
          level.setHeader(key, val);
        }
        if (Array.isArray(args?.unset)) {
          for (const key of args.unset) {
            level.removeHeader(key);
          }
        }
        changed = true;
        break;
      }
      case 'level.patchSkillset': {
        if (dryRun) break;
        const level = getLevel();
        if (!level) break;
        const set = args?.set || {};
        for (const [key, val] of Object.entries(set)) {
          level.setSkill(key, val);
        }
        if (Array.isArray(args?.unset)) {
          for (const key of args.unset) {
            level.skillset?.delete?.(String(key).trim().toUpperCase());
          }
        }
        changed = true;
        break;
      }
      case 'editor.setTool': {
        const tool = args?.tool;
        if (!tool) break;
        const validTools = new Set(Object.values(EditorTools));
        if (validTools.has(tool)) {
          ctx.controller.setTool(tool);
        }
        value = { tool: ctx.controller.tool };
        break;
      }
      case 'editor.setBrushSettings': {
        if (Number.isFinite(args?.gridSize)) ctx.controller.gridSize = Math.max(1, Math.trunc(args.gridSize));
        if (args?.snapEnabled !== undefined) ctx.controller.setSnapEnabled(!!args.snapEnabled);
        if (Number.isFinite(args?.brushSize)) ctx.controller.setBrushSize(Math.max(1, Math.trunc(args.brushSize)));
        if (args?.eraseGadgets !== undefined) ctx.controller.setEraseGadgets(!!args.eraseGadgets);
        if (Number.isFinite(args?.handleSize)) ctx.controller.handleSize = Math.max(1, Math.trunc(args.handleSize));
        value = {
          gridSize: ctx.controller.gridSize,
          snapEnabled: ctx.controller.snapEnabled,
          brushSize: ctx.controller.brushSize,
          eraseGadgets: ctx.controller.eraseGadgets,
          handleSize: ctx.controller.handleSize
        };
        break;
      }
      case 'editor.setPaletteSelection': {
        if (Number.isFinite(args?.selectedTerrainId)) ctx.controller.setSelectedTerrain(args.selectedTerrainId);
        if (Number.isFinite(args?.selectedGadgetId)) ctx.controller.setSelectedGadget(args.selectedGadgetId);
        if (Number.isFinite(args?.selectedTriggerId)) ctx.controller.setSelectedTrigger(args.selectedTriggerId);
        value = {
          selectedTerrainId: ctx.controller.selectedTerrainId,
          selectedGadgetId: ctx.controller.selectedGadgetId,
          selectedTriggerId: ctx.controller.selectedTriggerId
        };
        break;
      }
      case 'selection.clear': {
        ctx.controller.clearSelection();
        value = { cleared: true };
        break;
      }
      case 'selection.set': {
        const refs = resolveSelectionFromRefs(args?.selection);
        ctx.controller._setSelection(refs);
        value = { count: refs.length };
        break;
      }
      case 'selection.hitTest': {
        const x = Number(args?.x);
        const y = Number(args?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          value = { hit: null };
          break;
        }
        const kinds = Array.isArray(args?.kinds) ? args.kinds : ['terrain', 'gadget', 'steel'];
        const level = getLevel();
        let hit = null;
        if (kinds.includes('gadget')) {
          const gadgetHit = findEntryAt(level?.gadgets, ctx.assets?.gadgetById, x, y);
          if (gadgetHit) hit = { kind: 'gadget', ...gadgetHit };
        }
        if (!hit && kinds.includes('steel')) {
          const steelHit = findEntryAt(level?.steel, null, x, y);
          if (steelHit) hit = { kind: 'steel', ...steelHit };
        }
        if (!hit && kinds.includes('terrain')) {
          const terrainHit = findEntryAt(level?.terrains, ctx.assets?.terrainById, x, y);
          if (terrainHit) hit = { kind: 'terrain', ...terrainHit };
        }
        if (hit && hit.entry) {
          value = { hit: { kind: hit.kind, index: hit.index, uid: hit.entry.uid || null } };
        } else {
          value = { hit: null };
        }
        break;
      }
      case 'selection.boxSelect': {
        const bounds = args?.bounds;
        if (!bounds) {
          value = { count: 0 };
          break;
        }
        const mode = args?.mode || 'replace';
        const hits = [];
        const addHit = (type, index) => {
          if (hits.some(entry => entry.type === type && entry.index === index)) return;
          hits.push({ type, index });
        };
        const scan = (entries, metaById, type) => {
          if (!Array.isArray(entries)) return;
          for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            const meta = metaById?.get?.(entry?.props?.PIECE);
            const entryBounds = getEntryBounds(entry, meta);
            if (boundsIntersect(bounds, entryBounds)) addHit(type, i);
          }
        };
        const level = getLevel();
        scan(level?.terrains, ctx.assets?.terrainById, 'terrain');
        scan(level?.gadgets, ctx.assets?.gadgetById, 'gadget');
        scan(level?.steel, null, 'steel');
        let next = [];
        if (mode === 'replace') {
          next = hits;
        } else if (mode === 'add') {
          next = ctx.controller.selection.slice();
          for (const hit of hits) {
            if (!next.some(entry => entry.type === hit.type && entry.index === hit.index)) {
              next.push(hit);
            }
          }
        } else if (mode === 'toggle') {
          next = ctx.controller.selection.slice();
          for (const hit of hits) {
            const idx = next.findIndex(entry => entry.type === hit.type && entry.index === hit.index);
            if (idx >= 0) {
              next.splice(idx, 1);
            } else {
              next.push(hit);
            }
          }
        }
        ctx.controller._setSelection(next);
        value = { count: ctx.controller.selection.length };
        break;
      }
      case 'entry.add': {
        if (dryRun) break;
        const kind = args?.kind;
        const list = getListForKind(getLevel(), kind);
        if (!Array.isArray(list)) {
          ok = false;
          errorCode = 'invalid_ref';
          errorMessage = 'Invalid entry kind.';
          break;
        }
        let entry = null;
        if (kind === 'terrain') {
          entry = createTerrainEntry({
            styleName: getLevel()?.getHeader?.('STYLE'),
            piece: args?.props?.PIECE ?? args?.props?.piece ?? args?.piece,
            x: args?.props?.X ?? args?.props?.x ?? args?.x,
            y: args?.props?.Y ?? args?.props?.y ?? args?.y
          });
        } else if (kind === 'gadget') {
          entry = createGadgetEntry({
            styleName: getLevel()?.getHeader?.('STYLE'),
            piece: args?.props?.PIECE ?? args?.props?.piece ?? args?.piece,
            x: args?.props?.X ?? args?.props?.x ?? args?.x,
            y: args?.props?.Y ?? args?.props?.y ?? args?.y
          });
        } else if (kind === 'steel') {
          entry = createSteelEntry({
            x: args?.props?.X ?? args?.x,
            y: args?.props?.Y ?? args?.y,
            width: args?.props?.WIDTH ?? args?.width,
            height: args?.props?.HEIGHT ?? args?.height
          });
        }
        if (!entry) {
          ok = false;
          errorCode = 'invalid_op';
          errorMessage = 'Failed to create entry.';
          break;
        }
        const insert = args?.insert;
        if (insert && Number.isFinite(insert.index)) {
          const idx = Math.max(0, Math.min(list.length, Math.trunc(insert.index)));
          list.splice(idx, 0, entry);
          value = { ref: { kind, index: idx, uid: entry.uid || null } };
        } else {
          list.push(entry);
          value = { ref: { kind, index: list.length - 1, uid: entry.uid || null } };
        }
        changed = true;
        break;
      }
      case 'entry.update': {
        if (dryRun) break;
        const resolved = resolveEntryRef(getLevel(), args?.ref);
        if (!resolved) {
          ok = false;
          errorCode = 'invalid_ref';
          errorMessage = 'Entry not found.';
          break;
        }
        const set = args?.set || {};
        for (const [key, val] of Object.entries(set)) {
          const removeIfFalse = typeof val === 'boolean';
          setEntryProp(resolved.entry, key, val, { removeIfFalse });
        }
        if (Array.isArray(args?.unset)) {
          for (const key of args.unset) {
            setEntryProp(resolved.entry, key, undefined, { removeIfEmpty: true });
          }
        }
        changed = true;
        break;
      }
      case 'entry.remove': {
        if (dryRun) break;
        const refs = Array.isArray(args?.refs) ? args.refs : [];
        const groups = { terrain: [], gadget: [], steel: [] };
        for (const ref of refs) {
          const resolved = resolveEntryRef(getLevel(), ref);
          if (!resolved) continue;
          groups[resolved.kind]?.push(resolved.index);
        }
        for (const [kind, indices] of Object.entries(groups)) {
          indices.sort((a, b) => b - a);
          for (const index of indices) {
            removeEntryAt(getLevel(), kind, index);
          }
        }
        changed = refs.length > 0;
        break;
      }
      case 'entry.duplicate': {
        if (dryRun) break;
        const refs = Array.isArray(args?.refs) ? args.refs : [];
        const dx = Number.isFinite(args?.offset?.dx) ? args.offset.dx : 0;
        const dy = Number.isFinite(args?.offset?.dy) ? args.offset.dy : 0;
        const nextRefs = [];
        for (const ref of refs) {
          const resolved = resolveEntryRef(getLevel(), ref);
          if (!resolved) continue;
          const prefix = getPrefixForKind(resolved.kind);
          const clone = cloneEntryForApply(resolved.entry, prefix);
          clone.props.X = (Number.isFinite(clone.props.X) ? clone.props.X : 0) + dx;
          clone.props.Y = (Number.isFinite(clone.props.Y) ? clone.props.Y : 0) + dy;
          resolved.list.push(clone);
          nextRefs.push({ kind: resolved.kind, index: resolved.list.length - 1, uid: clone.uid || null });
        }
        if (args?.selectNew) {
          ctx.controller._setSelection(nextRefs.map(ref => ({ type: ref.kind, index: ref.index })));
        }
        value = { refs: nextRefs };
        changed = nextRefs.length > 0;
        break;
      }
      case 'entry.reorder': {
        if (dryRun) break;
        const action = args?.action;
        const selection = ctx.controller.selection.slice();
        const groups = { terrain: [], gadget: [], steel: [] };
        for (const selected of selection) {
          if (groups[selected.type]) groups[selected.type].push(selected.index);
        }
        const reorderList = (list, indices, dir) => {
          if (!Array.isArray(list) || indices.length === 0) return null;
          const unique = Array.from(new Set(indices)).filter(idx => idx >= 0 && idx < list.length);
          if (!unique.length) return null;
          const selectedSet = new Set(unique);
          if (dir === 'front' || dir === 'back') {
            const ordered = unique.slice().sort((a, b) => a - b).map(idx => list[idx]);
            const remaining = list.filter((_, idx) => !selectedSet.has(idx));
            list.length = 0;
            if (dir === 'front') {
              list.push(...remaining, ...ordered);
            } else {
              list.push(...ordered, ...remaining);
            }
            const next = new Map();
            list.forEach((entry, idx) => next.set(entry, idx));
            return ordered.map(entry => next.get(entry)).filter(idx => idx != null);
          }
          if (dir === 'forward') {
            const sorted = unique.slice().sort((a, b) => b - a);
            for (const idx of sorted) {
              if (idx >= list.length - 1) continue;
              if (selectedSet.has(idx + 1)) continue;
              const tmp = list[idx + 1];
              list[idx + 1] = list[idx];
              list[idx] = tmp;
              selectedSet.delete(idx);
              selectedSet.add(idx + 1);
            }
            return Array.from(selectedSet);
          }
          if (dir === 'backward') {
            const sorted = unique.slice().sort((a, b) => a - b);
            for (const idx of sorted) {
              if (idx <= 0) continue;
              if (selectedSet.has(idx - 1)) continue;
              const tmp = list[idx - 1];
              list[idx - 1] = list[idx];
              list[idx] = tmp;
              selectedSet.delete(idx);
              selectedSet.add(idx - 1);
            }
            return Array.from(selectedSet);
          }
          return null;
        };
        const nextSelection = [];
        for (const [kind, indices] of Object.entries(groups)) {
          const list = getListForKind(getLevel(), kind);
          const nextIndices = reorderList(list, indices, action === 'bringToFront' ? 'front'
            : action === 'sendToBack' ? 'back'
              : action === 'moveForward' ? 'forward'
                : action === 'moveBackward' ? 'backward'
                  : null);
          if (!nextIndices) continue;
          for (const idx of nextIndices) {
            nextSelection.push({ type: kind, index: idx });
          }
        }
        if (nextSelection.length) {
          ctx.controller._setSelection(nextSelection);
        }
        changed = nextSelection.length > 0;
        break;
      }
      case 'tool.place': {
        if (dryRun) break;
        const tool = String(args?.tool || '');
        const pos = applySnap(Number(args?.x || 0), Number(args?.y || 0), args?.snap);
        let entry = null;
        if (tool === EditorTools.TERRAIN) {
          if (Number.isFinite(args?.pieceId)) ctx.controller.setSelectedTerrain(args.pieceId);
          entry = ctx.controller._placeTerrainAt(pos.x, pos.y);
        } else if (tool === EditorTools.GADGET) {
          if (Number.isFinite(args?.pieceId)) ctx.controller.setSelectedGadget(args.pieceId);
          entry = ctx.controller._placeGadgetAt(pos.x, pos.y, ctx.controller.selectedGadgetId);
        } else if (tool === EditorTools.TRIGGER) {
          if (Number.isFinite(args?.pieceId)) ctx.controller.setSelectedTrigger(args.pieceId);
          const id = ctx.controller.selectedTriggerId ?? ctx.controller.selectedGadgetId;
          entry = ctx.controller._placeGadgetAt(pos.x, pos.y, id);
        } else if (tool === EditorTools.ENTRANCE) {
          const id = ctx.assets?.entranceId ?? ctx.controller.selectedGadgetId;
          entry = ctx.controller._placeGadgetAt(pos.x, pos.y, id);
        } else if (tool === EditorTools.EXIT) {
          const id = ctx.assets?.exitId ?? ctx.controller.selectedGadgetId;
          entry = ctx.controller._placeGadgetAt(pos.x, pos.y, id);
        } else if (tool === EditorTools.STEEL) {
          const size = Number.isFinite(ctx.controller.gridSize) ? ctx.controller.gridSize : 1;
          entry = ctx.controller._placeSteelAt(pos.x, pos.y, size, size);
        }
        if (entry) {
          const kind = tool === EditorTools.STEEL ? 'steel'
            : tool === EditorTools.GADGET || tool === EditorTools.TRIGGER || tool === EditorTools.ENTRANCE || tool === EditorTools.EXIT
              ? 'gadget'
              : 'terrain';
          const list = getListForKind(getLevel(), kind);
          const index = Array.isArray(list) ? list.indexOf(entry) : -1;
          if (index >= 0) {
            ctx.controller._setSelection([{ type: kind, index }]);
            value = { ref: { kind, index, uid: entry.uid || null } };
          }
          changed = true;
        }
        break;
      }
      case 'tool.stroke':
      case 'tool.erase': {
        if (dryRun) break;
        const tool = type === 'tool.erase' ? EditorTools.ERASER : String(args?.tool || '');
        const points = Array.isArray(args?.points) ? args.points : [];
        if (!points.length) break;
        const prevErase = ctx.controller.eraseGadgets;
        if (typeof args?.eraseGadgets === 'boolean') {
          ctx.controller.setEraseGadgets(args.eraseGadgets);
        }
        ctx.controller._beginStroke();
        let last = null;
        for (const point of points) {
          const pos = applySnap(Number(point.x || 0), Number(point.y || 0), args?.snap);
          if (tool === EditorTools.BRUSH) {
            if (last) ctx.controller._brushLine(last, pos);
            else ctx.controller._brushAt(pos.x, pos.y);
          } else if (tool === EditorTools.ERASER) {
            if (last) ctx.controller._eraseLine(last, pos);
            else ctx.controller._eraseAt(pos.x, pos.y);
          }
          last = pos;
        }
        ctx.controller._lastBrushPos = null;
        ctx.controller.setEraseGadgets(prevErase);
        changed = true;
        break;
      }
      case 'tool.steelRect': {
        if (dryRun) break;
        const rects = Array.isArray(args?.rects) ? args.rects : [];
        for (const rect of rects) {
          const bounds = normalizeBounds(rect.x, rect.y, rect.x + rect.width, rect.y + rect.height);
          ctx.controller._placeSteelAt(bounds.x, bounds.y, bounds.width, bounds.height);
        }
        changed = rects.length > 0;
        break;
      }
      case 'history.undo': {
        usedHistoryOp = true;
        const count = Number.isFinite(args?.count) ? Math.max(1, Math.trunc(args.count)) : 1;
        for (let i = 0; i < count; i++) {
          ctx.controller.undo();
        }
        value = { count };
        break;
      }
      case 'history.redo': {
        usedHistoryOp = true;
        const count = Number.isFinite(args?.count) ? Math.max(1, Math.trunc(args.count)) : 1;
        for (let i = 0; i < count; i++) {
          ctx.controller.redo();
        }
        value = { count };
        break;
      }
      case 'history.getEntry': {
        const entry = getEditorHistoryEntry(ctx.history, Number(args?.index));
        value = entry || null;
        break;
      }
      case 'validate.run': {
        value = validateAndFix();
        break;
      }
      default:
        ok = false;
        errorCode = 'invalid_op';
        errorMessage = `Unknown op: ${type}`;
        break;
      }
    } catch (err) {
      ok = false;
      errorCode = 'internal_error';
      errorMessage = err ? String(err) : 'Unknown error';
    }

    if (ok) {
      results.push({ opId, type, ok: true, value });
    } else {
      results.push({ opId, type, ok: false, error: errorMessage });
      if (atomic) {
        if (rollbackText && typeof view?.loadEditorLevelFromText === 'function') {
          view.loadEditorLevelFromText(rollbackText, { render: false });
          ctx.session = view?.editorSession || ctx.session;
          ctx.controller.session = ctx.session;
          ensureLevelEntryUids(ctx.session.level);
        }
        return applyError(errorCode, errorMessage);
      }
    }
  }

  const validation = validateAndFix();
  if (validation) {
    results.push({ opId: null, type: 'validate.run', ok: true, value: validation });
  }

  if (historyOptions.record !== false && changed && !usedHistoryOp) {
    ctx.controller.history.pushSnapshot(getLevel(), historyLabel);
  }

  if (previewOptions.refresh !== false && ctx.editorUi?._refreshPreview) {
    await ctx.editorUi._refreshPreview(previewLabel, {
      preserveView: previewOptions.preserveViewport !== false
    });
  }

  let state = null;
  if (returnState === 'editor') {
    state = getEditorState(view, editorUi);
  } else if (returnState === 'full') {
    state = {
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
        outputName: view?.midiOut?.name || null
      }
    };
  }

  return {
    ok: true,
    results,
    resources,
    state
  };
};

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
