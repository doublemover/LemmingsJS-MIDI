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
  });

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
    globalThis.window = { location: { search: '' } };
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
    globalThis.window = { location: { search: '' } };
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
});
