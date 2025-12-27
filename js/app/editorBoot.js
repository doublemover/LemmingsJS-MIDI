import './bootstrap.js';
import { GameView } from '../game/GameView.js';
import { EditorUiController } from './editorUiController.js';

const init = async () => {
  const lemmings = new GameView();
  lemmings.midiEnabled = false;

  lemmings.elementSelectGameType = document.getElementById('editorGameTypeSelect');
  lemmings.elementSelectLevelGroup = document.getElementById('editorLevelGroupSelect');
  lemmings.elementSelectLevel = document.getElementById('editorLevelIndexSelect');
  lemmings.gameCanvas = document.getElementById('editorCanvas');

  await lemmings.setupEditor();
  lemmings.enterEditorMode();
  lemmings.createBlankEditorLevel({ render: false });

  const ui = new EditorUiController({ view: lemmings, document, window });
  await ui.init();
};

window.addEventListener('DOMContentLoaded', () => {
  init();
});
