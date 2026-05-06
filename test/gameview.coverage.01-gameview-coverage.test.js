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

  it('parses query params and updates history state', function() {
    globalThis.window = {
      location: { search: '?version=2&difficulty=2&level=3&speed=2.2&cheat=true&debug=true&bench=true&scale=0.5&shortcut=true&profile=perf&offscreenPresent=true&workerOffscreen=true' }
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
    expect(view.startupProfile).to.equal('perf');
    expect(view.performanceAPI).to.equal(true);
    expect(view.perfOverlay).to.equal(true);
    expect(view.offscreenPresentExperiment).to.equal(true);
    expect(view.workerOffscreenExperiment).to.equal(true);

    view.updateQuery();
    expect(replaced).to.include('?');
    expect(replaced).to.include('v=2');
    expect(replaced).to.include('d=2');
    expect(replaced).to.include('_=true');
    expect(replaced).to.include('pr=perf');

    view.setHistoryState('a=1');
    expect(replaced).to.equal('?a=1');
  });

  it('parses shorthand and numeric boolean query flags', function() {
    globalThis.window = {
      location: { search: '?bench&debug=1&cheat=yes&bench2=0&endless=off' }
    };
    const view = new GameView();
    expect(view.bench).to.equal(true);
    expect(view.debug).to.equal(true);
    expect(view.cheatEnabled).to.equal(true);
    expect(view.bench2).to.equal(false);
    expect(view.endless).to.equal(false);
  });

  it('applies query bounds before multipliers for scaled values', function() {
    globalThis.window = {
      location: { search: '?nukeAfter=20&extra=0' }
    };
    const inRange = new GameView();
    expect(inRange.nukeAfter).to.equal(200);
    expect(inRange.extraLemmings).to.equal(0);

    globalThis.window = {
      location: { search: '?nukeAfter=61' }
    };
    const outOfRange = new GameView();
    expect(outOfRange.nukeAfter).to.equal(0);
  });

  it('applies rollout rollback toggles for render and history codec paths', function() {
    globalThis.window = {
      location: {
        search: '?profile=perf&offscreenPresent=true&workerOffscreen=true&rollbackRenderPresent=1&rollbackHistoryCodec=1'
      }
    };
    const view = new GameView();
    expect(view.rolloutFlags.renderPresentPath).to.equal(false);
    expect(view.rolloutFlags.historyCodec).to.equal(false);
    expect(view.offscreenPresentExperiment).to.equal(false);
    expect(view.workerOffscreenExperiment).to.equal(false);
    const policy = view.resolveHistoryRetentionPolicy();
    expect(policy.coldBlockAgeTicks).to.equal(0);
    expect(policy.enableColdBlockCompression).to.equal(false);
    expect(policy.enableColdBlockDedupe).to.equal(false);
  });

  it('reports runtime diagnostics with normalized feature flags and cache stats', function() {
    globalThis.window = {
      location: { search: '' }
    };
    const view = new GameView();
    view.startupProfile = 'perf';
    view.debug = true;
    view.midiEnabled = true;
    view.bench = true;
    view.gameFactory = {
      fileProvider: {
        getCacheStats() {
          return { memoryEntries: 2, localStorageBytes: 10, indexedDbBytes: 11 };
        }
      }
    };

    const diagnostics = view.getRuntimeDiagnostics();
    expect(diagnostics.profile).to.equal('perf');
    expect(diagnostics.rolloutFlags).to.be.an('object');
    expect(diagnostics.capabilities).to.be.an('object');
    expect(diagnostics.featureFlags.debug).to.equal(true);
    expect(diagnostics.featureFlags.midiEnabled).to.equal(true);
    expect(diagnostics.featureFlags.bench).to.equal(true);
    expect(diagnostics.caches.fileProvider).to.deep.equal({
      memoryEntries: 2,
      localStorageBytes: 10,
      indexedDbBytes: 11
    });
  });

  runScenarioTable([
    {
      name: 'formats MIDI errors for insecure contexts',
      windowRef: { isSecureContext: false, location: { protocol: 'http:', hostname: 'example.com', search: '' } },
      input: {},
      expected: 'WebMIDI requires HTTPS or localhost.'
    },
    {
      name: 'formats MIDI errors for permission denials',
      windowRef: { isSecureContext: true, location: { protocol: 'https:', hostname: 'example.com', search: '' } },
      input: { name: 'NotAllowedError', message: 'permission' },
      expected: 'WebMIDI permission denied. Check browser permissions.'
    },
    {
      name: 'formats MIDI errors for unsupported browser APIs',
      windowRef: { isSecureContext: true, location: { protocol: 'https:', hostname: 'example.com', search: '' } },
      input: { name: 'NotSupportedError' },
      expected: 'WebMIDI is not supported in this browser.'
    }
  ], ({ windowRef, input, expected }) => {
    globalThis.window = windowRef;
    const view = new GameView();
    expect(view._formatMidiEnableError(input)).to.equal(expected);
  });

  it('handles WebMidi enable lifecycle', async function() {
    globalThis.window = { isSecureContext: true, location: { protocol: 'https:', hostname: 'example.com', search: '' } };
    const view = new GameView();

    let errorMessage = null;
    view.setMidiStatusHandlers({ onError: msg => { errorMessage = msg; } });
    const missing = await view._ensureWebMidiEnabled();
    expect(missing).to.equal(null);
    expect(errorMessage).to.include('not supported');

    let enabledCalled = false;
    let onEnabledCalled = false;
    globalThis.WebMidi = {
      enabled: false,
      enable: async () => { enabledCalled = true; },
      outputs: []
    };
    const view2 = new GameView();
    view2.setMidiStatusHandlers({ onEnabled: () => { onEnabledCalled = true; } });
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

  it('registers midi flag triggers and emits flag events', function() {
    const view = new GameView();
    const added = [];
    const emitted = [];
    const game = {
      level: {
        midiFlags: [
          { id: 4, x1: 2, y1: 3, x2: 8, y2: 9, cooldownTicks: 2, pieceId: 7 }
        ]
      },
      triggerManager: {
        add(trigger) {
          added.push(trigger);
        }
      },
      soundEvents: {
        emit(payload) {
          emitted.push(payload);
        }
      }
    };

    view._registerMidiFlagTriggers(game);
    view._registerMidiFlagTriggers(game);
    expect(added).to.have.length(1);

    const trigger = added[0];
    const triggerType = toMidiFlagTriggerType(4);
    const result = trigger.trigger(4, 5, 0, { id: 11 });
    expect(result).to.equal(0);
    expect(emitted).to.have.length(1);
    expect(emitted[0].triggerType).to.equal(triggerType);
    expect(emitted[0].midiFlagId).to.equal(4);
    expect(emitted[0].lemmingId).to.equal(11);
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
});
