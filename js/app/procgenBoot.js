import { getDecorationPack } from '../decorations/ProcgenDecorationPacks.js';
import './bootstrap.js';
import { ProcgenBitmapHud } from './procgen/ProcgenBitmapHud.js';
import { createProcgenUiController } from './procgen/ProcgenUiController.js';
import { ProcgenRecipeTerrain } from './procgen/ProcgenRecipeTerrain.js';
import { loadTerrainRecipeBook, selectThemeRecipe } from './procgen/ProcgenTerrainRecipes.js';
import { createProcgenLaneRuntime } from './procgen/ProcgenLaneRuntime.js';
import { GameView } from '../game/GameView.js';
import { GameTypes } from '../game/GameTypes.js';
import { EditorLevel } from '../editor/EditorLevel.js';
import { loadEditorLevel } from '../editor/EditorLevelLoader.js';
import { getStyle, getStyleNames } from '../editor/StyleRegistry.js';
import { ProcgenController } from './procgenController.js';
import { ProcgenAssetManager } from './procgenAssetManager.js';
import { ProcgenTerrainStamper } from './procgenTerrainStamper.js';
import { installE2EHarness } from './e2eHarness.js';
import { registerServiceWorker } from './registerServiceWorker.js';
import { DEFAULT_LEVEL_HEIGHT } from '../level/ClassicLevelConstants.js';
import { bindCanvasFocusBlur } from './canvasFocusBlur.js';
import { ProcgenStageAdapter } from './procgenStageAdapter.js';
import { ANALYTICS_EVENT_TYPES, createAnalyticsService } from './analytics.js';
import {
  normalizeSeed,
  deriveSeed,
  createSeededRandom
} from '../core/seededRandom.js';

const PROCGEN_GAME_TYPE = GameTypes.OHNO;
const PROCGEN_LEVEL_WIDTH = 65535;
const PROCGEN_LEVEL_HEIGHT = DEFAULT_LEVEL_HEIGHT;
const PROCGEN_RELEASE_RATE = 50;
const PROCGEN_RELEASE_COUNT = 50;
const PROCGEN_GROUND_HEIGHT = 4;
const PROCGEN_ENTRANCE_OFFSET = 80;
const PROCGEN_INITIAL_GROUND_WIDTH = 280;
const PROCGEN_ENTRANCE_CLEARANCE = 28;
const PROCGEN_SEED_PARAM = 'seed';
const PROCGEN_SEED_STORAGE_KEY = 'procgen.seed';
const PROCGEN_GROUND_SETS_BY_PATH = {
  lemmings: [0, 1, 2, 3, 4],
  lemmings_ohNo: [0, 1, 2, 3],
  xmas91: [0, 2],
  xmas92: [0, 2],
  holiday93: [1, 2],
  holiday94: [1, 2]
};
const PROCGEN_SKILLS = {
  CLIMBER: 9999,
  FLOATER: 9999,
  BOMBER: 9999,
  BLOCKER: 9999,
  BUILDER: 9999,
  BASHER: 9999,
  MINER: 9999,
  DIGGER: 9999
};

let activeProcgenRuntime = null;
let analytics = null;
let procgenUi = null;
const readProcgenDistances = () => {
  try { const values = JSON.parse(window.localStorage?.getItem('procgen.laneDistances.v1') || '[]'); return Array.isArray(values) ? values.slice(0, 1024).map(n => Number.isFinite(n) ? Math.max(0, n) : 0) : []; }
  catch { return []; }
};
const saveProcgenDistances = world => {
  if (!world?.stall?.lanes) return;
  const values = readProcgenDistances();
  world.stall.lanes.forEach((lane, index) => { values[index] = Math.max(values[index] || 0, lane.bestDistance, lane.previousDistance, lane.maxX - 36); });
  try { window.localStorage?.setItem('procgen.laneDistances.v1', JSON.stringify(values)); } catch { /* Session values remain available. */ }
};
let procgenBootListeners = [];
let procgenBarObserver = null;

const runFocusBlurCleanup = (runtime) => {
  const cleanup = runtime?.focusBlurCleanup;
  if (typeof cleanup === 'function') {
    cleanup();
  }
  if (runtime) {
    runtime.focusBlurCleanup = null;
  }
};

/**
 * Ensure repeat procgen init/start cycles do not leak timers/listeners.
 * Cleanup order matters: controller first (detaches timer/event hooks), then
 * stage adapter/view/game teardown.
 */
const disposeProcgenRuntime = () => {
  const runtime = activeProcgenRuntime;
  if (!runtime) return;
  activeProcgenRuntime = null;
  saveProcgenDistances(runtime.world);
  runFocusBlurCleanup(runtime);
  procgenUi?.local.stop();
  runtime.lanes?.stop();
  runtime.controller?.stop?.();
  if (runtime.view && runtime.view.procgenController === runtime.controller) {
    runtime.view.procgenController = null;
  }
  if (typeof window !== 'undefined' && window.procgenDebugState) {
    window.procgenDebugState = null;
    window.__PROCGEN_LANES__ = null;
  }
  runtime.stageAdapter?.dispose?.();
  runtime.game?.stop?.();
  runtime.view?.dispose?.();
};

const addProcgenBootListener = (target, eventName, handler, options) => {
  if (!target?.addEventListener || typeof handler !== 'function') return;
  target.addEventListener(eventName, handler, options);
  procgenBootListeners.push({ target, eventName, handler, options });
};

const disposeProcgenBootListeners = () => {
  procgenBarObserver?.disconnect(); procgenBarObserver = null;
  while (procgenBootListeners.length) {
    const { target, eventName, handler, options } = procgenBootListeners.pop();
    target?.removeEventListener?.(eventName, handler, options);
  }
};

const installProcgenBootListeners = () => {
  disposeProcgenBootListeners();
  const boot = () => {
    resizeCanvas();
    if (!procgenUi && document.getElementById('procgenDrawer')) {
      const params = new URLSearchParams(window.location.search);
      procgenUi = createProcgenUiController({ document, window, getRuntime: () => activeProcgenRuntime, restart: init,
        initial: { laneCount: params.get('lanes'), speed: params.get('speed'), pack: params.get('pack') } });
    }
    const bar = document.getElementById('procgenTopbar');
    if (bar && typeof window.ResizeObserver === 'function') { procgenBarObserver = new window.ResizeObserver(() => resizeCanvas()); procgenBarObserver.observe(bar); }
    init().catch(error => { const status = document.getElementById('procgenRunStatus'); if (status) status.textContent = `Could not start: ${error.message}`; });
  };
  addProcgenBootListener(window, 'resize', () => resizeCanvas());
  addProcgenBootListener(window, 'beforeunload', disposeProcgenRuntime);
  addProcgenBootListener(window, 'orientationchange', () => resizeCanvas());

  if (document.readyState === 'loading') {
    addProcgenBootListener(document, 'DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
};

const setActiveProcgenRuntimeForTest = (runtime) => {
  activeProcgenRuntime = runtime || null;
};

const getProcgenGroundSets = (config) => {
  const key = config?.path || null;
  const sets = key ? PROCGEN_GROUND_SETS_BY_PATH[key] : null;
  return Array.isArray(sets) && sets.length ? sets : null;
};

const getCompatibleProcgenStyleNames = (config) => {
  const names = getStyleNames();
  const allowedGroundSets = getProcgenGroundSets(config);
  if (!allowedGroundSets) return names;
  return names.filter(name => {
    const style = getStyle(name);
    return Number.isFinite(style?.groundSet)
      && allowedGroundSets.includes(style.groundSet | 0);
  });
};

const rotateFromRandomIndex = (list, rng = Math.random) => {
  if (!Array.isArray(list) || list.length === 0) return [];
  const start = Math.floor(rng() * list.length) % list.length;
  return list.slice(start).concat(list.slice(0, start));
};

const buildProcgenThemeContract = (styleName, config = null) => {
  const style = getStyle(styleName);
  return {
    selectedTheme: style?.name || styleName || null,
    styleName: style?.name || styleName || null,
    groundSet: Number.isFinite(style?.groundSet) ? style.groundSet | 0 : null,
    packPath: config?.path || null
  };
};

const pickProcgenStyle = async (fileProvider, config, rng = Math.random) => {
  const names = getStyleNames();
  if (!names.length) return 'fire';
  const compatible = getCompatibleProcgenStyleNames(config);
  const list = rotateFromRandomIndex(compatible.length ? compatible : names, rng);
  let choice = names[0];
  if (fileProvider && config) {
    for (const candidate of list) {
      const style = getStyle(candidate);
      const groundSet = Number.isFinite(style?.groundSet) ? style.groundSet | 0 : null;
      if (groundSet == null) continue;
      try {
        await Promise.all([
          fileProvider.loadBinary(config.path, `VGAGR${groundSet}.DAT`),
          fileProvider.loadBinary(config.path, `GROUND${groundSet}O.DAT`)
        ]);
        choice = candidate;
        break;
      } catch (err) {
        continue;
      }
    }
  } else {
    choice = list[Math.floor(rng() * list.length)] || names[0];
  }
  try {
    window.localStorage?.setItem('procgen.style', choice);
  } catch (err) {
    // ignore storage failures
  }
  return choice;
};

const resolveProcgenSeed = (params) => {
  const requestedSeed = params?.get?.(PROCGEN_SEED_PARAM);
  if (requestedSeed != null && requestedSeed !== '') {
    return normalizeSeed(requestedSeed);
  }
  let storedSeed = null;
  try {
    storedSeed = window.localStorage?.getItem(PROCGEN_SEED_STORAGE_KEY) || null;
  } catch {
    storedSeed = null;
  }
  if (storedSeed != null && storedSeed !== '') {
    return normalizeSeed(storedSeed);
  }
  return normalizeSeed(Date.now());
};

const readFiniteQueryOption = (params, name) => {
  if (!params?.has?.(name)) return null;
  const value = Number(params.get(name));
  return Number.isFinite(value) ? value : null;
};

const readBooleanQueryOption = (params, name) => {
  if (!params?.has?.(name)) return null;
  const value = String(params.get(name) ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', ''].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  return null;
};

const buildProcgenControllerOptions = (params, baseOptions = {}) => {
  const options = { ...baseOptions };
  for (const name of [
    'gapChance',
    'gapMinWidth',
    'gapMaxWidth',
    'recentCertificateLimit'
  ]) {
    const value = readFiniteQueryOption(params, name);
    if (value != null) options[name] = value;
  }
  const verify = readBooleanQueryOption(params, 'procgenCertificateVerification');
  if (verify != null) options.procgenCertificateVerification = verify;
  return options;
};

const buildProcgenEditorLevel = (styleName) => {
  const level = new EditorLevel();
  level.setHeader('TITLE', 'Procgen');
  level.setHeader('STYLE', styleName);
  level.setHeader('WIDTH', PROCGEN_LEVEL_WIDTH);
  level.setHeader('HEIGHT', PROCGEN_LEVEL_HEIGHT);
  level.setHeader('LEMMINGS', PROCGEN_RELEASE_COUNT);
  level.setHeader('SAVE_REQUIREMENT', 0);
  level.setHeader('MAX_SPAWN_INTERVAL', PROCGEN_RELEASE_RATE);
  level.setHeader('TIME_LIMIT', 'INFINITE');
  const entranceX = 64;
  const entranceY = PROCGEN_LEVEL_HEIGHT - PROCGEN_GROUND_HEIGHT - PROCGEN_ENTRANCE_OFFSET;
  level.setHeader('START_X', entranceX);
  for (const [skill, count] of Object.entries(PROCGEN_SKILLS)) {
    level.setSkill(skill, count);
  }
  level.gadgets.push({
    props: { PIECE: 1, X: entranceX, Y: entranceY }
  });
  return { level, entranceX, entranceY };
};

const init = async () => {
  disposeProcgenRuntime();
  analytics = createAnalyticsService({
    window,
    document,
    navigator: window?.navigator || null,
    location: window?.location || null,
    localStorage: window?.localStorage || null,
    profile: 'perf',
    surface: 'procgen'
  });
  analytics.installWindowApi(window);
  analytics.trackPageView({
    surface: 'procgen',
    profile: 'perf',
    embedMode: false
  });
  const runtime = {
    view: null,
    game: null,
    controller: null,
    stageAdapter: null,
    focusBlurCleanup: null
  };
  const canvas = document.getElementById('gameCanvas');
  if (!canvas) return;
  activeProcgenRuntime = runtime;
  try {
    const params = new URLSearchParams(window.location.search);
    const procgenSeed = procgenUi?.settings.seed ?? resolveProcgenSeed(params);
    const styleRng = createSeededRandom(deriveSeed(procgenSeed, 'style'));
    const terrainRng = createSeededRandom(deriveSeed(procgenSeed, 'terrain'));
    window.procgenSeed = procgenSeed;
    try {
      window.localStorage?.setItem(PROCGEN_SEED_STORAGE_KEY, String(procgenSeed));
    } catch {
      // ignore storage failures
    }
    const aiDebugOverlay = params.has('aiDebug');
    const view = new GameView();
    runtime.view = view;
    const gameType = procgenUi?.settings.pack || PROCGEN_GAME_TYPE;
    view.gameType = gameType;
    view.levelGroupIndex = 0;
    view.levelIndex = 0;
    view.midiEnabled = false;
    view.includeSavedLevels = false;
    view.endless = true;
    view.gameCanvas = canvas;
    view.gameSpeedFactor = procgenUi?.settings.speed || 3;
    if (view.stage) {
      view.stage.setGuiEnabled(false);
      view.stage.setCursorSprite(null);
      view.stage.hudMargin = 0;
    }

    const config = await view.gameFactory.getConfig(gameType);
    const resources = await view.gameFactory.getGameResources(gameType);
    view.gameResources = resources;

    const styleName = await pickProcgenStyle(
      view.gameFactory.fileProvider,
      config,
      styleRng
    );
    const themeContract = buildProcgenThemeContract(styleName, config);
    window.procgenSelectedTheme = themeContract.selectedTheme;
    window.procgenThemeContract = themeContract;
    if (activeProcgenRuntime !== runtime) { view.dispose(); return; }
    const laneCount = procgenUi?.settings.laneCount || 1;
    if (procgenUi) {
      const assets = new ProcgenAssetManager({ styleName, config, fileProvider: view.gameFactory.fileProvider, random: terrainRng });
      await assets.load();
      assets.decorationPack = getDecorationPack(procgenUi.settings.decoration);
      const book = await loadTerrainRecipeBook(view.gameFactory.fileProvider);
      const recipe = selectThemeRecipe(book, { packPath: config.path, groundSet: assets.groundSet });
      const objectPieces = (assets.assets?.gadgetImages || []).map((image, id) => ({ ...assets.assets.gadgets[id], id, image }));
      const terrain = new ProcgenRecipeTerrain({ recipe, terrainPieces: assets.terrainPieces, objectPieces });
      const palette = assets.assets?.gadgetImages?.find(image => image?.palette)?.palette || assets.groundPieces[0]?.image?.palette;
      const [sprites, masks, hudSprites] = await Promise.all([resources.getLemmingsSprite(palette), resources.getMasks(), resources.getSkillPanelSprite(palette)]);
      if (activeProcgenRuntime !== runtime) { view.dispose(); return; }
      const lanes = createProcgenLaneRuntime({ canvas, resources, sprites, masks, assets, laneCount, seed: procgenSeed,
        speed: view.gameSpeedFactor, terrain, previousDistances: readProcgenDistances(), onMetrics: state => procgenUi?.syncMetrics(state), windowRef: window });
      lanes.renderer.hud = new ProcgenBitmapHud({ canvas, sprites: hudSprites });
      view.dispose();
      runtime.lanes = lanes; runtime.world = lanes.world; runtime.view = lanes.view; runtime.game = lanes.game;
      runtime.stageAdapter = { updateStageSize: () => lanes.resize() };
      window.procgenDebugState = () => lanes.getDebugState();
      if (params.has('e2e')) window.__PROCGEN_LANES__ = { world: lanes.world, renderer: lanes.renderer, getState: lanes.getDebugState, pause: lanes.pause, resume: lanes.resume, step: lanes.step };
      procgenUi?.sync();
      registerServiceWorker({ profile: 'perf' });
      return;
    }
    const { level: editorLevel, entranceX, entranceY } = buildProcgenEditorLevel(styleName);
    const level = await loadEditorLevel(
      editorLevel,
      config,
      view.gameFactory.fileProvider,
      {
        styleName,
        levelGroupIndex: 0,
        levelIndex: 0
      }
    );
    if (activeProcgenRuntime !== runtime) { view.dispose(); return; }
    if (!level) {
      runtime.view?.dispose?.();
      return;
    }

    const game = await view.gameFactory.getGame(gameType, resources);
    if (activeProcgenRuntime !== runtime) { view.dispose(); return; }
    runtime.game = game;
    await game.loadCustomLevel(level, { levelGroupIndex: 0, levelIndex: 0 });
    if (activeProcgenRuntime !== runtime) { game.stop(); view.dispose(); return; }
    game.setGameDisplay(view.stage.getGameDisplay());
    view.game = game;
    view.applyLevelViewport(level);
    view.stage.updateStageSize();
    game.start();
    game.getGameTimer().speedFactor = view.gameSpeedFactor;
    runtime.focusBlurCleanup = bindCanvasFocusBlur(canvas);

    const assetManager = new ProcgenAssetManager({
      styleName,
      config,
      fileProvider: view.gameFactory.fileProvider,
      random: terrainRng
    });
    await assetManager.load();
    if (activeProcgenRuntime !== runtime) { game.stop(); view.dispose(); return; }
    const stamper = new ProcgenTerrainStamper(level);

    const controller = new ProcgenController({
      view,
      game,
      level,
      assets: assetManager,
      stamper,
      options: buildProcgenControllerOptions(params, {
        groundHeight: PROCGEN_GROUND_HEIGHT,
        initialGroundWidth: PROCGEN_INITIAL_GROUND_WIDTH,
        entranceX,
        entranceY,
        entranceClearance: PROCGEN_ENTRANCE_CLEARANCE,
        aiDebugOverlay,
        rng: terrainRng,
        rngSeed: procgenSeed,
        selectedTheme: themeContract.selectedTheme,
        themeContract
      })
    });
    controller.start();
    runtime.controller = controller;
    view.procgenController = controller;
    window.procgenDebugState = () => controller.getDebugState();

    const stageAdapter = new ProcgenStageAdapter({
      view,
      controller,
      canvas
    });
    stageAdapter.install();
    runtime.stageAdapter = stageAdapter;
    stageAdapter.updateStageSize();

    procgenUi?.sync();
    installE2EHarness({ view, procgenController: controller });
    registerServiceWorker({ profile: 'perf' });
  } catch (err) {
    runtime.lanes?.stop();
    analytics?.track?.(ANALYTICS_EVENT_TYPES.RUNTIME_BOOT_ERROR, {
      code: 'resource_error',
      surface: 'procgen',
      profile: 'perf',
      embedMode: false
    });
    if (activeProcgenRuntime === runtime) {
      activeProcgenRuntime = null;
    }
    runtime?.controller?.stop?.();
    if (runtime?.view && runtime.view.procgenController === runtime?.controller) {
      runtime.view.procgenController = null;
    }
    runtime?.stageAdapter?.dispose?.();
    runtime?.game?.stop?.();
    runtime?.view?.dispose?.();
    runFocusBlurCleanup(runtime);
    throw err;
  }
};

const resizeCanvas = (runtime = activeProcgenRuntime) => {
  const canvas = document.getElementById('gameCanvas');
  if (!canvas) return;
  const dprValue = Number(window?.devicePixelRatio);
  const dpr = Number.isFinite(dprValue) && dprValue > 0 ? Math.min(2, dprValue) : 1;
  const widthValue = Number(window?.innerWidth);
  const heightValue = Number(window?.innerHeight);
  const fallbackWidth = Number(canvas?.clientWidth);
  const fallbackHeight = Number(canvas?.clientHeight);
  const width = Number.isFinite(widthValue) && widthValue > 0
    ? widthValue
    : (Number.isFinite(fallbackWidth) && fallbackWidth > 0 ? fallbackWidth : 1);
  const barHeight = document.getElementById('procgenTopbar')?.getBoundingClientRect?.().height || 0;
  const height = Number.isFinite(heightValue) && heightValue > 0
    ? Math.max(1, heightValue - barHeight)
    : (Number.isFinite(fallbackHeight) && fallbackHeight > 0 ? fallbackHeight : 1);
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  document.body?.style?.setProperty?.('--procgen-bar-height', `${barHeight}px`);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  if (runtime?.stageAdapter?.updateStageSize) {
    runtime.stageAdapter.updateStageSize();
  } else {
    runtime?.view?.stage?.updateStageSize?.();
  }
};

const shouldAutoBoot = () => (
  typeof window !== 'undefined' &&
  globalThis?.__LEMMINGS_PROCGEN_NO_AUTO_BOOT__ !== true
);

if (shouldAutoBoot()) {
  installProcgenBootListeners();
}

export {
  getProcgenGroundSets,
  getCompatibleProcgenStyleNames,
  buildProcgenThemeContract,
  pickProcgenStyle,
  resolveProcgenSeed,
  buildProcgenControllerOptions,
  buildProcgenEditorLevel,
  init,
  resizeCanvas,
  disposeProcgenRuntime,
  installProcgenBootListeners,
  disposeProcgenBootListeners,
  setActiveProcgenRuntimeForTest
};
