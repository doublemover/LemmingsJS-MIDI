import { expect } from 'chai';
import { GameView } from '../js/game/GameView.js';
import { MidiMapping } from '../js/midi/MidiMapping.js';
import { EventHandler } from '../js/util/EventHandler.js';
import { setDependency, resetDependencies } from './helpers/lemmings.js';

describe('GameView coverage', function() {
  const originalWindow = globalThis.window;
  const originalHistory = globalThis.history;
  const originalLemmings = globalThis.lemmings;
  const originalWebMidi = globalThis.WebMidi;
  const originalOnMidiError = globalThis.onMidiError;
  const originalOnEnabled = globalThis.onEnabled;
  const originalLocalStorage = globalThis.localStorage;
  const originalDocument = globalThis.document;

  beforeEach(function() {
    setDependency('GameFactory', class { constructor() {} });
    setDependency('KeyboardShortcuts', class { constructor() {} dispose() {} });
  });

  afterEach(function() {
    resetDependencies();
    globalThis.window = originalWindow;
    globalThis.history = originalHistory;
    globalThis.lemmings = originalLemmings;
    globalThis.WebMidi = originalWebMidi;
    globalThis.onMidiError = originalOnMidiError;
    globalThis.onEnabled = originalOnEnabled;
    globalThis.localStorage = originalLocalStorage;
    globalThis.document = originalDocument;
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

  it('parses query params and updates history state', function() {
    globalThis.window = {
      location: { search: '?version=2&difficulty=2&level=3&speed=2.2&cheat=true&debug=true&bench=true&scale=0.5&shortcut=true' }
    };
    let replaced = null;
    globalThis.history = {
      replaceState(_state, _title, url) { replaced = url; }
    };

    const view = new GameView();
    expect(view.gameType).to.equal(2);
    expect(view.levelGroupIndex).to.equal(1);
    expect(view.levelIndex).to.equal(2);
    expect(view.gameSpeedFactor).to.equal(2);
    expect(view.cheatEnabled).to.equal(true);
    expect(view.benchReverse).to.equal(false);

    view.updateQuery();
    expect(replaced).to.include('?');
    expect(replaced).to.include('v=2');
    expect(replaced).to.include('d=2');
    expect(replaced).to.include('_=true');

    view.setHistoryState('a=1');
    expect(replaced).to.equal('?a=1');
  });

  it('formats MIDI errors and handles WebMidi enable', async function() {
    globalThis.window = { isSecureContext: false, location: { protocol: 'http:', hostname: 'example.com', search: '' } };
    const view = new GameView();
    expect(view._formatMidiEnableError({})).to.equal('WebMIDI requires HTTPS or localhost.');
    globalThis.window.isSecureContext = true;
    globalThis.window.location.protocol = 'https:';
    expect(view._formatMidiEnableError({ name: 'NotAllowedError', message: 'permission' }))
      .to.equal('WebMIDI permission denied. Check browser permissions.');
    expect(view._formatMidiEnableError({ name: 'NotSupportedError' }))
      .to.equal('WebMIDI is not supported in this browser.');

    let errorMessage = null;
    globalThis.onMidiError = msg => { errorMessage = msg; };
    const missing = await view._ensureWebMidiEnabled();
    expect(missing).to.equal(null);
    expect(errorMessage).to.include('not supported');

    let enabledCalled = false;
    let onEnabledCalled = false;
    globalThis.onEnabled = () => { onEnabledCalled = true; };
    globalThis.WebMidi = {
      enabled: false,
      enable: async () => { enabledCalled = true; },
      outputs: []
    };
    const view2 = new GameView();
    const enabled = await view2._ensureWebMidiEnabled();
    expect(enabled).to.equal(globalThis.WebMidi);
    expect(enabledCalled).to.equal(true);
    expect(onEnabledCalled).to.equal(true);
  });

  it('advances and rewinds frames', function() {
    const view = new GameView();
    let rendered = 0;
    let truncated = null;
    const timer = {
      tickIndex: 7,
      tickCalls: [],
      tick(step) { this.tickCalls.push(step); this.tickIndex += step; }
    };
    view.game = {
      getGameTimer() { return timer; },
      history: { truncateAfter(idx) { truncated = idx; } },
      timeTravel: { isReversing: true, stopReverse() { this.stopped = true; } },
      gameGui: { gameTimeChanged: false },
      render() { rendered += 1; }
    };

    view.nextFrame();
    expect(view.game.timeTravel.stopped).to.equal(true);
    expect(truncated).to.equal(7);
    expect(timer.tickCalls[0]).to.equal(1);
    expect(view.game.gameGui.gameTimeChanged).to.equal(true);
    expect(rendered).to.equal(1);

    view.game.timeTravel = { stepBackward(step) { this.step = step; } };
    view.prevFrame();
    expect(view.game.timeTravel.step).to.equal(1);
  });

  it('suspends with overlay and resumes', function() {
    globalThis.window = {
      location: { search: '' },
      setTimeout(cb) { cb(); return 1; },
      clearTimeout() {}
    };
    const view = new GameView();
    const timer = {
      suspendCalls: 0,
      continueCalls: 0,
      suspend() { this.suspendCalls += 1; },
      continue() { this.continueCalls += 1; }
    };
    const overlay = { color: null, rect: null };
    view.stage = {
      guiImgProps: { viewPoint: { scale: 2 }, x: 0, y: 0 },
      startOverlayFade(color, rect) { overlay.color = color; overlay.rect = rect; }
    };
    view.game = { getGameTimer() { return timer; } };
    view.bench = true;
    view.suspendWithColor('red');
    expect(timer.suspendCalls).to.equal(1);
    expect(timer.continueCalls).to.equal(1);
    expect(overlay.color).to.equal('red');
    expect(overlay.rect.width).to.equal(32);
  });

  it('toggles editor playtest state', function() {
    const view = new GameView();
    const timer = {
      running: true,
      isRunning() { return this.running; },
      suspendCalls: 0,
      continueCalls: 0,
      suspend() { this.suspendCalls += 1; },
      continue() { this.continueCalls += 1; }
    };
    view.stage = { panEnabled: true };
    view.game = { inputEnabled: true, getGameTimer() { return timer; } };

    view.enterEditorMode();
    expect(view.editorMode).to.equal(true);
    expect(view.stage.panEnabled).to.equal(false);
    expect(view.game.inputEnabled).to.equal(false);

    view.setEditorPlaytest(true);
    expect(timer.continueCalls).to.equal(1);
    expect(view.stage.panEnabled).to.equal(true);
    expect(view.game.inputEnabled).to.equal(true);

    view.setEditorPlaytest(false);
    expect(timer.suspendCalls).to.equal(2);
    expect(view.stage.panEnabled).to.equal(false);
    expect(view.game.inputEnabled).to.equal(false);

    view.exitEditorMode();
    expect(timer.continueCalls).to.equal(2);
    expect(view.stage.panEnabled).to.equal(true);
    expect(view.game.inputEnabled).to.equal(true);
  });

  it('loads and renders levels when not using saved entries', async function() {
    globalThis.window = { location: { search: '?benchSequence=true' } };
    globalThis.history = { replaceState() {} };
    const view = new GameView();
    const level = {
      screenPositionX: 6,
      renderCalls: 0,
      render() { this.renderCalls += 1; }
    };
    const gameDisplay = { clearCalls: 0, clear() { this.clearCalls += 1; } };
    const stage = {
      resetFadeCalls: 0,
      updateCalls: 0,
      applied: null,
      redrawn: 0,
      gameImgProps: { viewPoint: { scale: 1 }, canvasViewportSize: { width: 10, height: 10 } },
      getGameDisplay() { return gameDisplay; },
      resetFade() { this.resetFadeCalls += 1; },
      updateStageSize() { this.updateCalls += 1; },
      applyViewport(...args) { this.applied = args; },
      redraw() { this.redrawn += 1; }
    };
    let started = false;
    view.start = async () => { started = true; };
    view.stage = stage;
    view.gameResources = {
      getLevelGroups() { return ['Only']; },
      async getLevel() { return level; }
    };
    view.configs = [{ gametype: view.gameType }];
    view.elementGameState = { innerText: '' };
    view.elementSelectGameType = { selectedIndex: -1 };
    view.elementSelectLevelGroup = { selectedIndex: -1 };
    view.elementSelectLevel = { selectedIndex: -1 };

    await view.loadLevel();
    expect(gameDisplay.clearCalls).to.equal(1);
    expect(stage.resetFadeCalls).to.equal(1);
    expect(level.renderCalls).to.equal(1);
    expect(stage.updateCalls).to.equal(1);
    expect(stage.applied).to.not.equal(null);
    expect(stage.redrawn).to.equal(1);
    expect(started).to.equal(true);
  });

  it('routes loadLevel to saved selections', async function() {
    globalThis.window = { location: { search: '' } };
    const view = new GameView();
    view.applyQuery = () => {};
    view.includeSavedLevels = true;
    view.gameResources = { getLevelGroups() { return []; } };
    view._getSavedLevelEntries = () => ([{ id: 'one', name: 'Saved' }]);
    view._isSavedGroupIndex = () => true;
    let called = false;
    view.loadSavedLevelFromSelection = async () => { called = true; return 'saved'; };
    const result = await view.loadLevel();
    expect(called).to.equal(true);
    expect(result).to.equal('saved');
  });

  it('starts a game session and applies options', async function() {
    globalThis.window = { location: { search: '?benchSequence=true' } };
    globalThis.history = { replaceState() {} };
    setDependency('GameFactory', class {
      constructor() {}
      async getGame() {
        const timer = { speedFactor: 0 };
        const history = { setPreserveFutureHistory(val) { this.enabled = val; } };
        const game = {
          level: { name: 'Level', entrances: [{ x: 0, y: 0 }] },
          history,
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
    expect(view.viewportApplied).to.equal(true);
    expect(view.game.cheated).to.equal(true);
    expect(view.game.showDebug).to.equal(true);
    expect(view.attached).to.equal(true);
  });

  it('handles saved level loading and editor text utilities', async function() {
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
    globalThis.lemmingsMidiOverrides = { position: { viewPan: false } };
    globalThis.lemmingsMidiViewPan = true;
    globalThis.WebMidi = { enabled: true, outputs: [{ id: 'out' }] };
    setDependency('MidiEventRouter', class {
      constructor(mapping) { this.mapping = mapping; this.scheduler = { allNotesOff() {} }; }
      setOutput(output) { this.output = output; }
      setMapping(mapping) { this.mapping = mapping; }
      detach() { this.detached = true; }
      dispose() { this.disposed = true; }
    });
    const view = new GameView();
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
    view.gameFactory = { async getGameResources() { return {}; } };
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
    globalThis.lemmingsMidiOverrides = { position: { viewPan: true } };
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
});
