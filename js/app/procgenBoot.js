import './bootstrap.js';
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

const shuffle = (list, rng = Math.random) => {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
};

const getProcgenGroundSets = (config) => {
  const key = config?.path || null;
  const sets = key ? PROCGEN_GROUND_SETS_BY_PATH[key] : null;
  return Array.isArray(sets) && sets.length ? sets : null;
};

const pickProcgenStyle = async (fileProvider, config, rng = Math.random) => {
  const names = getStyleNames();
  if (!names.length) return 'fire';
  const allowedGroundSets = getProcgenGroundSets(config);
  let last = null;
  try {
    last = window.localStorage?.getItem('procgen.style') || null;
  } catch (err) {
    last = null;
  }
  const normalizedLast = last ? last.toLowerCase() : null;
  const candidates = normalizedLast
    ? names.filter(name => name.toLowerCase() !== normalizedLast)
    : names.slice();
  const filtered = allowedGroundSets
    ? candidates.filter(name => {
      const style = getStyle(name);
      return Number.isFinite(style?.groundSet)
        && allowedGroundSets.includes(style.groundSet | 0);
    })
    : candidates.slice();
  const shuffled = shuffle(filtered, rng);
  if (normalizedLast && !shuffled.some(name => name.toLowerCase() === normalizedLast)) {
    const lastStyle = getStyle(last);
    const lastGroundSet = Number.isFinite(lastStyle?.groundSet) ? lastStyle.groundSet | 0 : null;
    const allowLast = !allowedGroundSets
      || (lastGroundSet != null && allowedGroundSets.includes(lastGroundSet));
    if (allowLast) {
      shuffled.push(last);
    }
  }
  const list = shuffled.length ? shuffled : names.slice();
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
  const canvas = document.getElementById('gameCanvas');
  if (!canvas) return;
  const params = new URLSearchParams(window.location.search);
  const procgenSeed = resolveProcgenSeed(params);
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
  view.gameType = PROCGEN_GAME_TYPE;
  view.levelGroupIndex = 0;
  view.levelIndex = 0;
  view.midiEnabled = false;
  view.includeSavedLevels = false;
  view.endless = true;
  view.gameCanvas = canvas;
  view.gameSpeedFactor = 3;
  if (view.stage) {
    view.stage.setGuiEnabled(false);
    view.stage.setCursorSprite(null);
    view.stage.hudMargin = 0;
  }

  const config = await view.gameFactory.getConfig(PROCGEN_GAME_TYPE);
  const resources = await view.gameFactory.getGameResources(PROCGEN_GAME_TYPE);
  view.gameResources = resources;

  const styleName = await pickProcgenStyle(
    view.gameFactory.fileProvider,
    config,
    styleRng
  );
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
  if (!level) return;

  const game = await view.gameFactory.getGame(PROCGEN_GAME_TYPE, resources);
  await game.loadCustomLevel(level, { levelGroupIndex: 0, levelIndex: 0 });
  game.setGameDisplay(view.stage.getGameDisplay());
  view.game = game;
  view.applyLevelViewport(level);
  view.stage.updateStageSize();
  game.start();
  game.getGameTimer().speedFactor = view.gameSpeedFactor;
  bindCanvasFocusBlur(canvas);

  const assetManager = new ProcgenAssetManager({
    styleName,
    config,
    fileProvider: view.gameFactory.fileProvider
  });
  await assetManager.load();
  const stamper = new ProcgenTerrainStamper(level);

  const controller = new ProcgenController({
    view,
    game,
    level,
    assets: assetManager,
    stamper,
    options: {
      groundHeight: PROCGEN_GROUND_HEIGHT,
      initialGroundWidth: PROCGEN_INITIAL_GROUND_WIDTH,
      entranceX,
      entranceY,
      entranceClearance: PROCGEN_ENTRANCE_CLEARANCE,
      aiDebugOverlay,
      rng: terrainRng,
      rngSeed: procgenSeed
    }
  });
  controller.start();

  const stageAdapter = new ProcgenStageAdapter({
    view,
    controller,
    canvas
  });
  stageAdapter.install();

  installE2EHarness({ view });
  registerServiceWorker();
};

const resizeCanvas = () => {
  const canvas = document.getElementById('gameCanvas');
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  if (window.lemmings?.stage) {
    window.lemmings.stage.updateStageSize();
  }
};

window.addEventListener('resize', resizeCanvas);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    resizeCanvas();
    init();
  });
} else {
  resizeCanvas();
  init();
}
