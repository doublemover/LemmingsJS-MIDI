import './bootstrap.js';
import { GameView } from '../game/GameView.js';
import { MidiInputController } from '../midi/input/MidiInputController.js';
import { createMidiUiController } from './midiUiController.js';

const $ = globalThis.$ || globalThis.jQuery;
const jQuery = globalThis.jQuery || $;

let midiUi = null;
let midiInputController = null;
let lemmings;

function init() {
  midiUi = createMidiUiController({
    window: globalThis.window,
    document: globalThis.document,
    getLemmings: () => lemmings,
    getWebMidi: () => globalThis.WebMidi
  });

  lemmings = new GameView();
  lemmings.midiEnabled = midiUi.getStoredEnabled();

  midiInputController = new MidiInputController(lemmings, {
    getConfig: () => midiUi.getMidiConfig(),
    onConfigChange: patch => midiUi.setMidiOverrides(patch)
  });
  midiUi.setMidiInputController(midiInputController);
  globalThis.onEnabled = () => midiUi?.onEnabled?.();

  lemmings.elementSelectGameType = document.getElementById('gameTypeSelect');
  lemmings.elementSelectLevelGroup = document.getElementById('levelGroupSelect');
  lemmings.elementSelectLevel = document.getElementById('levelIndexSelect');
  lemmings.gameCanvas = document.getElementById('gameCanvas');
  const setupPromise = lemmings.setup();
  if (setupPromise?.then) {
    setupPromise.then(() => midiUi?.refreshMidiUiFromConfig?.()).catch(() => {});
  }
  // use GameView.strToNum to parse dropdown values
  lemmings.elementSelectGameType.addEventListener('change', (e) => {
    lemmings.selectGameType(lemmings.strToNum(e.target.value));
  });
  lemmings.elementSelectLevelGroup.addEventListener('change', (e) => {
    lemmings.selectLevelGroup(lemmings.strToNum(e.target.value));
  });
  lemmings.elementSelectLevel.addEventListener('change', (e) => {
    lemmings.selectLevel(lemmings.strToNum(e.target.value));
  });
}

function setSize() {
  const baseW = 800;
  const baseH = 480;
  const ratio = baseW / baseH;
  const gameContainer = jQuery('.game_container');
  const docEl = document.documentElement;
  const width = Math.max(1, docEl.clientWidth || window.innerWidth);
  const height = Math.max(1, docEl.clientHeight || window.innerHeight);
  let containerWidth, containerHeight;

  if (width >= height * ratio) {
    containerWidth = height * ratio;
    containerHeight = height;
    gameContainer.css('margin-top', '');
    gameContainer.css('margin-left', (width - containerWidth) / 2);
    gameContainer.removeClass('small');
  } else {
    containerWidth = width;
    containerHeight = width / ratio;
    gameContainer.css('margin-top', (height - containerHeight) / 2);
    gameContainer.css('margin-left', '');
    gameContainer.addClass('small');
  }

  if (containerWidth > width) containerWidth = width;
  if (containerHeight > height) containerHeight = height;

  gameContainer.width(containerWidth);
  gameContainer.height(containerHeight);

  const canvas = document.getElementById('gameCanvas');
  if (canvas) {
    canvas.width = baseW;
    canvas.height = baseH;
    canvas.style.width = containerWidth + 'px';
    canvas.style.height = containerHeight + 'px';
  }

  if (window.lemmings && window.lemmings.stage) {
    window.lemmings.stage.updateStageSize();
  }
}

function bindResize() {
  if (typeof $ === 'function' && $(window)?.on) {
    $(window).on('resize orientationchange', function() {
      setSize();
    });
  } else {
    window.addEventListener('resize', setSize);
    window.addEventListener('orientationchange', setSize);
  }
}

function start() {
  init();
  midiUi?.bindMidiUi();
  midiUi?.scheduleMidiUiRefresh();
  setSize();
  bindResize();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
