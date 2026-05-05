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

  it('starts a game session and applies options', async function() {
    globalThis.window = { location: { search: '?benchSequence=true' } };
    globalThis.history = { replaceState() {} };
    setDependency('GameFactory', class {
      constructor() {}
      async getGame() {
        const timer = { speedFactor: 0 };
        const history = {
          setPreserveFutureHistory(val) { this.enabled = val; },
          configureRetention(policy) {
            this.retention = { ...policy };
            return this.retention;
          }
        };
        const game = {
          level: { name: 'Level', entrances: [{ x: 0, y: 0 }] },
          history,
          timeTravel: {
            setHistoryRetention(policy) {
              this.retention = { ...policy };
              return this.retention;
            }
          },
          onGameEnd: new EventHandler(),
          setGameDisplay(display) { this.gameDisplay = display; },
          setGuiDisplay(display) { this.guiGuiDisplay = display; },
          getGameTimer() { return timer; },
          start() { this.started = true; },
          loadLevel() {},
          cheat() { this.cheated = true; }
        };
        return game;
      }
    });
    setDependency('KeyboardShortcuts', class { constructor() {} dispose() {} });

    const view = new GameView();
    view.gameResources = {};
    view.stage = {
      getGameDisplay() { return { id: 'game' }; },
      getGuiDisplay() { return { id: 'gui' }; },
      setCursorSprite() {},
    };
    view.applyLevelViewport = () => { view.viewportApplied = true; };
    view.elementGameState = { innerText: '' };
    view.preserveHistory = true;
    view.cheatEnabled = true;
    view.debug = true;
    view.midiEnabled = true;
    view.initMidiRouting = async () => {
      view.midiRouter = { attach() { view.attached = true; } };
      return view.midiRouter;
    };

    await view.start();
    expect(view.game.started).to.equal(true);
    expect(view.game.history.enabled).to.equal(true);
    expect(view.game.timeTravel.retention).to.deep.include({
      enableHistoryCap: true,
      historyCapTicks: 12000,
      historyWarnTicks: 9000,
      preserveFutureHistory: true
    });
    expect(view.getRuntimeDiagnostics().history.retention.historyCapTicks).to.equal(12000);
    expect(view.viewportApplied).to.equal(true);
    expect(view.game.cheated).to.equal(true);
    expect(view.game.showDebug).to.equal(true);
    expect(view.attached).to.equal(true);
  });

  it('handles saved level loading and editor text utilities', async function() {
    globalThis.window = { location: { search: '' } };
    const indexPayload = JSON.stringify([
      { id: 'lvl-1', name: 'Saved Level', updatedAt: 1 }
    ]);
    globalThis.localStorage = {
      getItem(key) {
        if (key === 'lemmings.editor.levels') return indexPayload;
        if (key === 'lemmings.editor.level.lvl-1') return 'LEVELDATA';
        return null;
      },
      setItem() {},
      removeItem() {}
    };

    const view = new GameView();
    view.includeSavedLevels = true;
    view.levelIndex = 0;
    view.gameResources = {};
    view.autoExitEditorOnSelect = true;
    view.editorMode = true;
    view.exitEditorMode = () => { view.exited = true; };
    view.loadEditorPreviewLevel = async () => 'preview';

    const result = await view.loadSavedLevelFromSelection();
    expect(result).to.equal('preview');
    expect(view.exited).to.equal(true);
    expect(view.getEditorLevelText()).to.be.a('string');
    expect(view.getEditorLevelTitle()).to.equal('Untitled');
  });

  it('initializes MIDI routing with overrides', async function() {
    globalThis.window = { location: { search: '' } };
    globalThis.WebMidi = { enabled: true, outputs: [{ id: 'out' }] };
    setDependency('MidiEventRouter', class {
      constructor(mapping) { this.mapping = mapping; this.scheduler = { allNotesOff() {} }; }
      setOutput(output) { this.output = output; }
      setMapping(mapping) { this.mapping = mapping; }
      detach() { this.detached = true; }
      dispose() { this.disposed = true; }
    });
    const view = new GameView();
    view.setMidiOverrides({ position: { viewPan: true } });
    view._ensureWebMidiEnabled = async () => ({ enabled: true, outputs: [{ id: 'out' }] });
    view._loadMidiMapping = async () => {
      view._midiBaseConfig = { position: {} };
      return new MidiMapping({ position: {} });
    };
    view.midiEnabled = true;

    const router = await view.initMidiRouting();
    expect(router).to.equal(view.midiRouter);
    expect(view.midiOut).to.eql({ id: 'out' });
    expect(view.getMidiConfig().position.viewPan).to.equal(true);
  });

  it('disables MIDI routing cleanly', async function() {
    const view = new GameView();
    let detached = 0;
    let allNotesOff = 0;
    view.midiRouter = {
      detach() { detached += 1; },
      scheduler: { allNotesOff() { allNotesOff += 1; } }
    };
    await view.setMidiEnabled(false);
    expect(detached).to.equal(1);
    expect(allNotesOff).to.equal(1);
  });

  it('covers helpers and selection utilities', async function() {
    stubDocument();
    globalThis.window = { location: { search: '' } };
    const view = new GameView();
    const select = makeSelect();
    select.options.push({ value: '1' }, { value: '2' });
    view.clearHtmlList(select);
    expect(select.options.length).to.equal(0);

    expect(view.prefixNumbers(['A', 'B'])).to.eql(['1 - A', '2 - B']);
    expect(view.strToNum('5')).to.equal(5);
    expect(view.strToNum('nope')).to.equal(0);

    view.arrayToSelect(select, ['X', 'Y']);
    expect(select.options.length).to.equal(2);

    view.gameResources = { getLevelGroups() { return ['One', 'Two']; } };
    view.includeSavedLevels = true;
    const groups = view._getGroupNames([{ id: 'a', name: 'Saved' }]);
    expect(groups).to.eql(['One', 'Two', 'Saved Levels']);

    const config = {
      level: {
        order: [[1], []],
        getGroupLength(index) {
          return index === 0 ? 1 : 0;
        }
      }
    };
    view.levelGroupIndex = 1;
    view.levelIndex = 4;
    view._normalizeSelection(config, []);
    expect(view.levelGroupIndex).to.equal(0);
    expect(view.levelIndex).to.equal(0);

    const emptyConfig = {
      level: { order: [[], []], getGroupLength() { return 0; } }
    };
    view.levelGroupIndex = 1;
    view.levelIndex = 2;
    view._normalizeSelection(emptyConfig, []);
    expect(view.levelGroupIndex).to.equal(0);
    expect(view.levelIndex).to.equal(0);

    view.elementSelectLevelGroup = select;
    view.gameFactory = { async getConfig() { return config; } };
    await view._syncLevelGroupSelect([]);
    expect(view.elementSelectLevelGroup.selectedIndex).to.equal(0);

    const stageImage = {
      viewPoint: { scale: 2 },
      canvasViewportSize: { width: 100, height: 50 }
    };
    const focus = view.getEntranceFocusX({ entrances: [{ x: 10, y: 0 }] }, stageImage);
    expect(focus).to.equal(9);
  });

  it('falls back to entrance focus when applying viewport without saved screen position', function() {
    const view = new GameView();
    let appliedX = null;
    let redraws = 0;
    view.stage = {
      gameImgProps: {
        viewPoint: { scale: 2 },
        canvasViewportSize: { width: 100, height: 50 }
      },
      applyViewport(_stageImage, x) {
        appliedX = x;
      },
      redraw() {
        redraws += 1;
      }
    };

    view.applyLevelViewport({
      screenPositionX: Number.NaN,
      entrances: [{ x: 10, y: 0 }]
    });

    expect(appliedX).to.equal(9);
    expect(redraws).to.equal(1);

    view.applyLevelViewport({
      screenPositionX: 42,
      entrances: [{ x: 10, y: 0 }]
    });

    expect(appliedX).to.equal(42);
    expect(redraws).to.equal(2);
  });

  it('populates level selections for saved and missing levels', async function() {
    stubDocument();
    const view = new GameView();
    view.elementSelectLevel = makeSelect();
    view.gameFactory = {
      async getConfig() {
        return { level: { getGroupLength() { return 2; } } };
      }
    };
    view.gameResources = {
      getLevelGroups() { return ['One']; },
      async getLevel(_group, index) {
        if (index === 0) return { name: 'Alpha' };
        throw new Error('missing');
      }
    };

    view.includeSavedLevels = true;
    view.levelGroupIndex = 1;
    view._getSavedLevelEntries = () => ([{ id: 's1', name: 'Saved' }]);
    await view.populateLevelSelect();
    expect(view.elementSelectLevel.options.length).to.equal(1);

    view.includeSavedLevels = false;
    view.levelGroupIndex = 0;
    await view.populateLevelSelect();
    expect(view.elementSelectLevel.options.length).to.equal(2);
  });

  it('selects levels, groups, and game types', async function() {
    const view = new GameView();
    view.gameResources = { getLevelGroups() { return ['One']; } };
    view._getSavedLevelEntries = () => [];
    view.populateLevelSelect = async () => { view.populated = true; };
    view.loadLevel = () => { view.loaded = true; };

    await view.selectLevelGroup(5);
    expect(view.levelGroupIndex).to.equal(0);
    expect(view.loaded).to.equal(true);

    view.editorMode = true;
    view.autoExitEditorOnSelect = true;
    view.exitEditorMode = () => { view.exited = true; };
    view.loadEditorLevelFromSelection = async () => { view.editorLoaded = true; };
    await view.selectLevelGroup(0);
    expect(view.exited).to.equal(true);
    expect(view.editorLoaded).to.equal(true);

    view.editorMode = false;
    view.configs = [{ gametype: 2, name: 'Pack' }];
    view.gameFactory = {
      async getGameResources() { return { getLevelGroups() { return ['One']; } }; },
      async getConfig() { return { level: { getGroupLength() { return 0; } } }; }
    };
    view._syncLevelGroupSelect = async () => { view.synced = true; };
    view.populateLevelSelect = async () => { view.levelsPopulated = true; };
    await view.selectGameType(0);
    expect(view.gameType).to.equal(2);
    expect(view.synced).to.equal(true);
    expect(view.levelsPopulated).to.equal(true);

    view.editorMode = true;
    view.loadEditorLevelFromSelection = async () => { view.editorPicked = true; };
    await view.selectLevel(3);
    expect(view.levelIndex).to.equal(3);
    expect(view.editorPicked).to.equal(true);
  });

  it('runs setup and setupEditor flows', async function() {
    stubDocument();
    globalThis.window = { location: { search: '' } };
    const view = new GameView();
    view._loadMidiMapping = async () => new MidiMapping({ position: {} });
    view.setMidiOverrides({ position: { viewPan: true } });
    view.gameFactory = {
      configReader: { configs: [{ gametype: 1, name: 'Pack' }] },
      async getGameResources() {
        return { getLevelGroups() { return ['One']; } };
      }
    };
    view.elementSelectGameType = makeSelect();
    view._syncLevelGroupSelect = async () => { view.groupSynced = true; };
    view.populateLevelSelect = async () => { view.levelsSynced = true; };
    view.loadLevel = async () => { view.didLoad = true; };
    view.benchSequenceStart = async () => { view.benchRan = true; };

    await view.setup();
    expect(view.groupSynced).to.equal(true);
    expect(view.levelsSynced).to.equal(true);
    expect(view.didLoad).to.equal(true);
    await view.benchSequenceStart();
    expect(view.benchRan).to.equal(true);

    view.benchSequence = false;
    view.populateLevelSelect = async () => { view.editorLevels = true; };
    await view.setupEditor();
    expect(view.editorLevels).to.equal(true);
  });

  it('covers simple gameplay controls and canvas setup', async function() {
    const events = [];
    globalThis.window = {
      location: { search: '' },
      addEventListener(type) { events.push(type); },
      removeEventListener(type) { events.push(`remove:${type}`); }
    };
    setDependency('Stage', class {
      constructor() { this.disposed = false; }
      scheduleUpdateStageSize() { this.scheduled = true; }
      dispose() { this.disposed = true; }
    });
    const view = new GameView();
    view.gameCanvas = {};
    expect(events).to.include('resize');
    view.gameCanvas = {};
    expect(events).to.include('remove:resize');

    let speed = 1;
    const timer = {
      suspendCalls: 0,
      continueCalls: 0,
      suspend() { this.suspendCalls += 1; },
      continue() { this.continueCalls += 1; },
      speedFactor: speed
    };
    view.game = {
      getGameTimer() { return timer; },
      setDebugMode(on) { this.debugOn = on; }
    };

    view.suspend();
    view.continue();
    view.selectSpeedFactor(3);
    view.enableDebug();
    view.playMusic();
    view.stopMusic();
    view.stopSound();
    view.playSound();

    expect(timer.suspendCalls).to.equal(1);
    expect(timer.continueCalls).to.equal(1);
    expect(timer.speedFactor).to.equal(3);
    expect(view.game.debugOn).to.equal(true);
  });

  it('sets game canvas safely when window listeners are unavailable', function() {
    globalThis.window = { location: { search: '' } };
    setDependency('Stage', class {
      scheduleUpdateStageSize() {}
      dispose() {}
    });
    const view = new GameView();
    globalThis.window = undefined;

    expect(() => {
      view.gameCanvas = {};
      view.gameCanvas = {};
    }).to.not.throw();
  });
});
