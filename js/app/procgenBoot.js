import './bootstrap.js';
import { GameView } from '../game/GameView.js';
import { GameTypes } from '../game/GameTypes.js';
import { EditorLevel } from '../editor/EditorLevel.js';
import { loadEditorLevel } from '../editor/EditorLevelLoader.js';
import { getStyleNames } from '../editor/StyleRegistry.js';
import { ProcgenController } from './procgenController.js';
import { ProcgenAssetManager } from './procgenAssetManager.js';
import { ProcgenTerrainStamper } from './procgenTerrainStamper.js';
import { installE2EHarness } from './e2eHarness.js';
import { registerServiceWorker } from './registerServiceWorker.js';
import { DEFAULT_LEVEL_HEIGHT } from '../level/ClassicLevelConstants.js';
import { bindCanvasFocusBlur } from './canvasFocusBlur.js';
import { ProcgenStageAdapter } from './procgenStageAdapter.js';

const PROCGEN_GAME_TYPE = GameTypes.OHNO;
const PROCGEN_LEVEL_WIDTH = 65535;
const PROCGEN_LEVEL_HEIGHT = DEFAULT_LEVEL_HEIGHT;
const PROCGEN_RELEASE_RATE = 50;
const PROCGEN_RELEASE_COUNT = 50;
const PROCGEN_GROUND_HEIGHT = 4;

const pickProcgenStyle = () => {
  const names = getStyleNames();
  if (!names.length) return 'fire';
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
  const list = candidates.length ? candidates : names;
  const choice = list[Math.floor(Math.random() * list.length)] || names[0];
  try {
    window.localStorage?.setItem('procgen.style', choice);
  } catch (err) {
    // ignore storage failures
  }
  return choice;
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
  const entranceY = PROCGEN_LEVEL_HEIGHT - PROCGEN_GROUND_HEIGHT - 40;
  level.setHeader('START_X', entranceX);
  level.gadgets.push({
    props: { PIECE: 1, X: entranceX, Y: entranceY }
  });
  return { level, entranceX, entranceY };
};

const init = async () => {
  const canvas = document.getElementById('gameCanvas');
  if (!canvas) return;
  const params = new URLSearchParams(window.location.search);
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

  const styleName = pickProcgenStyle();
  const { level: editorLevel } = buildProcgenEditorLevel(styleName);
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
    options: { groundHeight: PROCGEN_GROUND_HEIGHT, aiDebugOverlay }
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
