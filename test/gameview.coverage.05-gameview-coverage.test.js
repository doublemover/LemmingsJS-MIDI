import { readFileSync } from 'node:fs';
import { expect } from 'chai';
import { GameView } from '../js/game/GameView.js';
import { BinaryReader } from '../js/data/BinaryReader.js';
import { LevelReader } from '../js/level/LevelReader.js';
import { MidiMapping } from '../js/midi/MidiMapping.js';
import { toMidiFlagTriggerType } from '../js/midi/MidiFlagTriggers.js';
import { EventHandler } from '../js/util/EventHandler.js';
import { setDependency, resetDependencies, useGlobalLemmings } from './helpers/lemmings.js';
import { useGlobalValueRestore } from './support/globals.js';
import { runScenarioTable } from './support/scenario-table.js';

describe('GameView coverage', function() {
  useGlobalValueRestore(['window', 'history', 'WebMidi', 'localStorage', 'document']);

  useGlobalLemmings({});

  beforeEach(function() {
    setDependency('GameFactory', class { constructor() {} });
    setDependency('KeyboardShortcuts', class { constructor() {} dispose() {} });
  });

  afterEach(function() {
    resetDependencies();
  });

  const makeSelect = () => ({
    options: [],
    selectedIndex: -1,
    appendChild(el) {
      this.options.push(el);
      return el;
    },
    remove(idx) {
      this.options.splice(idx, 1);
    }
  });

  const stubDocument = () => {
    globalThis.document = {
      createElement() {
        return { textContent: '', value: '' };
      }
    };
  };

  it('clamps saved level index when out of range', async function() {
    globalThis.window = { location: { search: '' } };
    globalThis.localStorage = {
      store: new Map(),
      getItem(key) { return this.store.get(key) ?? null; },
      setItem(key, value) { this.store.set(key, value); },
      removeItem(key) { this.store.delete(key); }
    };
    globalThis.localStorage.setItem(
      'lemmings.editor.levels',
      JSON.stringify([{ id: 'lvl-1', name: 'Saved Level', updatedAt: 1 }])
    );
    globalThis.localStorage.setItem(
      'lemmings.editor.level.lvl-1',
      'LEVELDATA'
    );

    const view = new GameView();
    view.gameResources = {};
    view.gameFactory = {};
    view.includeSavedLevels = true;
    view.levelIndex = 5;
    view.loadEditorPreviewLevel = async () => 'preview';

    const result = await view.loadSavedLevelFromSelection();

    expect(result).to.equal('preview');
    expect(view.levelIndex).to.equal(0);
  });

  it('loads classic levels when data is available', async function() {
    globalThis.window = { location: { search: '' } };
    const view = new GameView();
    const data = readFileSync(new URL('../lemmings/LEVEL000.DAT', import.meta.url));
    view.gameFactory = {
      fileProvider: {
        async loadBinary(path, filename) {
          return new BinaryReader(data, 0, data.length, filename, path);
        }
      },
      async getConfig() {
        return {
          path: 'lemmings',
          level: {
            filePrefix: 'LEVEL',
            order: [[0]]
          }
        };
      }
    };

    const reader = await view._loadClassicLevelReader(1, 0, 0);

    expect(reader).to.be.instanceOf(LevelReader);
  });

  it('loads editor preview levels end-to-end', async function() {
    globalThis.window = {
      location: { search: '' },
      clearTimeout() {}
    };
    globalThis.history = { replaceState() {} };
    const view = new GameView();
    view.createBlankEditorLevel({ render: false });
    const config = {
      gametype: view.gameType,
      path: 'lemmings',
      level: { filePrefix: 'LEVEL', order: [[0]] },
      mechanics: {}
    };
    view.gameResources = { config, getLevelGroups() { return []; } };
    view.gameFactory = {
      fileProvider: {
        async loadBinary(path, filename) {
          const data = readFileSync(new URL(`../${path}/${filename}`, import.meta.url));
          return new BinaryReader(data, 0, data.length, filename, path);
        }
      },
      async getGame() {
        return {
          level: null,
          soundEvents: {},
          onGameEnd: new EventHandler(),
          loadLevel() {},
          setGameDisplay() {},
          setGuiDisplay() {},
          getGameTimer() { return { speedFactor: 0, suspend() {}, continue() {} }; },
          start() {},
          stop() {},
          cheat() {}
        };
      }
    };
    view.stage = {
      gameImgProps: { viewPoint: { x: 0, y: 0, scale: 1 }, canvasViewportSize: { width: 10, height: 10 } },
      getGameDisplay() {
        return {
          clear() {},
          initSize() {},
          setBackground() {}
        };
      },
      getGuiDisplay() { return {}; },
      resetFade() {},
      updateStageSize() {},
      applyViewport() {},
      redraw() {},
      setCursorSprite() {}
    };
    view.updateQuery = () => {};
    view.applyLevelViewport = () => {};

    const level = await view.loadEditorPreviewLevel();

    expect(level).to.not.equal(null);
  });

  it('loads editor levels from classic readers', async function() {
    globalThis.window = { location: { search: '' } };
    const view = new GameView();
    view.game = { getGameTimer() { return { isRunning() { return false; }, suspend() {} }; } };
    view.stage = { panEnabled: true };
    view.levelGroupIndex = 0;
    view.levelIndex = 0;
    view._loadClassicLevelReader = async () => ({
      graphicSet1: 0,
      levelProperties: {
        levelName: 'Classic',
        releaseCount: 10,
        needCount: 5,
        releaseRate: 50,
        timeLimit: 3,
        skills: []
      },
      levelWidth: 160,
      levelHeight: 80,
      screenPositionX: 12,
      terrains: [],
      objects: [],
      steel: []
    });
    let previewed = false;
    view.loadEditorPreviewLevel = async () => { previewed = true; return 'preview'; };

    const level = await view.loadEditorLevelFromSelection();

    expect(level).to.equal(view.editorSession.level);
    expect(previewed).to.equal(true);
    expect(view.editorMode).to.equal(true);
  });

  it('disposes shortcuts, midi, and stage handlers', function() {
    const removed = [];
    const clearedTimeouts = [];
    globalThis.window = {
      location: { search: '' },
      removeEventListener(type) { removed.push(type); },
      clearTimeout(id) { clearedTimeouts.push(id); }
    };
    const view = new GameView();
    let shortcutsDisposed = false;
    let midiDisposed = false;
    let stageDisposed = false;
    view.shortcuts = { dispose() { shortcutsDisposed = true; } };
    view.midiRouter = { dispose() { midiDisposed = true; } };
    view.autoMoveTimer = 41;
    view.resumeTimer = 42;
    view._stageResize = () => {};
    view.stage = { dispose() { stageDisposed = true; } };

    view.dispose();

    expect(shortcutsDisposed).to.equal(true);
    expect(midiDisposed).to.equal(true);
    expect(stageDisposed).to.equal(true);
    expect(clearedTimeouts).to.include.members([41, 42]);
    expect(removed).to.include('resize');
    expect(removed).to.include('orientationchange');
  });

  it('uses global clearTimeout fallback when window is unavailable during dispose', function() {
    const clearedTimeouts = [];
    globalThis.window = { location: { search: '' } };
    const originalClearTimeout = globalThis.clearTimeout;
    globalThis.clearTimeout = (id) => { clearedTimeouts.push(id); };
    try {
      const view = new GameView();
      view.autoMoveTimer = 51;
      view.resumeTimer = 52;
      view.stage = null;
      globalThis.window = undefined;

      view.dispose();

      expect(clearedTimeouts).to.include.members([51, 52]);
    } finally {
      globalThis.clearTimeout = originalClearTimeout;
    }
  });
});
