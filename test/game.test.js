import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/EventHandler.js';
import '../js/GameStateTypes.js';
import { Game } from '../js/Game.js';

globalThis.lemmings = { game: { showDebug: false } };

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

    Lemmings.GameResources = class {
      async getLevel(g, i) {
        return { timeLimit: 5, colorPalette: 0, triggers: [], objects: [], screenPositionX: 0 };
      }
      async getMasks() { return []; }
      async getLemmingsSprite() { return {}; }
      async getSkillPanelSprite() { return {}; }
    };

    Lemmings.GameTimer = class {
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
    };

    Lemmings.CommandManager = class {
      constructor(game, timer) { this.game = game; this.timer = timer; this.disposed = false; }
      dispose() { this.disposed = true; }
      serialize() { return ''; }
    };

    Lemmings.GameSkills = class { constructor(level) { this.level = level; } };

    Lemmings.GameVictoryCondition = class {
      constructor(level) { this.level = level; this.finalizeCalled = 0; }
      getSurvivorsCount() { return 1; }
      getNeedCount() { return 1; }
      getLeftCount() { return 0; }
      getOutCount() { return 0; }
      getSurvivorPercentage() { return 100; }
      doFinalize() { this.finalizeCalled++; }
    };

    Lemmings.TriggerManager = class {
      constructor(timer) { this.timer = timer; this.disposed = false; this.added = null; }
      addRange(arr) { this.added = arr; }
      dispose() { this.disposed = true; }
    };

    Lemmings.LemmingManager = class {
      constructor() { this.tickCalled = 0; this.disposed = false; }
      tick() { this.tickCalled++; }
      dispose() { this.disposed = true; }
    };

    Lemmings.ObjectManager = class {
      constructor() { this.disposed = false; this.added = null; }
      addRange(arr) { this.added = arr; }
      dispose() { this.disposed = true; }
    };

    Lemmings.GameGui = class {
      constructor() { this.renderCalled = 0; this.setDisplay = null; this.disposed = false; }
      setGuiDisplay(d) { this.setDisplay = d; }
      render() { this.renderCalled++; }
      dispose() { this.disposed = true; }
    };

    Lemmings.GameDisplay = class {
      constructor() { this.renderCalled = 0; this.renderDebugCalled = 0; this.setDisplay = null; this.disposed = false; }
      setGuiDisplay(d) { this.setDisplay = d; }
      render() { this.renderCalled++; }
      renderDebug() { this.renderDebugCalled++; }
      dispose() { this.disposed = true; }
    };

    Lemmings.ParticleTable = class { constructor() {} };
    Lemmings.GameResult = class { constructor(game) { this.game = game; } };
  });

  afterEach(function() {
    Object.entries(originals).forEach(([k,v]) => { Lemmings[k] = v; });
  });

  it('loadLevel initializes managers and returns itself', async function() {
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

  it('getGameState returns final state when already determined', function() {
    const res = new Lemmings.GameResources();
    const game = new Game(res);
    game.finalGameState = Lemmings.GameStateTypes.FAILED_OUT_OF_TIME;
    expect(game.getGameState()).to.equal(Lemmings.GameStateTypes.FAILED_OUT_OF_TIME);
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
});
