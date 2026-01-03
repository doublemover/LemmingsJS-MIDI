import { CommandManager } from '../commands/CommandManager.js';
import { EventHandler } from '../util/EventHandler.js';
import { GameDisplay } from './GameDisplay.js';
import { GameGui } from './GameGui.js';
import { GameResult } from './GameResult.js';
import { GameSkills } from './GameSkills.js';
import { GameStateTypes } from './GameStateTypes.js';
import { GameTimer } from './GameTimer.js';
import { GameVictoryCondition } from './GameVictoryCondition.js';
import { HistoryStore } from './HistoryStore.js';
import { TimeTravelController } from './TimeTravelController.js';
import { LemmingManager } from '../lemmings/LemmingManager.js';
import { BaseLogger } from '../util/LogHandler.js';
import { ObjectManager } from '../level/ObjectManager.js';
import { ParticleTable } from '../render/ParticleTable.js';
import { SoundEventBus, SoundEventTypes, SoundEffectIds } from './SoundEvents.js';
import { TriggerManager } from '../level/TriggerManager.js';
import { getDependency } from '../core/dependencies.js';

class Game extends BaseLogger {
  constructor (gameResources) {
    super();
    this.gameResources = gameResources;

    // runtime refs (null until loadLevel resolves)
    this.guiDisplay           = null;
    this.display              = null;
    this.gameDisplay          = null;
    this.gameTimer            = null;
    this.commandManager       = null;
    this.skills               = null;
    this.level                = null;
    this.levelGroupIndex      = null;
    this.levelIndex           = null;
    this.gameGui              = null;
    this.objectManager        = null;
    this.triggerManager       = null;
    this.gameVictoryCondition = null;
    this.soundEvents          = null;
    this.history              = null;
    this.timeTravel           = null;
    this.inputEnabled         = true;

    this.onGameEnd      = new EventHandler();
    this.finalGameState = GameStateTypes.UNKNOWN;
    this.showDebug      = false;

    this._boundTick = this.onGameTimerTick.bind(this);
  }

  setGameDisplay (display) {
    this.display = display;
    if (this.gameDisplay) {
      this.gameDisplay.setGuiDisplay(display);
      this.display.setScreenPosition(this.level?.screenPositionX ?? 0, 0);
    }
  }

  setGuiDisplay (display) {
    this.guiDisplay = display;
    if (this.gameGui) {
      this.gameGui.setGuiDisplay(display);
    }
  }

  _disposeCurrentLevel () {
    if (this.gameTimer)            { this.gameTimer.stop(); this.gameTimer = null; }
    if (this.commandManager?.dispose)    this.commandManager.dispose();
    if (this.objectManager?.dispose)     this.objectManager.dispose();
    if (this.lemmingManager?.dispose)    this.lemmingManager.dispose();
    if (this.triggerManager?.dispose)    this.triggerManager.dispose();
    if (this.gameDisplay?.dispose)       this.gameDisplay.dispose();
    if (this.gameGui?.dispose)           this.gameGui.dispose();
    if (this.soundEvents?.dispose)       this.soundEvents.dispose();
    if (this.history?.detach)           this.history.detach();
    if (this.timeTravel?.dispose)       this.timeTravel.dispose();

    this.commandManager  = null;
    this.objectManager   = null;
    this.lemmingManager  = null;
    this.triggerManager  = null;
    this.gameDisplay     = null;
    this.gameGui         = null;
    this.soundEvents     = null;
    this.history         = null;
    this.timeTravel      = null;

    this.finalGameState  = GameStateTypes.UNKNOWN;
  }

  async loadLevel (levelGroupIndex, levelIndex) {
    const endMeasure = this.startMeasure('Game loadLevel', {
      track: 'Game',
      trackGroup: 'Game State',
      color: 'primary',
      tooltipText: `loadLevel ${levelGroupIndex}:${levelIndex}`
    });
    const level = await this.gameResources.getLevel(levelGroupIndex, levelIndex);
    await this._initLevel(level, { levelGroupIndex, levelIndex });
    endMeasure();
    return this; // keeps legacy promise signature intact
  }

  async loadCustomLevel(level, options = {}) {
    if (!level) return null;
    await this._initLevel(level, options);
    return this;
  }

  async _initLevel(level, options = {}) {
    this._disposeCurrentLevel();

    // Record indices for HUD etc.
    this.levelGroupIndex = Number.isFinite(options.levelGroupIndex)
      ? options.levelGroupIndex
      : 0;
    this.levelIndex = Number.isFinite(options.levelIndex)
      ? options.levelIndex
      : 0;
    this.level = level;

    const Timer = getDependency('GameTimer', GameTimer);
    this.gameTimer = new Timer(level);
    this.gameTimer.onGameTick.on(this._boundTick);
    const History = getDependency('HistoryStore', HistoryStore);
    this.history = new History();
    this.history.attach(this, { captureBaseline: false });
    const SoundBus = getDependency('SoundEventBus', SoundEventBus);
    this.soundEvents = new SoundBus(this.gameTimer);
    this.soundEvents.setHistoryStore?.(this.history);
    const TimeTravel = getDependency('TimeTravelController', TimeTravelController);
    this.timeTravel = new TimeTravel(this, this.history);
    this.gameTimer?.setTimeTravelController?.(this.timeTravel);

    const CommandMgr = getDependency('CommandManager', CommandManager);
    const Skills = getDependency('GameSkills', GameSkills);
    const Victory = getDependency('GameVictoryCondition', GameVictoryCondition);
    const Triggers = getDependency('TriggerManager', TriggerManager);
    this.commandManager       = new CommandMgr(this, this.gameTimer);
    this.skills               = new Skills(level);
    this.gameVictoryCondition = new Victory(level);
    this.triggerManager       = new Triggers(this.gameTimer);
    this.triggerManager.addRange(level.triggers);

    const [masks, lemSprite] = await Promise.all([
      this.gameResources.getMasks(),
      this.gameResources.getLemmingsSprite(level.colorPalette),
    ]);

    const Particle = getDependency('ParticleTable', ParticleTable);
    const LemmingMgr = getDependency('LemmingManager', LemmingManager);
    const particleTable  = new Particle(level.colorPalette);
    this.lemmingManager  = new LemmingMgr(
      level,
      lemSprite,
      this.triggerManager,
      this.gameVictoryCondition,
      masks,
      particleTable,
    );

    const skillPanelSprites = await this.gameResources.getSkillPanelSprite(level.colorPalette);
    const Gui = getDependency('GameGui', GameGui);
    this.gameGui = new Gui(
      this,
      skillPanelSprites,
      this.skills,
      this.gameTimer,
      this.gameVictoryCondition,
    );

    const ObjManager = getDependency('ObjectManager', ObjectManager);
    this.objectManager = new ObjManager(this.gameTimer);
    this.objectManager.addRange(level.objects);

    const Display = getDependency('GameDisplay', GameDisplay);
    this.gameDisplay = new Display(
      this,
      level,
      this.lemmingManager,
      this.objectManager,
      this.triggerManager,
    );
    if (this.display) this.gameDisplay.setGuiDisplay(this.display);
    if (this.guiDisplay) this.gameGui.setGuiDisplay(this.guiDisplay);

    this.history?.start?.();
  }

  start () {
    if (this.soundEvents) {
      this.soundEvents.emitSfx(
        SoundEventTypes.LEVEL_START,
        SoundEffectIds.LEVEL_START,
        {
          levelIndex: this.levelIndex,
          levelGroupIndex: this.levelGroupIndex,
          levelName: this.level?.name ?? ''
        }
      );
    }
    this.gameTimer?.continue();
  }

  stop () {
    this._disposeCurrentLevel();
    this.onGameEnd?.dispose();
    this.onGameEnd = null;
  }

  getGameTimer        () { return this.gameTimer; }
  getGameSkills       () { return this.skills; }
  getLemmingManager   () { return this.lemmingManager; }
  getVictoryCondition () { return this.gameVictoryCondition; }
  getCommandManager   () { return this.commandManager; }
  cheat               () { this.skills?.cheat(); }
  setDebugMode       (v) { this.showDebug = !!v; }
  queueCommand(cmd)   {
    if (this.inputEnabled === false || this.timeTravel?.isReversing) return;
    this.commandManager?.queueCommand(cmd);
  }

  onGameTimerTick () {
    if (!this.level) {
      this.runGameLogic();
      return;
    }
    this.runGameLogic();
    this.checkForGameOver();
    this.render();
  }

  runGameLogic () {
    const endMeasure = this.startMeasure('Game runGameLogic', {
      track: 'Game',
      trackGroup: 'Game State',
      color: 'secondary',
      tooltipText: 'runGameLogic'
    });
    if (!this.level) {
      this.log.log('level not loaded!');
      endMeasure();
      return;
    }
    this.lemmingManager.tick();
    endMeasure();
  }

  getGameState () {
    if (typeof lemmings !== 'undefined' && (lemmings.bench || lemmings.bench2 || lemmings.benchReverse)) {
      return GameStateTypes.RUNNING;
    }
    if (typeof lemmings !== 'undefined' && lemmings.endless) {
      return GameStateTypes.RUNNING;
    }
    if (this.finalGameState !== GameStateTypes.UNKNOWN) {
      return this.finalGameState;
    }

    const survivors = this.gameVictoryCondition.getSurvivorsCount();
    const need      = this.gameVictoryCondition.getNeedCount();
    const left      = this.gameVictoryCondition.getLeftCount();
    const out       = this.gameVictoryCondition.getOutCount();
    const won       = survivors >= need;

    if (left <= 0 && out <= 0) {
      return won ? GameStateTypes.SUCCEEDED
        : GameStateTypes.FAILED_LESS_LEMMINGS;
    }
    if (!lemmings?.endless && this.gameTimer?.getGameLeftTime() <= 0) {
      return won ? GameStateTypes.SUCCEEDED
        : GameStateTypes.FAILED_OUT_OF_TIME;
    }
    return GameStateTypes.RUNNING;
  }

  checkForGameOver () {
    const endMeasure = this.startMeasure('Game checkForGameOver', {
      track: 'Game',
      trackGroup: 'Game State',
      color: 'tertiary',
      tooltipText: 'checkForGameOver'
    });
    if (typeof lemmings !== 'undefined' && (lemmings.bench || lemmings.bench2 || lemmings.benchReverse)) {
      endMeasure();
      return;
    }
    if (this.finalGameState !== GameStateTypes.UNKNOWN) {
      endMeasure();
      return;
    }

    const state = this.getGameState();
    if (state !== GameStateTypes.RUNNING &&
        state !== GameStateTypes.UNKNOWN) {
      this.gameVictoryCondition.doFinalize();
      this.finalGameState = state;
      const Result = getDependency('GameResult', GameResult);
      this.onGameEnd?.trigger(new Result(this));
    }
    endMeasure();
  }

  render () {
    const endMeasure = this.startMeasure('Game render', {
      track: 'Game',
      trackGroup: 'Render',
      color: 'primary-dark',
      tooltipText: 'render'
    });
    if (this.gameDisplay) {
      this.gameDisplay.render();
      if (this.showDebug) this.gameDisplay.renderDebug();
    }
    if (this.guiDisplay) {
      this.gameGui.render();
      this.guiDisplay.redraw();
    } else if (this.display) {
      this.display.redraw();
    }
    endMeasure();
  }
}
export { Game };
