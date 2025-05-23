class Game {
  constructor (gameResources) {
    this.log                = new Lemmings.LogHandler('Game');
    this.gameResources      = gameResources;

    // runtime refs (null until loadLevel resolves)
    this.guiDisplay           = null;
    this.display              = null;
    this.gameDisplay          = null;
    this.gameTimer            = null;
    this.commandManager       = null;
    this.skills               = null;
    this.level                = null;
    this.gameGui              = null;
    this.objectManager        = null;
    this.triggerManager       = null;
    this.gameVictoryCondition = null;

    this.onGameEnd            = new Lemmings.EventHandler();
    this.finalGameState       = Lemmings.GameStateTypes.UNKNOWN;
    this.showDebug            = false;

    // bind once – reused for the whole game lifespan (avoids arrow re‑alloc)
    this._boundTick = this.onGameTimerTick.bind(this);
  }

  // ------------------------------------------------------------------- Display wiring
  setGameDisplay (display) {
    this.display = display;
    if (this.gameDisplay != null) {
      this.gameDisplay.setGuiDisplay(display);
      this.display.setScreenPosition(this.level.screenPositionX, 0);
    }
  }

  setGuiDisplay (display) {
    this.guiDisplay = display;
    if (this.gameGui != null) {
      this.gameGui.setGuiDisplay(display);
    }
  }

  // ---------------------------------------------------------------------- Load / Start
  /** Load level assets and construct managers. */
  async loadLevel (levelGroupIndex, levelIndex) {
    this.levelGroupIndex = levelGroupIndex;
    this.levelIndex      = levelIndex;

    // --------------------------- fetch level + prepare timer & managers
    const level         = await this.gameResources.getLevel(levelGroupIndex, levelIndex);
    this.level          = level;
    this.gameTimer      = new Lemmings.GameTimer(level);
    this.gameTimer.onGameTick.on(this._boundTick);

    this.commandManager       = new Lemmings.CommandManager(this, this.gameTimer);
    this.skills               = new Lemmings.GameSkills(level);
    this.gameVictoryCondition = new Lemmings.GameVictoryCondition(level);
    this.triggerManager       = new Lemmings.TriggerManager(this.gameTimer);
    this.triggerManager.addRange(level.triggers);

    // --------------------------- preload masks + lemming sprite in parallel
    const [masks, lemSprite] = await Promise.all([
      this.gameResources.getMasks(),
      this.gameResources.getLemmingsSprite(level.colorPalette),
    ]);

    // --------------------------- lemming manager + particles
    const particleTable  = new Lemmings.ParticleTable(level.colorPalette);
    this.lemmingManager  = new Lemmings.LemmingManager(level, lemSprite, this.triggerManager,
                                                      this.gameVictoryCondition, masks, particleTable);

    // --------------------------- GUI sprite & displays
    const skillPanelSprites = await this.gameResources.getSkillPanelSprite(level.colorPalette);
    this.gameGui = new Lemmings.GameGui(this, skillPanelSprites, this.skills, this.gameTimer,
                                        this.gameVictoryCondition);
    if (this.guiDisplay) {
      this.gameGui.setGuiDisplay(this.guiDisplay);
    }

    // --------------------------- misc managers
    this.objectManager = new Lemmings.ObjectManager(this.gameTimer);
    this.objectManager.addRange(level.objects);

    this.gameDisplay = new Lemmings.GameDisplay(this, level, this.lemmingManager,
                                                this.objectManager, this.triggerManager);
    if (this.display) {
      this.gameDisplay.setGuiDisplay(this.display);
    }

    return this; // keeps legacy promise signature
  }

  /** Begin / resume gameplay. */
  start () { this.gameTimer?.continue(); }

  /** Stop gameplay and dispose resources. */
  stop () {
    if (this.gameTimer) {
      this.gameTimer.stop();
      this.gameTimer = null;
    }
    this.onGameEnd.dispose();
    this.onGameEnd = null;
  }

  // ----------------------------------------------------------------------------- Accessors
  getGameTimer        () { return this.gameTimer; }
  getGameSkills       () { return this.skills; }
  getLemmingManager   () { return this.lemmingManager; }
  getVictoryCondition () { return this.gameVictoryCondition; }
  getCommandManager   () { return this.commandManager; }
  cheat               () { this.skills.cheat(); }
  setDebugMode       (v) { this.showDebug = !!v; }
  
  queueCommand(newCommand){
    this.commandManager.queueCommand(newCommand);
  }

  // ------------------------------------------------------------------------- Main loop
  /** Bound to GameTimer tick → executes logic then renders. */
  onGameTimerTick () {
    this.runGameLogic();
    this.checkForGameOver();
    this.render();
  }

  /** Execute single logic step */
  runGameLogic () {
    if (!this.level) {
      this.log.log('level not loaded!');
      return;
    }
    this.lemmingManager.tick();
  }

  // ------------------------------------------------------------------------- Game state
  getGameState () {
    if (this.finalGameState !== Lemmings.GameStateTypes.UNKNOWN) {
      return this.finalGameState;
    }

    const survivors = this.gameVictoryCondition.getSurvivorsCount();
    const need      = this.gameVictoryCondition.getNeedCount();
    const left      = this.gameVictoryCondition.getLeftCount();
    const out       = this.gameVictoryCondition.getOutCount();

    const won = survivors >= need;

    if (left <= 0 && out <= 0) {
      return won ? Lemmings.GameStateTypes.SUCCEEDED
                 : Lemmings.GameStateTypes.FAILED_LESS_LEMMINGS;
    }
    if (this.gameTimer.getGameLeftTime() <= 0) {
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
      this.onGameEnd.trigger(new Lemmings.GameResult(this));
    }
  }

  // ------------------------------------------------------------------------------ Render
  render () {
    if (this.gameDisplay) {
      this.gameDisplay.render();
      if (this.showDebug) {
        this.gameDisplay.renderDebug();
      }
    }
    if (this.guiDisplay) {
      this.gameGui.render();
      this.guiDisplay.redraw();
    }
  }
}
Lemmings.Game = Game;
export { Game };