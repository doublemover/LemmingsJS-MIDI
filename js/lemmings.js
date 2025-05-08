var Lemmings;
(function (Lemmings) {
    /** loads the config and provides an game-resources object */
    class GameFactory {
        constructor(rootPath) {
            this.rootPath = rootPath;
            this.fileProvider = new Lemmings.FileProvider(rootPath);
            let configFileReader = this.fileProvider.loadString("config.json");
            this.configReader = new Lemmings.ConfigReader(configFileReader);
        }
        /** return a game object to control/run the game */
        getGame(gameType) {
            return new Promise((resolve, reject) => {
                /// load resources
                this.getGameResources(gameType)
                    .then((res) => resolve(new Lemmings.Game(res)));
            });
        }
        /** return the config of a game type */
        getConfig(gameType) {
            return this.configReader.getConfig(gameType);
        }
        /** return a Game Resources that gives access to images, maps, sounds  */
        getGameResources(gameType) {
            return new Promise((resolve, reject) => {
                this.configReader.getConfig(gameType).then((config) => {
                    if (config == null) {
                        reject();
                        return;
                    }
                    resolve(new Lemmings.GameResources(this.fileProvider, config));
                });
            });
        }
    }
    Lemmings.GameFactory = GameFactory;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    /** represents access to the resources of a Lemmings Game */
    class GameResources {
        constructor(fileProvider, config) {
            this.fileProvider = fileProvider;
            this.config = config;
            this.mainDat = null;
        }
        /** return the main.dat file container */
        getMainDat() {
            if (this.mainDat != null) {
                return this.mainDat;
            }
            this.mainDat = new Promise((resolve, reject) => {
                this.fileProvider.loadBinary(this.config.path, "MAIN.DAT")
                    .then((data) => {
                        /// split the file
                        let mainParts = new Lemmings.FileContainer(data);
                        resolve(mainParts);
                    });
            });
            return this.mainDat;
        }
        /** return the Lemmings animations */
        getLemmingsSprite(colorPalette) {
            return new Promise((resolve, reject) => {
                this.getMainDat().then((container) => {
                    let sprite = new Lemmings.LemmingsSprite(container.getPart(0), colorPalette);
                    resolve(sprite);
                });
            });
        }
        getSkillPanelSprite(colorPalette) {
            return new Promise((resolve, reject) => {
                this.getMainDat().then((container) => {
                    resolve(new Lemmings.SkillPanelSprites(container.getPart(2), container.getPart(6), colorPalette));
                });
            });
        }
        getMasks() {
            return new Promise((resolve, reject) => {
                this.getMainDat().then((container) => {
                    resolve(new Lemmings.MaskProvider(container.getPart(1)));
                });
            });
        }
        /** return the Level Data for a given Level-Index */
        getLevel(levelMode, levelIndex) {
            let levelReader = new Lemmings.LevelLoader(this.fileProvider, this.config);
            return levelReader.getLevel(levelMode, levelIndex);
        }
        /** return the level group names for this game */
        getLevelGroups() {
            return this.config.level.groups;
        }
    }
    Lemmings.GameResources = GameResources;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    /** collects all information about the finished game */
    class GameResult {
        constructor(game) {
            this.state = game.getGameState();
            this.replay = game.getCommandManager().serialize();
            this.survivorPercentage = game.getVictoryCondition().getSurvivorPercentage();
            this.survivors = game.getVictoryCondition().getSurvivorsCount();
            this.duration = game.getGameTimer().getGameTicks();
        }
    }
    Lemmings.GameResult = GameResult;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    var GameStateTypes;
    (function (GameStateTypes) {
        GameStateTypes[GameStateTypes["UNKNOWN"] = 0] = "UNKNOWN";
        GameStateTypes[GameStateTypes["RUNNING"] = 1] = "RUNNING";
        GameStateTypes[GameStateTypes["FAILED_OUT_OF_TIME"] = 2] = "FAILED_OUT_OF_TIME";
        GameStateTypes[GameStateTypes["FAILED_LESS_LEMMINGS"] = 3] = "FAILED_LESS_LEMMINGS";
        GameStateTypes[GameStateTypes["SUCCEEDED"] = 4] = "SUCCEEDED";
    })(GameStateTypes = Lemmings.GameStateTypes || (Lemmings.GameStateTypes = {}));
    (function (GameStateTypes) {
        function toString(type) {
            return GameStateTypes[type];
        }
        GameStateTypes.toString = toString;

        function length() {
            return 5;
        }
        GameStateTypes.length = length;

        function isValid(type) {
            return ((type > GameStateTypes.UNKNOWN) && (type < this.length()));
        }
        GameStateTypes.isValid = isValid;
        /** return the GameStateTypes with the given name */
        function fromString(typeName) {
            typeName = typeName.trim().toUpperCase();
            for (let i = 0; i < this.length(); i++) {
                if (GameStateTypes[i] == typeName) {
                    return i;
                }
            }
            return GameStateTypes.UNKNOWN;
        }
        GameStateTypes.fromString = fromString;
    })(GameStateTypes = Lemmings.GameStateTypes || (Lemmings.GameStateTypes = {}));
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    var GameTypes;
    (function (GameTypes) {
        GameTypes[GameTypes["UNKNOWN"] = 0] = "UNKNOWN";
        GameTypes[GameTypes["LEMMINGS"] = 1] = "LEMMINGS";
        GameTypes[GameTypes["OHNO"] = 2] = "OHNO";
        /*GameTypes[GameTypes["XMAS91"] = 3] = "XMAS91";
        GameTypes[GameTypes["XMAS92"] = 4] = "XMAS92";
        GameTypes[GameTypes["HOLIDAY93"] = 5] = "HOLIDAY93";
        GameTypes[GameTypes["HOLIDAY94"] = 6] = "HOLIDAY94";*/
    })(GameTypes = Lemmings.GameTypes || (Lemmings.GameTypes = {}));
    (function (GameTypes) {
        function toString(type) {
            return GameTypes[type];
        }
        GameTypes.toString = toString;

        function length() {
            return 7;
        }
        GameTypes.length = length;

        function isValid(type) {
            return ((type > GameTypes.UNKNOWN) && (type < this.length()));
        }
        GameTypes.isValid = isValid;
        /** return the GameTypes with the given name */
        function fromString(typeName) {
            typeName = typeName.trim().toUpperCase();
            for (let i = 0; i < this.length(); i++) {
                if (GameTypes[i] == typeName) {
                    return i;
                }
            }
            return GameTypes.UNKNOWN;
        }
        GameTypes.fromString = fromString;
    })(GameTypes = Lemmings.GameTypes || (Lemmings.GameTypes = {}));
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    /** provides an game object to pixel the game */
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
            }
            this.guiDisplay.redraw();
        }
    }
    Lemmings.Game = Game;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    class GameConfig {
        constructor() {
            /** Name of the Lemmings Game */
            this.name = "";
            /** Path/Url to the resources */
            this.path = "";
            /** unique GameType Name */
            this.gametype = Lemmings.GameTypes.UNKNOWN;
            this.level = new Lemmings.LevelConfig();
        }
    }
    Lemmings.GameConfig = GameConfig;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    class LevelConfig {
        constructor() {
            /** file Prefix used in the filename of the level-file */
            this.filePrefix = "LEVEL";
            /** use the odd-table-file */
            this.useOddTable = false;
            /** the names of the level groups */
            this.groups = [];
            /** sort order of the levels for each group
             *   every entry is a number where:
             *     ->  (FileId * 10 + FilePart) * (useOddTabelEntry? -1 : 1)
             */
            this.order = [];
        }
        getGroupLength(groupIndex) {
            if ((groupIndex < 0) || (groupIndex > this.order.length)) {
                return 0;
            }
            return this.order[groupIndex].length;
        }
    }
    Lemmings.LevelConfig = LevelConfig;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    class GameSkills {
        constructor(level) {
            this.selectedSkill = Lemmings.SkillTypes.CLIMBER;
            this.onCountChanged = new Lemmings.EventHandler();
            this.onSelectionChanged = new Lemmings.EventHandler();
            this.skills = level.skills;
        }
        /** return true if the skill can be reused / used */
        canReduseSkill(type) {
            return (this.skills[type] > 0);
        }
        reduseSkill(type) {
            if (this.skills[type] <= 0)
                return false;
            this.skills[type]--;
            this.onCountChanged.trigger(type);
            return true;
        }
        getSkill(type) {
            if (!Lemmings.SkillTypes.isValid(type))
                return 0;
            return this.skills[type];
        }
        getSelectedSkill() {
            return this.selectedSkill;
        }
        setSelectedSkill(skill) {
            if (this.selectedSkill == skill) {
                return false;
            }
            if (!Lemmings.SkillTypes.isValid(skill)) {
                return false;
            }
            this.selectedSkill = skill;
            this.onSelectionChanged.trigger();
            return true;
        }
        /** increase the amount of actions for all skills */
        cheat() {
            for (let i = 0; i < this.skills.length; i++) {
                this.skills[i] = 99;
                this.onCountChanged.trigger(i);
            }
        }
    }
    Lemmings.GameSkills = GameSkills;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    class GameTimer {
        constructor(level) {
            this.TIME_PER_FRAME_MS = 60;
            this._speedFactor = 1;
            this.gameTimerHandler = 0;
            /** the current game time in number of steps the game has made  */
            this.tickIndex = 0;
            /** event raising on every tick (one step in time) the game made */
            this.onGameTick = new Lemmings.EventHandler();
            /** event raising on before every tick (one step in time) the game made */
            this.onBeforeGameTick = new Lemmings.EventHandler();
            this.ticksTimeLimit = this.secondsToTicks(level.timeLimit * 60);
        }
        /** return if the game timer is running or not */
        isRunning() {
            return (this.gameTimerHandler != 0);
        }
        /** define a factor to speed up >1 or slow down <1 the game */
        get speedFactor() {
            return this._speedFactor;
        }
        /** set a factor to speed up >1 or slow down <1 the game */
        set speedFactor(newSpeedFactor) {
            this._speedFactor = newSpeedFactor;
            if (!this.isRunning()) {
                return;
            }
            this.suspend();
            this.continue();
        }
        /** Pause the game */
        suspend() {
            if (this.gameTimerHandler != 0) {
                clearInterval(this.gameTimerHandler);
            }
            this.gameTimerHandler = 0;
        }
        /** End the game */
        stop() {
            this.suspend();
            this.onBeforeGameTick.dispose();
            this.onGameTick.dispose();
        }
        /** toggle between suspend and continue */
        toggle() {
            if (this.isRunning()) {
                this.suspend();
            } else {
                this.continue();
            }
        }
        /** Run the game timer */
        continue () {
            if (this.isRunning()) {
                return;
            }
            this.gameTimerHandler = setInterval(() => {
                this.tick();
            }, (this.TIME_PER_FRAME_MS / this._speedFactor));
        }
        /** run the game one step in time */
        tick() {
            if (this.onBeforeGameTick != null)
                this.onBeforeGameTick.trigger(this.tickIndex);
            this.tickIndex++;
            if (this.onGameTick != null)
                this.onGameTick.trigger();
        }
        /** return the past game time in seconds */
        getGameTime() {
            return Math.floor(this.ticksToSeconds(this.tickIndex));
        }
        /** return the past game time in ticks */
        getGameTicks() {
            return this.tickIndex;
        }
        /** return the left game time in seconds */
        getGameLeftTime() {
            let leftTicks = this.ticksTimeLimit - this.tickIndex;
            if (leftTicks < 0)
                leftTicks = 0;
            return Math.floor(this.ticksToSeconds(leftTicks));
        }
        /** return the left game time in seconds */
        getGameLeftTimeString() {
            let leftSeconds = this.getGameLeftTime();
            let secondsStr = "0" + Math.floor(leftSeconds % 60);
            return Math.floor(leftSeconds / 60) + "-" + secondsStr.substr(secondsStr.length - 2, 2);
        }
        /** convert a game-ticks-time to in game-seconds. Returns Float */
        ticksToSeconds(ticks) {
            return ticks * (this.TIME_PER_FRAME_MS / 1000);
        }
        /** calc the number ticks form game-time in seconds  */
        secondsToTicks(seconds) {
            return seconds * (1000 / this.TIME_PER_FRAME_MS);
        }
        /** return the maximum time in seconds to win the game  */
        getGameTimeLimit() {
            return this.ticksTimeLimit;
        }
    }
    Lemmings.GameTimer = GameTimer;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    /// Handles the number of lemmings
    ///  - needed to win or lose the game
    ///  - release rate
    class GameVictoryCondition {
        constructor(level) {
            this.isFinalize = false;
            this.needCount = level.needCount;
            this.releaseCount = level.releaseCount;
            this.leftCount = level.releaseCount;
            this.minReleaseRate = level.releaseRate;
            this.releaseRate = level.releaseRate;
            this.survivorCount = 0;
            this.outCount = 0;
        }
        getNeedCount() {
            return this.needCount;
        }
        getReleaseCount() {
            return this.releaseCount;
        }
        changeReleaseRate(count) {
            if (this.isFinalize) {
                return false;
            }
            let oldReleaseRate = this.releaseRate;
            let newReleaseRate = this.boundToRange(this.minReleaseRate, this.releaseRate + count, GameVictoryCondition.maxReleaseRate);
            if (newReleaseRate == oldReleaseRate) {
                return false;
            }
            this.releaseRate = newReleaseRate;
            return true;
        }
        boundToRange(min, value, max) {
            return Math.min(max, Math.max(min, value | 0)) | 0;
        }
        getMinReleaseRate() {
            return this.minReleaseRate;
        }
        getCurrentReleaseRate() {
            return this.releaseRate;
        }
        /** one lemming reached the exit */
        addSurvivor() {
            if (this.isFinalize) {
                return;
            }
            this.survivorCount++;
        }
        /** number of rescued lemmings */
        getSurvivorsCount() {
            return this.survivorCount;
        }
        /** number of rescued lemmings in percentage */
        getSurvivorPercentage() {
            return Math.floor(this.survivorCount / this.releaseCount * 100) | 0;
        }
        /** number of alive lemmings out in the level */
        getOutCount() {
            return this.outCount;
        }
        /** the number of lemmings not yet released */
        getLeftCount() {
            return this.leftCount;
        }
        /** release one new lemming */
        releaseOne() {
            if ((this.isFinalize) || (this.leftCount <= 0)) {
                return;
            }
            this.leftCount--;
            this.outCount++;
        }
        /** if a lemming die */
        removeOne() {
            if (this.isFinalize) {
                return;
            }
            this.outCount--;
        }
        /** stop releasing lemmings */
        doNuke() {
            if (this.isFinalize) {
                return;
            }
            this.leftCount = 0;
        }
        /** stop any changing in the conditions */
        doFinalize() {
            if (this.isFinalize) {
                return;
            }
            this.isFinalize = true;
        }
    }
    GameVictoryCondition.maxReleaseRate = 99;
    Lemmings.GameVictoryCondition = GameVictoryCondition;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    var LemmingStateType;
    (function (LemmingStateType) {
        LemmingStateType[LemmingStateType["NO_STATE_TYPE"] = 0] = "NO_STATE_TYPE";
        LemmingStateType[LemmingStateType["WALKING"] = 1] = "WALKING";
        LemmingStateType[LemmingStateType["SPLATTING"] = 2] = "SPLATTING";
        LemmingStateType[LemmingStateType["EXPLODING"] = 3] = "EXPLODING";
        LemmingStateType[LemmingStateType["FALLING"] = 4] = "FALLING";
        LemmingStateType[LemmingStateType["JUMPING"] = 5] = "JUMPING";
        LemmingStateType[LemmingStateType["DIGGING"] = 6] = "DIGGING";
        LemmingStateType[LemmingStateType["CLIMBING"] = 7] = "CLIMBING";
        LemmingStateType[LemmingStateType["HOISTING"] = 8] = "HOISTING";
        LemmingStateType[LemmingStateType["BUILDING"] = 9] = "BUILDING";
        LemmingStateType[LemmingStateType["BLOCKING"] = 10] = "BLOCKING";
        LemmingStateType[LemmingStateType["BASHING"] = 11] = "BASHING";
        LemmingStateType[LemmingStateType["FLOATING"] = 12] = "FLOATING";
        LemmingStateType[LemmingStateType["MINING"] = 13] = "MINING";
        LemmingStateType[LemmingStateType["DROWNING"] = 14] = "DROWNING";
        LemmingStateType[LemmingStateType["EXITING"] = 15] = "EXITING";
        LemmingStateType[LemmingStateType["FRYING"] = 16] = "FRYING";
        LemmingStateType[LemmingStateType["OHNO"] = 17] = "OHNO";
        LemmingStateType[LemmingStateType["SHRUG"] = 18] = "SHRUG";
        LemmingStateType[LemmingStateType["OUT_OFF_LEVEL"] = 19] = "OUT_OFF_LEVEL";
    })(LemmingStateType = Lemmings.LemmingStateType || (Lemmings.LemmingStateType = {}));
})(Lemmings || (Lemmings = {}));
/// <reference path="./lemming-state-type.ts"/>
var Lemmings;
(function (Lemmings) {
    class LemmingManager {
        constructor(level, lemmingsSprite, triggerManager, gameVictoryCondition, masks, particleTable) {
            this.level = level;
            this.triggerManager = triggerManager;
            this.gameVictoryCondition = gameVictoryCondition;
            /** list of all Lemming in the game */
            this.lemmings = [];
            /** list of all Actions a Lemming can do */
            this.actions = [];
            this.skillActions = [];
            this.releaseTickIndex = 0;
            this.logging = new Lemmings.LogHandler("LemmingManager");
            /** next lemming index need to explode */
            this.nextNukingLemmingsIndex = -1;
            this.actions[Lemmings.LemmingStateType.WALKING] = new Lemmings.ActionWalkSystem(lemmingsSprite);
            this.actions[Lemmings.LemmingStateType.FALLING] = new Lemmings.ActionFallSystem(lemmingsSprite);
            this.actions[Lemmings.LemmingStateType.JUMPING] = new Lemmings.ActionJumpSystem(lemmingsSprite);
            this.actions[Lemmings.LemmingStateType.DIGGING] = new Lemmings.ActionDiggSystem(lemmingsSprite);
            this.actions[Lemmings.LemmingStateType.EXITING] = new Lemmings.ActionExitingSystem(lemmingsSprite, gameVictoryCondition);
            this.actions[Lemmings.LemmingStateType.FLOATING] = new Lemmings.ActionFloatingSystem(lemmingsSprite);
            this.actions[Lemmings.LemmingStateType.BLOCKING] = new Lemmings.ActionBlockerSystem(lemmingsSprite, triggerManager);
            this.actions[Lemmings.LemmingStateType.MINING] = new Lemmings.ActionMineSystem(lemmingsSprite, masks);
            this.actions[Lemmings.LemmingStateType.CLIMBING] = new Lemmings.ActionClimbSystem(lemmingsSprite);
            this.actions[Lemmings.LemmingStateType.HOISTING] = new Lemmings.ActionHoistSystem(lemmingsSprite);
            this.actions[Lemmings.LemmingStateType.BASHING] = new Lemmings.ActionBashSystem(lemmingsSprite, masks);
            this.actions[Lemmings.LemmingStateType.BUILDING] = new Lemmings.ActionBuildSystem(lemmingsSprite);
            this.actions[Lemmings.LemmingStateType.SHRUG] = new Lemmings.ActionShrugSystem(lemmingsSprite);
            this.actions[Lemmings.LemmingStateType.EXPLODING] = new Lemmings.ActionExplodingSystem(lemmingsSprite, masks, triggerManager, particleTable);
            this.actions[Lemmings.LemmingStateType.OHNO] = new Lemmings.ActionOhNoSystem(lemmingsSprite);
            this.actions[Lemmings.LemmingStateType.SPLATTING] = new Lemmings.ActionSplatterSystem(lemmingsSprite);
            this.actions[Lemmings.LemmingStateType.DROWNING] = new Lemmings.ActionDrowningSystem(lemmingsSprite);
            this.skillActions[Lemmings.SkillTypes.DIGGER] = this.actions[Lemmings.LemmingStateType.DIGGING];
            this.skillActions[Lemmings.SkillTypes.FLOATER] = this.actions[Lemmings.LemmingStateType.FLOATING];
            this.skillActions[Lemmings.SkillTypes.BLOCKER] = this.actions[Lemmings.LemmingStateType.BLOCKING];
            this.skillActions[Lemmings.SkillTypes.MINER] = this.actions[Lemmings.LemmingStateType.MINING];
            this.skillActions[Lemmings.SkillTypes.CLIMBER] = this.actions[Lemmings.LemmingStateType.CLIMBING];
            this.skillActions[Lemmings.SkillTypes.BASHER] = this.actions[Lemmings.LemmingStateType.BASHING];
            this.skillActions[Lemmings.SkillTypes.BUILDER] = this.actions[Lemmings.LemmingStateType.BUILDING];
            this.skillActions[Lemmings.SkillTypes.BOMBER] = new Lemmings.ActionCountdownSystem(masks);
            /// wait before first lemming is spawn
            this.releaseTickIndex = this.gameVictoryCondition.getCurrentReleaseRate() - 30;
        }
        processNewAction(lem, newAction) {
            if (newAction == Lemmings.LemmingStateType.NO_STATE_TYPE) {
                return false;
            }
            this.setLemmingState(lem, newAction);
            return true;
        }
        /** process all Lemmings to the next time-step */
        tick() {
            this.addNewLemmings();
            let lems = this.lemmings;
            if (this.isNuking()) {
                this.doLemmingAction(lems[this.nextNukingLemmingsIndex], Lemmings.SkillTypes.BOMBER);
                this.nextNukingLemmingsIndex++;
            }
            for (let i = 0; i < lems.length; i++) {
                let lem = lems[i];
                if (lem.removed)
                    continue;
                let newAction = lem.process(this.level);
                this.processNewAction(lem, newAction);
                let triggerAction = this.runTrigger(lem);
                this.processNewAction(lem, triggerAction);
            }
        }
        /** Add a new Lemming to the manager */
        addLemming(x, y) {
            let lem = new Lemmings.Lemming(x, y, this.lemmings.length);
            this.setLemmingState(lem, Lemmings.LemmingStateType.FALLING);
            this.lemmings.push(lem);
        }
        /** let a new lemming arise from an entrance */
        addNewLemmings() {
            if (this.gameVictoryCondition.getLeftCount() <= 0) {
                return;
            }
            this.releaseTickIndex++;
            if (this.releaseTickIndex >= (104 - this.gameVictoryCondition.getCurrentReleaseRate())) {
                this.releaseTickIndex = 0;
                let entrance = this.level.entrances[0];
                this.addLemming(entrance.x + 24, entrance.y + 14);
                this.gameVictoryCondition.releaseOne();
            }
        }
        runTrigger(lem) {
            if (lem.isRemoved() || (lem.isDisabled())) {
                return Lemmings.LemmingStateType.NO_STATE_TYPE;
            }
            let triggerType = this.triggerManager.trigger(lem.x, lem.y);
            switch (triggerType) {
            case Lemmings.TriggerTypes.NO_TRIGGER:
                return Lemmings.LemmingStateType.NO_STATE_TYPE;
            case Lemmings.TriggerTypes.DROWN:
                return Lemmings.LemmingStateType.DROWNING;
            case Lemmings.TriggerTypes.EXIT_LEVEL:
                return Lemmings.LemmingStateType.EXITING;
            case Lemmings.TriggerTypes.KILL:
                return Lemmings.LemmingStateType.SPLATTING;
            case Lemmings.TriggerTypes.TRAP:
                return Lemmings.LemmingStateType.HOISTING;
            case Lemmings.TriggerTypes.BLOCKER_LEFT:
                if (lem.lookRight)
                    lem.lookRight = false;
                return Lemmings.LemmingStateType.NO_STATE_TYPE;
            case Lemmings.TriggerTypes.BLOCKER_RIGHT:
                if (!lem.lookRight)
                    lem.lookRight = true;
                return Lemmings.LemmingStateType.NO_STATE_TYPE;
            default:
                this.logging.log("unknown trigger type: " + triggerType);
                return Lemmings.LemmingStateType.NO_STATE_TYPE;
            }
        }
        /** render all Lemmings to the GameDisplay */
        render(gameDisplay) {
            let lems = this.lemmings;
            for (let i = 0; i < lems.length; i++) {
                lems[i].render(gameDisplay);
            }
        }
        /** render all Lemmings to the GameDisplay */
        renderDebug(gameDisplay) {
            let lems = this.lemmings;
            for (let i = 0; i < lems.length; i++) {
                lems[i].renderDebug(gameDisplay);
            }
        }
        /** return the lemming with a given id */
        getLemming(id) {
            return this.lemmings[id];
        }
        /** return a lemming a a given position */
        getLemmingAt(x, y) {
            let lems = this.lemmings;
            let minDistance = 99999;
            let minDistanceLem = null;
            for (let i = 0; i < lems.length; i++) {
                let lem = lems[i];
                let distance = lem.getClickDistance(x, y);
                //console.log("--> "+ distance);
                if ((distance < 0) || (distance >= minDistance)) {
                    continue;
                }
                minDistance = distance;
                minDistanceLem = lem;
            }
            //console.log("====> "+ (minDistanceLem? minDistanceLem.id : "null"));
            return minDistanceLem;
        }
        /** change the action a Lemming is doing */
        setLemmingState(lem, stateType) {
            if (stateType == Lemmings.LemmingStateType.OUT_OFF_LEVEL) {
                lem.remove();
                this.gameVictoryCondition.removeOne();
                return;
            }
            let actionSystem = this.actions[stateType];
            if (actionSystem == null) {
                lem.remove();
                this.logging.log(lem.id + " Action: Error not an action: " + Lemmings.LemmingStateType[stateType]);
                return;
            } else {
                this.logging.debug(lem.id + " Action: " + actionSystem.getActionName());
            }
            lem.setAction(actionSystem);
        }
        /** change the action a Lemming is doing */
        doLemmingAction(lem, skillType) {
            if (lem == null) {
                return false;
            }
            let actionSystem = this.skillActions[skillType];
            if (!actionSystem) {
                this.logging.log(lem.id + " Unknown Action: " + skillType);
                return false;
            }
            return actionSystem.triggerLemAction(lem);
        }
        /** return if the game is in nuke state */
        isNuking() {
            return this.nextNukingLemmingsIndex >= 0;
        }
        /** start the nuking of all lemmings */
        doNukeAllLemmings() {
            this.nextNukingLemmingsIndex = 0;
        }
    }
    Lemmings.LemmingManager = LemmingManager;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    class Lemming {
        constructor(x, y, id) {
            this.x = 0;
            this.y = 0;
            this.lookRight = true;
            this.frameIndex = 0;
            this.canClimb = false;
            this.hasParachute = false;
            this.removed = false;
            this.countdown = 0;
            this.state = 0;
            this.disabled = false;
            this.x = x;
            this.y = y;
            this.id = id;
        }
        /** return the number shown as countdown */
        getCountDownTime() {
            return (8 - (this.countdown >> 4));
        }
        /** switch the action of this lemming */
        setAction(action) {
            this.action = action;
            this.frameIndex = 0;
            this.state = 0;
        }
        /** set the countdown action of this lemming */
        setCountDown(action) {
            this.countdownAction = action;
            if (this.countdown > 0) {
                return false;
            }
            this.countdown = 80;
            return true;
        }
        /** return the distance of this lemming to a given position */
        getClickDistance(x, y) {
            let yCenter = this.y - 5;
            let xCenter = this.x;
            let x1 = xCenter - 5;
            let y1 = yCenter - 6;
            let x2 = xCenter + 5;
            let y2 = yCenter + 7;
            //console.log(this.id + " : "+ x1 +"-"+ x2 +"  "+ y1 +"-"+ y2);
            if ((x >= x1) && (x <= x2) && (y >= y1) && (y < y2)) {
                return ((yCenter - y) * (yCenter - y) + (xCenter - x) * (xCenter - x));
            }
            return -1;
        }
        /** render this lemming to the display */
        render(gameDisplay) {
            if (!this.action) {
                return;
            }
            if (this.countdownAction != null) {
                this.countdownAction.draw(gameDisplay, this);
            }
            this.action.draw(gameDisplay, this);
        }
        /** render this lemming debug "information" to the display */
        renderDebug(gameDisplay) {
            if (!this.action) {
                return;
            }
            gameDisplay.setDebugPixel(this.x, this.y);
        }
        /** process this lemming one tick in time */
        process(level) {
            if ((this.x < 0) || (this.x >= level.width) || (this.y < 0) || (this.y >= level.height + 6)) {
                return Lemmings.LemmingStateType.OUT_OFF_LEVEL;
            }
            /// run main action
            if (!this.action) {
                return Lemmings.LemmingStateType.OUT_OFF_LEVEL;
            }
            /// run secondary action
            if (this.countdownAction) {
                let newAction = this.countdownAction.process(level, this);
                if (newAction != Lemmings.LemmingStateType.NO_STATE_TYPE) {
                    return newAction;
                }
            }
            if (this.action) {
                return this.action.process(level, this);
            }
        }
        /** disable this lemming so it can no longer be triggered
         *   or selected by the user */
        disable() {
            this.disabled = true;
        }
        /** remove this lemming */
        remove() {
            this.action = null;
            this.countdownAction = null;
            this.removed = true;
        }
        isDisabled() {
            return this.disabled;
        }
        isRemoved() {
            return (this.action == null);
        }
    }
    Lemming.LEM_MIN_Y = -5;
    Lemming.LEM_MAX_FALLING = 60;
    Lemmings.Lemming = Lemming;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    /** represent a object (e.g. Exit, Entry, Trap, ...) */
    class MapObject {
        constructor(ob, objectImg) {
            this.x = ob.x;
            this.y = ob.y;
            this.drawProperties = ob.drawProperties;
            this.animation = new Lemmings.Animation();
            this.animation.isRepeat = objectImg.animationLoop;
            this.animation.firstFrameIndex = objectImg.firstFrameIndex;
            for (let i = 0; i < objectImg.frames.length; i++) {
                let newFrame = new Lemmings.Frame(objectImg.width, objectImg.height);
                //newFrame.clear();
                newFrame.drawPaletteImage(objectImg.frames[i], objectImg.width, objectImg.height, objectImg.palette, 0, 0);
                this.animation.frames.push(newFrame);
            }
        }
    }
    Lemmings.MapObject = MapObject;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    /** manages all objects on the map */
    class ObjectManager {
        constructor(gameTimer) {
            this.gameTimer = gameTimer;
            this.objects = [];
        }
        /** render all Objects to the GameDisplay */
        render(gameDisplay) {
            let objs = this.objects;
            let tick = this.gameTimer.getGameTicks();
            for (let i = 0; i < objs.length; i++) {
                let obj = objs[i];
                gameDisplay.drawFrameFlags(obj.animation.getFrame(tick), obj.x, obj.y, obj.drawProperties);
            }
        }
        /** add map objects to manager */
        addRange(mapObjects) {
            for (let i = 0; i < mapObjects.length; i++) {
                this.objects.push(mapObjects[i]);
            }
        }
    }
    Lemmings.ObjectManager = ObjectManager;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    /** the skills/behaviors a Lemming could have */
    var SkillTypes;
    (function (SkillTypes) {
        SkillTypes[SkillTypes["UNKNOWN"] = 0] = "UNKNOWN";
        SkillTypes[SkillTypes["CLIMBER"] = 1] = "CLIMBER";
        SkillTypes[SkillTypes["FLOATER"] = 2] = "FLOATER";
        SkillTypes[SkillTypes["BOMBER"] = 3] = "BOMBER";
        SkillTypes[SkillTypes["BLOCKER"] = 4] = "BLOCKER";
        SkillTypes[SkillTypes["BUILDER"] = 5] = "BUILDER";
        SkillTypes[SkillTypes["BASHER"] = 6] = "BASHER";
        SkillTypes[SkillTypes["MINER"] = 7] = "MINER";
        SkillTypes[SkillTypes["DIGGER"] = 8] = "DIGGER";
    })(SkillTypes = Lemmings.SkillTypes || (Lemmings.SkillTypes = {}));
    /** helper functions for SkillTypes */
    (function (SkillTypes) {
        function toString(type) {
            return SkillTypes[type];
        }
        SkillTypes.toString = toString;

        function length() {
            return 9;
        }
        SkillTypes.length = length;

        function isValid(type) {
            if (type == null)
                return false;
            return ((type > SkillTypes.UNKNOWN) && (type < SkillTypes.length()));
        }
        SkillTypes.isValid = isValid;
    })(SkillTypes = Lemmings.SkillTypes || (Lemmings.SkillTypes = {}));
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    /** manage the in-game Lemmings animation sprite */
    class LemmingsSprite {
        constructor(fr, colorPalette) {
            this.lemmingAnimation = []; //- Lookup table from ActionType -> this.animations(); First Element: left-move, Second: right-move
            this.colorPalette = colorPalette;
            this.registerAnimation(Lemmings.SpriteTypes.WALKING, 1, fr, 2, 16, 10, -8, -10, 8); //- walking (r)
            this.registerAnimation(Lemmings.SpriteTypes.JUMPING, 1, fr, 2, 16, 10, -8, -10, 1); //- jumping (r)
            this.registerAnimation(Lemmings.SpriteTypes.WALKING, -1, fr, 2, 16, 10, -8, -10, 8); //- walking (l)
            this.registerAnimation(Lemmings.SpriteTypes.JUMPING, -1, fr, 2, 16, 10, -8, -10, 1); //- jumping (l)
            this.registerAnimation(Lemmings.SpriteTypes.DIGGING, 0, fr, 3, 16, 14, -8, -12, 16); //- digging
            this.registerAnimation(Lemmings.SpriteTypes.CLIMBING, 1, fr, 2, 16, 12, -8, -12, 8); //- climbing (r)
            this.registerAnimation(Lemmings.SpriteTypes.CLIMBING, -1, fr, 2, 16, 12, -8, -12, 8); //- climbing (l)
            this.registerAnimation(Lemmings.SpriteTypes.DROWNING, 0, fr, 2, 16, 10, -8, -10, 16); //- drowning
            this.registerAnimation(Lemmings.SpriteTypes.POSTCLIMBING, 1, fr, 2, 16, 12, -8, -12, 8); //- post-climb (r)
            this.registerAnimation(Lemmings.SpriteTypes.POSTCLIMBING, -1, fr, 2, 16, 12, -8, -12, 8); //- post-climb (l)
            this.registerAnimation(Lemmings.SpriteTypes.BUILDING, 1, fr, 3, 16, 13, -8, -13, 16); //- brick-laying (r)
            this.registerAnimation(Lemmings.SpriteTypes.BUILDING, -1, fr, 3, 16, 13, -8, -13, 16); //- brick-laying (l)
            this.registerAnimation(Lemmings.SpriteTypes.BASHING, 1, fr, 3, 16, 10, -8, -10, 32); //- bashing (r)
            this.registerAnimation(Lemmings.SpriteTypes.BASHING, -1, fr, 3, 16, 10, -8, -10, 32); //- bashing (l)
            this.registerAnimation(Lemmings.SpriteTypes.MINING, 1, fr, 3, 16, 13, -8, -12, 24); //- mining (r)
            this.registerAnimation(Lemmings.SpriteTypes.MINING, -1, fr, 3, 16, 13, -8, -12, 24); //- mining (l)
            this.registerAnimation(Lemmings.SpriteTypes.FALLING, 1, fr, 2, 16, 10, -8, -10, 4); //- falling (r)
            this.registerAnimation(Lemmings.SpriteTypes.FALLING, -1, fr, 2, 16, 10, -8, -10, 4); //- falling (l)
            this.registerAnimation(Lemmings.SpriteTypes.UMBRELLA, 1, fr, 3, 16, 16, -8, -16, 8); //- pre-umbrella (r)
            this.registerAnimation(Lemmings.SpriteTypes.UMBRELLA, -1, fr, 3, 16, 16, -8, -16, 8); //- umbrella (r)
            this.registerAnimation(Lemmings.SpriteTypes.SPLATTING, 0, fr, 2, 16, 10, -8, -10, 16); //- splatting
            this.registerAnimation(Lemmings.SpriteTypes.EXITING, 0, fr, 2, 16, 13, -8, -13, 8); //- exiting
            this.registerAnimation(Lemmings.SpriteTypes.FRYING, 1, fr, 4, 16, 14, -8, -10, 14); //- fried
            this.registerAnimation(Lemmings.SpriteTypes.BLOCKING, 0, fr, 2, 16, 10, -8, -10, 16); //- blocking
            this.registerAnimation(Lemmings.SpriteTypes.SHRUGGING, 1, fr, 2, 16, 10, -8, -10, 8); //- shrugging (r)
            this.registerAnimation(Lemmings.SpriteTypes.SHRUGGING, 0, fr, 2, 16, 10, -8, -10, 8); //- shrugging (l)
            this.registerAnimation(Lemmings.SpriteTypes.OHNO, 0, fr, 2, 16, 10, -8, -10, 16); //- oh-no-ing
            this.registerAnimation(Lemmings.SpriteTypes.EXPLODING, 0, fr, 3, 32, 32, -8, -10, 1); //- explosion
        }
        /** return the animation for a given animation type */
        getAnimation(state, right) {
            return this.lemmingAnimation[this.typeToIndex(state, right)];
        }
        typeToIndex(state, right) {
            return state * 2 + (right ? 0 : 1);
        }
        registerAnimation(state, dir, fr, bitsPerPixel, width, height, offsetX, offsetY, frames) {
            //- load animation frames from file (fr)
            var animation = new Lemmings.Animation();
            animation.loadFromFile(fr, bitsPerPixel, width, height, frames, this.colorPalette, offsetX, offsetY);
            //- add animation to cache -add unidirectional (dir == 0) animations to both lists
            if (dir >= 0) {
                this.lemmingAnimation[this.typeToIndex(state, true)] = animation;
            }
            if (dir <= 0) {
                this.lemmingAnimation[this.typeToIndex(state, false)] = animation;
            }
        }
    }
    Lemmings.LemmingsSprite = LemmingsSprite;
})(Lemmings || (Lemmings = {}));
/// <reference path="../resources/lemmings-sprite.ts"/>
var Lemmings;
(function (Lemmings) {
    /** manages all triggers */
    class TriggerManager {
        constructor(gameTimer) {
            this.gameTimer = gameTimer;
            this.triggers = [];
        }
        /** add a new trigger to the manager */
        add(trigger) {
            this.triggers.push(trigger);
        }
        /** remove all triggers having a giving owner */
        removeByOwner(owner) {
            let triggerIndex = (this.triggers.length - 1);
            while (triggerIndex >= 0) {
                triggerIndex = this.triggers.findIndex((t) => t.owner == owner);
                if (triggerIndex >= 0) {
                    this.triggers.splice(triggerIndex, 1);
                }
            }
        }
        /** add a new trigger to the manager */
        remove(trigger) {
            let triggerIndex = this.triggers.indexOf(trigger);
            this.triggers.splice(triggerIndex, 1);
        }
        addRange(newTriggers) {
            for (let i = 0; i < newTriggers.length; i++) {
                this.triggers.push(newTriggers[i]);
            }
        }
        renderDebug(gameDisplay) {
            for (let i = 0; i < this.triggers.length; i++) {
                this.triggers[i].draw(gameDisplay);
            }
        }
        /** test all triggers. Returns the triggered type that matches */
        trigger(x, y) {
            let l = this.triggers.length;
            let tick = this.gameTimer.getGameTicks();
            for (var i = 0; i < l; i++) {
                let type = this.triggers[i].trigger(x, y, tick);
                if (type != Lemmings.TriggerTypes.NO_TRIGGER)
                    return type;
            }
            return Lemmings.TriggerTypes.NO_TRIGGER;
        }
    }
    Lemmings.TriggerManager = TriggerManager;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    /** A trigger that can be hit by a lemming */
    class Trigger {
        constructor(type, x1, y1, x2, y2, disableTicksCount = 0, soundIndex = -1, owner = null) {
            this.owner = null;
            this.x1 = 0;
            this.y1 = 0;
            this.x2 = 0;
            this.y2 = 0;
            this.type = Lemmings.TriggerTypes.NO_TRIGGER;
            this.disableTicksCount = 0;
            this.disabledUntilTick = 0;
            this.owner = owner;
            this.type = type;
            this.x1 = Math.min(x1, x2);
            this.y1 = Math.min(y1, y2);
            this.x2 = Math.max(x1, x2);
            this.y2 = Math.max(y1, y2);
            this.disableTicksCount = disableTicksCount;
        }
        trigger(x, y, tick) {
            if (this.disabledUntilTick <= tick) {
                if ((x >= this.x1) && (y >= this.y1) && (x <= this.x2) && (y <= this.y2)) {
                    this.disabledUntilTick = tick + this.disableTicksCount;
                    return this.type;
                }
            }
            return Lemmings.TriggerTypes.NO_TRIGGER;
        }
        draw(gameDisplay) {
            gameDisplay.drawRect(this.x1, this.y1, this.x2 - this.x1, this.y2 - this.y1, 255, 0, 0);
        }
    }
    Lemmings.Trigger = Trigger;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    class ActionBashSystem {
        constructor(sprites, masks) {
            this.sprite = [];
            this.masks = [];
            this.sprite.push(sprites.getAnimation(Lemmings.SpriteTypes.BASHING, false));
            this.sprite.push(sprites.getAnimation(Lemmings.SpriteTypes.BASHING, true));
            this.masks.push(masks.GetMask(Lemmings.MaskTypes.BASHING_L));
            this.masks.push(masks.GetMask(Lemmings.MaskTypes.BASHING_R));
        }
        getActionName() {
            return "bashing";
        }
        /** user called this action */
        triggerLemAction(lem) {
            lem.setAction(this);
            return true;
        }
        /** render Lemming to gamedisplay */
        draw(gameDisplay, lem) {
            let ani = this.sprite[(lem.lookRight ? 1 : 0)];
            let frame = ani.getFrame(lem.frameIndex);
            gameDisplay.drawFrame(frame, lem.x, lem.y);
        }
        process(level, lem) {
            let groundMask = level.getGroundMaskLayer();
            lem.frameIndex++;
            let state = lem.frameIndex % 16;
            /// move lemming
            if (state > 10) {
                lem.x += (lem.lookRight ? 1 : -1);
                let yDelta = this.findGapDelta(groundMask, lem.x, lem.y);
                lem.y += yDelta;
                if (yDelta == 3) {
                    return Lemmings.LemmingStateType.FALLING;
                }
            }
            /// apply mask
            if ((state > 1) && (state < 6)) {
                let mask = this.masks[(lem.lookRight ? 1 : 0)];
                let maskIndex = state - 2;
                level.clearGroundWithMask(mask.GetMask(maskIndex), lem.x, lem.y);
            }
            /// check if end of solid?
            if (state == 5) {
                if (this.findHorizontalSpace(groundMask, lem.x + (lem.lookRight ? 8 : -8), lem.y - 6, lem.lookRight) == 4) {
                    return Lemmings.LemmingStateType.WALKING;
                }
            }
            return Lemmings.LemmingStateType.NO_STATE_TYPE;
        }
        findGapDelta(groundMask, x, y) {
            for (let i = 0; i < 3; i++) {
                if (groundMask.hasGroundAt(x, y + i)) {
                    return i;
                }
            }
            return 3;
        }
        findHorizontalSpace(groundMask, x, y, lookRight) {
            for (let i = 0; i < 4; i++) {
                if (groundMask.hasGroundAt(x, y)) {
                    return i;
                }
                x += (lookRight ? 1 : -1);
            }
            return 4;
        }
    }
    Lemmings.ActionBashSystem = ActionBashSystem;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    class ActionBlockerSystem {
        constructor(sprites, triggerManager) {
            this.triggerManager = triggerManager;
            this.sprite = sprites.getAnimation(Lemmings.SpriteTypes.BLOCKING, false);
        }
        getActionName() {
            return "blocking";
        }
        triggerLemAction(lem) {
            lem.setAction(this);
            return true;
        }
        draw(gameDisplay, lem) {
            let frame = this.sprite.getFrame(lem.frameIndex);
            gameDisplay.drawFrame(frame, lem.x, lem.y);
        }
        process(level, lem) {
            if (lem.state == 0) {
                let trigger1 = new Lemmings.Trigger(Lemmings.TriggerTypes.BLOCKER_LEFT, lem.x - 6, lem.y + 4, lem.x - 3, lem.y - 10, 0, 0, lem);
                let trigger2 = new Lemmings.Trigger(Lemmings.TriggerTypes.BLOCKER_RIGHT, lem.x + 7, lem.y + 4, lem.x + 4, lem.y - 10, 0, 0, lem);
                this.triggerManager.add(trigger1);
                this.triggerManager.add(trigger2);
                lem.state = 1;
            }
            lem.frameIndex++;
            if (!level.hasGroundAt(lem.x, lem.y + 1)) {
                this.triggerManager.removeByOwner(lem);
                return Lemmings.LemmingStateType.FALLING;
            }
            return Lemmings.LemmingStateType.NO_STATE_TYPE;
        }
    }
    Lemmings.ActionBlockerSystem = ActionBlockerSystem;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    class ActionBuildSystem {
        constructor(sprites) {
            this.sprite = [];
            this.sprite.push(sprites.getAnimation(Lemmings.SpriteTypes.BUILDING, false));
            this.sprite.push(sprites.getAnimation(Lemmings.SpriteTypes.BUILDING, true));
        }
        getActionName() {
            return "building";
        }
        triggerLemAction(lem) {
            lem.setAction(this);
            return true;
        }
        /** render Lemming to gamedisplay */
        draw(gameDisplay, lem) {
            let ani = this.sprite[(lem.lookRight ? 1 : 0)];
            let frame = ani.getFrame(lem.frameIndex);
            gameDisplay.drawFrame(frame, lem.x, lem.y);
        }
        process(level, lem) {
            lem.frameIndex = (lem.frameIndex + 1) % 16;
            if (lem.frameIndex == 9) {
                /// lay brick
                var x = lem.x + (lem.lookRight ? 0 : -4);
                for (var i = 0; i < 6; i++) {
                    level.setGroundAt(x + i, lem.y - 1, 7);
                }
                return Lemmings.LemmingStateType.NO_STATE_TYPE;
            }
            if (lem.frameIndex == 0) {
                /// walk 
                lem.y--;
                for (let i = 0; i < 2; i++) {
                    lem.x += (lem.lookRight ? 1 : -1);
                    if (level.hasGroundAt(lem.x, lem.y - 1)) {
                        lem.lookRight = !lem.lookRight;
                        return Lemmings.LemmingStateType.WALKING;
                    }
                }
                lem.state++;
                if (lem.state >= 12) {
                    return Lemmings.LemmingStateType.SHRUG;
                }
                if (level.hasGroundAt(lem.x + (lem.lookRight ? 2 : -2), lem.y - 9)) {
                    lem.lookRight = !lem.lookRight;
                    return Lemmings.LemmingStateType.WALKING;
                }
            }
            return Lemmings.LemmingStateType.NO_STATE_TYPE;
        }
    }
    Lemmings.ActionBuildSystem = ActionBuildSystem;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    class ActionClimbSystem {
        constructor(sprites) {
            this.sprite = [];
            this.sprite.push(sprites.getAnimation(Lemmings.SpriteTypes.CLIMBING, false));
            this.sprite.push(sprites.getAnimation(Lemmings.SpriteTypes.CLIMBING, true));
        }
        getActionName() {
            return "climbing";
        }
        triggerLemAction(lem) {
            if (lem.canClimb) {
                return false;
            }
            lem.canClimb = true;
            return true;
        }
        /** render Lemming to gamedisplay */
        draw(gameDisplay, lem) {
            let ani = this.sprite[(lem.lookRight ? 1 : 0)];
            let frame = ani.getFrame(lem.frameIndex);
            gameDisplay.drawFrame(frame, lem.x, lem.y);
        }
        process(level, lem) {
            lem.frameIndex = (lem.frameIndex + 1) % 8;
            if (lem.frameIndex < 4) {
                // check for top
                if (!level.hasGroundAt(lem.x, lem.y - lem.frameIndex - 7)) {
                    lem.y = lem.y - lem.frameIndex + 2;
                    return Lemmings.LemmingStateType.HOISTING;
                }
                return Lemmings.LemmingStateType.NO_STATE_TYPE;
            } else {
                lem.y--;
                if (level.hasGroundAt(lem.x + (lem.lookRight ? -1 : 1), lem.y - 8)) {
                    lem.lookRight = !lem.lookRight;
                    lem.x += (lem.lookRight ? 2 : -2);
                    return Lemmings.LemmingStateType.FALLING;
                }
                return Lemmings.LemmingStateType.NO_STATE_TYPE;
            }
        }
    }
    Lemmings.ActionClimbSystem = ActionClimbSystem;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    class ActionCountdownSystem {
        constructor(masks) {
            this.numberMasks = masks.GetMask(Lemmings.MaskTypes.NUMBERS);
        }
        getActionName() {
            return "countdown";
        }
        triggerLemAction(lem) {
            return lem.setCountDown(this);
        }
        /** render Lemming to gamedisplay */
        draw(gameDisplay, lem) {
            let count = lem.getCountDownTime();
            if (count <= 0) {
                return;
            }
            let numberFrame = this.numberMasks.GetMask(count);
            gameDisplay.drawMask(numberFrame, lem.x, lem.y);
        }
        process(level, lem) {
            if (lem.countdown <= 0) {
                return Lemmings.LemmingStateType.NO_STATE_TYPE;
            }
            lem.countdown--;
            if (lem.countdown == 0) {
                lem.setCountDown(null);
                return Lemmings.LemmingStateType.OHNO;
            }
            return Lemmings.LemmingStateType.NO_STATE_TYPE;
        }
    }
    Lemmings.ActionCountdownSystem = ActionCountdownSystem;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    class ActionDiggSystem {
        constructor(sprites) {
            this.sprite = [];
            this.sprite.push(sprites.getAnimation(Lemmings.SpriteTypes.DIGGING, false));
            this.sprite.push(sprites.getAnimation(Lemmings.SpriteTypes.DIGGING, true));
        }
        draw(gameDisplay, lem) {
            let ani = this.sprite[(lem.lookRight ? 1 : 0)];
            let frame = ani.getFrame(lem.frameIndex);
            gameDisplay.drawFrame(frame, lem.x, lem.y);
        }
        getActionName() {
            return "digging";
        }
        triggerLemAction(lem) {
            lem.setAction(this);
            return true;
        }
        process(level, lem) {
            if (lem.state == 0) {
                this.digRow(level, lem, lem.y - 2);
                this.digRow(level, lem, lem.y - 1);
                lem.state = 1;
            } else {
                lem.frameIndex = (lem.frameIndex + 1) % 16;
            }
            if (!(lem.frameIndex & 0x07)) {
                lem.y++;
                if (level.isOutOfLevel(lem.y)) {
                    return Lemmings.LemmingStateType.FALLING;
                }
                if (!this.digRow(level, lem, lem.y - 1)) {
                    return Lemmings.LemmingStateType.FALLING;
                }
            }
            return Lemmings.LemmingStateType.NO_STATE_TYPE;
        }
        digRow(level, lem, y) {
            let removeCount = 0;
            for (let x = lem.x - 4; x < lem.x + 5; x++) {
                if (level.hasGroundAt(x, y)) {
                    level.clearGroundAt(x, y);
                    removeCount++;
                }
            }
            return (removeCount > 0);
        }
    }
    Lemmings.ActionDiggSystem = ActionDiggSystem;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    class ActionDrowningSystem {
        constructor(sprites) {
            this.sprite = sprites.getAnimation(Lemmings.SpriteTypes.DROWNING, false);
        }
        getActionName() {
            return "drowning";
        }
        triggerLemAction(lem) {
            return false;
        }
        draw(gameDisplay, lem) {
            let frame = this.sprite.getFrame(lem.frameIndex);
            gameDisplay.drawFrame(frame, lem.x, lem.y);
        }
        process(level, lem) {
            lem.disable();
            lem.frameIndex++;
            if (lem.frameIndex >= 16) {
                return Lemmings.LemmingStateType.OUT_OFF_LEVEL;
            }
            if (!level.hasGroundAt(lem.x + (lem.lookRight ? 8 : -8), lem.y)) {
                lem.x += (lem.lookRight ? 1 : -1);
            } else {
                lem.lookRight = !lem.lookRight;
            }
            return Lemmings.LemmingStateType.NO_STATE_TYPE;
        }
    }
    Lemmings.ActionDrowningSystem = ActionDrowningSystem;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    class ActionExitingSystem {
        constructor(sprites, gameVictoryCondition) {
            this.gameVictoryCondition = gameVictoryCondition;
            this.sprite = sprites.getAnimation(Lemmings.SpriteTypes.EXITING, false);
        }
        getActionName() {
            return "exiting";
        }
        triggerLemAction(lem) {
            return false;
        }
        draw(gameDisplay, lem) {
            let frame = this.sprite.getFrame(lem.frameIndex);
            gameDisplay.drawFrame(frame, lem.x, lem.y);
        }
        process(level, lem) {
            lem.disable();
            lem.frameIndex++;
            if (lem.frameIndex >= 8) {
                this.gameVictoryCondition.addSurvivor();
                return Lemmings.LemmingStateType.OUT_OFF_LEVEL;
            }
            return Lemmings.LemmingStateType.NO_STATE_TYPE;
        }
    }
    Lemmings.ActionExitingSystem = ActionExitingSystem;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    class ActionExplodingSystem {
        constructor(sprites, masks, triggerManager, particleTable) {
            this.triggerManager = triggerManager;
            this.particleTable = particleTable;
            this.mask = masks.GetMask(Lemmings.MaskTypes.EXPLODING);
            this.sprite = sprites.getAnimation(Lemmings.SpriteTypes.EXPLODING, false);
        }
        getActionName() {
            return "exploding";
        }
        triggerLemAction(lem) {
            return false;
        }
        /** render Lemming to gamedisplay */
        draw(gameDisplay, lem) {
            if (lem.frameIndex == 0) {
                let frame = this.sprite.getFrame(lem.frameIndex);
                gameDisplay.drawFrame(frame, lem.x, lem.y);
            } else {
                this.particleTable.draw(gameDisplay, lem.frameIndex - 1, lem.x, lem.y);
            }
        }
        process(level, lem) {
            lem.disable();
            lem.frameIndex++;
            if (lem.frameIndex == 1) {
                this.triggerManager.removeByOwner(lem);
                level.clearGroundWithMask(this.mask.GetMask(0), lem.x, lem.y);
            }
            if (lem.frameIndex == 52) {
                return Lemmings.LemmingStateType.OUT_OFF_LEVEL;
            }
            return Lemmings.LemmingStateType.NO_STATE_TYPE;
        }
    }
    Lemmings.ActionExplodingSystem = ActionExplodingSystem;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    class ActionFallSystem {
        constructor(sprites) {
            this.sprite = [];
            this.sprite.push(sprites.getAnimation(Lemmings.SpriteTypes.FALLING, false));
            this.sprite.push(sprites.getAnimation(Lemmings.SpriteTypes.FALLING, true));
        }
        getActionName() {
            return "falling";
        }
        triggerLemAction(lem) {
            return false;
        }
        /** render Lemming to gamedisplay */
        draw(gameDisplay, lem) {
            let ani = this.sprite[(lem.lookRight ? 1 : 0)];
            let frame = ani.getFrame(lem.frameIndex);
            gameDisplay.drawFrame(frame, lem.x, lem.y);
        }
        process(level, lem) {
            lem.frameIndex++;
            if (lem.state > 16 && (lem.hasParachute)) {
                return Lemmings.LemmingStateType.FLOATING;
            }
            // fall down!
            let i = 0;
            for (; i < 3; i++) {
                if (level.hasGroundAt(lem.x, lem.y + i)) {
                    break;
                }
            }
            lem.y += i;
            if (i == 3) {
                lem.state += i;
                return Lemmings.LemmingStateType.NO_STATE_TYPE;
            } else {
                // landed
                if (lem.state > Lemmings.Lemming.LEM_MAX_FALLING) {
                    return Lemmings.LemmingStateType.SPLATTING;
                }
                return Lemmings.LemmingStateType.WALKING;
            }
        }
    }
    Lemmings.ActionFallSystem = ActionFallSystem;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    class ActionFloatingSystem {
        constructor(sprites) {
            this.sprite = [];
            this.sprite.push(sprites.getAnimation(Lemmings.SpriteTypes.UMBRELLA, false));
            this.sprite.push(sprites.getAnimation(Lemmings.SpriteTypes.UMBRELLA, true));
        }
        getActionName() {
            return "floating";
        }
        triggerLemAction(lem) {
            if (lem.hasParachute) {
                return false;
            }
            lem.hasParachute = true;
            return true;
        }
        /** render Lemming to gamedisplay */
        draw(gameDisplay, lem) {
            let ani = this.sprite[(lem.lookRight ? 1 : 0)];
            let frame = ani.getFrame(ActionFloatingSystem.floatFrame[lem.frameIndex]);
            gameDisplay.drawFrame(frame, lem.x, lem.y);
        }
        process(level, lem) {
            lem.frameIndex++;
            if (lem.frameIndex >= ActionFloatingSystem.floatFrame.length) {
                /// first 8 are the opening of the umbrella
                lem.frameIndex = 8;
            }
            let speed = ActionFloatingSystem.floatSpeed[lem.frameIndex];
            for (let i = 0; i < speed; i++) {
                if (level.hasGroundAt(lem.x, lem.y + i)) {
                    // landed
                    lem.y += i;
                    return Lemmings.LemmingStateType.WALKING;
                }
            }
            lem.y += speed;
            return Lemmings.LemmingStateType.NO_STATE_TYPE;
        }
    }
    ActionFloatingSystem.floatSpeed = [3, 3, 3, 3, -1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2];
    ActionFloatingSystem.floatFrame = [0, 1, 3, 5, 5, 5, 5, 5, 5, 6, 7, 7, 6, 5, 4, 4];
    Lemmings.ActionFloatingSystem = ActionFloatingSystem;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    class ActionHoistSystem {
        constructor(sprites) {
            this.sprite = [];
            this.sprite.push(sprites.getAnimation(Lemmings.SpriteTypes.POSTCLIMBING, false));
            this.sprite.push(sprites.getAnimation(Lemmings.SpriteTypes.POSTCLIMBING, true));
        }
        getActionName() {
            return "hoist";
        }
        triggerLemAction(lem) {
            return false;
        }
        /** render Lemming to gamedisplay */
        draw(gameDisplay, lem) {
            let ani = this.sprite[(lem.lookRight ? 1 : 0)];
            let frame = ani.getFrame(lem.frameIndex);
            gameDisplay.drawFrame(frame, lem.x, lem.y);
        }
        process(level, lem) {
            lem.frameIndex++;
            if (lem.frameIndex <= 4) {
                lem.y -= 2;
                return Lemmings.LemmingStateType.NO_STATE_TYPE;
            }
            if (lem.frameIndex >= 8) {
                return Lemmings.LemmingStateType.WALKING;
            }
            return Lemmings.LemmingStateType.NO_STATE_TYPE;
        }
    }
    Lemmings.ActionHoistSystem = ActionHoistSystem;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    class ActionJumpSystem {
        constructor(sprites) {
            this.sprite = [];
            this.sprite.push(sprites.getAnimation(Lemmings.SpriteTypes.FALLING, false));
            this.sprite.push(sprites.getAnimation(Lemmings.SpriteTypes.FALLING, true));
        }
        getActionName() {
            return "jump";
        }
        triggerLemAction(lem) {
            return false;
        }
        draw(gameDisplay, lem) {
            let ani = this.sprite[(lem.lookRight ? 1 : 0)];
            let frame = ani.getFrame(lem.frameIndex);
            gameDisplay.drawFrame(frame, lem.x, lem.y);
        }
        process(level, lem) {
            lem.frameIndex++;
            let i = 0;
            for (; i < 2; i++) {
                if (!level.hasGroundAt(lem.x, lem.y + i - 1)) {
                    break;
                }
            }
            lem.y -= i;
            if (i < 2) {
                return Lemmings.LemmingStateType.WALKING;
            }
            return Lemmings.LemmingStateType.NO_STATE_TYPE; // this.check_top_collision(lem);
        }
    }
    Lemmings.ActionJumpSystem = ActionJumpSystem;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    class ActionMineSystem {
        constructor(sprites, masks) {
            this.sprite = [];
            this.masks = [];
            this.sprite.push(sprites.getAnimation(Lemmings.SpriteTypes.MINING, false));
            this.sprite.push(sprites.getAnimation(Lemmings.SpriteTypes.MINING, true));
            this.masks.push(masks.GetMask(Lemmings.MaskTypes.MINING_L));
            this.masks.push(masks.GetMask(Lemmings.MaskTypes.MINING_R));
        }
        draw(gameDisplay, lem) {
            let ani = this.sprite[(lem.lookRight ? 1 : 0)];
            let frame = ani.getFrame(lem.frameIndex);
            gameDisplay.drawFrame(frame, lem.x, lem.y);
        }
        getActionName() {
            return "mining";
        }
        triggerLemAction(lem) {
            lem.setAction(this);
            return true;
        }
        process(level, lem) {
            lem.frameIndex = (lem.frameIndex + 1) % 24;
            switch (lem.frameIndex) {
            case 1:
            case 2:
                let mask = this.masks[(lem.lookRight ? 1 : 0)];
                let maskIndex = lem.frameIndex - 1;
                level.clearGroundWithMask(mask.GetMask(maskIndex), lem.x, lem.y);
                break;
            case 3:
                lem.y++;
            case 15:
                lem.x += lem.lookRight ? 1 : -1;
                if (!level.hasGroundAt(lem.x, lem.y)) {
                    return Lemmings.LemmingStateType.FALLING;
                }
                break;
            }
            return Lemmings.LemmingStateType.NO_STATE_TYPE;
        }
    }
    Lemmings.ActionMineSystem = ActionMineSystem;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    class ActionOhNoSystem {
        constructor(sprites) {
            this.sprite = sprites.getAnimation(Lemmings.SpriteTypes.OHNO, false);
        }
        getActionName() {
            return "oh-no";
        }
        triggerLemAction(lem) {
            return false;
        }
        /** render Lemming to gamedisplay */
        draw(gameDisplay, lem) {
            let frame = this.sprite.getFrame(lem.frameIndex);
            gameDisplay.drawFrame(frame, lem.x, lem.y);
        }
        process(level, lem) {
            lem.frameIndex++;
            if (lem.frameIndex == 16) {
                // play sound: explosion
                return Lemmings.LemmingStateType.EXPLODING;
            }
            // fall down!
            for (let i = 0; i < 3; i++) {
                if (!level.hasGroundAt(lem.x, lem.y + 1)) {
                    lem.y++;
                    break;
                }
            }
            return Lemmings.LemmingStateType.NO_STATE_TYPE;
        }
    }
    Lemmings.ActionOhNoSystem = ActionOhNoSystem;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    class ActionShrugSystem {
        constructor(sprites) {
            this.sprite = [];
            this.sprite.push(sprites.getAnimation(Lemmings.SpriteTypes.SHRUGGING, false));
            this.sprite.push(sprites.getAnimation(Lemmings.SpriteTypes.SHRUGGING, true));
        }
        getActionName() {
            return "shrugging";
        }
        triggerLemAction(lem) {
            return false;
        }
        /** render Lemming to gamedisplay */
        draw(gameDisplay, lem) {
            let ani = this.sprite[(lem.lookRight ? 1 : 0)];
            let frame = ani.getFrame(lem.frameIndex);
            gameDisplay.drawFrame(frame, lem.x, lem.y);
        }
        process(level, lem) {
            lem.frameIndex++;
            if (lem.frameIndex >= 8) {
                return Lemmings.LemmingStateType.WALKING;
            }
            return Lemmings.LemmingStateType.NO_STATE_TYPE;
        }
    }
    Lemmings.ActionShrugSystem = ActionShrugSystem;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    class ActionSplatterSystem {
        constructor(sprites) {
            this.sprite = sprites.getAnimation(Lemmings.SpriteTypes.SPLATTING, false);
        }
        getActionName() {
            return "splatter";
        }
        triggerLemAction(lem) {
            return false;
        }
        draw(gameDisplay, lem) {
            let frame = this.sprite.getFrame(lem.frameIndex);
            gameDisplay.drawFrame(frame, lem.x, lem.y);
        }
        process(level, lem) {
            lem.disable();
            lem.frameIndex++;
            if (lem.frameIndex >= 16) {
                return Lemmings.LemmingStateType.OUT_OFF_LEVEL;
            }
            return Lemmings.LemmingStateType.NO_STATE_TYPE;
        }
    }
    Lemmings.ActionSplatterSystem = ActionSplatterSystem;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    class ActionWalkSystem {
        constructor(sprites) {
            this.sprite = [];
            this.sprite.push(sprites.getAnimation(Lemmings.SpriteTypes.WALKING, false));
            this.sprite.push(sprites.getAnimation(Lemmings.SpriteTypes.WALKING, true));
        }
        draw(gameDisplay, lem) {
            let ani = this.sprite[(lem.lookRight ? 1 : 0)];
            let frame = ani.getFrame(lem.frameIndex);
            gameDisplay.drawFrame(frame, lem.x, lem.y);
        }
        getActionName() {
            return "walk";
        }
        triggerLemAction(lem) {
            return false;
        }
        getGroundStepDelta(groundMask, x, y) {
            for (let i = 0; i < 8; i++) {
                if (!groundMask.hasGroundAt(x, y - i)) {
                    return i;
                }
            }
            return 8;
        }
        getGroudGapDelta(groundMask, x, y) {
            for (let i = 1; i < 4; i++) {
                if (groundMask.hasGroundAt(x, y + i)) {
                    return i;
                }
            }
            return 4;
        }
        process(level, lem) {
            lem.frameIndex++;
            lem.x += (lem.lookRight ? 1 : -1);
            let groundMask = level.getGroundMaskLayer();
            let upDelta = this.getGroundStepDelta(groundMask, lem.x, lem.y);
            if (upDelta == 8) {
                // collision with obstacle
                if (lem.canClimb) {
                    // start climbing
                    return Lemmings.LemmingStateType.CLIMBING;
                } else {
                    // turn around
                    lem.lookRight = !lem.lookRight;
                    return Lemmings.LemmingStateType.NO_STATE_TYPE;
                }
            } else if (upDelta > 0) {
                lem.y -= upDelta - 1;
                if (upDelta > 3) {
                    // jump
                    return Lemmings.LemmingStateType.JUMPING;
                } else {
                    // walk with small jump up
                    return Lemmings.LemmingStateType.NO_STATE_TYPE;
                }
            } else {
                // walk or fall
                let downDelta = this.getGroudGapDelta(groundMask, lem.x, lem.y);
                lem.y += downDelta;
                if (downDelta == 4) {
                    return Lemmings.LemmingStateType.FALLING;
                } else {
                    // walk with small jump down
                    return Lemmings.LemmingStateType.NO_STATE_TYPE;
                }
            }
        }
    }
    Lemmings.ActionWalkSystem = ActionWalkSystem;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    /** Commands actions on lemmings the user has given */
    class CommandLemmingsAction {
        constructor(lemmingId) {
            this.log = new Lemmings.LogHandler("CommandLemmingsAction");
            if (lemmingId != null)
                this.lemmingId = lemmingId;
        }
        getCommandKey() {
            return "l";
        }
        /** load parameters for this command from serializer */
        load(values) {
            if (values.length < 1) {
                this.log.log("Unable to process load");
                return;
            }
            this.lemmingId = values[0];
        }
        /** save parameters of this command to serializer */
        save() {
            return [this.lemmingId];
        }
        /** execute this command */
        execute(game) {
            let lemManager = game.getLemmingManager();
            let lem = lemManager.getLemming(this.lemmingId);
            if (!lem) {
                this.log.log("Lemming not found! " + this.lemmingId);
                return false;
            }
            let skills = game.getGameSkills();
            let selectedSkill = skills.getSelectedSkill();
            if (!skills.canReduseSkill(selectedSkill)) {
                this.log.log("Not enough skills!");
                return false;
            }
            /// set the skill
            if (!lemManager.doLemmingAction(lem, selectedSkill)) {
                this.log.log("unable to execute action on lemming!");
                return false;
            }
            /// reduce the available skill count
            return skills.reduseSkill(selectedSkill);
        }
    }
    Lemmings.CommandLemmingsAction = CommandLemmingsAction;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    /** manages commands user -> game */
    class CommandManager {
        constructor(game, gameTimer) {
            this.game = game;
            this.gameTimer = gameTimer;
            this.log = new Lemmings.LogHandler("CommandManager");
            this.runCommands = {};
            this.loggedCommads = {};
            this.gameTimer.onBeforeGameTick.on((tick) => {
                let command = this.runCommands[tick];
                if (!command)
                    return;
                this.queueCommand(command);
            });
        }
        /** load parameters for this command from serializer */
        loadReplay(replayString) {
            let parts = replayString.split("&");
            for (let i = 0; i < parts.length; i++) {
                let commandStr = parts[i].split("=", 2);
                if (commandStr.length != 2)
                    continue;
                let tick = (+commandStr[0]) | 0;
                this.runCommands[tick] = this.parseCommand(commandStr[1]);
            }
        }
        commandFactory(type) {
            switch (type.toLowerCase()) {
            case "l":
                return new Lemmings.CommandLemmingsAction();
            case "n":
                return new Lemmings.CommandNuke();
            case "s":
                return new Lemmings.CommandSelectSkill();
            case "i":
                return new Lemmings.CommandReleaseRateIncrease();
            case "d":
                return new Lemmings.CommandReleaseRateDecrease();
            default:
                return null;
            }
        }
        parseCommand(valuesStr) {
            if (valuesStr.length < 1)
                return;
            let newCommand = this.commandFactory(valuesStr.substr(0, 1));
            let values = valuesStr.substr(1).split(":");
            newCommand.load(values.map(Number));
            return newCommand;
        }
        /** add a command to execute queue */
        queueCommand(newCommand) {
            let currentTick = this.gameTimer.getGameTicks();
            if (newCommand.execute(this.game)) {
                // only log commands that are executable
                this.loggedCommads[currentTick] = newCommand;
            }
        }
        serialize() {
            let result = [];
            Object.keys(this.loggedCommads).forEach((key) => {
                let command = this.loggedCommads[+key];
                result.push(key + "=" + command.getCommandKey() + command.save().join(":"));
            });
            return result.join("&");
        }
    }
    Lemmings.CommandManager = CommandManager;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    /** Commands a all lemmings nuke */
    class CommandNuke {
        constructor() {
            this.log = new Lemmings.LogHandler("CommandNuke");
        }
        getCommandKey() {
            return "n";
        }
        /** load parameters for this command from serializer */
        load(values) {}
        /** save parameters of this command to serializer */
        save() {
            return [];
        }
        /** execute this command */
        execute(game) {
            let lemManager = game.getLemmingManager();
            if (lemManager.isNuking())
                return false;
            lemManager.doNukeAllLemmings();
            game.getVictoryCondition().doNuke();
            return true;
        }
    }
    Lemmings.CommandNuke = CommandNuke;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    /** Increase the release rate */
    class CommandReleaseRateDecrease {
        constructor(number) {
            this.log = new Lemmings.LogHandler("CommandReleaseRateDecrease");
            if (number != null)
                this.number = number;
        }
        getCommandKey() {
            return "d";
        }
        /** load parameters for this command from serializer */
        load(values) {
            if (values.length < 1) {
                this.log.log("Unable to process load");
                return;
            }
            this.number = values[0];
        }
        /** save parameters of this command to serializer */
        save() {
            return [this.number];
        }
        /** execute this command */
        execute(game) {
            let victoryConditions = game.getVictoryCondition();
            return victoryConditions.changeReleaseRate(-this.number);
        }
    }
    Lemmings.CommandReleaseRateDecrease = CommandReleaseRateDecrease;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    /** Increase the release rate */
    class CommandReleaseRateIncrease {
        constructor(number) {
            this.log = new Lemmings.LogHandler("CommandReleaseRateIncrease");
            if (number != null)
                this.number = number;
        }
        getCommandKey() {
            return "i";
        }
        /** load parameters for this command from serializer */
        load(values) {
            if (values.length < 1) {
                this.log.log("Unable to process load");
                return;
            }
            this.number = values[0];
        }
        /** save parameters of this command to serializer */
        save() {
            return [this.number];
        }
        /** execute this command */
        execute(game) {
            let victoryConditions = game.getVictoryCondition();
            return victoryConditions.changeReleaseRate(this.number);
        }
    }
    Lemmings.CommandReleaseRateIncrease = CommandReleaseRateIncrease;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    /** Commands actions on lemmings the user has given */
    class CommandSelectSkill {
        constructor(skill) {
            this.log = new Lemmings.LogHandler("CommandSelectSkill");
            if (skill)
                this.skill = skill;
        }
        getCommandKey() {
            return "s";
        }
        /** load parameters for this command from serializer */
        load(values) {
            if (values.length < 0) {
                this.log.log("Unable to process load");
                return;
            }
            this.skill = values[0];
        }
        /** save parameters of this command to serializer */
        save() {
            return [+(this.skill)];
        }
        /** execute this command */
        execute(game) {
            let gameSkill = game.getGameSkills();
            return gameSkill.setSelectedSkill(this.skill);
        }
    }
    Lemmings.CommandSelectSkill = CommandSelectSkill;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    class Animation {
        constructor() {
            this.frames = [];
            this.isRepeat = true;
            this.firstFrameIndex = 0;
        }
        getFrame(frameIndex) {
            frameIndex = frameIndex + this.firstFrameIndex;
            let frame = 0;
            if (this.isRepeat) {
                frame = frameIndex % this.frames.length;
            } else {
                if (frameIndex < this.frames.length)
                    frame = frameIndex;
            }
            return this.frames[frame];
        }
        /** load all images for this animation from a file */
        loadFromFile(fr, bitsPerPixel, width, height, frames, palette, offsetX = null, offsetY = null) {
            for (let f = 0; f < frames; f++) {
                let paletteImg = new Lemmings.PaletteImage(width, height);
                paletteImg.processImage(fr, bitsPerPixel);
                paletteImg.processTransparentByColorIndex(0);
                this.frames.push(paletteImg.createFrame(palette, offsetX, offsetY));
            }
        }
    }
    Lemmings.Animation = Animation;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    /** defines the way a image is drawn to the stage */
    class DrawProperties {
        constructor(isUpsideDown, noOverwrite, onlyOverwrite, isErase) {
            this.isUpsideDown = isUpsideDown;
            this.noOverwrite = noOverwrite;
            this.onlyOverwrite = onlyOverwrite;
            this.isErase = isErase;
            //- the original game does not allow the combination: (noOverwrite | isErase)
            if (noOverwrite)
                this.isErase = false;
        }
    }
    Lemmings.DrawProperties = DrawProperties;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    /** image frame with index color */
    class Frame {
        constructor(width, height, offsetX, offsetY) {
            this.width = 0;
            this.height = 0;
            this.offsetX = 0;
            this.offsetY = 0;
            this.width = Math.trunc(width);
            this.height = Math.trunc(height);
            if (offsetX == null) {
                this.offsetX = 0;
            } else {
                this.offsetX = Math.trunc(offsetX);
            }
            if (offsetY == null) {
                this.offsetY = 0;
            } else {
                this.offsetY = Math.trunc(offsetY);
            }
            let pixCount = this.width * this.height;
            this.data = new Uint32Array(pixCount);
            this.mask = new Int8Array(pixCount);
            this.clear();
        }
        getData() {
            return new Uint8ClampedArray(this.data.buffer);
        }
        getBuffer() {
            return this.data;
        }
        /** Mask can be 0 or 1 */
        getMask() {
            return this.mask;
        }
        /** set the image to color=black / alpha=255 / mask=0 */
        clear() {
            //this.data.fill(ColorPalette.debugColor());
            this.data.fill(Lemmings.ColorPalette.black);
            this.mask.fill(0);
        }
        /** set the image to color=black / alpha=255 / mask=0 */
        fill(r, g, b) {
            this.data.fill(Lemmings.ColorPalette.colorFromRGB(r, g, b));
            this.mask.fill(1);
        }
        /** draw a palette Image to this frame */
        drawPaletteImage(srcImg, srcWidth, srcHeight, palette, left, top) {
            let pixIndex = 0;
            srcWidth = srcWidth | 0;
            srcHeight = srcHeight | 0;
            left = left | 0;
            top = top | 0;
            for (let y = 0; y < srcHeight; y++) {
                for (let x = 0; x < srcWidth; x++) {
                    let colorIndex = srcImg[pixIndex];
                    pixIndex++;
                    if ((colorIndex & 0x80) > 0) {
                        this.clearPixel(x + left, y + top);
                    } else {
                        this.setPixel(x + left, y + top, palette.getColor(colorIndex));
                    }
                }
            }
        }
        /** set the color of a pixel */
        setPixel(x, y, color, noOverwrite = false, onlyOverwrite = false) {
            if ((x < 0) || (x >= this.width))
                return;
            if ((y < 0) || (y >= this.height))
                return;
            let destPixelPos = y * this.width + x;
            if (noOverwrite) {
                /// if some data have been drawn here before
                if (this.mask[destPixelPos] != 0)
                    return;
            }
            if (onlyOverwrite) {
                /// if no data have been drawn here before
                if (this.mask[destPixelPos] == 0)
                    return;
            }
            this.data[destPixelPos] = color;
            this.mask[destPixelPos] = 1;
        }
        /** set a pixel to back */
        clearPixel(x, y) {
            if ((x < 0) || (x >= this.width))
                return;
            if ((y < 0) || (y >= this.height))
                return;
            let destPixelPos = y * this.width + x;
            this.data[destPixelPos] = Lemmings.ColorPalette.black;
            this.mask[destPixelPos] = 0;
        }
    }
    Lemmings.Frame = Frame;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    /** uses the LevelReader and GroundReader to render/create the games background */
    class GroundRenderer {
        constructor() {}
        createVgaspecMap(lr, vr) {
            this.img = vr.img;
        }
        /** create the ground image from the level definition and the Terrain images */
        createGroundMap(lr, terrarImg) {
            this.img = new Lemmings.Frame(lr.levelWidth, lr.levelHeight);
            let terrarObjects = lr.terrains;
            for (let i = 0; i < terrarObjects.length; i++) {
                let tOb = terrarObjects[i];
                this.copyImageTo(terrarImg[tOb.id], tOb);
            }
        }
        /** copy a terrain image to the ground */
        copyImageTo(srcImg, destConfig, frameIndex = 0) {
            if (!srcImg)
                return;
            var pixBuf = srcImg.frames[frameIndex];
            var w = srcImg.width;
            var h = srcImg.height;
            var pal = srcImg.palette;
            var destX = destConfig.x;
            var destY = destConfig.y;
            var upsideDown = destConfig.drawProperties.isUpsideDown;
            var noOverwrite = destConfig.drawProperties.noOverwrite;
            var isErase = destConfig.drawProperties.isErase;
            var onlyOverwrite = destConfig.drawProperties.onlyOverwrite;
            for (var y = 0; y < h; y++) {
                for (var x = 0; x < w; x++) {
                    let sourceY = upsideDown ? (h - y - 1) : y;
                    /// read source color index
                    let colorIndex = pixBuf[sourceY * w + x];
                    /// ignore transparent pixels
                    if ((colorIndex & 0x80) != 0)
                        continue;
                    if (isErase) {
                        this.img.clearPixel(x + destX, y + destY);
                    } else {
                        this.img.setPixel(x + destX, y + destY, pal.getColor(colorIndex), noOverwrite, onlyOverwrite);
                    }
                }
            }
        }
    }
    Lemmings.GroundRenderer = GroundRenderer;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    class LevelIndexType {
        constructor() {
            /** use the odd table information for this entry */
            this.useOddTable = false;
        }
    }
    Lemmings.LevelIndexType = LevelIndexType;
    /** matches the Level-Mode + Level-Index to a level-file and level-file-index */
    class LevelIndexResolve {
        constructor(config) {
            this.config = config;
        }
        resolve(levelMode, levelIndex) {
            let levelOrderList = this.config.level.order;
            if (levelOrderList.length <= levelMode)
                return null;
            if (levelMode < 0)
                return null;
            let levelOrder = levelOrderList[levelMode];
            if (levelOrder.length <= levelIndex)
                return null;
            if (levelIndex < 0)
                return null;
            let levelOrderConfig = levelOrder[levelIndex];
            let liType = new LevelIndexType();
            liType.fileId = Math.abs((levelOrderConfig / 10) | 0);
            liType.partIndex = Math.abs((levelOrderConfig % 10) | 0);
            liType.useOddTable = (levelOrderConfig < 0);
            /// the level number is the sum-index of the level
            let levelNo = 0;
            for (let i = 0; i < (levelMode - 1); i++) {
                levelNo += levelOrderList[i].length;
            }
            liType.levelNumber = levelNo + levelIndex;
            return liType;
        }
    }
    Lemmings.LevelIndexResolve = LevelIndexResolve;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    /** Bootstrap the Level loading */
    class LevelLoader {
        constructor(fileProvider, config) {
            this.fileProvider = fileProvider;
            this.config = config;
            this.levelIndexResolve = new Lemmings.LevelIndexResolve(config);
        }
        /** return the map and it's config */
        getLevel(levelMode, levelIndex) {
            let level;
            let levelReader;
            return new Promise((resolve, reject) => {
                let levelInfo = this.levelIndexResolve.resolve(levelMode, levelIndex);
                if (levelInfo == null) {
                    resolve(null);
                    return;
                }
                let useOddTable = levelInfo.useOddTable && this.config.level.useOddTable;
                let promiseList = [];
                let paddedFileId = ("0000" + levelInfo.fileId).slice(-3);
                promiseList.push(this.fileProvider.loadBinary(this.config.path, this.config.level.filePrefix + paddedFileId + ".DAT"));
                /// may we need to load the odd-table to?
                if (useOddTable) {
                    promiseList.push(this.fileProvider.loadBinary(this.config.path, "ODDTABLE.DAT"));
                }
                Promise.all(promiseList)
                    .then((files) => {
                        /// read the level meta data
                        let levelsContainer = new Lemmings.FileContainer(files[0]);
                        levelReader = new Lemmings.LevelReader(levelsContainer.getPart(levelInfo.partIndex));
                        level = new Lemmings.Level(levelReader.levelWidth, levelReader.levelHeight);
                        level.gameType = this.config.gametype;
                        level.levelIndex = levelIndex;
                        level.levelMode = levelMode;
                        level.screenPositionX = levelReader.screenPositionX;
                        level.isSuperLemming = levelReader.isSuperLemming;
                        /// default level properties
                        let levelProperties = levelReader.levelProperties;
                        /// switch level properties to odd table config
                        if (useOddTable) {
                            let oddTable = new Lemmings.OddTableReader(files[1]);
                            levelProperties = oddTable.getLevelProperties(levelInfo.levelNumber);
                        }
                        level.name = levelProperties.levelName;
                        level.releaseRate = levelProperties.releaseRate;
                        level.releaseCount = levelProperties.releaseCount;
                        level.needCount = levelProperties.needCount;
                        level.timeLimit = levelProperties.timeLimit;
                        level.skills = levelProperties.skills;
                        let fileList = [];
                        /// load level ground
                        fileList.push(this.fileProvider.loadBinary(this.config.path, "VGAGR" + levelReader.graphicSet1 + ".DAT"));
                        fileList.push(this.fileProvider.loadBinary(this.config.path, "GROUND" + levelReader.graphicSet1 + "O.DAT"));
                        if (levelReader.graphicSet2 != 0) {
                            /// this is a Image Map
                            fileList.push(this.fileProvider.loadBinary(this.config.path, "VGASPEC" + (levelReader.graphicSet2 - 1) + ".DAT"));
                        }
                        return Promise.all(fileList);
                    })
                    .then((fileList) => {
                        let goundFile = fileList[1];
                        let vgaContainer = new Lemmings.FileContainer(fileList[0]);
                        /// read the images used for the map and for the objects of the map
                        let groundReader = new Lemmings.GroundReader(goundFile, vgaContainer.getPart(0), vgaContainer.getPart(1));
                        /// render the map background image
                        let render = new Lemmings.GroundRenderer();
                        if (fileList.length > 2) {
                            /// use a image for this map background
                            let vgaspecReader = new Lemmings.VgaspecReader(fileList[2], level.width, level.height);
                            render.createVgaspecMap(levelReader, vgaspecReader);
                        } else {
                            /// this is a normal map background
                            render.createGroundMap(levelReader, groundReader.getTerraImages());
                        }
                        level.setGroundImage(render.img.getData());
                        level.setGroundMaskLayer(new Lemmings.SolidLayer(level.width, level.height, render.img.mask));
                        level.setMapObjects(levelReader.objects, groundReader.getObjectImages());
                        level.setPalettes(groundReader.colorPalette, groundReader.groundPalette);
                        resolve(level);
                    });
            });
        }
    }
    Lemmings.LevelLoader = LevelLoader;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    /** Level Data */
    class Level {
        constructor(width, height) {
            /** the background mask 0=noGround / 1=ground*/
            this.groundMask = null;
            /** objects on the map: entrance/exit/traps */
            this.objects = [];
            this.entrances = [];
            this.triggers = [];
            this.name = "";
            this.width = 0;
            this.height = 0;
            this.releaseRate = 0;
            this.releaseCount = 0;
            this.needCount = 0;
            this.timeLimit = 0;
            this.skills = new Array(Lemmings.SkillTypes.length());
            this.screenPositionX = 0;
            this.isSuperLemming = false;
            this.width = width;
            this.height = height;
        }
        /** set the map objects of this level and update trigger */
        setMapObjects(objects, objectImg) {
            this.entrances = [];
            this.triggers = [];
            this.objects = [];
            /// process all objects
            for (let i = 0; i < objects.length; i++) {
                let ob = objects[i];
                let objectInfo = objectImg[ob.id];
                /// add object
                let newMapObject = new Lemmings.MapObject(ob, objectInfo);
                this.objects.push(newMapObject);
                /// add entrances
                if (ob.id == 1)
                    this.entrances.push(ob);
                /// add triggers
                if (objectInfo.trigger_effect_id != 0) {
                    let x1 = ob.x + objectInfo.trigger_left;
                    let y1 = ob.y + objectInfo.trigger_top;
                    let x2 = x1 + objectInfo.trigger_width;
                    let y2 = y1 + objectInfo.trigger_height;
                    let newTrigger = new Lemmings.Trigger(objectInfo.trigger_effect_id, x1, y1, x2, y2, 0, objectInfo.trap_sound_effect_id);
                    this.triggers.push(newTrigger);
                }
            }
        }
        /** check if a y-position is out of the level */
        isOutOfLevel(y) {
            return ((y >= this.height) || (y <= 0));
        }
        /** return the layer that defines if a pixel in the level is solid */
        getGroundMaskLayer() {
            if (this.groundMask == null) {
                this.groundMask = new Lemmings.SolidLayer(this.width, this.height);
            }
            return this.groundMask;
        }
        /** set the GroundMaskLayer */
        setGroundMaskLayer(solidLayer) {
            this.groundMask = solidLayer;
        }
        /** clear with mask  */
        clearGroundWithMask(mask, x, y) {
            x += mask.offsetX;
            y += mask.offsetY;
            for (let d_y = 0; d_y < mask.height; d_y++) {
                for (let d_x = 0; d_x < mask.width; d_x++) {
                    if (!mask.at(d_x, d_y)) {
                        this.clearGroundAt(x + d_x, y + d_y);
                    }
                }
            }
        }
        /** set a point in the map to solid ground  */
        setGroundAt(x, y, palletIndex) {
            this.groundMask.setGroundAt(x, y);
            let index = (y * this.width + x) * 4;
            this.groundImage[index + 0] = this.colorPalette.getR(palletIndex);
            this.groundImage[index + 1] = this.colorPalette.getG(palletIndex);
            this.groundImage[index + 2] = this.colorPalette.getB(palletIndex);
        }
        /** checks if a point is solid ground  */
        hasGroundAt(x, y) {
            return this.groundMask.hasGroundAt(x, y);
        }
        /** clear a point  */
        clearGroundAt(x, y) {
            this.groundMask.clearGroundAt(x, y);
            let index = (y * this.width + x) * 4;
            this.groundImage[index + 0] = 0; // R
            this.groundImage[index + 1] = 0; // G
            this.groundImage[index + 2] = 0; // B
        }
        setGroundImage(img) {
            this.groundImage = new Uint8ClampedArray(img);
        }
        /** set the color palettes for this level */
        setPalettes(colorPalette, groundPalette) {
            this.colorPalette = colorPalette;
            this.groundPalette = groundPalette;
        }
        /** render ground to display */
        render(gameDisplay) {
            gameDisplay.initSize(this.width, this.height);
            gameDisplay.setBackground(this.groundImage, this.groundMask);
        }
    }
    Lemmings.Level = Level;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    /** a mask */
    class MaskList {
        constructor(fr, width, height, count, offsetX, offsetY) {
            if (fr != null) {
                this.loadFromFile(fr, width, height, count, offsetX, offsetY);
            }
        }
        get length() {
            return frames.length;
        }
        GetMask(index) {
            return this.frames[index];
        }
        loadFromFile(fr, width, height, count, offsetX, offsetY) {
            this.frames = [];
            for (let i = 0; i < count; i++) {
                let mask = new Lemmings.Mask(fr, width, height, offsetX, offsetY);
                this.frames.push(mask);
            }
        }
    }
    Lemmings.MaskList = MaskList;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    /** manage the in-game masks a lemming can use to change the map */
    class MaskProvider {
        constructor(fr) {
            this.maskList = [];
            this.maskList[Lemmings.MaskTypes.BASHING_R] = new Lemmings.MaskList(fr, 16, 10, 4, -8, -10);
            this.maskList[Lemmings.MaskTypes.BASHING_L] = new Lemmings.MaskList(fr, 16, 10, 4, -8, -10);
            this.maskList[Lemmings.MaskTypes.MINING_R] = new Lemmings.MaskList(fr, 16, 13, 2, -8, -12);
            this.maskList[Lemmings.MaskTypes.MINING_L] = new Lemmings.MaskList(fr, 16, 13, 2, -8, -12);
            this.maskList[Lemmings.MaskTypes.EXPLODING] = new Lemmings.MaskList(fr, 16, 22, 1, -8, -14);
            this.maskList[Lemmings.MaskTypes.NUMBERS] = new Lemmings.MaskList(fr, 8, 8, 10, -1, -19);
        }
        GetMask(maskTypes) {
            return this.maskList[maskTypes];
        }
    }
    Lemmings.MaskProvider = MaskProvider;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    var MaskTypes;
    (function (MaskTypes) {
        MaskTypes[MaskTypes["BASHING_R"] = 0] = "BASHING_R";
        MaskTypes[MaskTypes["BASHING_L"] = 1] = "BASHING_L";
        MaskTypes[MaskTypes["MINING_R"] = 2] = "MINING_R";
        MaskTypes[MaskTypes["MINING_L"] = 3] = "MINING_L";
        MaskTypes[MaskTypes["EXPLODING"] = 4] = "EXPLODING";
        MaskTypes[MaskTypes["NUMBERS"] = 5] = "NUMBERS";
    })(MaskTypes = Lemmings.MaskTypes || (Lemmings.MaskTypes = {}));
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    /** a mask */
    class Mask {
        constructor(fr, width, height, offsetX, offsetY) {
            this.offsetX = offsetX;
            this.offsetY = offsetY;
            if (fr != null) {
                this.loadFromFile(fr, width, height);
            }
        }
        getMask() {
            return this.data;
        }
        /** return true if the given position (x,y) of the mask is set */
        at(x, y) {
            return (this.data[y * this.width + x] == 0);
        }
        /** load a mask from a file stream */
        loadFromFile(fr, width, height) {
            this.width = width;
            this.height = height;
            let pixCount = width * height;
            let pixBuf = new Int8Array(pixCount);
            let bitBuffer = 0;
            let bitBufferLen = 0;
            for (let i = 0; i < pixCount; i++) {
                if (bitBufferLen <= 0) {
                    bitBuffer = fr.readByte();
                    bitBufferLen = 8;
                }
                pixBuf[i] = (bitBuffer & 0x80);
                bitBuffer = (bitBuffer << 1);
                bitBufferLen--;
            }
            this.data = pixBuf;
        }
    }
    Lemmings.Mask = Mask;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    class ParticleTable {
        constructor(palette) {
            this.palette = palette;
            this.colorIndexTable = [4, 15, 14, 13, 12, 11, 10, 9, 8, 11, 10, 9, 8, 7, 6, 2];
            /// read particle coordinates form Base64 string
            this.particleData = new Array(51);
            let data = window.atob(ParticleTable.particleDataBase64);
            let pos = 0;
            for (let f = 0; f < 51; f++) {
                this.particleData[f] = new Int8Array(160);
                let tmpData = this.particleData[f];
                for (let p = 0; p < 80; p++) {
                    /// x position
                    tmpData[p * 2] = data.charCodeAt(pos);
                    pos++;
                    /// y position
                    tmpData[p * 2 + 1] = data.charCodeAt(pos);
                    pos++;
                }
            }
        }
        draw(gameDisplay, frameIndex, x, y) {
            var frameData = this.particleData[frameIndex];
            if ((!frameData) || (gameDisplay == null)) {
                return;
            }
            for (let i = 0; i < frameData.length; i += 2) {
                let dx = frameData[i];
                let dy = frameData[i + 1];
                if ((dx == -128) || (dy == -128)) {
                    continue;
                }
                let colorIndex = this.colorIndexTable[i % 16];
                gameDisplay.setPixel(x + dx, y + dy, this.palette.getR(colorIndex), this.palette.getG(colorIndex), this.palette.getB(colorIndex));
            }
        }
    }
    ParticleTable.particleDataBase64 = "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" +
        "YjicQMlJC041MSJMJ0btUT1CC1JPTrlF+0fuWhpfIVhBZTteLWJEcA54yHgOaURt/3Dycg1w5WrTb+N68nYleg14CHyAgBJ6Kn4JfICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI6NlcGAgDPDwPPf4mLk9wm1HIstDwxXK2Q+mkbHTwtUNzcjUihM7Vg+SAxZUVS3S/tN7mEbZiJfQms8ZC5pRXeAgICAD29GdP938XkNeORx0naAgPF9gICAgICAgICAgICAgICAgICAgICAgICAgI" +
        "CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICMjpLEgIA0xr/33uZk6PcOtCGIMg8RWTFmRJhMxlULWjg9JFgpUu1eQE8MX1JbtlL7U+1oHG0iZkRyPmsvcICAgICAgA93R3uAgICAgIDkeNF9gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAipGQyICANcq+/N7qZuz2E7InhjgPFls3aEqWU8VcC2E5QyRfKlns" +
        "ZUFVDGZUYbRY+1rtbxx0I21FeT9yMHeAgICAgIAQfoCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIeTjsyAgDbNvADd7mjx9hixLYM+EBxdPWtQk1nDYgxoOkklZStf7GxCXAxtVmizX/th7HYdeyN0gIBAeTJ+gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI" +
        "CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICFlovQgIA40bsF3PNq9fYdrzOBRBAhX0NtV5FgwmkMbztQJmwrZutzRGMMdFhwsWb7aOx9gIAke4CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgpiJ1ICAOdW6C9v3bPr2I605gIAQJ2FJb16PZ8FwDHY9VyZzLG3rekVqDHtad69t+2+AgICA" +
        "gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAh9iAgDrauBDa/G7/9SmsP4CAES1jUHJljW6/dwx9Pl0ney11gIBGcYCAXH6udft2gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA";
    Lemmings.ParticleTable = ParticleTable;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    /** manage the sprites need for the game skill panel */
    class SkillPanelSprites {
        constructor(fr2, fr6, colorPalette) {
            this.letterSprite = {};
            this.numberSpriteLeft = [];
            this.numberSpriteRight = [];
            /// read skill panel
            let paletteImg = new Lemmings.PaletteImage(320, 40);
            paletteImg.processImage(fr6, 4);
            this.panelSprite = paletteImg.createFrame(colorPalette);
            /// read green panel letters
            let letters = ["%", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "-", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z"];
            for (let l = 0; l < letters.length; l++) {
                let paletteImg = new Lemmings.PaletteImage(8, 16);
                paletteImg.processImage(fr6, 3);
                this.letterSprite[letters[l]] = paletteImg.createFrame(colorPalette);
            }
            /// add space
            let emptyFrame = new Lemmings.Frame(8, 16);
            emptyFrame.fill(0, 0, 0);
            this.letterSprite[" "] = emptyFrame;
            let blackAndWithPalette = new Lemmings.ColorPalette();
            blackAndWithPalette.setColorRGB(1, 255, 255, 255);
            /// read panel skill-count number letters
            fr2.setOffset(0x1900);
            for (let i = 0; i < 10; i++) {
                let paletteImgRight = new Lemmings.PaletteImage(8, 8);
                paletteImgRight.processImage(fr2, 1);
                paletteImgRight.processTransparentByColorIndex(0);
                this.numberSpriteRight.push(paletteImgRight.createFrame(blackAndWithPalette));
                let paletteImgLeft = new Lemmings.PaletteImage(8, 8);
                paletteImgLeft.processImage(fr2, 1);
                paletteImgLeft.processTransparentByColorIndex(0);
                this.numberSpriteLeft.push(paletteImgLeft.createFrame(blackAndWithPalette));
            }
            /// add space
            this.emptyNumberSprite = new Lemmings.Frame(9, 8);
            this.emptyNumberSprite.fill(255, 255, 255);
        }
        /** return the sprite for the skill panel */
        getPanelSprite() {
            return this.panelSprite;
        }
        /** return a green letter */
        getLetterSprite(letter) {
            return this.letterSprite[letter.toUpperCase()];
        }
        /** return a number letter */
        getNumberSpriteLeft(number) {
            return this.numberSpriteLeft[number];
        }
        /** return a number letter */
        getNumberSpriteRight(number) {
            return this.numberSpriteRight[number];
        }
        getNumberSpriteEmpty() {
            return this.emptyNumberSprite;
        }
    }
    Lemmings.SkillPanelSprites = SkillPanelSprites;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    /** Handles a mask of points for the level background
     *   that defines the solid points of the level */
    class SolidLayer {
        constructor(width, height, mask = null) {
            this.width = 0;
            this.height = 0;
            this.width = width;
            this.height = height;
            if (mask != null) {
                this.groundMask = mask;
            }
        }
        /** check if a point is solid */
        hasGroundAt(x, y) {
            if ((x < 0) || (x >= this.width))
                return false;
            if ((y < 0) || (y >= this.height))
                return false;
            return (this.groundMask[x + y * this.width] != 0);
        }
        /** clear a point  */
        clearGroundAt(x, y) {
            let index = x + y * this.width;
            this.groundMask[index] = 0;
        }
        /** clear a point  */
        setGroundAt(x, y) {
            let index = x + y * this.width;
            this.groundMask[index] = 1;
        }
    }
    Lemmings.SolidLayer = SolidLayer;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    var SpriteTypes;
    (function (SpriteTypes) {
        SpriteTypes[SpriteTypes["WALKING"] = 0] = "WALKING";
        SpriteTypes[SpriteTypes["EXPLODING"] = 1] = "EXPLODING";
        SpriteTypes[SpriteTypes["JUMPING"] = 2] = "JUMPING";
        SpriteTypes[SpriteTypes["DIGGING"] = 3] = "DIGGING";
        SpriteTypes[SpriteTypes["CLIMBING"] = 4] = "CLIMBING";
        SpriteTypes[SpriteTypes["POSTCLIMBING"] = 5] = "POSTCLIMBING";
        SpriteTypes[SpriteTypes["BUILDING"] = 6] = "BUILDING";
        SpriteTypes[SpriteTypes["BLOCKING"] = 7] = "BLOCKING";
        SpriteTypes[SpriteTypes["BASHING"] = 8] = "BASHING";
        SpriteTypes[SpriteTypes["FALLING"] = 9] = "FALLING";
        SpriteTypes[SpriteTypes["UMBRELLA"] = 10] = "UMBRELLA";
        SpriteTypes[SpriteTypes["SPLATTING"] = 11] = "SPLATTING";
        SpriteTypes[SpriteTypes["MINING"] = 12] = "MINING";
        SpriteTypes[SpriteTypes["DROWNING"] = 13] = "DROWNING";
        SpriteTypes[SpriteTypes["EXITING"] = 14] = "EXITING";
        SpriteTypes[SpriteTypes["FRYING"] = 15] = "FRYING";
        SpriteTypes[SpriteTypes["OHNO"] = 16] = "OHNO";
        SpriteTypes[SpriteTypes["LEMACTION_SHRUG"] = 17] = "LEMACTION_SHRUG";
        SpriteTypes[SpriteTypes["SHRUGGING"] = 18] = "SHRUGGING";
        SpriteTypes[SpriteTypes["OUT_OFF_LEVEL"] = 19] = "OUT_OFF_LEVEL";
    })(SpriteTypes = Lemmings.SpriteTypes || (Lemmings.SpriteTypes = {}));
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    /** Class to provide a read pointer and read functions to a binary Buffer */
    class BinaryReader {
        constructor(dataArray, offset = 0, length, filename = "[unknown]") {
            this.log = new Lemmings.LogHandler("BinaryReader");
            this.filename = filename;
            if (offset == null)
                offset = 0;
            let dataLength = 0;
            if (dataArray == null) {
                this.data = new Uint8Array(0);
                dataLength = 0;
                this.log.log("BinaryReader from NULL; size:" + 0);
            } else if (dataArray instanceof BinaryReader) {
                //- if dataArray is BinaryReader use there data
                this.data = dataArray.data;
                dataLength = dataArray.length;
                this.log.log("BinaryReader from BinaryReader; size:" + dataLength);
            } else if (dataArray instanceof Uint8Array) {
                this.data = dataArray;
                dataLength = dataArray.byteLength;
                this.log.log("BinaryReader from Uint8Array; size:" + dataLength);
            } else if (dataArray instanceof ArrayBuffer) {
                this.data = new Uint8Array(dataArray);
                dataLength = dataArray.byteLength;
                this.log.log("BinaryReader from ArrayBuffer; size:" + dataLength);
            } else if (dataArray instanceof Blob) {
                this.data = new Uint8Array(dataArray);
                dataLength = this.data.byteLength;
                this.log.log("BinaryReader from Blob; size:" + dataLength);
            } else {
                this.data = dataArray;
                dataLength = this.data.length;
                this.log.log("BinaryReader from unknown: " + dataArray + "; size:" + dataLength);
            }
            if (length == null)
                length = dataLength - offset;
            this.hiddenOffset = offset;
            this.length = length;
            this.pos = this.hiddenOffset;
        }
        /** Read one Byte from stream */
        readByte(offset) {
            if (offset != null)
                this.pos = (offset + this.hiddenOffset);
            if ((this.pos < 0) || (this.pos > this.data.length)) {
                this.log.log("read out of data: " + this.filename + " - size: " + this.data.length + " @ " + this.pos);
                return 0;
            }
            let v = this.data[this.pos];
            this.pos++;
            return v;
        }
        /** Read one DWord (4 Byte) from stream (little ending) */
        readInt(length = 4, offset) {
            if (offset == null)
                offset = this.pos;
            if (length == 4) {
                let v = (this.data[offset] << 24) | (this.data[offset + 1] << 16) | (this.data[offset + 2] << 8) | (this.data[offset + 3]);
                this.pos = offset + 4;
                return v;
            }
            let v = 0;
            for (let i = length; i > 0; i--) {
                v = (v << 8) | this.data[offset];
                offset++;
            }
            this.pos = offset;
            return v;
        }
        /** Read one DWord (4 Byte) from stream (big ending) */
        readIntBE(offset) {
            if (offset == null)
                offset = this.pos;
            let v = (this.data[offset]) | (this.data[offset + 1] << 8) | (this.data[offset + 2] << 16) | (this.data[offset + 3] << 24);
            this.pos = offset + 4;
            return v;
        }
        /** Read one Word (2 Byte) from stream (big ending) */
        readWord(offset) {
            if (offset == null)
                offset = this.pos;
            let v = (this.data[offset] << 8) | (this.data[offset + 1]);
            this.pos = offset + 2;
            return v;
        }
        /** Read one Word (2 Byte) from stream (big ending) */
        readWordBE(offset) {
            if (offset == null)
                offset = this.pos;
            let v = (this.data[offset]) | (this.data[offset + 1] << 8);
            this.pos = offset + 2;
            return v;
        }
        /** Read a String */
        readString(length, offset) {
            if (offset === null)
                this.pos = offset + this.hiddenOffset;
            let result = "";
            for (let i = 0; i < length; i++) {
                let v = this.data[this.pos];
                this.pos++;
                result += String.fromCharCode(v);
            }
            return result;
        }
        /** return the current cursor position */
        getOffset() {
            return this.pos - this.hiddenOffset;
        }
        /** set the current cursor position */
        setOffset(newPos) {
            this.pos = newPos + this.hiddenOffset;
        }
        /** return true if the cursor position is out of data */
        eof() {
            let pos = this.pos - this.hiddenOffset;
            return ((pos >= this.length) || (pos < 0));
        }
        /** return a String of the data */
        readAll() {
            return this.readString(this.length, 0);
        }
    }
    Lemmings.BinaryReader = BinaryReader;
})(Lemmings || (Lemmings = {}));
/// <reference path="binary-reader.ts"/>
var Lemmings;
(function (Lemmings) {
    //------------------------
    // reads the bits on a BinaryReader
    class BitReader {
        constructor(fileReader, offset, length, initBufferLength) {
            this.pos = 0;
            //- create a copy of the reader
            this.binReader = new Lemmings.BinaryReader(fileReader, offset, length, fileReader.filename);
            this.pos = length;
            this.pos--;
            this.buffer = this.binReader.readByte(this.pos);
            this.bufferLen = initBufferLength;
            this.checksum = this.buffer;
        }
        getCurrentChecksum() {
            return this.checksum;
        }
        /** read and return [bitCount] bits from the stream */
        read(bitCount) {
            let result = 0;
            for (var i = bitCount; i > 0; i--) {
                if (this.bufferLen <= 0) {
                    this.pos--;
                    var b = this.binReader.readByte(this.pos);
                    this.buffer = b;
                    this.checksum ^= b;
                    this.bufferLen = 8;
                }
                this.bufferLen--;
                result = (result << 1) | (this.buffer & 1);
                this.buffer >>= 1;
            }
            return result;
        }
        eof() {
            return ((this.bufferLen <= 0) && (this.pos < 0));
        }
    }
    Lemmings.BitReader = BitReader;
})(Lemmings || (Lemmings = {}));
/// <reference path="bit-reader.ts"/>
/// <reference path="binary-reader.ts"/>
var Lemmings;
(function (Lemmings) {
    /** Bit Stream Writer class */
    class BitWriter {
        constructor(bitReader, outLength) {
            this.log = new Lemmings.LogHandler("BitWriter");
            this.outData = new Uint8Array(outLength);
            this.outPos = outLength;
            this.bitReader = bitReader;
        }
        /** copy length bytes from the reader */
        copyRawData(length) {
            if (this.outPos - length < 0) {
                this.log.log("copyRawData: out of out buffer");
                length = this.outPos;
                return;
            }
            for (; length > 0; length--) {
                this.outPos--;
                this.outData[this.outPos] = this.bitReader.read(8);
            }
        }
        /** Copy length bits from the write cache */
        copyReferencedData(length, offsetBitCount) {
            /// read offset to current write pointer to read from
            var offset = this.bitReader.read(offsetBitCount) + 1;
            /// is offset in range?
            if (this.outPos + offset > this.outData.length) {
                this.log.log("copyReferencedData: offset out of range");
                offset = 0;
                return;
            }
            /// is length in range
            if (this.outPos - length < 0) {
                this.log.log("copyReferencedData: out of out buffer");
                length = this.outPos;
                return;
            }
            for (; length > 0; length--) {
                this.outPos--;
                this.outData[this.outPos] = this.outData[this.outPos + offset];
            }
        }
        /** return a  BinaryReader with the data written to this BitWriter class */
        getFileReader(filename) {
            return new Lemmings.BinaryReader(this.outData, null, null, filename);
        }
        eof() {
            return this.outPos <= 0;
        }
    }
    Lemmings.BitWriter = BitWriter;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    /** Read the container file and return the unpacked parts of it  */
    class FileContainer {
        /** read the content of the container  */
        constructor(content) {
            this.log = new Lemmings.LogHandler("FileContainer");
            this.read(content);
        }
        /** Unpack a part (chunks / segments) of the file and return it */
        getPart(index) {
            if ((index < 0) || (index >= this.parts.length)) {
                this.log.log("getPart(" + index + ") Out of index!");
                return new Lemmings.BinaryReader();
            }
            return this.parts[index].unpack();
        }
        /** return the number of parts in this file */
        count() {
            return this.parts.length;
        }
        /** do the read job and find all parts in this container */
        read(fileReader) {
            /// reset parts
            this.parts = new Array();
            /// we start at the end of the file
            var pos = 0;
            /// the size of the header
            const HEADER_SIZE = 10;
            while (pos + HEADER_SIZE < fileReader.length) {
                fileReader.setOffset(pos);
                let part = new Lemmings.UnpackFilePart(fileReader);
                /// start of the chunk
                part.offset = pos + HEADER_SIZE;
                /// Read Header of each Part
                part.initialBufferLen = fileReader.readByte();
                part.checksum = fileReader.readByte();
                part.unknown1 = fileReader.readWord();
                part.decompressedSize = fileReader.readWord();
                part.unknown0 = fileReader.readWord();
                var size = fileReader.readWord();
                part.compressedSize = size - HEADER_SIZE;
                /// position of this part in the container
                part.index = this.parts.length;
                /// check if the data are valid
                if ((part.offset < 0) || (size > 0xFFFFFF) || (size < 10)) {
                    this.log.log("out of sync " + fileReader.filename);
                    break;
                }
                //- add part
                this.parts.push(part);
                //this.error.debug(part);
                /// jump to next part
                pos += size;
            }
            this.log.debug(fileReader.filename + " has " + this.parts.length + " file-parts.");
        }
    }
    Lemmings.FileContainer = FileContainer;
})(Lemmings || (Lemmings = {}));
/// <reference path="binary-reader.ts"/>
var Lemmings;
(function (Lemmings) {
    /**
     * Handle Files loading from remote/web
     */
    class FileProvider {
        constructor(rootPath) {
            this.rootPath = rootPath;
            this.log = new Lemmings.LogHandler("FileProvider");
        }
        /** load binary data from URL: rootPath + [path] + filename */
        loadBinary(path, filename = null) {
            let url = this.rootPath + path + ((filename == null) ? "" : "/" + filename);
            this.log.debug("loading:" + url);
            return new Promise((resolve, reject) => {
                var xhr = new XMLHttpRequest();
                xhr.onload = () => {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        let reader = new Lemmings.BinaryReader(xhr.response, 0, null, this.filenameFormUrl(url));
                        resolve(reader);
                    } else {
                        this.log.log("error load file:" + url);
                        reject({
                            status: xhr.status,
                            statusText: xhr.statusText
                        });
                    }
                };
                xhr.onerror = () => {
                    this.log.log("error load file:" + url);
                    reject({
                        status: xhr.status,
                        statusText: xhr.statusText
                    });
                };
                xhr.open("GET", url);
                xhr.responseType = "arraybuffer";
                xhr.send();
            });
        }
        /** load string data from URL */
        loadString(url) {
            this.log.log("Load file as string: " + url);
            return new Promise((resolve, reject) => {
                let xhr = new XMLHttpRequest();
                xhr.onload = (oEvent) => {
                    resolve(xhr.response);
                };
                xhr.onerror = () => {
                    this.log.log("error load file:" + url);
                    reject({
                        status: xhr.status,
                        statusText: xhr.statusText
                    });
                };
                /// setup query
                xhr.open('GET', url, true);
                xhr.responseType = "text";
                /// call url
                xhr.send(null);
            });
        }
        // Extract filename form URL
        filenameFormUrl(url) {
            if (url == "")
                return "";
            url = url.substring(0, (url.indexOf("#") == -1) ? url.length : url.indexOf("#"));
            url = url.substring(0, (url.indexOf("?") == -1) ? url.length : url.indexOf("?"));
            url = url.substring(url.lastIndexOf("/") + 1, url.length);
            return url;
        }
    }
    Lemmings.FileProvider = FileProvider;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    /** represents a part/chunk of a file and is  */
    class UnpackFilePart {
        constructor(fileReader) {
            /** file offset in the container */
            this.offset = 0;
            /** flag for uncompressing */
            this.initialBufferLen = 0;
            /** checksum this file need to have */
            this.checksum = 0;
            /** size the uncompressed chunk should have */
            this.decompressedSize = 0;
            /** the size the compressed chunk had */
            this.compressedSize = 0;
            this.unknown0 = 0;
            this.unknown1 = 0;
            /** position of this part/chunk in the container */
            this.index = 0;
            this.log = new Lemmings.LogHandler("UnpackFilePart");
            this.fileReader = fileReader;
            this.unpackingDone = false;
        }
        /** unpack this content and return a BinaryReader */
        unpack() {
            /// if the unpacking is not yet done, do it...
            if (!this.unpackingDone) {
                this.fileReader = this.doUnpacking(this.fileReader);
                this.unpackingDone = true;
                return this.fileReader;
            }
            /// use the cached file buffer but with a new file pointer
            return new Lemmings.BinaryReader(this.fileReader);
        }
        /// unpack the fileReader
        doUnpacking(fileReader) {
            var bitReader = new Lemmings.BitReader(fileReader, this.offset, this.compressedSize, this.initialBufferLen);
            var outBuffer = new Lemmings.BitWriter(bitReader, this.decompressedSize);
            while ((!outBuffer.eof()) && (!bitReader.eof())) {
                if (bitReader.read(1) == 0) {
                    switch (bitReader.read(1)) {
                    case 0:
                        outBuffer.copyRawData(bitReader.read(3) + 1);
                        break;
                    case 1:
                        outBuffer.copyReferencedData(2, 8);
                        break;
                    }
                } else {
                    switch (bitReader.read(2)) {
                    case 0:
                        outBuffer.copyReferencedData(3, 9);
                        break;
                    case 1:
                        outBuffer.copyReferencedData(4, 10);
                        break;
                    case 2:
                        outBuffer.copyReferencedData(bitReader.read(8) + 1, 12);
                        break;
                    case 3:
                        outBuffer.copyRawData(bitReader.read(8) + 9);
                        break;
                    }
                }
            }
            if (this.checksum == bitReader.getCurrentChecksum()) {
                this.log.debug("doUnpacking(" + fileReader.filename + ") done! ");
            } else {
                this.log.log("doUnpacking(" + fileReader.filename + ") : Checksum mismatch! ");
            }
            /// create FileReader from buffer
            var outReader = outBuffer.getFileReader(fileReader.filename + "[" + this.index + "]");
            return outReader;
        }
    }
    Lemmings.UnpackFilePart = UnpackFilePart;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    /** The ColorPalette Class provides a Color Palette of the game.
     *  use:
     *                           INDEX    RGBA
     * read:  ColorPalette.data[0 ... 16].color;
     * write: ColorPalette.setColor(INT index, INT r, INT g, INT b, BOOL locked)
     */
    class ColorPalette {
        constructor() {
            this.data = new Uint32Array(16); //- 16 colors
            this.data.fill(0);
        }
        /** set color from Int-Value e.g. 0xFF00FF00 */
        setColorInt(index, colorValue) {
            this.data[index] = colorValue;
        }
        /** return a int-color value e.g. 0xFF00FF00 */
        getColor(index) {
            return this.data[index];
        }
        getR(index) {
            return this.data[index] & 0xFF;
        }
        getG(index) {
            return (this.data[index] >> 8) & 0xFF;
        }
        getB(index) {
            return (this.data[index] >> 16) & 0xFF;
        }
        /** set color from R,G,B */
        setColorRGB(index, r, g, b) {
            this.setColorInt(index, ColorPalette.colorFromRGB(r, g, b));
        }
        static colorFromRGB(r, g, b) {
            return 0xFF << 24 | b << 16 | g << 8 | r << 0;
        }
        static get black() {
            return 0xFF000000;
        }
        static get debugColor() {
            return 0xFFFF00FF;
        }
    }
    Lemmings.ColorPalette = ColorPalette;
})(Lemmings || (Lemmings = {}));
/// <reference path="../file/binary-reader.ts"/>
/// <reference path="./color-palette.ts"/>
var Lemmings;
(function (Lemmings) {
    /** base image information of objects */
    class BaseImageInfo {
        constructor() {
            this.width = 0;
            this.height = 0;
            /// normal case
            ///           +------------+
            /// imageLoc: |            | 1st Bits
            ///           |            | 2th Bits
            /// vgaLoc:   |            | 3th Bits
            /// maskLoc:  |            | 4th Bits
            ///           +------------+
            /** position of the image in the file */
            this.imageLoc = 0;
            /** position of the (alpha) mask in the file */
            this.maskLoc = 0;
            /** position of the vga bits in the file */
            this.vgaLoc = 0;
            /** size of one frame in the file */
            this.frameDataSize = 0;
            /** number of frames used by this image */
            this.frameCount = 0;
            /** the color palette to be used for this image */
            this.palette = null;
        }
    }
    Lemmings.BaseImageInfo = BaseImageInfo;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    /** Define Types a triggers */
    var TriggerTypes;
    (function (TriggerTypes) {
        TriggerTypes[TriggerTypes["NO_TRIGGER"] = 0] = "NO_TRIGGER";
        TriggerTypes[TriggerTypes["EXIT_LEVEL"] = 1] = "EXIT_LEVEL";
        TriggerTypes[TriggerTypes["UNKNOWN_2"] = 2] = "UNKNOWN_2";
        TriggerTypes[TriggerTypes["UNKNOWN_3"] = 3] = "UNKNOWN_3";
        TriggerTypes[TriggerTypes["TRAP"] = 4] = "TRAP";
        TriggerTypes[TriggerTypes["DROWN"] = 5] = "DROWN";
        TriggerTypes[TriggerTypes["KILL"] = 6] = "KILL";
        TriggerTypes[TriggerTypes["ONWAY_LEFT"] = 7] = "ONWAY_LEFT";
        TriggerTypes[TriggerTypes["ONWAY_RIGHT"] = 8] = "ONWAY_RIGHT";
        TriggerTypes[TriggerTypes["STEEL"] = 9] = "STEEL";
        TriggerTypes[TriggerTypes["BLOCKER_LEFT"] = 10] = "BLOCKER_LEFT";
        TriggerTypes[TriggerTypes["BLOCKER_RIGHT"] = 11] = "BLOCKER_RIGHT";
    })(TriggerTypes = Lemmings.TriggerTypes || (Lemmings.TriggerTypes = {}));
})(Lemmings || (Lemmings = {}));
/// <reference path="./base-image-info.ts"/>
/// <reference path="./trigger-types.ts"/>
var Lemmings;
(function (Lemmings) {
    /** stores sprite image properties of objects */
    class ObjectImageInfo extends Lemmings.BaseImageInfo {
        constructor() {
            super(...arguments);
            this.animationLoop = false;
            this.firstFrameIndex = 0;
            this.unknown1 = 0;
            this.unknown2 = 0;
            this.trigger_left = 0;
            this.trigger_top = 0;
            this.trigger_width = 0;
            this.trigger_height = 0;
            this.trigger_effect_id = 0;
            this.preview_image_index = 0;
            this.unknown = 0;
            this.trap_sound_effect_id = 0;
        }
    }
    Lemmings.ObjectImageInfo = ObjectImageInfo;
})(Lemmings || (Lemmings = {}));
/// <reference path="./base-image-info.ts"/>
var Lemmings;
(function (Lemmings) {
    /** stores terrain/background image properties */
    class TerrainImageInfo extends Lemmings.BaseImageInfo {}
    Lemmings.TerrainImageInfo = TerrainImageInfo;
})(Lemmings || (Lemmings = {}));
/// <reference path="../file/binary-reader.ts"/>
/// <reference path="./color-palette.ts"/>
/// <reference path="./object-image-info.ts"/>
/// <reference path="./terrain-image-info.ts"/>
var Lemmings;
(function (Lemmings) {
    /** read all image meta information from ground file (GROUNDxO.DAT)
     *   and uses the VGAGx File to add the image-data to this images-list.
     * The ground file contains
     *  - the meta data for the level-background-images (e.g mud and grass)
     *  - the meta data for the level-object-images (e.g. Exists and Traps)
     *  - the color palettes to use
     * The VGAGx file contains
     *  - the image data (color-indexed) of the level-background-images
     *  - the image data (color-indexed) of the level-object-images (multi frame/animation)
     */
    class GroundReader {
        /** groundFile: GROUNDxO.DAT
         *  vgaTerrar: Part of VGAGx.DAT for the terrar-images
         *  vgaObject: Part of VGAGx.DAT with the object-images
         */
        constructor(groundFile, vgaTerrar, vgaObject) {
            this.imgObjects = new Array(16);
            this.imgTerrar = new Array(64);
            /** the color palette stored in this file */
            this.groundPalette = new Lemmings.ColorPalette();
            this.colorPalette = new Lemmings.ColorPalette();
            this.log = new Lemmings.LogHandler("GroundReader");
            if (groundFile.length != 1056) {
                this.log.log("groundFile " + groundFile.filename + " has wrong size: " + groundFile.length);
                return;
            }
            let BYTE_SIZE_OF_OBJECTS = 28 * 16;
            let BYTE_SIZE_OF_TERRAIN = 64 * 8;
            this.readPalettes(groundFile, BYTE_SIZE_OF_OBJECTS + BYTE_SIZE_OF_TERRAIN);
            this.readObjectImages(groundFile, 0, this.colorPalette);
            this.readTerrainImages(groundFile, BYTE_SIZE_OF_OBJECTS, this.groundPalette);
            this.readImages(this.imgObjects, vgaObject, 4);
            this.readImages(this.imgTerrar, vgaTerrar, 3);
        }
        /** return the images (meta + data) used for the Background */
        getTerraImages() {
            return this.imgTerrar;
        }
        /** return the images (meta + data) used for the map objects*/
        getObjectImages() {
            return this.imgObjects;
        }
        /** loads all images of imgList from the VGAGx file */
        readImages(imgList, vga, bitPerPixel) {
            imgList.map((img) => {
                img.frames = [];
                let filePos = img.imageLoc;
                for (let f = 0; f < img.frameCount; f++) {
                    var bitImage = new Lemmings.PaletteImage(img.width, img.height);
                    //// read image
                    bitImage.processImage(vga, bitPerPixel, filePos);
                    bitImage.processTransparentData(vga, filePos + img.maskLoc);
                    img.frames.push(bitImage.getImageBuffer());
                    /// move to the next frame data
                    filePos += img.frameDataSize;
                }
            });
        }
        /** loads the properties for object-images from the groundFile  */
        readObjectImages(frO, offset, colorPalett) {
            /// offset to the objects
            frO.setOffset(offset);
            for (let i = 0; i < 16; i++) {
                let img = new Lemmings.ObjectImageInfo();
                let flags = frO.readWordBE();
                img.animationLoop = ((flags & 1) == 0);
                img.firstFrameIndex = frO.readByte();
                img.frameCount = frO.readByte();
                img.width = frO.readByte();
                img.height = frO.readByte();
                img.frameDataSize = frO.readWordBE();
                img.maskLoc = frO.readWordBE();
                img.unknown1 = frO.readWordBE();
                img.unknown2 = frO.readWordBE();
                img.trigger_left = frO.readWordBE() * 4;
                img.trigger_top = frO.readWordBE() * 4 - 4;
                img.trigger_width = frO.readByte() * 4;
                img.trigger_height = frO.readByte() * 4;
                img.trigger_effect_id = frO.readByte();
                img.imageLoc = frO.readWordBE();
                img.preview_image_index = frO.readWordBE();
                img.unknown = frO.readWordBE();
                img.trap_sound_effect_id = frO.readByte();
                img.palette = colorPalett;
                if (frO.eof()) {
                    this.log.log("readObjectImages() : unexpected end of file: " + frO.filename);
                    return;
                }
                //- add Object
                this.imgObjects[i] = img;
            }
        }
        /** loads the properties for terrain-images  */
        readTerrainImages(frO, offset, colorPalette) {
            frO.setOffset(offset);
            for (let i = 0; i < 64; i++) {
                let img = new Lemmings.TerrainImageInfo();
                img.width = frO.readByte();
                img.height = frO.readByte();
                img.imageLoc = frO.readWordBE();
                /// use the delta offset to be compatible with the 'ObjectImageInfo.maskLoc'
                img.maskLoc = frO.readWordBE() - img.imageLoc;
                img.vgaLoc = frO.readWordBE();
                img.palette = colorPalette;
                img.frameCount = 1;
                if (frO.eof()) {
                    this.log.log("readTerrainImages() : unexpected end of file! " + frO.filename);
                    return;
                }
                //- add Object
                this.imgTerrar[i] = img;
            }
        }
        /** loads the palettes  */
        readPalettes(frO, offset) {
            /// jump over the EGA palettes
            frO.setOffset(offset + 3 * 8);
            /// read the VGA palette index 8..15
            for (let i = 0; i < 8; i++) {
                let r = frO.readByte() << 2;
                let g = frO.readByte() << 2;
                let b = frO.readByte() << 2;
                this.groundPalette.setColorRGB(i, r, g, b);
            }
            /// read the VGA palette index 0..7
            for (var i = 0; i < 8; i++) {
                let r = frO.readByte() << 2;
                let g = frO.readByte() << 2;
                let b = frO.readByte() << 2;
                this.colorPalette.setColorRGB(i, r, g, b);
            }
            /// read the VGA palette index 8..15 for preview
            for (let i = 8; i < 16; i++) {
                let r = frO.readByte() << 2;
                let g = frO.readByte() << 2;
                let b = frO.readByte() << 2;
                this.colorPalette.setColorRGB(i, r, g, b);
            }
        }
    }
    Lemmings.GroundReader = GroundReader;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    /** A LevelElement is a Object / Terrain Item used on a Level map */
    class LevelElement {
        constructor() {
            this.x = 0;
            this.y = 0;
            this.id = 0;
            this.frameIndex = 0;
        }
    }
    Lemmings.LevelElement = LevelElement;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    class LevelProperties {
        constructor() {
            this.levelName = "";
            this.releaseRate = 0;
            this.releaseCount = 0;
            this.needCount = 0;
            this.timeLimit = 0;
            this.skills = new Array(Lemmings.SkillTypes.length());
        }
    }
    Lemmings.LevelProperties = LevelProperties;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    /** stores a rectangle range */
    class Range {
        constructor() {
            this.x = 0;
            this.y = 0;
            this.width = 0;
            this.height = 0;
        }
    }
    Lemmings.Range = Range;
})(Lemmings || (Lemmings = {}));
/// <reference path="../file/binary-reader.ts"/>
/// <reference path="./range.ts"/>
/// <reference path="./level-properties.ts"/>
var Lemmings;
(function (Lemmings) {
    /** read a level from LEVEL___.DAT file */
    class LevelReader {
        /// Load a Level
        constructor(fr) {
            this.levelWidth = 1600;
            this.levelHeight = 160;
            this.levelProperties = new Lemmings.LevelProperties();
            this.screenPositionX = 0;
            /** index of GROUNDxO.DAT file */
            this.graphicSet1 = 0;
            /** index of VGASPECx.DAT */
            this.graphicSet2 = 0;
            this.isSuperLemming = false;
            this.objects = [];
            this.terrains = [];
            this.steel = [];
            this.log = new Lemmings.LogHandler("LevelReader");
            this.readLevelInfo(fr);
            this.readLevelObjects(fr);
            this.readLevelTerrain(fr);
            this.readSteelArea(fr);
            this.readLevelName(fr);
            this.log.debug(this);
        }
        /** read general Level information */
        readLevelInfo(fr) {
            fr.setOffset(0);
            this.levelProperties.releaseRate = fr.readWord();
            this.levelProperties.releaseCount = fr.readWord();
            this.levelProperties.needCount = fr.readWord();
            this.levelProperties.timeLimit = fr.readWord();
            //- read amount of skills
            this.levelProperties.skills[Lemmings.SkillTypes.CLIMBER] = fr.readWord();
            this.levelProperties.skills[Lemmings.SkillTypes.FLOATER] = fr.readWord();
            this.levelProperties.skills[Lemmings.SkillTypes.BOMBER] = fr.readWord();
            this.levelProperties.skills[Lemmings.SkillTypes.BLOCKER] = fr.readWord();
            this.levelProperties.skills[Lemmings.SkillTypes.BUILDER] = fr.readWord();
            this.levelProperties.skills[Lemmings.SkillTypes.BASHER] = fr.readWord();
            this.levelProperties.skills[Lemmings.SkillTypes.MINER] = fr.readWord();
            this.levelProperties.skills[Lemmings.SkillTypes.DIGGER] = fr.readWord();
            this.screenPositionX = fr.readWord();
            this.graphicSet1 = fr.readWord();
            this.graphicSet2 = fr.readWord();
            this.isSuperLemming = (fr.readWord() != 0);
        }
        /** read the level objects */
        readLevelObjects(fr) {
            /// reset array
            this.objects = [];
            fr.setOffset(0x0020);
            for (var i = 0; i < 32; i++) {
                var newOb = new Lemmings.LevelElement();
                newOb.x = fr.readWord() - 16;
                newOb.y = fr.readWord();
                newOb.id = fr.readWord();
                var flags = fr.readWord();
                let isUpsideDown = ((flags & 0x0080) > 0);
                let noOverwrite = ((flags & 0x8000) > 0);
                let onlyOverwrite = ((flags & 0x4000) > 0);
                newOb.drawProperties = new Lemmings.DrawProperties(isUpsideDown, noOverwrite, onlyOverwrite, false);
                /// ignore empty items/objects
                if (flags == 0)
                    continue;
                this.objects.push(newOb);
            }
        }
        /** read the Level Objects */
        readLevelTerrain(fr) {
            /// reset array
            this.terrains = [];
            fr.setOffset(0x0120);
            for (var i = 0; i < 400; i++) {
                var newOb = new Lemmings.LevelElement();
                var v = fr.readInt(4);
                if (v == -1)
                    continue;
                newOb.x = ((v >> 16) & 0x0FFF) - 16;
                var y = ((v >> 7) & 0x01FF);
                newOb.y = y - ((y > 256) ? 516 : 4);
                newOb.id = (v & 0x003F);
                var flags = ((v >> 29) & 0x000F);
                let isUpsideDown = ((flags & 2) > 0);
                let noOverwrite = ((flags & 4) > 0);
                let isErase = ((flags & 1) > 0);
                newOb.drawProperties = new Lemmings.DrawProperties(isUpsideDown, noOverwrite, false, isErase);
                this.terrains.push(newOb);
            }
        }
        /** read Level Steel areas (Lemming can't pass) */
        readSteelArea(fr) {
            /// reset array
            this.steel = [];
            fr.setOffset(0x0760);
            for (var i = 0; i < 32; i++) {
                var newRange = new Lemmings.Range();
                var pos = fr.readWord();
                var size = fr.readByte();
                var unknown = fr.readByte();
                if ((pos == 0) && (size == 0))
                    continue;
                if (unknown != 0) {
                    this.log.log("Error in readSteelArea() : unknown != 0");
                    continue;
                }
                newRange.x = (pos & 0x01FF) * 4 - 16;
                newRange.y = ((pos >> 9) & 0x007F) * 4;
                newRange.width = (size & 0x0F) * 4 + 4;
                newRange.height = ((size >> 4) & 0x0F) * 4 + 4;
                this.steel.push(newRange);
            }
        }
        /** read general Level information */
        readLevelName(fr) {
            /// at the end of the 
            this.levelProperties.levelName = fr.readString(32, 0x07E0);
            this.log.debug("Level Name: " + this.levelProperties.levelName);
        }
    }
    Lemmings.LevelReader = LevelReader;
})(Lemmings || (Lemmings = {}));
/// <reference path="../file/binary-reader.ts" />
/// <reference path="../file/file-container.ts" />
var Lemmings;
(function (Lemmings) {
    /** The Odd Table has a list of LevelProperties to describe alternative starting conditions for a level  */
    class OddTableReader {
        constructor(oddfile) {
            this.levelProperties = [];
            this.log = new Lemmings.LogHandler("OddTableReader");
            this.read(oddfile);
        }
        /** return the Level for a given levelNumber - LevelNumber is counting all levels from first to last of the game
         *  Odd-Tables are only used for the "Original Lemmings" Game
         */
        getLevelProperties(levelNumber) {
            if ((levelNumber >= this.levelProperties.length) && (levelNumber < 0))
                return null;
            return this.levelProperties[levelNumber];
        }
        /** read the odd fine */
        read(fr) {
            fr.setOffset(0);
            /// count of levels definitions
            let count = Math.trunc(fr.length / 56);
            for (let i = 0; i < count; i++) {
                let prop = new Lemmings.LevelProperties();
                prop.releaseRate = fr.readWord();
                prop.releaseCount = fr.readWord();
                prop.needCount = fr.readWord();
                prop.timeLimit = fr.readWord();
                //- read amount of skills
                prop.skills[Lemmings.SkillTypes.CLIMBER] = fr.readWord();
                prop.skills[Lemmings.SkillTypes.FLOATER] = fr.readWord();
                prop.skills[Lemmings.SkillTypes.BOMBER] = fr.readWord();
                prop.skills[Lemmings.SkillTypes.BLOCKER] = fr.readWord();
                prop.skills[Lemmings.SkillTypes.BUILDER] = fr.readWord();
                prop.skills[Lemmings.SkillTypes.BASHER] = fr.readWord();
                prop.skills[Lemmings.SkillTypes.MINER] = fr.readWord();
                prop.skills[Lemmings.SkillTypes.DIGGER] = fr.readWord();
                prop.levelName = fr.readString(32);
                this.log.debug("Level (" + i + ") Name: " + prop.levelName + " " + prop.needCount + " " + prop.timeLimit);
                this.levelProperties.push(prop);
            }
            this.log.debug("levelProperties: " + this.levelProperties.length);
        }
    }
    Lemmings.OddTableReader = OddTableReader;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    /** convert the lemmings bit plain image format to real color-index-image data.
     * The lemmings file format uses multiple plains for every bit of color.
     * E.g. Save all lowest bits of the image in a chunk then all second bits... */
    class PaletteImage {
        constructor(width, height) {
            this.width = width;
            this.height = height;
            let pixCount = this.width * this.height;
            this.pixBuf = new Uint8Array(pixCount);
        }
        /** return the image buffer */
        getImageBuffer() {
            return this.pixBuf;
        }
        /** convert to frame (colored image) */
        createFrame(palette, offsetX, offsetY) {
            /// convert color-index data to pixel image
            let resultFrame = new Lemmings.Frame(this.width, this.height, offsetX, offsetY);
            if (palette != null) {
                resultFrame.drawPaletteImage(this.pixBuf, this.width, this.height, palette, 0, 0);
            }
            return resultFrame;
        }
        /** convert the multi-bit-plain image to image */
        processImage(src, bitsPerPixel = 3, startPos) {
            let pixBuf = this.pixBuf;
            let pixCount = pixBuf.length;
            let bitBufLen = 0;
            let bitBuf = 0;
            if (startPos != null) {
                src.setOffset(startPos);
            }
            /// read image
            //- bits of a byte are stored separately
            for (var i = 0; i < bitsPerPixel; i++) {
                for (var p = 0; p < pixCount; p++) {
                    if (bitBufLen <= 0) {
                        bitBuf = src.readByte();
                        bitBufLen = 8;
                    }
                    pixBuf[p] = pixBuf[p] | ((bitBuf & 0x80) >> (7 - i));
                    bitBuf = (bitBuf << 1);
                    bitBufLen--;
                }
            }
            this.pixBuf = pixBuf;
        }
        /** use a color-index for the transparency in the image */
        processTransparentByColorIndex(transparentColorIndex) {
            let pixBuf = this.pixBuf;
            let pixCount = pixBuf.length;
            for (let i = 0; i < pixCount; i++) {
                if (pixBuf[i] == transparentColorIndex) {
                    /// Sets the highest bit to indicate the transparency.
                    pixBuf[i] = 0x80 | pixBuf[i];
                }
            }
        }
        /** use a bit plain for the transparency in the image */
        processTransparentData(src, startPos = 0) {
            let pixBuf = this.pixBuf;
            let pixCount = pixBuf.length;
            let bitBufLen = 0;
            let bitBuf = 0;
            if (startPos != null) {
                src.setOffset(startPos);
            }
            /// read image mask
            for (var p = 0; p < pixCount; p++) {
                if (bitBufLen <= 0) {
                    bitBuf = src.readByte();
                    bitBufLen = 8;
                }
                if ((bitBuf & 0x80) == 0) {
                    /// Sets the highest bit to indicate the transparency.
                    pixBuf[p] = 0x80 | pixBuf[p];
                }
                bitBuf = (bitBuf << 1);
                bitBufLen--;
            }
        }
    }
    Lemmings.PaletteImage = PaletteImage;
})(Lemmings || (Lemmings = {}));
/// <reference path="../file/binary-reader.ts" />
/// <reference path="../file/file-container.ts" />
var Lemmings;
(function (Lemmings) {
    /** read the VGASPECx.DAT file : it is a image used for the ground */
    class VgaspecReader {
        constructor(vgaspecFile, width, height) {
            this.log = new Lemmings.LogHandler("VgaspecReader");
            this.width = 0;
            this.height = 0;
            /** the color palette stored in this file */
            this.groundPalette = new Lemmings.ColorPalette();
            this.width = width;
            this.height = height;
            this.read(vgaspecFile);
        }
        /** read the file */
        read(fr) {
            fr.setOffset(0);
            let fc = new Lemmings.FileContainer(fr);
            if (fc.count() != 1) {
                this.log.log("No FileContainer found!");
                return;
            }
            /// we only need the first part
            fr = fc.getPart(0);
            /// read palette
            this.readPalettes(fr, 0);
            /// process the image
            this.readImage(fr, 40);
        }
        /** read image from file */
        readImage(fr, offset) {
            fr.setOffset(offset);
            let width = 960;
            let chunkHeight = 40;
            let groundImagePositionX = 304;
            this.img = new Lemmings.Frame(this.width, this.height);
            let startScanLine = 0;
            let pixelCount = width * chunkHeight;
            let bitBuffer = new Uint8Array(pixelCount);
            let bitBufferPos = 0;
            while (!fr.eof()) {
                let curByte = fr.readByte();
                if (curByte == 128) {
                    /// end of chunk
                    /// unpack image data to image-buffer
                    let fileReader = new Lemmings.BinaryReader(bitBuffer);
                    let bitImage = new Lemmings.PaletteImage(width, chunkHeight);
                    bitImage.processImage(fileReader, 3, 0);
                    bitImage.processTransparentByColorIndex(0);
                    this.img.drawPaletteImage(bitImage.getImageBuffer(), width, chunkHeight, this.groundPalette, groundImagePositionX, startScanLine);
                    startScanLine += 40;
                    if (startScanLine >= this.img.height)
                        return;
                    bitBufferPos = 0;
                } else if (curByte <= 127) {
                    let copyByteCount = curByte + 1;
                    /// copy copyByteCount to the bitImage
                    while (!fr.eof()) {
                        /// write the next Byte
                        if (bitBufferPos >= bitBuffer.length)
                            return;
                        bitBuffer[bitBufferPos] = fr.readByte();
                        bitBufferPos++;
                        copyByteCount--;
                        if (copyByteCount <= 0)
                            break;
                    }
                } else {
                    /// copy n times the same value
                    let repeatByte = fr.readByte();
                    for (let repeatByteCount = 257 - curByte; repeatByteCount > 0; repeatByteCount--) {
                        /// write the next Byte
                        if (bitBufferPos >= bitBuffer.length)
                            return;
                        bitBuffer[bitBufferPos] = repeatByte;
                        bitBufferPos++;
                    }
                }
            }
        }
        /** load the palettes  */
        readPalettes(fr, offset) {
            /// read the VGA palette index 0..8
            for (let i = 0; i < 8; i++) {
                let r = fr.readByte() << 2;
                let g = fr.readByte() << 2;
                let b = fr.readByte() << 2;
                this.groundPalette.setColorRGB(i, r, g, b);
            }
            if (fr.eof()) {
                this.log.log("readPalettes() : unexpected end of file!: " + fr.filename);
                return;
            }
        }
    }
    Lemmings.VgaspecReader = VgaspecReader;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    /** read the config.json file */
    class ConfigReader {
        constructor(configFile) {
            this.log = new Lemmings.LogHandler("ConfigReader");
            this.configs = new Promise((resolve, reject) => {
                configFile.then((jsonString) => {
                    let configJson = this.parseConfig(jsonString);
                    resolve(configJson);
                });
            });
        }
        /** return the game config for a given GameType */
        getConfig(gameType) {
            return new Promise((resolve, reject) => {
                this.configs.then((configs) => {
                    let config = configs.find((type) => type.gametype == gameType);
                    if (config == null) {
                        this.log.log("config for GameTypes:" + Lemmings.GameTypes.toString(gameType) + " not found!");
                        reject();
                        return;
                    }
                    resolve(config);
                });
            });
        }
        /** pars the config file */
        parseConfig(jsonData) {
            let gameConfigs = [];
            try {
                var config = JSON.parse(jsonData);
            } catch (e) {
                this.log.log("Unable to parse config", e);
                return gameConfigs;
            }
            /// for all game types
            for (let c = 0; c < config.length; c++) {
                let newConfig = new Lemmings.GameConfig();
                let configData = config[c];
                newConfig.name = configData["name"];
                newConfig.path = configData["path"];
                newConfig.gametype = Lemmings.GameTypes.fromString(configData["gametype"]);
                /// read level config
                if (configData["level.useoddtable"] != null) {
                    newConfig.level.useOddTable = (!!configData["level.useoddtable"]);
                }
                newConfig.level.order = configData["level.order"];
                newConfig.level.filePrefix = configData["level.filePrefix"];
                newConfig.level.groups = configData["level.groups"];
                gameConfigs.push(newConfig);
            }
            return gameConfigs;
        }
    }
    Lemmings.ConfigReader = ConfigReader;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    class EventHandler {
        constructor() {
            this.handlers = [];
        }
        on(handler) {
            this.handlers.push(handler);
        }
        off(handler) {
            this.handlers = this.handlers.filter(h => h !== handler);
        }
        /// clear all callbacks
        dispose() {
            this.handlers = [];
        }
        /// raise all 
        trigger(arg) {
            this.handlers.slice(0).forEach(h => h(arg));
        }
    }
    Lemmings.EventHandler = EventHandler;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    /** handle error logging */
    class LogHandler {
        constructor(moduleName) {
            this._moduleName = moduleName;
        }
        /** log an error */
        log(msg, exeption) {
            console.log(this._moduleName + "\t" + msg);
            if (exeption) {
                console.log(this._moduleName + "\t" + exeption.message);
            }
        }
        /** write a debug message. If [msg] is not a String it is displayed: as {prop:value} */
        debug(msg) {
            if (typeof msg === 'string') {
                console.log(this._moduleName + "\t" + msg);
            } else {
                console.dir(msg);
            }
        }
    }
    Lemmings.LogHandler = LogHandler;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    class Position2D {
        constructor(x = 0, y = 0) {
            /** X position in the container */
            this.x = 0;
            /** Y position in the container */
            this.y = 0;
            this.x = x;
            this.y = y;
        }
    }
    Lemmings.Position2D = Position2D;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    class Rectangle {
        constructor(x1 = 0, y1 = 0, x2 = 0, y2 = 0) {
            /** X position in the container */
            this.x1 = 0;
            /** Y position in the container */
            this.y1 = 0;
            /** X position in the container */
            this.x2 = 0;
            /** Y position in the container */
            this.y2 = 0;
            this.x1 = x1;
            this.y1 = y1;
            this.x2 = x2;
            this.y2 = y2;
        }
    }
    Lemmings.Rectangle = Rectangle;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    class GameView {
        constructor() {
            this.log = new Lemmings.LogHandler("GameView");
            this.levelIndex = 0;
            this.levelGroupIndex = 0;
            this.gameResources = null;
            this.game = null;
            this.gameFactory = new Lemmings.GameFactory("./");
            this.stage = null;
            this.gameSpeedFactor = 1;
            this.applyQuery();
            this.log.log("selected level: " + Lemmings.GameTypes.toString(this.gameType) + " : " + this.levelIndex + " / " + this.levelGroupIndex);
        }
        set gameCanvas(el) {
            this.stage = new Lemmings.Stage(el);
        }
        /** start or continue the game */
        start(replayString) {
            if (!this.gameFactory)
                return;
            /// is the game already running
            if (this.game != null) {
                this.continue();
                return;
            }
            /// create new game
            return this.gameFactory.getGame(this.gameType)
                .then((game) => game.loadLevel(this.levelGroupIndex, this.levelIndex))
                .then((game) => {
                    if (replayString != null) {
                        game.getCommandManager().loadReplay(replayString);
                    }
                    game.setGameDisplay(this.stage.getGameDisplay());
                    game.setGuiDisplay(this.stage.getGuiDisplay());
                    game.getGameTimer().speedFactor = this.gameSpeedFactor;
                    game.start();
                    this.changeHtmlText(this.elementGameState, Lemmings.GameStateTypes.toString(Lemmings.GameStateTypes.RUNNING));
                    game.onGameEnd.on((state) => this.onGameEnd(state));
                    this.game = game;
                    if (this.cheat) {
                        this.game.cheat();
                    }
                });
        }
        onGameEnd(gameResult) {
            this.changeHtmlText(this.elementGameState, Lemmings.GameStateTypes.toString(gameResult.state));
            this.stage.startFadeOut();
            console.dir(gameResult);
            window.setTimeout(() => {
                if (gameResult.state == Lemmings.GameStateTypes.SUCCEEDED) {
                    /// move to next level
                    this.moveToLevel(1);
                } else {
                    /// redo this level
                    this.moveToLevel(0);
                }
            }, 2500);
        }
        /** load and run a replay */
        loadReplay(replayString) {
            this.start(replayString);
        }
        /** pause the game */
        cheat() {
            if (this.game == null) {
                return;
            }
            this.game.cheat();
        }
        /** pause the game */
        suspend() {
            if (this.game == null) {
                return;
            }
            this.game.getGameTimer().suspend();
        }
        /** continue the game after pause/suspend */
        continue () {
            if (this.game == null) {
                return;
            }
            this.game.getGameTimer().continue();
        }
        nextFrame() {
            if (this.game == null) {
                return;
            }
            this.game.getGameTimer().tick();
        }
        selectSpeedFactor(newSpeed) {
            if (this.game == null) {
                return;
            }
            this.gameSpeedFactor = newSpeed;
            this.game.getGameTimer().speedFactor = newSpeed;
        }
        playMusic(moveInterval) {

        }
        stopMusic() {

        }
        stopSound() {

        }
        playSound(moveInterval) {

        }
        enableDebug() {
            if (this.game == null) {
                return;
            }
            this.game.setDebugMode(true);
        }
        /** add/subtract one to the current levelIndex */
        moveToLevel(moveInterval) {
            if (moveInterval == null)
                moveInterval = 0;
            if (this.levelIndex + moveInterval < 0 && this.levelGroupIndex == 0) {
                return;
            }
            if (this.inMoveToLevel) {
                return;
            }
            this.inMoveToLevel = true;
            this.levelIndex = (this.levelIndex + moveInterval) | 0;
            /// check if the levelIndex is out of bounds
            this.gameFactory.getConfig(this.gameType).then((config) => {
                /// jump to next level group?
                if (this.levelIndex >= config.level.getGroupLength(this.levelGroupIndex)) {
                    this.levelGroupIndex++;
                    this.levelIndex = 0;
                } else if (this.levelGroupIndex > 0 && this.levelIndex < 0) {
                    this.levelGroupIndex--;
                    this.levelIndex = config.level.getGroupLength(this.levelGroupIndex) - 1;
                }
                if (this.levelGroupIndex >= config.level.order.length) {
                    this.gameType++;
                    this.levelGroupIndex = 0;
                    this.levelIndex = 0;
                }
                if (!Lemmings.GameTypes[this.gameType]) {
                    this.gameType = 1;
                    this.levelGroupIndex = 0;
                    this.levelIndex = 0;
                }
                /// jump to previous level group?
                if ((this.levelIndex < 0) && (this.levelGroupIndex > 0)) {
                    this.levelGroupIndex--;
                    this.levelIndex = config.level.getGroupLength(this.levelGroupIndex) - 1;
                }
                /// update and load level
                this.changeHtmlText(this.elementLevelNumber, (this.levelIndex + 1).toString());
                this.loadLevel().then(() => {
                    this.inMoveToLevel = false;
                });
            });
        }
        /** return the url hash for the present game/group/level-index */
        applyQuery() {
            this.gameType = 1;
            let query = new URLSearchParams(window.location.search);
            if (query.get("version") || query.get("v")) {
                let queryVersion = parseInt(query.get("version") || query.get("v"), 10);
                if (!isNaN(queryVersion) && queryVersion >= 1 && queryVersion <= 2) {
                    this.gameType = queryVersion;
                }
            }
            this.levelGroupIndex = 0;
            if (query.get("difficulty") || query.get("d")) {
                let queryDifficulty = parseInt(query.get("difficulty") || query.get("d"), 10);
                if (!isNaN(queryDifficulty) && queryDifficulty >= 1 && queryDifficulty <= 5) {
                    this.levelGroupIndex = queryDifficulty - 1;
                }
            }
            this.levelIndex = 0;
            if (query.get("level") || query.get("l")) {
                let queryLevel = parseInt(query.get("level") || query.get("l"), 10);
                if (!isNaN(queryLevel) && queryLevel >= 1 && queryLevel <= 30) {
                    this.levelIndex = queryLevel - 1;
                }
            }
            this.gameSpeedFactor = 1;
            if (query.get("speed") || query.get("s")) {
                let querySpeed = parseFloat(query.get("speed") || query.get("s"));
                if (!isNaN(querySpeed) && querySpeed > 0 && querySpeed <= 10) {
                    this.gameSpeedFactor = querySpeed;
                }
            }
            this.cheat = false;
            if (query.get("cheat") || query.get("c")) {
                this.cheat = (query.get("cheat") || query.get("c")) === "true";
            }
            this.shortcut = false;
            if (query.get("shortcut") || query.get("_")) {
                this.shortcut = (query.get("shortcut") || query.get("_")) === "true";
            }
        }
        updateQuery() {
            if (this.shortcut) {
                this.setHistoryState({
                    v: this.gameType,
                    d: this.levelGroupIndex + 1,
                    l: this.levelIndex + 1,
                    s: this.gameSpeedFactor,
                    c: !!this.cheat,
                    _: true
                });
            } else {
                this.setHistoryState({
                    version: this.gameType,
                    difficulty: this.levelGroupIndex + 1,
                    level: this.levelIndex + 1,
                    speed: this.gameSpeedFactor,
                    cheat: !!this.cheat
                });
            }
        }
        setHistoryState(state) {
            history.replaceState(
                null,
                null,
                "?" +
                Object.keys(state)
                .map((key) => key + "=" + state[key])
                .join("&")
            );
        }
        /** convert a string to a number */
        strToNum(str) {
            return Number(str) | 0;
        }
        /** change the the text of a html element */
        changeHtmlText(htmlElement, value) {
            if (htmlElement == null) {
                return;
            }
            htmlElement.innerText = value;
        }
        /** remove items of a <select> */
        clearHtmlList(htmlList) {
            while (htmlList.options.length) {
                htmlList.remove(0);
            }
        }
        /** add array elements to a <select> */
        arrayToSelect(htmlList, list) {
            if (htmlList == null) {
                return;
            }
            this.clearHtmlList(htmlList);
            for (var i = 0; i < list.length; i++) {
                var opt = list[i];
                var el = document.createElement("option");
                el.textContent = opt;
                el.value = i.toString();
                htmlList.appendChild(el);
            }
        }
        /** switch the selected level group */
        selectLevelGroup(newLevelGroupIndex) {
            this.levelGroupIndex = newLevelGroupIndex;
            this.loadLevel();
        }
        /** select a game type */
        setup() {
            this.applyQuery();
            this.gameFactory.getGameResources(this.gameType)
                .then((newGameResources) => {
                    this.gameResources = newGameResources;
                    this.arrayToSelect(this.elementSelectLevelGroup, this.gameResources.getLevelGroups());
                    this.loadLevel();
                });
        }
        /** load a level and render it to the display */
        loadLevel() {
            if (this.gameResources == null)
                return;
            if (this.game != null) {
                this.game.stop();
                this.game = null;
            }
            this.changeHtmlText(this.elementGameState, Lemmings.GameStateTypes.toString(Lemmings.GameStateTypes.UNKNOWN));
            return this.gameResources.getLevel(this.levelGroupIndex, this.levelIndex)
                .then((level) => {
                    if (level == null)
                        return;
                    this.changeHtmlText(this.elementLevelName, level.name);
                    if (this.stage != null) {
                        let gameDisplay = this.stage.getGameDisplay();
                        gameDisplay.clear();
                        this.stage.resetFade();
                        level.render(gameDisplay);
                        gameDisplay.setScreenPosition(level.screenPositionX, 0);
                        gameDisplay.redraw();
                    }
                    this.updateQuery();
                    console.dir(level);
                    return this.start();
                });
        }
    }
    Lemmings.GameView = GameView;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    /** handle the display of the game images */
    class DisplayImage {
        constructor(stage) {
            this.stage = stage;
            this.onMouseUp = new Lemmings.EventHandler();
            this.onMouseDown = new Lemmings.EventHandler();
            this.onMouseMove = new Lemmings.EventHandler();
            this.onDoubleClick = new Lemmings.EventHandler();
            this.onMouseDown.on((e) => {
                //this.setDebugPixel(e.x, e.y);
            });
        }
        getWidth() {
            if (this.imgData == null)
                return 0;
            return this.imgData.width;
        }
        getHeight() {
            if (this.imgData == null)
                return 0;
            return this.imgData.height;
        }
        initSize(width, height) {
            /// create image data
            if ((this.imgData == null) || (this.imgData.width != width) || (this.imgData.height != height)) {
                this.imgData = this.stage.createImage(this, width, height);
                this.clear();
            }
        }
        clear() {
            if (this.imgData == null)
                return;
            let img = new Uint32Array(this.imgData.data);
            for (let i = 0; i < img.length; i++) {
                img[i] = 0xFF00FF00;
            }
        }
        /** render the level-background to an image */
        setBackground(groundImage, groundMask = null) {
            /// set pixels
            this.imgData.data.set(groundImage);
            this.groundMask = groundMask;
        }
        uint8ClampedColor(colorValue) {
            return colorValue & 0xFF;
        }
        drawRectangle(rect, red, green, blue) {
            this.drawHorizontalLine(rect.x1, rect.y1, rect.x2, red, green, blue);
            this.drawHorizontalLine(rect.x1, rect.y2, rect.x2, red, green, blue);
            this.drawVerticalLine(rect.x1, rect.y1, rect.y2, red, green, blue);
            this.drawVerticalLine(rect.x2, rect.y1, rect.y2, red, green, blue);
        }
        /** draw a rect to the display */
        drawRect(x, y, width, height, red, green, blue) {
            let x2 = x + width;
            let y2 = y + height;
            this.drawHorizontalLine(x, y, x2, red, green, blue);
            this.drawHorizontalLine(x, y2, x2, red, green, blue);
            this.drawVerticalLine(x, y, y2, red, green, blue);
            this.drawVerticalLine(x2, y, y2, red, green, blue);
        }
        drawVerticalLine(x1, y1, y2, red, green, blue) {
            red = this.uint8ClampedColor(red);
            green = this.uint8ClampedColor(green);
            blue = this.uint8ClampedColor(blue);
            let destW = this.imgData.width;
            let destH = this.imgData.height;
            let destData = this.imgData.data;
            x1 = (x1 >= destW) ? (destW - 1) : (x1 < 0) ? 0 : x1;
            y1 = (y1 >= destH) ? (destH - 1) : (y1 < 0) ? 0 : y1;
            y2 = (y2 >= destH) ? (destH - 1) : (y2 < 0) ? 0 : y2;
            for (let y = y1; y <= y2; y += 1) {
                let destIndex = ((destW * y) + x1) * 4;
                destData[destIndex] = red;
                destData[destIndex + 1] = green;
                destData[destIndex + 2] = blue;
                destData[destIndex + 3] = 255;
            }
        }
        drawHorizontalLine(x1, y1, x2, red, green, blue) {
            red = this.uint8ClampedColor(red);
            green = this.uint8ClampedColor(green);
            blue = this.uint8ClampedColor(blue);
            let destW = this.imgData.width;
            let destH = this.imgData.height;
            let destData = this.imgData.data;
            x1 = (x1 >= destW) ? (destW - 1) : (x1 < 0) ? 0 : x1;
            y1 = (y1 >= destH) ? (destH - 1) : (y1 < 0) ? 0 : y1;
            x2 = (x2 >= destW) ? (destW - 1) : (x2 < 0) ? 0 : x2;
            for (let x = x1; x <= x2; x += 1) {
                let destIndex = ((destW * y1) + x) * 4;
                destData[destIndex] = red;
                destData[destIndex + 1] = green;
                destData[destIndex + 2] = blue;
                destData[destIndex + 3] = 255;
            }
        }
        /** copy a mask frame to the display */
        drawMask(mask, posX, posY) {
            let srcW = mask.width;
            let srcH = mask.height;
            let srcMask = mask.getMask();
            let destW = this.imgData.width;
            let destH = this.imgData.height;
            let destData = new Uint32Array(this.imgData.data.buffer);
            let destX = posX + mask.offsetX;
            let destY = posY + mask.offsetY;
            for (let y = 0; y < srcH; y++) {
                let outY = y + destY;
                if ((outY < 0) || (outY >= destH))
                    continue;
                for (let x = 0; x < srcW; x++) {
                    let srcIndex = ((srcW * y) + x);
                    /// ignore transparent pixels
                    if (srcMask[srcIndex] == 0)
                        continue;
                    let outX = x + destX;
                    if ((outX < 0) || (outX >= destW))
                        continue;
                    let destIndex = ((destW * outY) + outX);
                    destData[destIndex] = 0xFFFFFFFF;
                }
            }
        }
        /** copy a frame to the display - transparent color is changed to (r,g,b) */
        drawFrameCovered(frame, posX, posY, red, green, blue) {
            let srcW = frame.width;
            let srcH = frame.height;
            let srcBuffer = frame.getBuffer();
            let srcMask = frame.getMask();
            let nullCollor = 0xFF << 24 | blue << 16 | green << 8 | red;
            let destW = this.imgData.width;
            let destH = this.imgData.height;
            let destData = new Uint32Array(this.imgData.data.buffer);
            let destX = posX + frame.offsetX;
            let destY = posY + frame.offsetY;
            red = this.uint8ClampedColor(red);
            green = this.uint8ClampedColor(green);
            blue = this.uint8ClampedColor(blue);
            for (let y = 0; y < srcH; y++) {
                let outY = y + destY;
                if ((outY < 0) || (outY >= destH))
                    continue;
                for (let x = 0; x < srcW; x++) {
                    let srcIndex = ((srcW * y) + x);
                    let outX = x + destX;
                    if ((outX < 0) || (outX >= destW))
                        continue;
                    let destIndex = ((destW * outY) + outX);
                    if (srcMask[srcIndex] == 0) {
                        /// transparent pixel
                        destData[destIndex] = nullCollor;
                    } else {
                        destData[destIndex] = srcBuffer[srcIndex];
                    }
                }
            }
        }
        /** copy a frame to the display */
        drawFrame(frame, posX, posY) {
            let srcW = frame.width;
            let srcH = frame.height;
            let srcBuffer = frame.getBuffer();
            let srcMask = frame.getMask();
            let destW = this.imgData.width;
            let destH = this.imgData.height;
            let destData = new Uint32Array(this.imgData.data.buffer);
            let destX = posX + frame.offsetX;
            let destY = posY + frame.offsetY;
            for (let y = 0; y < srcH; y++) {
                let outY = y + destY;
                if ((outY < 0) || (outY >= destH))
                    continue;
                for (let x = 0; x < srcW; x++) {
                    let srcIndex = ((srcW * y) + x);
                    /// ignore transparent pixels
                    if (srcMask[srcIndex] == 0)
                        continue;
                    let outX = x + destX;
                    if ((outX < 0) || (outX >= destW))
                        continue;
                    let destIndex = ((destW * outY) + outX);
                    destData[destIndex] = srcBuffer[srcIndex];
                }
            }
        }
        /** copy a frame to the display */
        drawFrameFlags(frame, posX, posY, destConfig) {
            let srcW = frame.width;
            let srcH = frame.height;
            let srcBuffer = frame.getBuffer();
            let srcMask = frame.getMask();
            let destW = this.imgData.width;
            let destH = this.imgData.height;
            let destData = new Uint32Array(this.imgData.data.buffer);
            let destX = posX + frame.offsetX;
            let destY = posY + frame.offsetY;
            var upsideDown = destConfig.isUpsideDown;
            var noOverwrite = destConfig.noOverwrite;
            var onlyOverwrite = destConfig.onlyOverwrite;
            var mask = this.groundMask;
            for (let srcY = 0; srcY < srcH; srcY++) {
                let outY = srcY + destY;
                if ((outY < 0) || (outY >= destH))
                    continue;
                for (let srcX = 0; srcX < srcW; srcX++) {
                    let sourceY = upsideDown ? (srcH - srcY - 1) : srcY;
                    let srcIndex = ((srcW * sourceY) + srcX);
                    /// ignore transparent pixels
                    if (srcMask[srcIndex] == 0)
                        continue;
                    let outX = srcX + destX;
                    if ((outX < 0) || (outX >= destW))
                        continue;
                    /// check flags
                    if (noOverwrite) {
                        if (mask.hasGroundAt(outX, outY))
                            continue;
                    }
                    if (onlyOverwrite) {
                        if (!mask.hasGroundAt(outX, outY))
                            continue;
                    }
                    /// draw
                    let destIndex = ((destW * outY) + outX);
                    destData[destIndex] = srcBuffer[srcIndex];
                }
            }
        }
        setDebugPixel(x, y) {
            let pointIndex = (this.imgData.width * (y) + x) * 4;
            this.imgData.data[pointIndex] = 255;
            this.imgData.data[pointIndex + 1] = 0;
            this.imgData.data[pointIndex + 2] = 0;
        }
        setPixel(x, y, r, g, b) {
            let pointIndex = (this.imgData.width * (y) + x) * 4;
            this.imgData.data[pointIndex] = r;
            this.imgData.data[pointIndex + 1] = g;
            this.imgData.data[pointIndex + 2] = b;
        }
        setScreenPosition(x, y) {
            this.stage.setGameViewPointPosition(x, y);
        }
        getImageData() {
            return this.imgData;
        }
        redraw() {
            this.stage.redraw();
        }
    }
    Lemmings.DisplayImage = DisplayImage;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    class GameDisplay {
        constructor(game, level, lemmingManager, objectManager, triggerManager) {
            this.game = game;
            this.level = level;
            this.lemmingManager = lemmingManager;
            this.objectManager = objectManager;
            this.triggerManager = triggerManager;
            this.display = null;
        }
        setGuiDisplay(display) {
            this.display = display;
            this.display.onMouseDown.on((e) => {
                //console.log(e.x +" "+ e.y);
                let lem = this.lemmingManager.getLemmingAt(e.x, e.y);
                if (!lem)
                    return;
                this.game.queueCmmand(new Lemmings.CommandLemmingsAction(lem.id));
            });
        }
        render() {
            if (this.display == null)
                return;
            this.level.render(this.display);
            this.objectManager.render(this.display);
            this.lemmingManager.render(this.display);
        }
        renderDebug() {
            if (this.display == null)
                return;
            this.lemmingManager.renderDebug(this.display);
            this.triggerManager.renderDebug(this.display);
        }
    }
    Lemmings.GameDisplay = GameDisplay;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    /** handles the in-game-gui. e.g. the panel on the bottom of the game */
    class GameGui {
        constructor(game, skillPanelSprites, skills, gameTimer, gameVictoryCondition) {
            this.game = game;
            this.skillPanelSprites = skillPanelSprites;
            this.skills = skills;
            this.gameTimer = gameTimer;
            this.gameVictoryCondition = gameVictoryCondition;
            this.gameTimeChanged = true;
            this.skillsCountChangd = true;
            this.skillSelectionChanged = true;
            this.backgroundChanged = true;
            this.display = null;
            this.deltaReleaseRate = 0;
            gameTimer.onGameTick.on(() => {
                this.gameTimeChanged = true;
                this.doReleaseRateChanges();
            });
            skills.onCountChanged.on(() => {
                this.skillsCountChangd = true;
                this.backgroundChanged = true;
            });
            skills.onSelectionChanged.on(() => {
                this.skillSelectionChanged = true;
                this.backgroundChanged = true;
            });
        }
        doReleaseRateChanges() {
            if (this.deltaReleaseRate == 0) {
                return;
            }
            if (this.deltaReleaseRate > 0) {
                this.game.queueCmmand(new Lemmings.CommandReleaseRateIncrease(this.deltaReleaseRate));
            } else {
                this.game.queueCmmand(new Lemmings.CommandReleaseRateDecrease(-this.deltaReleaseRate));
            }
        }
        /// handle click on the skills panel
        handleSkillMouseDown(x) {
            let panelIndex = Math.trunc(x / 16);
            if (panelIndex != 11) {
                this.game.nukePrepared = false;
            }
            if (panelIndex == 0) {
                this.deltaReleaseRate = -3;
                this.doReleaseRateChanges();
                return;
            }
            if (panelIndex == 1) {
                this.deltaReleaseRate = 3;
                this.doReleaseRateChanges();
                return;
            }
            if (panelIndex == 10) {
                this.gameTimer.toggle();
                return;
            }
            if (panelIndex == 11) {
                if (this.game.nukePrepared) {
                    this.game.queueCmmand(new Lemmings.CommandNuke());
                } else {
                    this.game.nukePrepared = true;
                }
                return;
            }
            if (panelIndex == 12) {
                if (this.gameTimer.speedFactor < 10) {
                    this.gameTimer.speedFactor += 2;
                }
                return;
            }
            let newSkill = this.getSkillByPanelIndex(panelIndex);
            if (newSkill == Lemmings.SkillTypes.UNKNOWN)
                return;
            this.game.queueCmmand(new Lemmings.CommandSelectSkill(newSkill));
            this.skillSelectionChanged = true;
        }
        handleSkillDoubleClick(x) {
            let panelIndex = Math.trunc(x / 16);
            /// trigger the nuke for all lemmings
            if (panelIndex == 11) {
                this.game.queueCmmand(new Lemmings.CommandNuke());
            }
        }
        /** init the display */
        setGuiDisplay(display) {
            this.display = display;
            /// handle user input in gui
            this.display.onMouseDown.on((e) => {
                this.deltaReleaseRate = 0;
                if (e.y > 15) {
                    this.handleSkillMouseDown(e.x);
                }
            });
            this.display.onMouseUp.on((e) => {
                /// clear release rate change
                this.deltaReleaseRate = 0;
            });
            this.display.onDoubleClick.on((e) => {
                /// clear release rate change
                this.deltaReleaseRate = 0;
                if (e.y > 15) {
                    this.handleSkillDoubleClick(e.x);
                }
            });
            this.gameTimeChanged = true;
            this.skillsCountChangd = true;
            this.skillSelectionChanged = true;
            this.backgroundChanged = true;
        }
        /** render the gui to the screen display */
        render() {
            if (this.display == null)
                return;
            let display = this.display;
            /// background
            if (this.backgroundChanged) {
                this.backgroundChanged = false;
                let panelImage = this.skillPanelSprites.getPanelSprite();
                display.initSize(panelImage.width, panelImage.height);
                display.setBackground(panelImage.getData());
                /// redraw everything
                this.gameTimeChanged = true;
                this.skillsCountChangd = true;
                this.skillSelectionChanged = true;
            }
            /////////
            /// green text
            this.drawGreenString(display, "Out " + this.gameVictoryCondition.getOutCount() + "  ", 112, 0);
            this.drawGreenString(display, "In" + this.stringPad(this.gameVictoryCondition.getSurvivorPercentage() + "", 3) + "%", 186, 0);
            if (this.gameTimeChanged) {
                this.gameTimeChanged = false;
                this.renderGameTime(display, 248, 0);
            }
            /////////
            /// white skill numbers
            this.drawPanelNumber(display, this.gameVictoryCondition.getMinReleaseRate(), 0);
            this.drawPanelNumber(display, this.gameVictoryCondition.getCurrentReleaseRate(), 1);
            if (this.skillsCountChangd) {
                this.skillsCountChangd = false;
                for (let i = 1 /* jump over unknown */ ; i < Lemmings.SkillTypes.length(); i++) {
                    let count = this.skills.getSkill(i);
                    this.drawPanelNumber(display, count, this.getPanelIndexBySkill(i));
                }
            }
            ////////
            /// selected skill
            if (this.skillSelectionChanged) {
                this.skillSelectionChanged = false;
                this.drawSelection(display, this.getPanelIndexBySkill(this.skills.getSelectedSkill()));
            }
        }
        /** left pad a string with spaces */
        stringPad(str, length) {
            if (str.length >= length)
                return str;
            return " ".repeat(length - str.length) + str;
        }
        /** return the skillType for an index */
        getSkillByPanelIndex(panelIndex) {
            switch (Math.trunc(panelIndex)) {
            case 2:
                return Lemmings.SkillTypes.CLIMBER;
            case 3:
                return Lemmings.SkillTypes.FLOATER;
            case 4:
                return Lemmings.SkillTypes.BOMBER;
            case 5:
                return Lemmings.SkillTypes.BLOCKER;
            case 6:
                return Lemmings.SkillTypes.BUILDER;
            case 7:
                return Lemmings.SkillTypes.BASHER;
            case 8:
                return Lemmings.SkillTypes.MINER;
            case 9:
                return Lemmings.SkillTypes.DIGGER;
            default:
                return Lemmings.SkillTypes.UNKNOWN;
            }
        }
        /** return the index for a skillType */
        getPanelIndexBySkill(skill) {
            switch (skill) {
            case Lemmings.SkillTypes.CLIMBER:
                return 2;
            case Lemmings.SkillTypes.FLOATER:
                return 3;
            case Lemmings.SkillTypes.BOMBER:
                return 4;
            case Lemmings.SkillTypes.BLOCKER:
                return 5;
            case Lemmings.SkillTypes.BUILDER:
                return 6;
            case Lemmings.SkillTypes.BASHER:
                return 7;
            case Lemmings.SkillTypes.MINER:
                return 8;
            case Lemmings.SkillTypes.DIGGER:
                return 9;
            default:
                return -1;
            }
        }
        /** draw a white rectangle border to the panel */
        drawSelection(display, panelIndex) {
            display.drawRect(16 * panelIndex, 16, 16, 23, 255, 255, 255);
        }
        /** draw the game time to the panel */
        renderGameTime(display, x, y) {
            let gameTime = this.gameTimer.getGameLeftTimeString();
            this.drawGreenString(display, "Time " + gameTime + "-00", x, y);
        }
        /** draw a white number to the skill-panel */
        drawPanelNumber(display, number, panelIndex) {
            this.drawNumber(display, number, 4 + 16 * panelIndex, 17);
        }
        /** draw a white number */
        drawNumber(display, number, x, y) {
            if (number > 0) {
                let num1Img = this.skillPanelSprites.getNumberSpriteLeft(Math.floor(number / 10));
                let num2Img = this.skillPanelSprites.getNumberSpriteRight(number % 10);
                display.drawFrameCovered(num1Img, x, y, 0, 0, 0);
                display.drawFrame(num2Img, x, y);
            } else {
                let numImg = this.skillPanelSprites.getNumberSpriteEmpty();
                display.drawFrame(numImg, x, y);
            }
            return x + 8;
        }
        /** draw a text with green letters */
        drawGreenString(display, text, x, y) {
            for (let i = 0; i < text.length; i++) {
                let letterImg = this.skillPanelSprites.getLetterSprite(text[i]);
                if (letterImg != null) {
                    display.drawFrameCovered(letterImg, x, y, 0, 0, 0);
                }
                x += 8;
            }
            return x;
        }
    }
    Lemmings.GameGui = GameGui;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    class StageImageProperties {
        constructor() {
            /** X position to display this Image */
            this.x = 0;
            /** Y position to display this Image */
            this.y = 0;
            this.width = 0;
            this.height = 0;
            this.display = null;
            this.viewPoint = new Lemmings.ViewPoint(0, 0, 2);
        }
        createImage(width, height) {
            this.cav = document.createElement('canvas');
            this.cav.width = width;
            this.cav.height = height;
            this.ctx = this.cav.getContext("2d");
            return this.ctx.createImageData(width, height);
        }
    }
    Lemmings.StageImageProperties = StageImageProperties;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    /** handle the display / output of game, gui, ... */
    class Stage {
        constructor(canvasForOutput) {
            this.controller = null;
            this.fadeTimer = 0;
            this.fadeAlpha = 0;
            this.controller = new Lemmings.UserInputManager(canvasForOutput);
            this.handleOnMouseUp();
            this.handleOnMouseDown();
            this.handleOnMouseMove();
            this.handleOnDoubleClick();
            this.handleOnZoom();
            this.stageCav = canvasForOutput;
            this.gameImgProps = new Lemmings.StageImageProperties();
            this.guiImgProps = new Lemmings.StageImageProperties();
            this.guiImgProps.viewPoint = new Lemmings.ViewPoint(0, 0, 2);
            this.updateStageSize();
            this.clear();
        }
        calcPosition2D(stageImage, e) {
            let x = (stageImage.viewPoint.getSceneX(e.x - stageImage.x));
            let y = (stageImage.viewPoint.getSceneY(e.y - stageImage.y));
            return new Lemmings.Position2D(x, y);
        }
        handleOnDoubleClick() {
            this.controller.onDoubleClick.on((e) => {
                let stageImage = this.getStageImageAt(e.x, e.y);
                if ((stageImage == null) || (stageImage.display == null))
                    return;
                stageImage.display.onDoubleClick.trigger(this.calcPosition2D(stageImage, e));
            });
        }
        handleOnMouseDown() {
            this.controller.onMouseDown.on((e) => {
                let stageImage = this.getStageImageAt(e.x, e.y);
                if ((stageImage == null) || (stageImage.display == null))
                    return;
                stageImage.display.onMouseDown.trigger(this.calcPosition2D(stageImage, e));
            });
        }
        handleOnMouseUp() {
            this.controller.onMouseUp.on((e) => {
                let stageImage = this.getStageImageAt(e.x, e.y);
                if ((stageImage == null) || (stageImage.display == null))
                    return;
                let pos = this.calcPosition2D(stageImage, e);
                stageImage.display.onMouseUp.trigger(pos);
            });
        }
        handleOnMouseMove() {
            this.controller.onMouseMove.on((e) => {
                if (e.button) {
                    let stageImage = this.getStageImageAt(e.mouseDownX, e.mouseDownY);
                    if (stageImage == null)
                        return;
                    if (stageImage == this.gameImgProps) {
                        this.updateViewPoint(stageImage, e.deltaX, e.deltaY, 0);
                    }
                } else {
                    let stageImage = this.getStageImageAt(e.x, e.y);
                    if (stageImage == null)
                        return;
                    if (stageImage.display == null)
                        return;
                    let x = e.x - stageImage.x;
                    let y = e.y - stageImage.y;
                    stageImage.display.onMouseMove.trigger(new Lemmings.Position2D(stageImage.viewPoint.getSceneX(x), stageImage.viewPoint.getSceneY(y)));
                }
            });
        }
        handleOnZoom() {
            this.controller.onZoom.on((e) => {
                let stageImage = this.getStageImageAt(e.x, e.y);
                if (stageImage == null)
                    return;
                this.updateViewPoint(stageImage, 0, 0, e.deltaZoom);
            });
        }
        updateViewPoint(stageImage, deltaX, deltaY, deletaZoom) {
            stageImage.viewPoint.scale += deletaZoom * 0.5;
            stageImage.viewPoint.scale = this.limitValue(0.5, stageImage.viewPoint.scale, 10);
            stageImage.viewPoint.x += deltaX / stageImage.viewPoint.scale;
            stageImage.viewPoint.y += deltaY / stageImage.viewPoint.scale;
            stageImage.viewPoint.x = this.limitValue(0, stageImage.viewPoint.x, stageImage.display.getWidth() - stageImage.width / stageImage.viewPoint.scale);
            stageImage.viewPoint.y = this.limitValue(0, stageImage.viewPoint.y, stageImage.display.getHeight() - stageImage.height / stageImage.viewPoint.scale);
            /// redraw
            if (stageImage.display != null) {
                this.clear(stageImage);
                let gameImg = stageImage.display.getImageData();
                this.draw(stageImage, gameImg);
            };
        }
        limitValue(minLimit, value, maxLimit) {
            let useMax = Math.max(minLimit, maxLimit);
            return Math.min(Math.max(minLimit, value), useMax);
        }
        updateStageSize() {
            let ctx = this.stageCav.getContext("2d");
            let stageHeight = ctx.canvas.height;
            let stageWidth = ctx.canvas.width;
            this.gameImgProps.y = 0;
            this.gameImgProps.height = stageHeight - 100;
            this.gameImgProps.width = stageWidth;
            this.guiImgProps.y = stageHeight - 100;
            this.guiImgProps.height = 100;
            this.guiImgProps.width = stageWidth;
        }
        getStageImageAt(x, y) {
            if (this.isPositionInStageImage(this.gameImgProps, x, y))
                return this.gameImgProps;
            if (this.isPositionInStageImage(this.guiImgProps, x, y))
                return this.guiImgProps;
            return null;
        }
        isPositionInStageImage(stageImage, x, y) {
            return ((stageImage.x <= x) && ((stageImage.x + stageImage.width) >= x) &&
                (stageImage.y <= y) && ((stageImage.y + stageImage.height) >= y));
        }
        getGameDisplay() {
            if (this.gameImgProps.display != null)
                return this.gameImgProps.display;
            this.gameImgProps.display = new Lemmings.DisplayImage(this);
            return this.gameImgProps.display;
        }
        getGuiDisplay() {
            if (this.guiImgProps.display != null)
                return this.guiImgProps.display;
            this.guiImgProps.display = new Lemmings.DisplayImage(this);
            return this.guiImgProps.display;
        }
        /** set the position of the view point for the game display */
        setGameViewPointPosition(x, y) {
            this.gameImgProps.viewPoint.x = x;
            this.gameImgProps.viewPoint.y = y;
        }
        /** redraw everything */
        redraw() {
            if (this.gameImgProps.display != null) {
                let gameImg = this.gameImgProps.display.getImageData();
                this.draw(this.gameImgProps, gameImg);
            };
            if (this.guiImgProps.display != null) {
                let guiImg = this.guiImgProps.display.getImageData();
                this.draw(this.guiImgProps, guiImg);
            };
        }
        createImage(display, width, height) {
            if (display == this.gameImgProps.display) {
                return this.gameImgProps.createImage(width, height);
            } else {
                return this.guiImgProps.createImage(width, height);
            }
        }
        /** clear the stage/display/output */
        clear(stageImage) {
            var ctx = this.stageCav.getContext("2d");
            ctx.fillStyle = "#000000";
            if (stageImage == null) {
                ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
            } else {
                ctx.fillRect(stageImage.x, stageImage.y, stageImage.width, stageImage.height);
            }
        }
        resetFade() {
            this.fadeAlpha = 0;
            if (this.fadeTimer != 0) {
                clearInterval(this.fadeTimer);
                this.fadeTimer = 0;
            }
        }
        startFadeOut() {
            this.resetFade();
            this.fadeTimer = setInterval(() => {
                this.fadeAlpha = Math.min(this.fadeAlpha + 0.02, 1);
                if (this.fadeAlpha <= 0) {
                    clearInterval(this.fadeTimer);
                }
            }, 40);
        }
        /** draw everything to the stage/display */
        draw(display, img) {
            if (display.ctx == null)
                return;
            /// write image to context
            display.ctx.putImageData(img, 0, 0);
            let ctx = this.stageCav.getContext("2d");
            //@ts-ignore
            ctx.mozImageSmoothingEnabled = false;
            //@ts-ignore
            ctx.webkitImageSmoothingEnabled = false;
            ctx.imageSmoothingEnabled = false;
            let outH = display.height;
            let outW = display.width;
            ctx.globalAlpha = 1;
            //- Display Layers
            var dW = img.width - display.viewPoint.x; //- display width
            if ((dW * display.viewPoint.scale) > outW) {
                dW = outW / display.viewPoint.scale;
            }
            var dH = img.height - display.viewPoint.y; //- display height
            if ((dH * display.viewPoint.scale) > outH) {
                dH = outH / display.viewPoint.scale;
            }
            //- drawImage(image,sx,sy,sw,sh,dx,dy,dw,dh)
            ctx.drawImage(display.cav, display.viewPoint.x, display.viewPoint.y, dW, dH, display.x, display.y, Math.trunc(dW * display.viewPoint.scale), Math.trunc(dH * display.viewPoint.scale));
            //- apply fading
            if (this.fadeAlpha != 0) {
                ctx.globalAlpha = this.fadeAlpha;
                ctx.fillStyle = "black";
                ctx.fillRect(display.x, display.y, Math.trunc(dW * display.viewPoint.scale), Math.trunc(dH * display.viewPoint.scale));
            }
        }
    }
    Lemmings.Stage = Stage;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    class MouseMoveEventArguemnts extends Lemmings.Position2D {
        constructor(x = 0, y = 0, deltaX = 0, deltaY = 0, button = false) {
            super(x, y);
            /** delta the mouse move Y */
            this.deltaX = 0;
            /** delta the mouse move Y */
            this.deltaY = 0;
            this.button = false;
            /** position the user starts pressed the mouse */
            this.mouseDownX = 0;
            /** position the user starts pressed the mouse */
            this.mouseDownY = 0;
            this.deltaX = deltaX;
            this.deltaY = deltaY;
            this.button = button;
        }
    }
    Lemmings.MouseMoveEventArguemnts = MouseMoveEventArguemnts;
    class ZoomEventArguemnts extends Lemmings.Position2D {
        constructor(x = 0, y = 0, deltaZoom = 0) {
            super(x, y);
            this.deltaZoom = deltaZoom;
        }
    }
    Lemmings.ZoomEventArguemnts = ZoomEventArguemnts;
    /** handle the user events on the stage */
    class UserInputManager {
        constructor(listenElement) {
            this.mouseDownX = 0;
            this.mouseDownY = 0;
            this.lastMouseX = 0;
            this.lastMouseY = 0;
            this.mouseButton = false;
            this.onMouseMove = new Lemmings.EventHandler();
            this.onMouseUp = new Lemmings.EventHandler();
            this.onMouseDown = new Lemmings.EventHandler();
            this.onDoubleClick = new Lemmings.EventHandler();
            this.onZoom = new Lemmings.EventHandler();
            listenElement.addEventListener("mousemove", (e) => {
                let relativePos = this.getRelativePosition(listenElement, e.clientX, e.clientY);
                this.handleMouseMove(relativePos);
                e.stopPropagation();
                e.preventDefault();
                return false;
            });
            listenElement.addEventListener("touchmove", (e) => {
                if (e.touches.length !== 1) {
                    e.preventDefault();
                    return;
                }
                let relativePos = this.getRelativePosition(listenElement, e.touches[0].clientX, e.touches[0].clientY);
                this.handleMouseMove(relativePos);
                e.stopPropagation();
                e.preventDefault();
                return false;
            });
            listenElement.addEventListener("touchstart", (e) => {
                if (e.touches.length !== 1) {
                    e.preventDefault();
                    return;
                }
                let relativePos = this.getRelativePosition(listenElement, e.touches[0].clientX, e.touches[0].clientY);
                this.handleMouseDown(relativePos);
                e.stopPropagation();
                e.preventDefault();
                return false;
            });
            listenElement.addEventListener("mousedown", (e) => {
                let relativePos = this.getRelativePosition(listenElement, e.clientX, e.clientY);
                this.handleMouseDown(relativePos);
                e.stopPropagation();
                e.preventDefault();
                return false;
            });
            listenElement.addEventListener("mouseup", (e) => {
                let relativePos = this.getRelativePosition(listenElement, e.clientX, e.clientY);
                this.handleMouseUp(relativePos);
                e.stopPropagation();
                e.preventDefault();
                return false;
            });
            listenElement.addEventListener("mouseleave", (e) => {
                this.handleMouseClear();
            });
            listenElement.addEventListener("touchend", (e) => {
                if (e.changedTouches.length !== 1) {
                    e.preventDefault();
                    return;
                }
                let relativePos = this.getRelativePosition(listenElement, e.changedTouches[0].clientX, e.changedTouches[0].clientY);
                this.handleMouseUp(relativePos);
                return false;
            });
            listenElement.addEventListener("touchleave", (e) => {
                this.handleMouseClear();
                return false;
            });
            listenElement.addEventListener("touchcancel", (e) => {
                this.handleMouseClear();
                return false;
            });
            listenElement.addEventListener("dblclick", (e) => {
                let relativePos = this.getRelativePosition(listenElement, e.clientX, e.clientY);
                this.handleMouseDoubleClick(relativePos);
                e.stopPropagation();
                e.preventDefault();
                return false;
            });
            listenElement.addEventListener("wheel", (e) => {
                // let relativePos = this.getRelativePosition(listenElement, e.clientX, e.clientY);
                // this.handeWheel(relativePos, e.deltaY);
                e.stopPropagation();
                e.preventDefault();
                return false;
            });
        }
        getRelativePosition(element, clientX, clientY) {
            var rect = element.getBoundingClientRect();
            const x = (clientX - rect.left) / rect.width * 800;
            const y = (clientY - rect.top) / rect.height * 480;
            return new Lemmings.Position2D(x, y);
        }
        handleMouseMove(position) {
            //- Move Point of View
            if (this.mouseButton) {
                let deltaX = (this.lastMouseX - position.x);
                let deltaY = (this.lastMouseY - position.y);
                //- save start of Mousedown
                this.lastMouseX = position.x;
                this.lastMouseY = position.y;
                let mouseDragArguments = new MouseMoveEventArguemnts(position.x, position.y, deltaX, deltaY, true);
                mouseDragArguments.mouseDownX = this.mouseDownX;
                mouseDragArguments.mouseDownY = this.mouseDownY;
                /// raise event
                this.onMouseMove.trigger(mouseDragArguments);
            } else {
                /// raise event
                this.onMouseMove.trigger(new MouseMoveEventArguemnts(position.x, position.y, 0, 0, false));
            }
        }
        handleMouseDown(position) {
            //- save start of Mousedown
            this.mouseButton = true;
            this.mouseDownX = position.x;
            this.mouseDownY = position.y;
            this.lastMouseX = position.x;
            this.lastMouseY = position.y;
            /// create new event handler
            this.onMouseDown.trigger(position);
        }
        handleMouseDoubleClick(position) {
            this.onDoubleClick.trigger(position);
        }
        handleMouseClear() {
            this.mouseButton = false;
            this.mouseDownX = 0;
            this.mouseDownY = 0;
            this.lastMouseX = 0;
            this.lastMouseY = 0;
        }
        handleMouseUp(position) {
            this.handleMouseClear();
            this.onMouseUp.trigger(new Lemmings.Position2D(position.x, position.y));
        }
        /** Zoom view
         * todo: zoom to mouse pointer */
        handeWheel(position, deltaY) {
            if (deltaY < 0) {
                this.onZoom.trigger(new ZoomEventArguemnts(position.x, position.y, 1));
            }
            if (deltaY > 0) {
                this.onZoom.trigger(new ZoomEventArguemnts(position.x, position.y, -1));
            }
        }
    }
    Lemmings.UserInputManager = UserInputManager;
})(Lemmings || (Lemmings = {}));
var Lemmings;
(function (Lemmings) {
    /** Camera Point to display the game */
    class ViewPoint {
        constructor(x, y, scale) {
            this.x = x;
            this.y = y;
            this.scale = scale;
        }
        /** transform a a X coordinate from display space to game-world space */
        getSceneX(x) {
            return Math.trunc(x / this.scale) + Math.trunc(this.x);
        }
        /** transform a a Y coordinate from display space to game-world space */
        getSceneY(y) {
            return Math.trunc(y / this.scale) + Math.trunc(this.y);
        }
    }
    Lemmings.ViewPoint = ViewPoint;
})(Lemmings || (Lemmings = {}));
