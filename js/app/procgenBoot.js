import './bootstrap.js';
import { GameView } from '../game/GameView.js';
import { GameTypes } from '../game/GameTypes.js';
import { EditorLevel } from '../editor/EditorLevel.js';
import { loadEditorLevel } from '../editor/EditorLevelLoader.js';
import { ProcgenController } from './procgenController.js';
import { installE2EHarness } from './e2eHarness.js';
import { registerServiceWorker } from './registerServiceWorker.js';
import { DEFAULT_LEVEL_HEIGHT } from '../level/ClassicLevelConstants.js';
import { bindCanvasFocusBlur } from './canvasFocusBlur.js';
import { ProcgenStageAdapter } from './procgenStageAdapter.js';

const PROCGEN_GAME_TYPE = GameTypes.OHNO;
const PROCGEN_STYLE = 'fire';
const PROCGEN_LEVEL_WIDTH = 65535;
const PROCGEN_LEVEL_HEIGHT = DEFAULT_LEVEL_HEIGHT;
const PROCGEN_RELEASE_RATE = 50;
const PROCGEN_RELEASE_COUNT = 50;
const PROCGEN_GROUND_HEIGHT = 4;

const buildProcgenEditorLevel = () => {
  const level = new EditorLevel();
  level.setHeader('TITLE', 'Procgen');
  level.setHeader('STYLE', PROCGEN_STYLE);
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
  const view = new GameView();
  view.gameType = PROCGEN_GAME_TYPE;
  view.levelGroupIndex = 0;
  view.levelIndex = 0;
  view.midiEnabled = false;
  view.includeSavedLevels = false;
  view.endless = true;
  view.gameCanvas = canvas;
  if (view.stage) {
    view.stage.setGuiEnabled(false);
    view.stage.setCursorSprite(null);
    view.stage.hudMargin = 0;
  }

  const config = await view.gameFactory.getConfig(PROCGEN_GAME_TYPE);
  const resources = await view.gameFactory.getGameResources(PROCGEN_GAME_TYPE);
  view.gameResources = resources;

  const { level: editorLevel } = buildProcgenEditorLevel();
  const level = await loadEditorLevel(
    editorLevel,
    config,
    view.gameFactory.fileProvider,
    {
      styleName: PROCGEN_STYLE,
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
  bindCanvasFocusBlur(canvas);

  const controller = new ProcgenController({
    view,
    game,
    level,
    options: { groundHeight: PROCGEN_GROUND_HEIGHT }
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
