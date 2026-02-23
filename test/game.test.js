import { expect } from 'chai';
import { Lemmings, setDependency, useGlobalLemmings, withGlobalLemmings } from './helpers/lemmings.js';
import '../js/util/EventHandler.js';
import '../js/game/GameStateTypes.js';
import { Game } from '../js/game/Game.js';

useGlobalLemmings({ game: { showDebug: false } });

describe('Game', function() {
  let originals;
  beforeEach(function() {
    originals = {
      GameResources: Lemmings.GameResources,
      GameTimer: Lemmings.GameTimer,
      CommandManager: Lemmings.CommandManager,
      GameSkills: Lemmings.GameSkills,
      GameVictoryCondition: Lemmings.GameVictoryCondition,
      TriggerManager: Lemmings.TriggerManager,
      LemmingManager: Lemmings.LemmingManager,
      ObjectManager: Lemmings.ObjectManager,
      GameGui: Lemmings.GameGui,
      GameDisplay: Lemmings.GameDisplay,
      ParticleTable: Lemmings.ParticleTable,
      GameResult: Lemmings.GameResult
    };

    setDependency('GameResources', class {
      async getLevel(g, i) {
        return { timeLimit: 5, colorPalette: 0, triggers: [], objects: [], screenPositionX: 0 };
      }
      async getMasks() { return []; }
      async getLemmingsSprite() { return {}; }
      async getSkillPanelSprite() { return {}; }
    });

    setDependency('GameTimer', class {
      constructor(level) {
        this.level = level;
        this.onGameTick = new Lemmings.EventHandler();
        this.continueCalled = 0;
        this.stopCalled = 0;
      }
      continue() { this.continueCalled++; }
      stop() { this.stopCalled++; }
      trigger() { this.onGameTick.trigger(); }
      getGameLeftTime() { return 60; }
      getGameTicks() { return 0; }
    });

    setDependency('CommandManager', class {
      constructor(game, timer) { this.game = game; this.timer = timer; this.disposed = false; }
      dispose() { this.disposed = true; }
      serialize() { return ''; }
    });

    setDependency('GameSkills', class { constructor(level) { this.level = level; } });

    setDependency('GameVictoryCondition', class {
      constructor(level) { this.level = level; this.finalizeCalled = 0; }
      getSurvivorsCount() { return 1; }
      getNeedCount() { return 1; }
      getLeftCount() { return 0; }
      getOutCount() { return 0; }
      getSurvivorPercentage() { return 100; }
      doFinalize() { this.finalizeCalled++; }
    });

    setDependency('TriggerManager', class {
      constructor(timer) { this.timer = timer; this.disposed = false; this.added = null; }
      addRange(arr) { this.added = arr; }
      dispose() { this.disposed = true; }
    });

    setDependency('LemmingManager', class {
      constructor() { this.tickCalled = 0; this.disposed = false; }
      tick() { this.tickCalled++; }
      dispose() { this.disposed = true; }
    });

    setDependency('ObjectManager', class {
      constructor() { this.disposed = false; this.added = null; }
      addRange(arr) { this.added = arr; }
      dispose() { this.disposed = true; }
    });

    setDependency('GameGui', class {
      constructor() { this.renderCalled = 0; this.setDisplay = null; this.disposed = false; }
      setGuiDisplay(d) { this.setDisplay = d; }
      render() { this.renderCalled++; }
      dispose() { this.disposed = true; }
    });

    setDependency('GameDisplay', class {
      constructor() { this.renderCalled = 0; this.renderDebugCalled = 0; this.setDisplay = null; this.disposed = false; }
      setGuiDisplay(d) { this.setDisplay = d; }
      render() { this.renderCalled++; }
      renderDebug() { this.renderDebugCalled++; }
      dispose() { this.disposed = true; }
    });

    setDependency('ParticleTable', class { constructor() {} });
    setDependency('GameResult', class { constructor(game) { this.game = game; } });
  });

  afterEach(function() {
    Object.entries(originals).forEach(([k,v]) => { Lemmings[k] = v; });
  });

  it('loadLevel initializes managers', async function() {
    const res = new Lemmings.GameResources();
    const game = new Game(res);
    const ret = await game.loadLevel(0, 1);
    expect(ret).to.equal(game);
    expect(game.gameTimer).to.be.instanceOf(Lemmings.GameTimer);
    expect(game.commandManager).to.be.instanceOf(Lemmings.CommandManager);
    expect(game.lemmingManager).to.be.instanceOf(Lemmings.LemmingManager);
    expect(game.objectManager).to.be.instanceOf(Lemmings.ObjectManager);
    expect(game.gameGui).to.be.instanceOf(Lemmings.GameGui);
    expect(game.gameDisplay).to.be.instanceOf(Lemmings.GameDisplay);
  });

  it('loadCustomLevel returns null without a level', async function() {
    const res = new Lemmings.GameResources();
    const game = new Game(res);
    const ret = await game.loadCustomLevel(null);
    expect(ret).to.equal(null);
  });

  it('loadLevel closes performance measures when loading fails', async function() {
    const res = new Lemmings.GameResources();
    const game = new Game(res);
    let endMeasureCalls = 0;
    game.startMeasure = () => () => {
      endMeasureCalls += 1;
    };
    res.getLevel = async () => {
      throw new Error('load failed');
    };
    let thrown = null;
    try {
      await game.loadLevel(0, 0);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).to.be.instanceOf(Error);
    expect(endMeasureCalls).to.equal(1);
  });

  it('loadCustomLevel initializes managers and returns itself', async function() {
    const res = new Lemmings.GameResources();
    const game = new Game(res);
    const level = { timeLimit: 5, colorPalette: 0, triggers: [], objects: [], screenPositionX: 0 };
    const ret = await game.loadCustomLevel(level);
    expect(ret).to.equal(game);
    expect(game.lemmingManager).to.be.instanceOf(Lemmings.LemmingManager);
  });

  it('timer tick triggers logic, game over check and rendering', async function() {
    const res = new Lemmings.GameResources();
    const game = new Game(res);
    await game.loadLevel(0, 1);
    const display = { setScreenPosition() {}, redrawCalled: 0, redraw() { this.redrawCalled++; } };
    const guiDisplay = { redrawCalled: 0, redraw() { this.redrawCalled++; } };
    game.setGameDisplay(display);
    game.setGuiDisplay(guiDisplay);
    let ended = 0;
    game.onGameEnd.on(() => { ended++; });
    game.gameTimer.trigger();
    expect(game.lemmingManager.tickCalled).to.equal(1);
    expect(game.gameDisplay.renderCalled).to.equal(1);
    expect(game.gameGui.renderCalled).to.equal(1);
    expect(guiDisplay.redrawCalled).to.equal(1);
    expect(game.gameVictoryCondition.finalizeCalled).to.equal(1);
    expect(game.finalGameState).to.equal(Lemmings.GameStateTypes.SUCCEEDED);
    expect(ended).to.equal(1);
  });

  it('start and stop control timer and dispose managers', async function() {
    const res = new Lemmings.GameResources();
    const game = new Game(res);
    await game.loadLevel(0, 1);
    game.start();
    expect(game.gameTimer.continueCalled).to.equal(1);
    const timer = game.gameTimer;
    const cm = game.commandManager;
    const om = game.objectManager;
    const lm = game.lemmingManager;
    const tm = game.triggerManager;
    const gd = game.gameDisplay;
    const gg = game.gameGui;
    game.stop();
    expect(timer.stopCalled).to.equal(1);
    expect(cm.disposed).to.be.true;
    expect(om.disposed).to.be.true;
    expect(lm.disposed).to.be.true;
    expect(tm.disposed).to.be.true;
    expect(gd.disposed).to.be.true;
    expect(gg.disposed).to.be.true;
    expect(game.commandManager).to.equal(null);
    expect(game.gameDisplay).to.equal(null);
    expect(game.objectManager).to.equal(null);
    expect(game.lemmingManager).to.equal(null);
    expect(game.triggerManager).to.equal(null);
    expect(game.gameGui).to.equal(null);
    expect(game.onGameEnd).to.equal(null);
    expect(game.finalGameState).to.equal(Lemmings.GameStateTypes.UNKNOWN);
  });

  it('logs and skips logic when ticking without a loaded level', function() {
    const res = new Lemmings.GameResources();
    const game = new Game(res);
    let ticked = 0;
    const msgs = [];
    game.lemmingManager = { tick: () => { ticked++; } };
    game.log.log = m => msgs.push(m);
    game.onGameTimerTick();
    expect(ticked).to.equal(0);
    expect(msgs).to.eql(['level not loaded!']);
  });

  it('sets time travel controller on timers that support it', async function() {
    let attached = null;
    setDependency('GameTimer', class {
      constructor(level) {
        this.level = level;
        this.onGameTick = new Lemmings.EventHandler();
      }
      continue() {}
      stop() {}
      setTimeTravelController(controller) { attached = controller; }
      getGameLeftTime() { return 60; }
      getGameTicks() { return 0; }
    });
    const res = new Lemmings.GameResources();
    const game = new Game(res);
    await game.loadLevel(0, 1);
    expect(attached).to.equal(game.timeTravel);
  });

  it('skips queueCommand when input is disabled or reversing', function() {
    const res = new Lemmings.GameResources();
    const game = new Game(res);
    let queued = 0;
    game.commandManager = { queueCommand() { queued += 1; } };

    game.inputEnabled = false;
    game.queueCommand({ type: 'noop' });
    game.inputEnabled = true;
    game.timeTravel = { isReversing: true };
    game.queueCommand({ type: 'noop' });

    game.timeTravel = { isReversing: false };
    game.queueCommand({ type: 'noop' });
    expect(queued).to.equal(1);
  });

  it('getGameState returns final state when already determined', function() {
    const res = new Lemmings.GameResources();
    const game = new Game(res);
    game.finalGameState = Lemmings.GameStateTypes.FAILED_OUT_OF_TIME;
    expect(game.getGameState()).to.equal(Lemmings.GameStateTypes.FAILED_OUT_OF_TIME);
  });

  it('getGameState returns RUNNING when bench mode is enabled', function() {    
    const res = new Lemmings.GameResources();
    const game = new Game(res);
    withGlobalLemmings({ bench: true }, () => {
      expect(game.getGameState()).to.equal(Lemmings.GameStateTypes.RUNNING);    
    });
  });

  it('getGameState returns RUNNING when benchReverse is enabled', function() {  
    const res = new Lemmings.GameResources();
    const game = new Game(res);
    withGlobalLemmings({ benchReverse: true }, () => {
      expect(game.getGameState()).to.equal(Lemmings.GameStateTypes.RUNNING);    
    });
  });

  it('setGameDisplay uses a default screen position without level data', function() {
    const res = new Lemmings.GameResources();
    const game = new Game(res);
    game.gameDisplay = { setGuiDisplay() {} };
    game.level = null;
    const display = {
      args: null,
      setScreenPosition(x, y) { this.args = { x, y }; }
    };
    game.setGameDisplay(display);
    expect(display.args).to.eql({ x: 0, y: 0 });
  });

  it('loadLevel wires pre-set game and gui displays', async function() {
    const res = new Lemmings.GameResources();
    const game = new Game(res);
    const display = { setScreenPosition() {} };
    const guiDisplay = { redraw() {} };
    game.setGameDisplay(display);
    game.setGuiDisplay(guiDisplay);
    await game.loadLevel(0, 1);
    expect(game.gameDisplay.setDisplay).to.equal(display);
    expect(game.gameGui.setDisplay).to.equal(guiDisplay);
  });

  it('checkForGameOver returns early for bench or finalized games', function() {
    const res = new Lemmings.GameResources();
    const game = new Game(res);
    const victory = new Lemmings.GameVictoryCondition();
    game.gameVictoryCondition = victory;
    withGlobalLemmings({ bench: true }, () => {
      game.checkForGameOver();
      expect(victory.finalizeCalled).to.equal(0);
    });

    game.finalGameState = Lemmings.GameStateTypes.SUCCEEDED;
    game.checkForGameOver();
    expect(victory.finalizeCalled).to.equal(0);
  });

  it('render draws debug frames when enabled', function() {
    const res = new Lemmings.GameResources();
    const game = new Game(res);
    const display = { renderCalled: 0, debugCalled: 0, render() { this.renderCalled++; }, renderDebug() { this.debugCalled++; } };
    game.gameDisplay = display;
    game.setDebugMode(true);
    game.render();
    expect(display.renderCalled).to.equal(1);
    expect(display.debugCalled).to.equal(1);
  });

  it('render falls back to legacy display redraw', function() {
    const res = new Lemmings.GameResources();
    const game = new Game(res);
    const display = { redrawCalled: 0, redraw() { this.redrawCalled++; } };
    game.display = display;
    game.gameDisplay = null;
    game.guiDisplay = null;
    game.render();
    expect(display.redrawCalled).to.equal(1);
  });

  it('getters return stored managers and cheat forwards', function() {
    const res = new Lemmings.GameResources();
    const game = new Game(res);
    const skills = { cheatCalled: 0, cheat() { this.cheatCalled++; } };
    const lemmingManager = { id: 'lem' };
    game.skills = skills;
    game.lemmingManager = lemmingManager;
    expect(game.getGameSkills()).to.equal(skills);
    expect(game.getLemmingManager()).to.equal(lemmingManager);
    game.cheat();
    expect(skills.cheatCalled).to.equal(1);
  });

  it('checkForGameOver finalizes and triggers event', function() {
    const res = new Lemmings.GameResources();
    const game = new Game(res);
    game.gameVictoryCondition = new Lemmings.GameVictoryCondition();
    game.getGameState = () => Lemmings.GameStateTypes.SUCCEEDED;
    let ended = 0;
    game.onGameEnd.on(() => { ended++; });
    game.checkForGameOver();
    expect(game.gameVictoryCondition.finalizeCalled).to.equal(1);
    expect(game.finalGameState).to.equal(Lemmings.GameStateTypes.SUCCEEDED);    
    expect(ended).to.equal(1);
  });

  it('getGameState returns RUNNING for endless mode', function() {
    const res = new Lemmings.GameResources();
    const game = new Game(res);
    withGlobalLemmings({ endless: true }, () => {
      expect(game.getGameState()).to.equal(Lemmings.GameStateTypes.RUNNING);    
    });
  });

  it('getGameState returns failed out of time when needed', function() {        
    const res = new Lemmings.GameResources();
    const game = new Game(res);
    game.gameTimer = { getGameLeftTime: () => 0 };
    game.gameVictoryCondition = {
      getSurvivorsCount() { return 0; },
      getNeedCount() { return 1; },
      getLeftCount() { return 1; },
      getOutCount() { return 0; }
    };
    withGlobalLemmings({}, () => {
      expect(game.getGameState()).to.equal(Lemmings.GameStateTypes.FAILED_OUT_OF_TIME);
    });
  });

  it('start emits sound events when available', function() {
    const res = new Lemmings.GameResources();
    const game = new Game(res);
    const calls = [];
    game.soundEvents = {
      emitSfx(...args) { calls.push(args); }
    };
    game.gameTimer = { continue() {} };
    game.levelIndex = 2;
    game.levelGroupIndex = 1;
    game.level = { name: 'Test' };
    game.start();
    expect(calls.length).to.equal(1);
    expect(calls[0][2].levelName).to.equal('Test');
  });
});
