import './bootstrap.js';
import { GameView } from '../game/GameView.js';
import { EditorUiController } from './editorUiController.js';
import { registerServiceWorker } from './registerServiceWorker.js';
import { installE2EHarness } from './e2eHarness.js';
import { bindCanvasFocusBlur } from './canvasFocusBlur.js';
import { ANALYTICS_EVENT_TYPES, createAnalyticsService } from './analytics.js';

let analytics = null;

const trackEditorAction = (action, enabled = null) => {
  analytics?.track?.(ANALYTICS_EVENT_TYPES.EDITOR_ACTION, {
    action,
    enabled
  });
};

const bindEditorAnalytics = (documentRef) => {
  const bindClick = (id, action, enabled = null) => {
    const node = documentRef.getElementById(id);
    if (!node?.addEventListener) return;
    node.addEventListener('click', () => {
      trackEditorAction(action, enabled);
    });
  };
  bindClick('editorNewLevel', 'new');
  bindClick('editorSavedSave', 'save');
  bindClick('editorSavedExport', 'export');
  bindClick('editorPlaytestToggle', 'playtest');
  const importButtons = ['editorSavedImport', 'editorSavedImportClassic'];
  for (const id of importButtons) {
    bindClick(id, 'import');
  }
};

const init = async () => {
  analytics = createAnalyticsService({
    window,
    document,
    navigator: window?.navigator || null,
    location: window?.location || null,
    localStorage: window?.localStorage || null,
    profile: 'editor',
    surface: 'editor'
  });
  analytics.installWindowApi(window);
  analytics.trackPageView({
    surface: 'editor',
    profile: 'editor',
    embedMode: false
  });

  const lemmings = new GameView();
  lemmings.midiEnabled = false;

  lemmings.elementSelectGameType = document.getElementById('editorGameTypeSelect');
  lemmings.elementSelectLevelGroup = document.getElementById('editorLevelGroupSelect');
  lemmings.elementSelectLevel = document.getElementById('editorLevelIndexSelect');
  lemmings.gameCanvas = document.getElementById('editorCanvas');
  bindCanvasFocusBlur(lemmings.gameCanvas);

  await lemmings.setupEditor();
  lemmings.enterEditorMode();
  lemmings.createBlankEditorLevel({ render: false });

  const ui = new EditorUiController({ view: lemmings, document, window });
  await ui.init();
  installE2EHarness({ view: lemmings, editorUi: ui });
  bindEditorAnalytics(document);
};

window.addEventListener('DOMContentLoaded', () => {
  init().catch((error) => {
    analytics?.track?.(ANALYTICS_EVENT_TYPES.RUNTIME_BOOT_ERROR, {
      code: 'boot_error',
      surface: 'editor',
      profile: 'editor',
      embedMode: false
    });
    throw error;
  });
  registerServiceWorker({ profile: 'editor', dev: true });
});
