import { Lemmings } from './LemmingsNamespace.js';

class Game {
  constructor (gameResources) {
    this.log           = new Lemmings.LogHandler('Game');
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

    this.onGameEnd      = new Lemmings.EventHandler();
    this.finalGameState = Lemmings.GameStateTypes.UNKNOWN;
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

    this.commandManager  = null;
    this.objectManager   = null;
    this.lemmingManager  = null;
    this.triggerManager  = null;
    this.gameDisplay     = null;
    this.gameGui         = null;

    this.finalGameState  = Lemmings.GameStateTypes.UNKNOWN;
  }

  async loadLevel (levelGroupIndex, levelIndex) {
    this._disposeCurrentLevel();

    // Record indices for HUD etc.
    this.levelGroupIndex = levelGroupIndex;
    this.levelIndex      = levelIndex;

    const level   = await this.gameResources.getLevel(levelGroupIndex, levelIndex);
    this.level    = level;
    this.gameTimer = new Lemmings.GameTimer(level);
    this.gameTimer.onGameTick.on(this._boundTick);

    this.commandManager       = new Lemmings.CommandManager(this, this.gameTimer);
    this.skills               = new Lemmings.GameSkills(level);
    this.gameVictoryCondition = new Lemmings.GameVictoryCondition(level);
    this.triggerManager       = new Lemmings.TriggerManager(this.gameTimer);
    this.triggerManager.addRange(level.triggers);

    const [masks, lemSprite] = await Promise.all([
      this.gameResources.getMasks(),
      this.gameResources.getLemmingsSprite(level.colorPalette),
    ]);

    const particleTable  = new Lemmings.ParticleTable(level.colorPalette);
    this.lemmingManager  = new Lemmings.LemmingManager(
      level,
      lemSprite,
      this.triggerManager,
      this.gameVictoryCondition,
      masks,
      particleTable,
    );

    const skillPanelSprites = await this.gameResources.getSkillPanelSprite(level.colorPalette);
    this.gameGui = new Lemmings.GameGui(
      this,
      skillPanelSprites,
      this.skills,
      this.gameTimer,
      this.gameVictoryCondition,
    );
    if (this.guiDisplay) this.gameGui.setGuiDisplay(this.guiDisplay);

    this.objectManager = new Lemmings.ObjectManager(this.gameTimer);
    this.objectManager.addRange(level.objects);

    this.gameDisplay = new Lemmings.GameDisplay(
      this,
      level,
      this.lemmingManager,
      this.objectManager,
      this.triggerManager,
    );
    if (this.display) this.gameDisplay.setGuiDisplay(this.display);

    return this; // keeps legacy promise signature intact
  }

  start () { this.gameTimer?.continue(); }

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
  queueCommand(cmd)   { this.commandManager?.queueCommand(cmd); }

  applySkillToSelected(skillType) {
    const lm = this.getLemmingManager();
    const skills = this.getGameSkills();
    const lem = lm?.getSelectedLemming?.();
    if (!lem || !skills?.canReuseSkill(skillType)) return false;
    if (!lm.doLemmingAction(lem, skillType)) return false;
    skills.reuseSkill(skillType);
    return true;
  }

  onGameTimerTick () {
    this.runGameLogic();
    this.checkForGameOver();
    this.render();
  }

  runGameLogic () {
    if (!this.level) {
      this.log.log('level not loaded!');
      return;
    }
    this.lemmingManager.tick();
  }

  getGameState () {
    if (this.finalGameState !== Lemmings.GameStateTypes.UNKNOWN) {
      return this.finalGameState;
    }

    const survivors = this.gameVictoryCondition.getSurvivorsCount();
    const need      = this.gameVictoryCondition.getNeedCount();
    const left      = this.gameVictoryCondition.getLeftCount();
    const out       = this.gameVictoryCondition.getOutCount();
    const won       = survivors >= need;

    if (left <= 0 && out <= 0) {
      return won ? Lemmings.GameStateTypes.SUCCEEDED
                 : Lemmings.GameStateTypes.FAILED_LESS_LEMMINGS;
    }
    if (this.gameTimer?.getGameLeftTime() <= 0) {
      return won ? Lemmings.GameStateTypes.SUCCEEDED
                 : Lemmings.GameStateTypes.FAILED_OUT_OF_TIME;
    }
    return Lemmings.GameStateTypes.RUNNING;
  }

  checkForGameOver () {
    if (this.finalGameState !== Lemmings.GameStateTypes.UNKNOWN) return;

    const state = this.getGameState();
    if (state !== Lemmings.GameStateTypes.RUNNING &&
        state !== Lemmings.GameStateTypes.UNKNOWN) {
      this.gameVictoryCondition.doFinalize();
      this.finalGameState = state;
      this.onGameEnd?.trigger(new Lemmings.GameResult(this));
    }
  }

  render () {
    if (this.gameDisplay) {
      this.gameDisplay.render();
      if (this.showDebug) this.gameDisplay.renderDebug();
    }
    if (this.guiDisplay) {
      this.gameGui.render();
      this.guiDisplay.redraw();
    }
  }
}

Lemmings.Game = Game;
export { Game };
