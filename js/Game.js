import { Lemmings } from './LemmingsNamespace.js';

class Game {
        constructor(gameResources) {
            this.log = new Lemmings.LogHandler("Game");
            this.gameResources = null;
            this.guiDisplay = null;
            this.display = null;
            this.gameDisplay = null;
            this.gameTimer = null;
            this.commandManager = null;
            this.showDebug = false;
            this.onGameEnd = new Lemmings.EventHandler();
            this.finalGameState = Lemmings.GameStateTypes.UNKNOWN;
            this.gameResources = gameResources;
        }
        setGameDisplay(display) {
            this.display = display;
            if (this.gameDisplay != null) {
                this.gameDisplay.setGuiDisplay(display);
                this.display.setScreenPosition(this.level.screenPositionX, 0);
            }
        }
        setGuiDisplay(display) {
            this.guiDisplay = display;
            if (this.gameGui != null) {
                this.gameGui.setGuiDisplay(display);
            }
        }
        /** load a new game/level */
        loadLevel(levelGroupIndex, levelIndex) {
            this.levelGroupIndex = levelGroupIndex;
            this.levelIndex = levelIndex;
            return new Promise((resolve, reject) => {
                this.gameResources.getLevel(this.levelGroupIndex, this.levelIndex)
                    .then((level) => {
                        this.gameTimer = new Lemmings.GameTimer(level);
                        this.gameTimer.onGameTick.on(() => {
                            this.onGameTimerTick();
                        });
                        this.commandManager = new Lemmings.CommandManager(this, this.gameTimer);
                        this.skills = new Lemmings.GameSkills(level);
                        this.level = level;
                        this.gameVictoryCondition = new Lemmings.GameVictoryCondition(level);
                        this.triggerManager = new Lemmings.TriggerManager(this.gameTimer);
                        this.triggerManager.addRange(level.triggers);
                        /// request next resources
                        let maskPromise = this.gameResources.getMasks();
                        let lemPromise = this.gameResources.getLemmingsSprite(this.level.colorPalette);
                        return Promise.all([maskPromise, lemPromise]);
                    })
                    .then((results) => {
                        let masks = results[0];
                        let lemSprite = results[1];
                        let particleTable = new Lemmings.ParticleTable(this.level.colorPalette);
                        /// setup Lemmings
                        this.lemmingManager = new Lemmings.LemmingManager(this.level, lemSprite, this.triggerManager, this.gameVictoryCondition, masks, particleTable);
                        return this.gameResources.getSkillPanelSprite(this.level.colorPalette);
                    })
                    .then((skillPanelSprites) => {
                        /// setup gui
                        this.gameGui = new Lemmings.GameGui(this, skillPanelSprites, this.skills, this.gameTimer, this.gameVictoryCondition);
                        if (this.guiDisplay != null) {
                            this.gameGui.setGuiDisplay(this.guiDisplay);
                        }
                        this.objectManager = new Lemmings.ObjectManager(this.gameTimer);
                        this.objectManager.addRange(this.level.objects);
                        this.gameDisplay = new Lemmings.GameDisplay(this, this.level, this.lemmingManager, this.objectManager, this.triggerManager);
                        if (this.display != null) {
                            this.gameDisplay.setGuiDisplay(this.display);
                        }
                        /// let's start!
                        resolve(this);
                    });
            });
        }
        /** run the game */
        start() {
            this.gameTimer.continue();
        }
        /** end the game */
        stop() {
            this.gameTimer.stop();
            this.gameTimer = null;
            this.onGameEnd.dispose();
            this.onGameEnd = null;
        }
        /** return the game Timer for this game */
        getGameTimer() {
            return this.gameTimer;
        }
        /** increase the amount of skills */
        cheat() {
            this.skills.cheat();
        }
        getGameSkills() {
            return this.skills;
        }
        getLemmingManager() {
            return this.lemmingManager;
        }
        getVictoryCondition() {
            return this.gameVictoryCondition;
        }
        getCommandManager() {
            return this.commandManager;
        }
        queueCmmand(newCommand) {
            this.commandManager.queueCommand(newCommand);
        }
        /** enables / disables the display of debug information */
        setDebugMode(value) {
            this.showDebug = value;
        }
        /** run one step in game time and render the result */
        onGameTimerTick() {
            /// run game logic
            this.runGameLogic();
            this.checkForGameOver();
            this.render();
        }
        /** return the current state of the game */
        getGameState() {
            /// if the game has finished return its saved state
            if (this.finalGameState != Lemmings.GameStateTypes.UNKNOWN) {
                return this.finalGameState;
            }
            let hasWon = this.gameVictoryCondition.getSurvivorsCount() >= this.gameVictoryCondition.getNeedCount();
            /// are there any lemmings alive?
            if ((this.gameVictoryCondition.getLeftCount() <= 0) && (this.gameVictoryCondition.getOutCount() <= 0)) {
                if (hasWon) {
                    return Lemmings.GameStateTypes.SUCCEEDED;
                } else {
                    return Lemmings.GameStateTypes.FAILED_LESS_LEMMINGS;
                }
            }
            /// is the game out of time?
            if (this.gameTimer.getGameLeftTime() <= 0) {
                if (hasWon) {
                    return Lemmings.GameStateTypes.SUCCEEDED;
                } else {
                    return Lemmings.GameStateTypes.FAILED_OUT_OF_TIME;
                }
            }
            return Lemmings.GameStateTypes.RUNNING;
        }
        checkForGameOver() {
            if (this.finalGameState != Lemmings.GameStateTypes.UNKNOWN) {
                return;
            }
            let state = this.getGameState();
            if ((state != Lemmings.GameStateTypes.RUNNING) && (state != Lemmings.GameStateTypes.UNKNOWN)) {
                this.gameVictoryCondition.doFinalize();
                this.finalGameState = state;
                this.onGameEnd.trigger(new Lemmings.GameResult(this));
            }
        }
        /** run the game logic one step in time */
        runGameLogic() {
            if (this.level == null) {
                this.log.log("level not loaded!");
                return;
            }
            this.lemmingManager.tick();
        }
        /** refresh display */
        render() {
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
