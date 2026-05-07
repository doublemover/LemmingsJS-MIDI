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

  it('handles game end and replay flow', async function() {
    globalThis.window = {
      location: { search: '' },
      setTimeout(cb) { cb(); return 1; },
      clearTimeout() {}
    };
    setDependency('GameStateTypes', {
      UNKNOWN: 0,
      SUCCEEDED: 1,
      toString() { return 'SUCCEEDED'; }
    });
    const view = new GameView();
    view.stage = { startFadeOut() { view.faded = true; } };
    view.elementGameState = { innerText: '' };
    view.moveToLevel = (delta) => { view.moved = delta; };
    view.onGameEnd({ state: 1 });
    expect(view.faded).to.equal(true);
    expect(view.moved).to.equal(1);

    view.start = async () => { view.started = true; };
    await view.loadReplay('abc');
    expect(view.started).to.equal(true);
  });

  it('covers MIDI config loading and setters', async function() {
    setDependency('GameFactory', class {
      constructor() {
        this.fileProvider = { loadString: async () => '{}' };
      }
    });
    setDependency('KeyboardShortcuts', class { constructor() {} dispose() {} });
    const view = new GameView();
    const mapping = await view._loadMidiMapping();
    expect(mapping).to.be.instanceOf(MidiMapping);
    expect(view.getMidiBaseConfig()).to.be.an('object');
    expect(view.getMidiSchemaHash()).to.be.a('string');

    view.midiRouter = { setOutput(out) { this.output = out; } };
    view.midiOut = { id: 'dev' };
    expect(view.midiRouter.output).to.eql({ id: 'dev' });
  });

  it('toggles editor mode and creates editor levels', function() {
    globalThis.window = { location: { search: '' } };
    const view = new GameView();
    view.stage = { panEnabled: true };
    view.game = { inputEnabled: true, getGameTimer() { return { isRunning() { return false; } }; } };

    view.toggleEditorMode();
    expect(view.editorMode).to.equal(true);
    view.toggleEditorMode();
    expect(view.editorMode).to.equal(false);

    const blank = view.createBlankEditorLevel({ render: false });
    expect(blank).to.equal(view.editorSession.level);
    const fromText = view.loadEditorLevelFromText('LEVEL', { render: false });
    expect(fromText).to.equal(view.editorSession.level);
    expect(blank).to.not.equal(fromText);
  });

  it('starts with custom levels and refreshes saved lists', async function() {
    const view = new GameView();
    view.gameResources = {};
    view.stage = {
      getGameDisplay() { return {}; },
      getGuiDisplay() { return {}; },
      setCursorSprite() {}
    };
    view.applyLevelViewport = () => { view.viewportApplied = true; };
    view.elementGameState = { innerText: '' };
    view.gameSpeedFactor = 2;
    view.gameFactory = {
      async getGame() {
        return {
          level: { name: 'Custom' },
          soundEvents: {},
          onGameEnd: new EventHandler(),
          getGameTimer() { return { speedFactor: 0 }; },
          loadLevel() {},
          setGameDisplay() {},
          setGuiDisplay() {},
          start() { view.customStarted = true; },
          cheat() { view.customCheat = true; }
        };
      }
    };
    view.cheatEnabled = true;
    await view._startWithLevel({ name: 'Custom' });
    expect(view.customStarted).to.equal(true);

    view.includeSavedLevels = true;
    view.gameResources.getLevelGroups = () => ['One'];
    view._getSavedLevelEntries = () => ([{ id: 'a', name: 'Saved' }]);
    view._syncLevelGroupSelect = async () => { view.synced = true; };
    view.populateLevelSelect = async () => { view.populated = true; };
    view._isSavedGroupIndex = () => true;
    view.loadSavedLevelFromSelection = async () => { view.savedLoaded = true; };
    await view.refreshSavedLevels();
    expect(view.savedLoaded).to.equal(true);
  });

  it('covers editor preview early exits and classic reader checks', async function() {
    globalThis.window = { location: { search: '' }, clearTimeout() {} };
    const view = new GameView();
    view.gameFactory = { async getConfig() { return { gametype: 1, level: { order: [] } }; } };
    view.gameResources = { config: null };
    view.editorSession = { level: {} };
    view.game = { stop() { view.stopped = true; } };
    view.midiRouter = { detach() { view.detached = true; } };
    view.elementGameState = { innerText: '' };
    const preview = await view.loadEditorPreviewLevel();
    expect(preview).to.equal(null);
    expect(view.stopped).to.equal(true);

    const none = await view._loadClassicLevelReader(1, 0, 0);
    expect(none).to.equal(null);

    view.gameFactory = {
      fileProvider: {},
      async getConfig() { return null; }
    };
    const none2 = await view._loadClassicLevelReader(1, 0, 0);
    expect(none2).to.equal(null);

    view.gameFactory = {
      fileProvider: { loadBinary: async () => new Uint8Array(0) },
      async getConfig() {
        return { path: '.', level: { order: [[]], filePrefix: 'L' } };
      }
    };
    const none3 = await view._loadClassicLevelReader(1, 5, 5);
    expect(none3).to.equal(null);
  });

  it('covers bench routines and sequence setup', async function() {
    setDependency('TriggerTypes', {
      DROWN: 1,
      FRYING: 2,
      KILL: 3,
      TRAP: 4
    });
    setDependency('Lemming', class { static LEM_MAX_FALLING = 20; });
    const view = new GameView();
    view.loadLevel = async () => {};
    view.configs = [{ gametype: view.gameType, name: 'Pack' }];
    view._getSavedLevelEntries = () => [];

    const level = {
      width: 20,
      height: 20,
      name: 'Bench',
      entrances: [{ x: 2, y: 2 }],
      triggers: [],
      getGroundMaskLayer() {
        return {
          hasGroundAt() { return false; },
          countMaskInRect() { return 0; }
        };
      }
    };
    const lm = {
      spawnCount: 0,
      spawnTotal: 0,
      getLemmings() { return []; }
    };
    const timer = {
      speedFactor: 1,
      benchStartupFrames: 0,
      benchStableFactor: 0,
      TIME_PER_FRAME_MS: 60,
      getGameTime() { return 0; },
      eachGameSecond: new EventHandler(),
      suspend() {}
    };
    view.game = {
      level,
      getLemmingManager() { return lm; },
      getGameTimer() { return timer; },
      getVictoryCondition() { return { releaseRate: 1, getMinReleaseRate() { return 1; } }; }
    };
    view.stage = { applyLevelViewport() {} };
    view.applyLevelViewport = () => { view.viewportApplied = true; };
    view._benchCounts = [1];

    await view.benchStart(1);
    expect(timer.speedFactor).to.equal(6);
    expect(timer.benchStartupFrames).to.equal(120);

    const timer2 = {
      speedFactor: 10,
      benchStartupFrames: 0,
      benchStableFactor: 0,
      getGameTime() { return 120; },
      eachGameSecond: new EventHandler(),
      suspend() { view.suspended = true; }
    };
    const lm2 = { spawnTotal: 0, spawnCount: 1 };
    view.game = {
      level,
      getLemmingManager() { return lm2; },
      getVictoryCondition() { return { getMinReleaseRate() { return 1; }, releaseRate: 1 }; },
      getGameTimer() { return timer2; }
    };
    const extrasPromise = view.benchMeasureExtras();
    await Promise.resolve();
    timer2.eachGameSecond.trigger();
    const extras = await extrasPromise;
    expect(extras).to.equal(0);
    expect(view.suspended).to.equal(true);

    view.benchMeasureExtras = async () => 2;
    view.benchStart = async () => { view.sequenceStarted = true; };
    await view.benchSequenceStart();
    expect(view.sequenceStarted).to.equal(true);
  });

  it('short-circuits start and controls when no game is active', async function() {
    const view = new GameView();
    view.gameFactory = null;
    await view.start();
    view.cheat();
    view.suspend();
    view.continue();
    view.suspendWithColor('red');
    view.nextFrame();
    view.prevFrame();
    view.selectSpeedFactor(3);
    view.enableDebug();
  });

  it('continues when start is called with an existing game', async function() {
    const view = new GameView();
    let continued = false;
    view.game = { getGameTimer() { return { continue() { continued = true; } }; } };
    view.continue = () => { continued = true; };
    await view.start();
    expect(continued).to.equal(true);
  });

  it('handles game end for non-success results', function() {
    globalThis.window = {
      location: { search: '' },
      setTimeout(cb) { cb(); return 1; }
    };
    setDependency('GameStateTypes', {
      UNKNOWN: 0,
      SUCCEEDED: 1,
      toString() { return 'FAILED'; }
    });
    const view = new GameView();
    view.stage = { startFadeOut() {} };
    view.elementGameState = { innerText: '' };
    view.moveToLevel = delta => { view.moved = delta; };
    view.onGameEnd({ state: 0 });
    expect(view.moved).to.equal(0);
  });

  it('uses global timer fallback when handling game end without window timers', function() {
    globalThis.window = { location: { search: '' } };
    const originalSetTimeout = globalThis.setTimeout;
    try {
      let timeoutCb = null;
      globalThis.setTimeout = (cb) => {
        timeoutCb = cb;
        return 33;
      };
      setDependency('GameStateTypes', {
        UNKNOWN: 0,
        SUCCEEDED: 1,
        toString() { return 'SUCCEEDED'; }
      });
      const view = new GameView();
      view.stage = { startFadeOut() {} };
      view.elementGameState = { innerText: '' };
      view.moveToLevel = delta => { view.moved = delta; };

      globalThis.window = undefined;
      view.onGameEnd({ state: 1 });
      expect(view.autoMoveTimer).to.equal(33);
      timeoutCb();
      expect(view.moved).to.equal(1);
      expect(view.autoMoveTimer).to.equal(null);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
  });

  it('formats MIDI errors for security and empty messages', function() {
    globalThis.window = { isSecureContext: true, location: { protocol: 'https:', hostname: 'example.com', search: '' } };
    const view = new GameView();
    expect(view._formatMidiEnableError({ name: 'SecurityError', message: 'secure context' }))
      .to.equal('WebMIDI requires HTTPS or localhost.');
    expect(view._formatMidiEnableError(''))
      .to.equal('WebMIDI enable failed.');
  });

  it('reports WebMidi enable failures', async function() {
    globalThis.window = { isSecureContext: true, location: { protocol: 'https:', hostname: 'example.com', search: '' } };
    let errorMessage = null;
    globalThis.WebMidi = {
      enabled: false,
      enable: async () => { throw new Error('boom'); }
    };
    const view = new GameView();
    view.setMidiStatusHandlers({ onError: msg => { errorMessage = msg; } });
    const result = await view._ensureWebMidiEnabled();
    expect(result).to.equal(null);
    expect(errorMessage).to.contain('WebMIDI enable failed');
  });

  it('attaches MIDI routing when enabled and game has sound events', async function() {
    const view = new GameView();
    view.game = { soundEvents: {}, getGameTimer() { return { continue() {} }; } };
    view.stage = {};
    view.midiRouter = { attach() {}, detach() {}, scheduler: { allNotesOff() {} } };
    view.initMidiRouting = async () => view.midiRouter;
    await view.setMidiEnabled(true);
  });

  it('covers helper branches for selection utilities', function() {
    const view = new GameView();
    view.includeSavedLevels = true;
    view.gameResources = { getLevelGroups() { return []; } };
    expect(view._getGroupLength({}, 0, 0, [{ id: 'a' }])).to.equal(1);

    view.levelGroupIndex = 2;
    view.levelIndex = 3;
    view._normalizeSelection({}, []);
    expect(view.levelGroupIndex).to.equal(0);
    expect(view.levelIndex).to.equal(0);

    const config = { level: { order: [[1]], getGroupLength() { return 1; } } };
    view.levelGroupIndex = 0;
    view.levelIndex = 5;
    view._normalizeSelection(config, []);
    expect(view.levelIndex).to.equal(0);

    view.arrayToSelect(null, ['A']);
    view.changeHtmlText(null, 'hi');
  });

  it('handles empty saved lists and editor selections', async function() {
    stubDocument();
    const view = new GameView();
    view.elementSelectLevel = makeSelect();
    view.gameResources = { getLevelGroups() { return ['One']; } };
    view.gameFactory = { async getConfig() { return { level: { getGroupLength() { return 0; } } }; } };
    view._getSavedLevelEntries = () => [];
    view._isSavedGroupIndex = () => true;
    view.levelGroupIndex = 0;
    view.levelIndex = 3;
    await view.populateLevelSelect();
    expect(view.levelIndex).to.equal(0);

    view.editorMode = true;
    view.autoExitEditorOnSelect = true;
    view.exitEditorMode = () => { view.exited = true; };
    view.loadEditorLevelFromSelection = async () => { view.loadedEditor = true; };
    view.gameFactory = {
      async getGameResources() { return { getLevelGroups() { return ['One']; } }; },
      async getConfig() { return { level: { getGroupLength() { return 0; } } }; }
    };
    view.configs = [{ gametype: 1 }];
    await view.selectGameType(0);
    expect(view.exited).to.equal(true);
    expect(view.loadedEditor).to.equal(true);
  });

  it('updates bench setup when enabled', async function() {
    stubDocument();
    const view = new GameView();
    view.benchSequence = true;
    view.applyQuery = () => {};
    view._loadMidiMapping = async () => new MidiMapping({ position: {} });
    view.gameFactory = {
      configReader: { configs: [{ gametype: 1, name: 'Pack' }] },
      async getGameResources() { return { getLevelGroups() { return ['One']; } }; }
    };
    view.elementSelectGameType = makeSelect();
    view._syncLevelGroupSelect = async () => {};
    view.populateLevelSelect = async () => {};
    view.loadLevel = async () => {};
    view.benchSequenceStart = async () => { view.benchRan = true; };
    await view.setup();
    expect(view.benchRan).to.equal(true);
  });
});
