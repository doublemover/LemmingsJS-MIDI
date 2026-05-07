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

  it('clears pending timers and replaces running games on load', async function() {
    globalThis.window = { location: { search: '' }, clearTimeout() {} };
    globalThis.history = { replaceState() {} };
    const view = new GameView();
    view.autoMoveTimer = 1;
    view.gameResources = {
      getLevelGroups() { return ['One']; },
      async getLevel() { return { render() {}, screenPositionX: 0 }; }
    };
    view.stage = {
      getGameDisplay() { return { clear() {}, initSize() {}, setBackground() {} }; },
      resetFade() {},
      updateStageSize() {},
      applyViewport() {},
      redraw() {}
    };
    view.applyLevelViewport = () => {};
    view.game = { stop() { view.stopped = true; } };
    view.midiRouter = { detach() { view.detached = true; } };
    view.elementGameState = { innerText: '' };
    view.configs = [{ gametype: view.gameType }];
    await view.loadLevel();
    expect(view.stopped).to.equal(true);
    expect(view.detached).to.equal(true);
  });

  it('covers replay start, cheat, and frame helpers when game exists', async function() {
    globalThis.window = {
      location: { search: '' },
      setTimeout(cb) { cb(); return 1; },
      clearTimeout() {}
    };
    const view = new GameView();
    let replayLoaded = null;
    const timer = { continue() {}, suspend() {}, tick() {}, speedFactor: 0 };
    view.gameFactory = {
      async getGame() {
        return {
          level: {},
          soundEvents: {},
          onGameEnd: new EventHandler(),
          getCommandManager() { return { loadReplay(str) { replayLoaded = str; } }; },
          getGameTimer() { return timer; },
          history: { truncateAfter() {} },
          timeTravel: { stepBackward() {} },
          render() {},
          setGameDisplay() {},
          setGuiDisplay() {},
          loadLevel() {},
          start() {},
          cheat() { view.cheated = true; }
        };
      }
    };
    view.stage = {
      getGameDisplay() { return {}; },
      getGuiDisplay() { return {}; },
      setCursorSprite() {}
    };
    view.applyLevelViewport = () => {};
    await view.start('abc');
    expect(replayLoaded).to.equal('abc');

    view.cheat();
    view.suspendWithColor('blue');
    view.nextFrame();
    view.prevFrame();
    view.selectSpeedFactor(2);
  });

  it('draws overlay and resets timers in suspendWithColor', function() {
    let timeoutCb = null;
    let clearedId = null;
    globalThis.window = {
      location: { search: '' },
      clearTimeout(id) { clearedId = id; },
      setTimeout(cb) { timeoutCb = cb; return 7; }
    };
    const view = new GameView();
    const timer = {
      suspend() {},
      continue() { view.continued = true; }
    };
    view.game = { getGameTimer() { return timer; } };
    view.stage = {
      guiImgProps: { x: 10, y: 20, viewPoint: { scale: 2 } },
      startOverlayFade(color, rect) { view.overlay = { color, rect }; }
    };
    view.resumeTimer = 3;
    view.bench = true;

    view.suspendWithColor('red');
    expect(clearedId).to.equal(3);
    expect(view.resumeTimer).to.equal(7);
    expect(view.overlay.rect).to.eql({ x: 330, y: 84, width: 32, height: 20 });

    timeoutCb();
    expect(view.continued).to.equal(true);
    expect(view.resumeTimer).to.equal(null);
  });

  it('replaces pending resume timers when suspendWithColor is called repeatedly', function() {
    const callbacks = new Map();
    let nextTimerId = 10;
    const cleared = [];
    globalThis.window = {
      location: { search: '' },
      clearTimeout(id) { cleared.push(id); callbacks.delete(id); },
      setTimeout(cb) {
        const id = nextTimerId++;
        callbacks.set(id, cb);
        return id;
      }
    };
    const view = new GameView();
    const timer = {
      suspendCalls: 0,
      continueCalls: 0,
      suspend() { this.suspendCalls += 1; },
      continue() { this.continueCalls += 1; }
    };
    view.game = { getGameTimer() { return timer; } };
    view.stage = {
      guiImgProps: { x: 0, y: 0, viewPoint: { scale: 1 } },
      startOverlayFade() {}
    };

    view.suspendWithColor('red');
    const firstTimer = view.resumeTimer;
    view.suspendWithColor('blue');
    const secondTimer = view.resumeTimer;

    expect(firstTimer).to.equal(10);
    expect(secondTimer).to.equal(11);
    expect(cleared).to.deep.equal([10]);
    expect(timer.suspendCalls).to.equal(2);

    callbacks.get(firstTimer)?.();
    expect(timer.continueCalls).to.equal(0);

    callbacks.get(secondTimer)?.();
    expect(timer.continueCalls).to.equal(1);
    expect(view.resumeTimer).to.equal(null);
  });

  it('uses global timer fallbacks in suspendWithColor when window is unavailable', function() {
    globalThis.window = { location: { search: '' } };
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const cleared = [];
    try {
      globalThis.setTimeout = () => 19;
      globalThis.clearTimeout = (id) => { cleared.push(id); };

      const view = new GameView();
      const timer = {
        suspend() {},
        continue() {}
      };
      view.game = { getGameTimer() { return timer; } };
      view.stage = {
        guiImgProps: { x: 0, y: 0, viewPoint: { scale: 1 } },
        startOverlayFade() {}
      };
      view.resumeTimer = 7;
      globalThis.window = undefined;

      expect(() => view.suspendWithColor('red')).to.not.throw();
      expect(cleared).to.deep.equal([7]);
      expect(view.resumeTimer).to.equal(19);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  });

  it('uses global clearTimeout fallbacks in load paths when window is unavailable', async function() {
    globalThis.window = { location: { search: '' } };
    const originalClearTimeout = globalThis.clearTimeout;
    const cleared = [];
    try {
      globalThis.clearTimeout = (id) => { cleared.push(id); };
      const view = new GameView();
      view.autoMoveTimer = 41;
      globalThis.window = undefined;
      await view.loadLevel();
      expect(view.autoMoveTimer).to.equal(null);

      view.autoMoveTimer = 42;
      await view.loadEditorPreviewLevel();
      expect(view.autoMoveTimer).to.equal(null);
      expect(cleared).to.deep.equal([41, 42]);
    } finally {
      globalThis.clearTimeout = originalClearTimeout;
    }
  });

  it('covers MIDI mapping fallback and disabled routing', async function() {
    const view = new GameView();
    view.gameFactory = {
      fileProvider: { loadString: async () => { throw new Error('nope'); } }
    };
    const mapping = await view._loadMidiMapping();
    expect(mapping).to.be.instanceOf(MidiMapping);

    view.midiEnabled = false;
    view.midiRouter = { detach() { view.detached = true; }, scheduler: { allNotesOff() { view.off = true; } } };
    const result = await view.initMidiRouting();
    expect(result).to.equal(null);
    expect(view.detached).to.equal(true);
    expect(view.off).to.equal(true);
  });

  it('covers moveToLevel negative wrap and invalid game types', async function() {
    setDependency('GameTypes', { length: 1, toString() { return 'Pack'; } });
    const view = new GameView();
    view.gameFactory = {
      async getConfig() { return { level: { order: [[]] } }; },
      async getGameResources() { return {}; }
    };
    view.editorMode = true;
    view.autoExitEditorOnSelect = true;
    view.exitEditorMode = () => { view.exited = true; };
    view.loadEditorLevelFromSelection = async () => { view.loadedEditor = true; };
    view.loadLevel = async () => { view.loaded = true; };
    await view.moveToLevel(-1);
    expect(view.levelIndex).to.equal(0);
    expect(view.exited).to.equal(true);
    expect(view.loadedEditor).to.equal(true);
  });

  it('covers selection list empty branches', async function() {
    const view = new GameView();
    view.elementSelectLevel = makeSelect();
    view.gameResources = { getLevelGroups() { return ['One']; } };
    view._getSavedLevelEntries = () => [];
    view._isSavedGroupIndex = () => false;
    view.gameFactory = { async getConfig() { return { level: { getGroupLength() { return 0; } } }; } };
    view.levelIndex = 5;
    await view.populateLevelSelect();
    expect(view.levelIndex).to.equal(0);
  });

  it('covers selectLevel outside editor mode', async function() {
    const view = new GameView();
    view.editorMode = false;
    view.loadLevel = () => { view.loaded = true; };
    await view.selectLevel(2);
    expect(view.loaded).to.equal(true);
  });

  it('calls preview rendering from editor utilities', function() {
    const view = new GameView();
    let previewed = 0;
    view.loadEditorPreviewLevel = async () => { previewed += 1; };
    view.createBlankEditorLevel();
    view.loadEditorLevelFromText('LEVELDATA');
    expect(previewed).to.equal(2);
  });

  it('returns early when starting a level with an existing game', async function() {
    const view = new GameView();
    let continued = false;
    view.game = { getGameTimer() { return { continue() { continued = true; } }; } };
    view.continue = () => { continued = true; };
    await view._startWithLevel({});
    expect(continued).to.equal(true);
  });

  it('swallows errors when starting editor levels', async function() {
    const view = new GameView();
    view.gameResources = {};
    view.gameFactory = { async getGame() { throw new Error('boom'); } };
    await view._startWithLevel({});
  });

  it('loads editor previews with preserved view state', async function() {
    globalThis.window = { location: { search: '' }, clearTimeout() {} };
    globalThis.history = { replaceState() {} };
    const view = new GameView();
    view.autoMoveTimer = 1;
    view.createBlankEditorLevel({ render: false });
    view.editorMode = true;
    view.editorPlaytest = true;
    view.midiEnabled = true;
    view.initMidiRouting = async () => { view.midiRouter = { attach() {} }; return view.midiRouter; };
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
    view.configs = [{ gametype: view.gameType, name: 'Pack' }];
    view.elementSelectGameType = { selectedIndex: -1 };
    view.elementSelectLevelGroup = { selectedIndex: -1 };
    view.elementSelectLevel = { selectedIndex: -1 };
    view.stage = {
      panEnabled: false,
      gameImgProps: { viewPoint: { x: 1, y: 2, scale: 1 }, canvasViewportSize: { width: 10, height: 10 } },
      getGameDisplay() { return { clear() {}, initSize() {}, setBackground() {} }; },
      getGuiDisplay() { return {}; },
      resetFade() {},
      updateStageSize() {},
      applyViewport() {},
      redraw() {},
      setCursorSprite() {}
    };
    view.updateQuery = () => {};
    view.applyLevelViewport = () => {};
    await view.loadEditorPreviewLevel({ preserveView: true, suspend: false });
  });

  it('enables input and pan when not in editor mode', async function() {
    globalThis.window = { location: { search: '' }, clearTimeout() {} };
    globalThis.history = { replaceState() {} };
    const view = new GameView();
    view.autoMoveTimer = 1;
    view.createBlankEditorLevel({ render: false });
    view.editorMode = false;
    view.editorPlaytest = false;
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
          cheat() {},
          inputEnabled: false
        };
      }
    };
    view.stage = {
      panEnabled: false,
      gameImgProps: { viewPoint: { x: 1, y: 2, scale: 1 }, canvasViewportSize: { width: 10, height: 10 } },
      getGameDisplay() { return { clear() {}, initSize() {}, setBackground() {} }; },
      getGuiDisplay() { return {}; },
      resetFade() {},
      updateStageSize() {},
      applyViewport() {},
      redraw() {},
      setCursorSprite() {}
    };
    view.updateQuery = () => {};
    view.applyLevelViewport = () => {};
    await view.loadEditorPreviewLevel({ preserveView: false, suspend: false });
    expect(view.game.inputEnabled).to.equal(true);
    expect(view.stage.panEnabled).to.equal(true);
  });
});
