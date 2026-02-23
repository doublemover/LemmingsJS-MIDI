import './bootstrap.js';
import { GameView } from '../game/GameView.js';
import { MidiInputController } from '../midi/input/MidiInputController.js';
import { createMidiUiController } from './midiUiController.js';
import { registerServiceWorker } from './registerServiceWorker.js';
import { installE2EHarness } from './e2eHarness.js';
import { ShortcutOverlay } from './shortcutOverlay.js';
import { bindCanvasFocusBlur } from './canvasFocusBlur.js';
import {
  detectEmbedMode,
  optionalElement,
  resolveRequiredElements
} from './domResolver.js';
import {
  getRuntimeDependency,
  setRuntimeContext
} from '../core/dependencies.js';
import { DEFAULT_RUNTIME_PROFILE } from '../core/runtimeProfiles.js';
import {
  listSavedLevels,
  loadSavedLevel,
  saveLevel
} from '../editor/EditorStorage.js';

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

const REQUIRED_BOOT_IDS = Object.freeze([
  'shortcutOverlay',
  'gameTypeSelect',
  'levelGroupSelect',
  'levelIndexSelect',
  'gameCanvas'
]);

const getRuntimeWindow = () => getRuntimeDependency('window', null);
const getRuntimeDocument = () => getRuntimeDependency('document', null);
const getRuntimeWebMidi = () => getRuntimeDependency('webMidi', null);

const hydrateRuntimeContext = () => {
  const windowRef = getRuntimeWindow();
  const documentRef = getRuntimeDocument();
  setRuntimeContext({
    window: windowRef,
    document: documentRef,
    navigator: getRuntimeDependency('navigator', windowRef?.navigator || null),
    location: getRuntimeDependency('location', windowRef?.location || null),
    history: getRuntimeDependency('history', windowRef?.history || null),
    localStorage: getRuntimeDependency('localStorage', windowRef?.localStorage || null),
    caches: getRuntimeDependency('caches', null),
    performance: getRuntimeDependency('performance', (typeof performance !== 'undefined' ? performance : null)),
    webMidi: getRuntimeWebMidi(),
    bootNoAutoStart: getRuntimeDependency('bootNoAutoStart', false)
  });
  return { windowRef, documentRef };
};

const appendBootFailureMessage = (documentRef, error, embedMode) => {
  if (!documentRef) return;
  const message = error?.message || 'Runtime boot failed.';
  documentRef.documentElement?.setAttribute?.('data-boot-error', message);
  if (!embedMode) return;
  const host = documentRef.querySelector?.('.game_container') || documentRef.body;
  if (!host || !documentRef.createElement) return;
  if (documentRef.getElementById?.('bootFailureNotice')) return;
  const notice = documentRef.createElement('div');
  notice.id = 'bootFailureNotice';
  notice.textContent = message;
  notice.className = 'boot-failure-notice';
  host.appendChild(notice);
};

let midiUi = null;
let midiInputController = null;
let lemmings;
let resizeBound = false;
let cachedGameContainer = null;
let cachedCanvas = null;

const setLemmingsForTest = (value) => {
  lemmings = value;
};

function init({ windowRef, documentRef, embedMode }) {
  if (!windowRef || !documentRef) {
    throw new Error('Runtime boot requires both window and document references.');
  }
  midiUi = createMidiUiController({
    window: windowRef,
    document: documentRef,
    getLemmings: () => lemmings,
    getWebMidi: () => getRuntimeWebMidi()
  });

  lemmings = new GameView();
  lemmings.applyProfileHistoryRetentionPolicy?.();
  lemmings.setMidiOverrides?.(midiUi.getMidiOverrides?.() || {});
  lemmings.midiEnabled = midiUi.getStoredEnabled();
  lemmings.includeSavedLevels = true;
  lemmings.autoExitEditorOnSelect = true;
  const bootNodes = resolveRequiredElements(documentRef, REQUIRED_BOOT_IDS, {
    context: 'boot',
    embedMode: embedMode === true
  });
  const shortcutOverlayRoot = bootNodes.shortcutOverlay;
  const gameTypeSelect = bootNodes.gameTypeSelect;
  const levelGroupSelect = bootNodes.levelGroupSelect;
  const levelIndexSelect = bootNodes.levelIndexSelect;
  const gameCanvas = bootNodes.gameCanvas;
  lemmings.shortcutOverlay = new ShortcutOverlay({
    root: shortcutOverlayRoot,
    title: 'Game Shortcuts',
    sections: GAME_SHORTCUT_SECTIONS,
    getBindings: action => lemmings.shortcuts?.getDisplayBindings?.(action) || []
  });
  installE2EHarness({ view: lemmings, midiUi });

  midiInputController = new MidiInputController(lemmings, {
    getConfig: () => midiUi.getMidiConfig(),
    onConfigChange: patch => midiUi.setMidiOverrides(patch)
  });
  midiUi.setMidiInputController(midiInputController);
  const midiStatusHandlers = midiUi.getMidiStatusHandlers?.();
  lemmings.setMidiStatusHandlers?.({
    onEnabled: midiStatusHandlers?.onEnabled,
    onError: midiStatusHandlers?.onError
  });

  lemmings.elementSelectGameType = gameTypeSelect;
  lemmings.elementSelectLevelGroup = levelGroupSelect;
  lemmings.elementSelectLevel = levelIndexSelect;
  lemmings.gameCanvas = gameCanvas;
  cachedCanvas = gameCanvas;
  cachedGameContainer = documentRef.querySelector('.game_container');
  bindCanvasFocusBlur(lemmings.gameCanvas);
  const setupPromise = lemmings.setup();
  if (setupPromise?.then) {
    setupPromise.then(async () => {
      if (lemmings.startupProfile === 'editor') {
        lemmings.enterEditorMode();
        await lemmings.loadEditorLevelFromSelection();
      }
      midiUi?.refreshMidiUiFromConfig?.();
    }).catch(() => {});
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
  const levelPrevButton = optionalElement(documentRef, 'levelPrevButton');
  const levelNextButton = optionalElement(documentRef, 'levelNextButton');
  if (levelPrevButton) {
    levelPrevButton.addEventListener('click', () => {
      lemmings.moveToLevel(-1);
    });
  }
  if (levelNextButton) {
    levelNextButton.addEventListener('click', () => {
      lemmings.moveToLevel(1);
    });
  }

  const savedSelect = optionalElement(documentRef, 'savedLevelSelect');
  const savedSaveButton = optionalElement(documentRef, 'savedLevelSave');
  const savedExportButton = optionalElement(documentRef, 'savedLevelExport');
  const savedImportButton = optionalElement(documentRef, 'savedLevelImport');
  const savedImportInput = optionalElement(documentRef, 'savedLevelImportInput');

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
    const placeholder = documentRef.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Saved levels';
    savedSelect.appendChild(placeholder);
    for (const entry of entries) {
      const opt = documentRef.createElement('option');
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
      const link = documentRef.createElement('a');
      link.href = url;
      link.download = filename;
      documentRef.body.appendChild(link);
      link.click();
      documentRef.body.removeChild(link);
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
  const windowRef = getRuntimeWindow();
  const documentRef = getRuntimeDocument();
  if (!windowRef || !documentRef) return;
  const baseW = 800;
  const baseH = 480;
  const ratio = baseW / baseH;
  const gameContainer = cachedGameContainer || documentRef.querySelector('.game_container');
  if (!cachedGameContainer) {
    cachedGameContainer = gameContainer;
  }
  const docEl = documentRef.documentElement;
  const viewport = windowRef.visualViewport;
  const width = Math.max(1, viewport?.width || docEl.clientWidth || windowRef.innerWidth);
  const height = Math.max(1, viewport?.height || docEl.clientHeight || windowRef.innerHeight);
  const isPortrait = height > width;
  const isTablet = Math.max(width, height) >= 900;
  documentRef.body.classList.toggle('portrait-small', isPortrait && !isTablet);
  let containerWidth, containerHeight;

  if (width >= height * ratio) {
    containerWidth = height * ratio;
    containerHeight = height;
    if (gameContainer) {
      gameContainer.style.marginTop = '';
      gameContainer.style.marginLeft = `${(width - containerWidth) / 2}px`;
      gameContainer.classList.remove('small');
    }
  } else {
    containerWidth = width;
    containerHeight = width / ratio;
    if (gameContainer) {
      gameContainer.style.marginTop = `${(height - containerHeight) / 2}px`;
      gameContainer.style.marginLeft = '';
      gameContainer.classList.add('small');
    }
  }

  if (containerWidth > width) containerWidth = width;
  if (containerHeight > height) containerHeight = height;

  if (gameContainer) {
    gameContainer.style.width = `${containerWidth}px`;
    gameContainer.style.height = `${containerHeight}px`;
  }

  const canvas = lemmings?.gameCanvas || cachedCanvas || optionalElement(documentRef, 'gameCanvas');
  if (!cachedCanvas && canvas) {
    cachedCanvas = canvas;
  }
  if (canvas) {
    if (canvas.width !== baseW) {
      canvas.width = baseW;
    }
    if (canvas.height !== baseH) {
      canvas.height = baseH;
    }
    canvas.style.width = containerWidth + 'px';
    canvas.style.height = containerHeight + 'px';
  }

  if (lemmings?.stage) {
    lemmings.stage.scheduleUpdateStageSize();
  }
}

function bindResize() {
  const windowRef = getRuntimeWindow();
  if (!windowRef) return;
  if (resizeBound) return;
  resizeBound = true;
  windowRef.addEventListener('resize', setSize);
  windowRef.addEventListener('orientationchange', setSize);
  windowRef.visualViewport?.addEventListener?.('resize', setSize);
}

function start() {
  const { windowRef, documentRef } = hydrateRuntimeContext();
  const embedMode = detectEmbedMode({ windowRef, documentRef });
  try {
    init({ windowRef, documentRef, embedMode });
    midiUi?.bindMidiUi();
    midiUi?.scheduleMidiUiRefresh();
    registerServiceWorker({
      profile: lemmings?.startupProfile || DEFAULT_RUNTIME_PROFILE,
      window: windowRef,
      document: documentRef,
      location: windowRef?.location || null
    });
    setSize();
    bindResize();
  } catch (error) {
    appendBootFailureMessage(documentRef, error, embedMode);
    if (!embedMode) {
      throw error;
    }
  }
}

{
  const { documentRef } = hydrateRuntimeContext();
  const noAutoStart = getRuntimeDependency('bootNoAutoStart', false) === true;
  if (!noAutoStart && documentRef) {
    if (documentRef.readyState === 'loading') {
      documentRef.addEventListener('DOMContentLoaded', start);
    } else {
      start();
    }
  } else if (!noAutoStart && !documentRef) {
    throw new Error('Runtime boot requires a document reference.');
  }
}

export {
  bindResize,
  setLemmingsForTest,
  setSize,
  start
};
