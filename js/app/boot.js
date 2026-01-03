import './bootstrap.js';
import { GameView } from '../game/GameView.js';
import { MidiInputController } from '../midi/input/MidiInputController.js';
import { createMidiUiController } from './midiUiController.js';
import { registerServiceWorker } from './registerServiceWorker.js';
import { installE2EHarness } from './e2eHarness.js';
import { ShortcutOverlay } from './shortcutOverlay.js';
import { bindCanvasFocusBlur } from './canvasFocusBlur.js';
import {
  listSavedLevels,
  loadSavedLevel,
  saveLevel
} from '../editor/EditorStorage.js';

const $ = globalThis.$ || globalThis.jQuery;
const jQuery = globalThis.jQuery || $;

const GAME_SHORTCUT_SECTIONS = [
  {
    title: 'General',
    entries: [
      { action: 'toggleShortcutOverlay', label: 'Shortcut overlay' },
      { action: 'togglePause', label: 'Pause / resume' },
      { action: 'toggleReverse', label: 'Reverse playback' },
      { action: 'stepBackward', label: 'Step back' },
      { action: 'stepForward', label: 'Step forward' },
      { action: 'restartLevel', label: 'Restart level' },
      { action: 'nuke', label: 'Nuke' },
      { action: 'nukeInstant', label: 'Instant nuke' }
    ]
  },
  {
    title: 'View',
    entries: [
      { action: 'panLeft', label: 'Pan left' },
      { action: 'panRight', label: 'Pan right' },
      { action: 'panUp', label: 'Pan up' },
      { action: 'panDown', label: 'Pan down' },
      { action: 'panBoost', label: 'Pan boost' },
      { action: 'zoomIn', label: 'Zoom in' },
      { action: 'zoomOut', label: 'Zoom out' },
      { action: 'zoomReset', label: 'Zoom reset' }
    ]
  },
  {
    title: 'Skills',
    entries: [
      { action: 'cycleSkillPrev', label: 'Cycle skill (prev)' },
      { action: 'cycleSkillNext', label: 'Cycle skill (next)' },
      { action: 'applySkillToSelected', label: 'Apply skill to selected' },
      { action: 'selectSkillClimber', label: 'Select climber' },
      { action: 'selectSkillFloater', label: 'Select floater' },
      { action: 'selectSkillBomber', label: 'Select bomber' },
      { action: 'selectSkillBlocker', label: 'Select blocker' },
      { action: 'selectSkillBuilder', label: 'Select builder' },
      { action: 'selectSkillBasher', label: 'Select basher' },
      { action: 'selectSkillMiner', label: 'Select miner' },
      { action: 'selectSkillDigger', label: 'Select digger' }
    ]
  },
  {
    title: 'Levels',
    entries: [
      { action: 'levelPrev', label: 'Previous level' },
      { action: 'levelNext', label: 'Next level' },
      { action: 'levelGroupPrev', label: 'Previous group' },
      { action: 'levelGroupNext', label: 'Next group' },
      { action: 'editorToggle', label: 'Toggle editor' }
    ]
  }
];

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
  lemmings.shortcutOverlay = new ShortcutOverlay({
    root: document.getElementById('shortcutOverlay'),
    title: 'Game Shortcuts',
    sections: GAME_SHORTCUT_SECTIONS,
    getBindings: action => lemmings.shortcuts?.getDisplayBindings?.(action) || []
  });
  installE2EHarness({ view: lemmings });

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
  bindCanvasFocusBlur(lemmings.gameCanvas);
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
  const viewport = window.visualViewport;
  const width = Math.max(1, viewport?.width || docEl.clientWidth || window.innerWidth);
  const height = Math.max(1, viewport?.height || docEl.clientHeight || window.innerHeight);
  const isPortrait = height > width;
  const isTablet = Math.max(width, height) >= 900;
  document.body.classList.toggle('portrait-small', isPortrait && !isTablet);
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
