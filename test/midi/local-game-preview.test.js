import { expect } from 'chai';
import { createLocalGamePreview } from '../../js/app/midi-ui/localGamePreview.js';
import { gameViewMidiMethods } from '../../js/game/game-view/GameViewMidi.js';
import { gameViewEditorModeMethods } from '../../js/game/game-view/GameViewEditorMode.js';
import { gameViewRuntimeMethods } from '../../js/game/game-view/GameViewRuntime.js';
import { gameViewLevelSelectionMethods } from '../../js/game/game-view/GameViewLevelSelection.js';
import { SoundEventBus, SoundEffectIds, SoundEventTypes } from '../../js/game/SoundEvents.js';
import { EventHandler } from '../../js/util/EventHandler.js';
import { makeOutput } from '../support/midi-output.js';
import { createMidiProject, projectToMidiConfig } from '../../js/midi/project/MidiProject.js';
import { applyGameEventMidiPreset } from '../../js/midi/project/GameEventMidiPresets.js';

const deferred = () => {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
};

const makeAudio = () => {
  const calls = [];
  const listeners = new Set();
  let enabled = false;
  let pending = null;
  let serial = 0;
  const audio = {
    output: makeOutput(Array.from({ length: 16 }, (_, index) => index + 1), calls, 'local'),
    getState: () => ({ enabled, message: enabled ? 'Ready' : 'Audio off' }),
    subscribe: callback => { listeners.add(callback); return () => listeners.delete(callback); },
    enableCalls: 0,
    stopCalls: 0,
    disposeCalls: 0,
    async enable() {
      audio.enableCalls += 1;
      const request = serial;
      const result = pending ? await pending.promise : true;
      if (request !== serial || !result) return false;
      enabled = true;
      return true;
    },
    stop() {
      serial += 1;
      enabled = false;
      audio.stopCalls += 1;
      for (const callback of listeners) callback(audio.getState());
    },
    async dispose() { audio.disposeCalls += 1; enabled = false; },
    waitForUnlock() { pending = deferred(); return pending; },
    interrupt() { enabled = false; for (const callback of listeners) callback(audio.getState()); },
    calls
  };
  audio.output.clear = () => calls.push({ type: 'clear' });
  return audio;
};

const makeGame = () => {
  const timer = {
    tick: 0, frameTime: 60, speedFactor: 1, onGameTick: new EventHandler(),
    getGameTicks() { return this.tick; },
    get tps() { return 1000 / this.frameTime; },
    suspend() {}, continue() {}, isRunning: () => true
  };
  const bus = new SoundEventBus(timer);
  return { soundEvents: bus, getGameTimer: () => timer, timer, stop() {} };
};
const makeView = () => ({
  ...gameViewMidiMethods,
  game: makeGame(), stage: {}, midiEnabled: false, midiRouter: null,
  midiPreviewRouter: null, _midiPreviewOnDispose: null, _midiPreviewDisposed: false,
  editorMode: false, editorPlaytest: false,
  _ensureWebMidiEnabled() { throw new Error('Must never request MIDI'); }
});
const config = () => ({
  enabled: false,
  defaultChannel: 1,
  mpe: { enabled: false },
  position: { mappings: [] },
  sfx: { [SoundEffectIds.SPAWN]: { note: 60, velocity: 50, durationTicks: 2, outputId: 'external-device' } },
  triggers: { 4: { note: 67, outputId: 'second-device' } }
});

const setup = (options = {}) => {
  const view = makeView();
  const audio = makeAudio();
  let source = config();
  const local = createLocalGamePreview({ getLemmings: () => view, getConfig: () => source, audio, ...options });
  return { view, audio, local, get source() { return source; }, set source(value) { source = value; } };
};

describe('local game note preview', function() {
  it('reuses immutable source identity without resetting arpeggios and refreshes after restart', async function() {
    const state = setup({ immutableConfig: true });
    await state.local.start();
    const router = state.view.midiPreviewRouter;
    router._arpStateBySfx.set('test', { index: 2 });
    const original = router.setMapping;
    let updates = 0;
    router.setMapping = function(mapping) { updates += 1; original.call(this, mapping); };
    expect(state.local.syncConfig()).to.equal(false);
    expect(state.local.syncConfig()).to.equal(false);
    expect(router._arpStateBySfx.get('test')).to.deep.equal({ index: 2 });
    expect(updates).to.equal(0);
    state.source = { ...state.source, sfx: { [SoundEffectIds.SPAWN]: { note: 73 } } };
    expect(state.local.syncConfig()).to.equal(true);
    expect(updates).to.equal(1);
    expect(router._arpStateBySfx.size).to.equal(0);
    state.local.stop();
    expect(await state.local.start()).to.equal(true);
    expect(state.view.midiPreviewRouter).not.to.equal(router);
    expect(state.view.midiPreviewRouter.mapping.config.sfx[SoundEffectIds.SPAWN].note).to.equal(73);
    await state.local.dispose();
  });

  it('refuses excluded mobile preview before initializing browser audio or routing', async function() {
    const { view, audio, local } = setup();
    view.midiAvailable = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(await local.start()).to.equal(false);
    }
    expect(audio.enableCalls).to.equal(0);
    expect(audio.calls).to.deep.equal([]);
    expect(view.midiPreviewRouter).to.equal(null);
    expect(local.getState().enabled).to.equal(false);
    await local.dispose();
  });

  it('attaches a separate local router while hardware stays disabled and the project stays unchanged', async function() {
    const { view, audio, local, source } = setup();
    const before = JSON.stringify(source);
    let hardwareCalls = 0;
    view.setMidiEnabled = () => { hardwareCalls += 1; throw new Error('Hardware was already off'); };
    expect(await local.start()).to.equal(true);
    expect(local.getState()).to.include({ status: 'live', enabled: true });
    expect(view.midiRouter).to.equal(null);
    expect(view.midiEnabled).to.equal(false);
    expect(hardwareCalls).to.equal(0);
    expect(view.midiPreviewRouter.mapping.config.enabled).to.equal(true);
    expect(view.midiPreviewRouter.mapping.config.sfx[SoundEffectIds.SPAWN].outputId).to.equal(null);
    expect(view.midiPreviewRouter.mapping.config.triggers[4].outputId).to.equal(null);
    expect(view.midiPreviewRouter.scheduler._listOutputs()).to.eql([audio.output]);
    expect(JSON.stringify(source)).to.equal(before);
    view.game.soundEvents.emitSfx(SoundEventTypes.LEMMING_SPAWN, SoundEffectIds.SPAWN);
    expect(audio.calls.filter(call => call.type === 'noteOn')).to.have.length(1);
    await local.dispose();
    expect(view.game.soundEvents.onEvent.handlers.size).to.equal(0);
    expect(view.game.timer.onGameTick.handlers.size).to.equal(0);
  });

  it('disables active hardware before attaching local routing and never restores it', async function() {
    const { view, audio, local } = setup();
    const order = [];
    const originalEnable = audio.enable;
    audio.enable = () => { order.push('unlock'); return originalEnable(); };
    view.midiEnabled = true;
    view.setMidiEnabled = async value => { order.push(`hardware:${value}`); view.midiEnabled = value; };
    const originalAttach = view.setMidiPreviewRouter;
    view.setMidiPreviewRouter = function(router, callback) { if (router) order.push('attach'); originalAttach.call(this, router, callback); };
    expect(await local.start()).to.equal(true);
    expect(order).to.eql(['unlock', 'hardware:false', 'attach']);
    local.stop();
    expect(view.midiEnabled).to.equal(false);
    expect(order.filter(value => value.startsWith('hardware'))).to.eql(['hardware:false']);
    await local.dispose();
  });

  it('never reattaches hardware when an earlier permission request resolves after switching local', async function() {
    const { local, view } = setup();
    const permission = deferred();
    let enableRequests = 0;
    view._ensureWebMidiEnabled = () => { enableRequests += 1; return permission.promise; };
    view._loadMidiMapping = async () => { throw new Error('Stale enable must stop before loading'); };
    const hardwareStart = view.setMidiEnabled(true);
    expect(view.midiEnabled).to.equal(true);
    expect(await local.start()).to.equal(true);
    permission.resolve({ enabled: true });
    await hardwareStart;
    expect(view.midiRouter).to.equal(null);
    expect(view.midiEnabled).to.equal(false);
    expect(view.midiPreviewRouter).not.to.equal(null);
    expect(enableRequests).to.equal(1);
    await local.dispose();
  });

  it('makes repeated starts idempotent and only updates changed derived configs', async function() {
    const state = setup();
    const { local, view, audio } = state;
    await local.start();
    const router = view.midiPreviewRouter;
    let updates = 0;
    const original = router.setMapping;
    router.setMapping = function(mapping) { updates += 1; original.call(this, mapping); };
    expect(local.syncConfig()).to.equal(false);
    expect(await local.start()).to.equal(true);
    expect(view.midiPreviewRouter).to.equal(router);
    expect(audio.enableCalls).to.equal(1);
    expect(updates).to.equal(0);
    state.source = { ...state.source, enabled: true };
    expect(local.syncConfig()).to.equal(false);
    state.source.sfx[SoundEffectIds.SPAWN].note = 72;
    expect(local.syncConfig()).to.equal(true);
    expect(updates).to.equal(1);
    expect(local.syncConfig()).to.equal(false);
    await local.dispose();
  });

  it('stop during unlock prevents stale attachment and a later start works', async function() {
    const { local, view, audio } = setup();
    const pending = audio.waitForUnlock();
    const starting = local.start();
    local.stop();
    pending.resolve(true);
    expect(await starting).to.equal(false);
    expect(view.midiPreviewRouter).to.equal(null);
    expect(local.getState().status).to.equal('off');
    expect(await local.start()).to.equal(true);
    expect(view.game.soundEvents.onEvent.handlers.size).to.equal(1);
    await local.dispose();
  });

  it('a rapid restart only attaches the latest request', async function() {
    const { local, view, audio } = setup();
    const pending = audio.waitForUnlock();
    const first = local.start();
    const second = local.start();
    pending.resolve(true);
    expect(await first).to.equal(false);
    expect(await second).to.equal(true);
    expect(view.game.soundEvents.onEvent.handlers.size).to.equal(1);
    await local.dispose();
  });

  it('disposal during unlock is permanent and closes audio exactly once', async function() {
    const { local, view, audio } = setup();
    const pending = audio.waitForUnlock();
    const starting = local.start();
    const disposal = local.dispose();
    expect(local.dispose()).to.equal(disposal);
    pending.resolve(true);
    expect(await starting).to.equal(false);
    expect(await local.start()).to.equal(false);
    expect(view.midiPreviewRouter).to.equal(null);
    expect(audio.disposeCalls).to.equal(1);
    expect(local.getState().status).to.equal('disposed');
  });

  it('declines unavailable audio or game without attaching listeners', async function() {
    const { local, view, audio } = setup();
    const pending = audio.waitForUnlock();
    pending.resolve(false);
    expect(await local.start()).to.equal(false);
    expect(local.getState().status).to.equal('error');
    expect(view.game.soundEvents.onEvent.handlers.size).to.equal(0);
    await local.dispose();
    const noGame = createLocalGamePreview({ audio: makeAudio() });
    expect(await noGame.start()).to.equal(false);
    expect(noGame.getState().message).to.include('not ready');
    await noGame.dispose();
  });

  it('rejects a changed or disposed view after asynchronous audio unlock', async function() {
    let current = makeView();
    const audio = makeAudio();
    const local = createLocalGamePreview({ audio, getLemmings: () => current, getConfig: config });
    const oldView = current;
    const pending = audio.waitForUnlock();
    const starting = local.start();
    current = makeView();
    pending.resolve(true);
    expect(await starting).to.equal(false);
    expect(oldView.midiPreviewRouter).to.equal(null);
    expect(current.midiPreviewRouter).to.equal(null);
    expect(local.getState().message).to.include('changed');
    await local.dispose();
  });

  it('detaches listeners and silences queued notes after audio interruption', async function() {
    const { local, view, audio } = setup();
    await local.start();
    audio.interrupt();
    expect(view.midiPreviewRouter).to.equal(null);
    expect(view.game.soundEvents.onEvent.handlers.size).to.equal(0);
    expect(view.game.timer.onGameTick.handlers.size).to.equal(0);
    expect(local.getState()).to.include({ status: 'error', enabled: false });
    await local.dispose();
  });

  it('retains bounded phrase progression on real game ticks only', async function() {
    const { local, view, audio } = setup({
      getConfig: () => projectToMidiConfig(applyGameEventMidiPreset(createMidiProject({
        enabled: false, global: { mpe: { enabled: false }, density: { velocityBoost: 0, durationScale: 0 } }
      }), 'game-major', { mode: 'phrase' }))
    });
    await local.start();
    view.midiPreviewRouter._nowMs = () => view.game.timer.tick * 60;
    view.midiPreviewRouter.scheduler._nowMs = () => view.game.timer.tick * 60;
    const notes = () => audio.calls.filter(call => call.type === 'noteOn');
    view.game.soundEvents.emitSfx(SoundEventTypes.LEMMING_SPAWN, SoundEffectIds.SPAWN);
    expect(notes().map(call => call.note)).to.eql([76]);
    await Promise.resolve();
    expect(notes()).to.have.length(1);
    for (let index = 0; index < 8; index += 1) {
      view.game.timer.tick += 1;
      view.game.timer.onGameTick.trigger();
    }
    expect(notes().map(call => call.note)).to.eql([76, 72, 67, 64, 60]);
    local.panic();
    view.game.timer.tick += 5;
    view.game.timer.onGameTick.trigger();
    expect(notes()).to.have.length(5);
    await local.dispose();
  });
});

describe('GameView local preview lifecycle', function() {
  it('detaches the previous bus on level change and reattaches despite hardware being disabled', async function() {
    const { local, view, audio } = setup();
    await local.start();
    const previousGame = view.game;
    let stops = 0;
    previousGame.stop = () => { stops += 1; };
    Object.assign(view, {
      autoMoveTimer: null,
      gameResources: { getLevelGroups: () => [], getLevel: async () => ({}) },
      _getSavedLevelEntries: () => [], _isSavedGroupIndex: () => false,
      changeHtmlText() {}, updateQuery() {}, log: { debug() {} }, stage: null,
      start() { this.game = makeGame(); this._attachMidiPreview(this.game); }
    });
    await gameViewLevelSelectionMethods.loadLevel.call(view);
    expect(stops).to.equal(1);
    expect(previousGame.soundEvents.onEvent.handlers.size).to.equal(0);
    expect(previousGame.timer.onGameTick.handlers.size).to.equal(0);
    expect(view.game.soundEvents.onEvent.handlers.size).to.equal(1);
    expect(audio.calls.some(call => call.type === 'clear')).to.equal(true);
    await local.dispose();
  });

  it('silences editor entry, attaches playtest, detaches its stop and reattaches after exit', async function() {
    const { local, view } = setup();
    await local.start();
    view.editorSession = {};
    gameViewEditorModeMethods.enterEditorMode.call(view);
    expect(view.game.soundEvents.onEvent.handlers.size).to.equal(0);
    gameViewEditorModeMethods.setEditorPlaytest.call(view, true);
    expect(view.game.soundEvents.onEvent.handlers.size).to.equal(1);
    gameViewEditorModeMethods.setEditorPlaytest.call(view, false);
    expect(view.game.soundEvents.onEvent.handlers.size).to.equal(0);
    gameViewEditorModeMethods.exitEditorMode.call(view);
    expect(view.game.soundEvents.onEvent.handlers.size).to.equal(1);
    await local.dispose();
  });

  it('does not attach an editor-only game until playtest starts', async function() {
    const { local, view } = setup();
    view.editorMode = true;
    await local.start();
    expect(view.game.soundEvents.onEvent.handlers.size).to.equal(0);
    gameViewEditorModeMethods.setEditorPlaytest.call(view, true);
    expect(view.game.soundEvents.onEvent.handlers.size).to.equal(1);
    await local.dispose();
  });

  it('silences pause without detaching, preserving game-clock phrases for single steps', async function() {
    const { local, view, audio } = setup();
    await local.start();
    gameViewRuntimeMethods.suspend.call(view);
    expect(audio.calls.some(call => call.type === 'clear')).to.equal(true);
    expect(view.game.soundEvents.onEvent.handlers.size).to.equal(1);
    await local.dispose();
  });

  it('GameView disposal stops the monitor and prevents stale routing', async function() {
    const { local, view } = setup();
    await local.start();
    view.stage = null;
    view.autoMoveTimer = null;
    view.resumeTimer = null;
    gameViewEditorModeMethods.dispose.call(view);
    expect(view._midiPreviewDisposed).to.equal(true);
    expect(view.midiPreviewRouter).to.equal(null);
    expect(local.getState().status).to.equal('off');
    expect(view.game.soundEvents.onEvent.handlers.size).to.equal(0);
    expect(await local.start()).to.equal(false);
    await local.dispose();
  });

  for (const customLevel of [false, true]) {
    it(`attaches preview before ${customLevel ? 'custom-level' : 'normal'} game start with hardware off`, async function() {
      const { local, view } = setup();
      const game = makeGame();
      let startedWithPreview = false;
      Object.assign(game, {
        loadLevel: async () => {}, setGameDisplay() {}, setGuiDisplay() {},
        onGameEnd: new EventHandler(),
        start() { startedWithPreview = this.soundEvents.onEvent.handlers.size === 1; }
      });
      Object.assign(view, {
        game: null, gameFactory: { getGame: async () => game }, gameResources: {},
        stage: { getGameDisplay: () => ({}), getGuiDisplay: () => ({}), setCursorSprite() {} },
        _applyHistoryRetentionPolicy() {}, _registerMidiFlagTriggers() {},
        changeHtmlText() {}, log: { log(error) { throw new Error(String(error)); } },
        gameSpeedFactor: 1
      });
      await local.start();
      if (customLevel) await gameViewLevelSelectionMethods._startWithLevel.call(view, {});
      else await gameViewRuntimeMethods.start.call(view);
      expect(startedWithPreview).to.equal(true);
      expect(view.game).to.equal(game);
      expect(view.midiEnabled).to.equal(false);
      await local.dispose();
    });
  }

  it('normal stop reports off without a spurious interruption error', async function() {
    const statuses = [];
    const { local } = setup({ onStateChange: state => statuses.push(state.status) });
    await local.start();
    local.stop();
    expect(statuses).to.eql(['off', 'starting', 'live', 'off']);
    await local.dispose();
  });

});

describe('exclusive local and hardware destinations', function() {
  it('a hardware enable through any GameView entry point stops local audition first', async function() {
    const order = [];
    const view = { ...gameViewMidiMethods, game: null, initMidiRouting: async () => { order.push('hardware'); } };
    view.setLocalAudioStopHandler(() => { order.push('stop-local'); });
    await view.setMidiEnabled(true);
    expect(order).to.deep.equal(['stop-local', 'hardware']);
    view.setLocalAudioStopHandler(null);
    await view.setMidiEnabled(false);
  });
});
