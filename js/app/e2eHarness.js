import { listSavedLevels } from '../editor/EditorStorage.js';
import { validateLevel } from '../editor/EditorValidator.js';

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
        skills: Array.isArray(skills.skills) ? skills.skills.slice() : []
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
      midi: {
        enabled: !!view?.midiEnabled,
        hasRouter: !!view?.midiRouter,
        outputName: view?.midiOut?.name || null
      }
    };
  },
  getBuffer: (name) => getBuffer(context.view, name),
  getEditorHistoryEntry: (index) => getEditorHistoryEntry(context.editorUi?.history || null, index),
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
  selectLemmingById: (id) => selectLemmingById(context.view, id),
  getBenchMetrics: () => getBenchMetrics(context.view),
  startBenchSequence: () => startBenchSequence(context.view),
  startBench: (entrances) => startBench(context.view, entrances),
  stopBench: () => stopBench(context.view)
});

const installE2EHarness = ({ view, editorUi } = {}) => {
  if (!isE2EEnabled()) return null;
  const root = typeof globalThis !== 'undefined' ? globalThis : window;
  if (root.__E2E__ && typeof root.__E2E__._setContext === 'function') {
    root.__E2E__._setContext({ view, editorUi });
    return root.__E2E__;
  }
  const context = { view: view || null, editorUi: editorUi || null };
  const api = createE2EApi(context);
  root.__E2E__ = api;
  return api;
};

export { installE2EHarness, isE2EEnabled };
