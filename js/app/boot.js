import './bootstrap.js';
import { GameView } from '../game/GameView.js';
import { MidiInputController } from '../midi/input/MidiInputController.js';
import { createMidiUiController } from './midiUiController.js';
import { registerServiceWorker } from './registerServiceWorker.js';
import {
  listSavedLevels,
  loadSavedLevel,
  saveLevel
} from '../editor/EditorStorage.js';

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
  lemmings.includeSavedLevels = true;
  lemmings.autoExitEditorOnSelect = true;

  midiInputController = new MidiInputController(lemmings, {
    getConfig: () => midiUi.getMidiConfig(),
    onConfigChange: patch => midiUi.setMidiOverrides(patch)
  });
  midiUi.setMidiInputController(midiInputController);
  globalThis.onEnabled = () => midiUi?.onEnabled?.();
  globalThis.onMidiError = (message) => midiUi?.showError?.(message);

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

  const savedSelect = document.getElementById('savedLevelSelect');
  const savedSaveButton = document.getElementById('savedLevelSave');
  const savedExportButton = document.getElementById('savedLevelExport');
  const savedImportButton = document.getElementById('savedLevelImport');
  const savedImportInput = document.getElementById('savedLevelImportInput');

  let currentSavedId = '';

  const sanitizeFileName = (name) => String(name || 'level')
    .trim()
    .replace(/[^a-z0-9_-]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'level';

  const refreshSavedList = (selectedId = currentSavedId) => {
    if (!savedSelect) return;
    const entries = listSavedLevels();
    savedSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Saved levels';
    savedSelect.appendChild(placeholder);
    for (const entry of entries) {
      const opt = document.createElement('option');
      opt.value = entry.id;
      opt.textContent = entry.name;
      savedSelect.appendChild(opt);
    }
    savedSelect.value = selectedId || '';
    lemmings?.refreshSavedLevels?.();
  };

  const ensureEditorLevel = () => {
    lemmings.enterEditorMode();
    if (!lemmings.editorSession?.level) {
      lemmings.createBlankEditorLevel();
    }
  };

  if (savedSelect) {
    refreshSavedList();
    savedSelect.addEventListener('change', () => {
      const id = savedSelect.value;
      if (!id) return;
      const text = loadSavedLevel(undefined, id);
      if (!text) return;
      lemmings.loadEditorLevelFromText(text);
      currentSavedId = id;
    });
  }

  if (savedSaveButton) {
    savedSaveButton.addEventListener('click', () => {
      ensureEditorLevel();
      const text = lemmings.getEditorLevelText();
      const name = lemmings.getEditorLevelTitle();
      const id = saveLevel(undefined, {
        id: currentSavedId || undefined,
        name,
        text
      });
      if (id) {
        currentSavedId = id;
        refreshSavedList(id);
      }
    });
  }

  if (savedExportButton) {
    savedExportButton.addEventListener('click', () => {
      ensureEditorLevel();
      const text = lemmings.getEditorLevelText();
      const title = lemmings.getEditorLevelTitle();
      const filename = `${sanitizeFileName(title)}.nxlv`;
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    });
  }

  if (savedImportButton && savedImportInput) {
    savedImportButton.addEventListener('click', () => {
      savedImportInput.click();
    });

    savedImportInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const text = typeof reader.result === 'string' ? reader.result : '';
        if (!text) return;
        lemmings.loadEditorLevelFromText(text);
        currentSavedId = '';
        refreshSavedList('');
      };
      reader.readAsText(file);
      e.target.value = '';
    });
  }
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
    window.lemmings.stage.scheduleUpdateStageSize();
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
  registerServiceWorker();
  setSize();
  bindResize();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
