import { Lemmings } from './LemmingsNamespace.js';

class GameView {
    constructor() {
        this.log = new Lemmings.LogHandler("GameView");
        this.gameType = null;
        this.levelIndex = 0;
        this.levelGroupIndex = 0;
        this.gameResources = null;
        this.game = null;
        this.gameFactory = new Lemmings.GameFactory("./");
        this.stage = null;
        this.gameSpeedFactor = 1;
        this.applyQuery();
        this.elementGameState = null;

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
                if (this.debug) {
                    this.game.showDebug = true;
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
            const groupLength = config.level.getGroupLength(this.levelGroupIndex);

            /// jump to next level group?
            if (this.levelIndex >= groupLength) {
                this.levelGroupIndex++;
                this.levelIndex = 0;
            } else if (this.levelGroupIndex > 0 && this.levelIndex < 0) {
                this.levelGroupIndex--;
                this.levelIndex = groupLength - 1;
            } else if (this.levelGroupIndex == 0 && this.levelIndex < 0 && this.gameType > 1) {
                this.gameType--;
                this.levelGroupIndex = 0;
                this.levelIndex = 0;
            }
            if (this.levelGroupIndex >= config.level.order.length) {
                this.gameType++;
                this.levelGroupIndex = 0;
                this.levelIndex = 0;
            }

            // /// jump to previous level group?
            // if ((this.levelIndex < 0) && (this.levelGroupIndex > 0)) {
            //     this.levelGroupIndex--;
            //     this.levelIndex = groupLength - 1;
            // }

            // if no gametype?
            if (!Lemmings.GameTypes[Object.keys(Lemmings.GameTypes)[this.gameType]]) {
                this.gameType = 1;
                this.levelGroupIndex = 0;
                this.levelIndex = 0;
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
            if (!isNaN(queryVersion) && queryVersion >= 1 && queryVersion <= 6) {
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
            if (!isNaN(querySpeed) && querySpeed > 0 && querySpeed <= 100) {
                this.gameSpeedFactor = querySpeed;
            }
        }
        this.cheat = false;
        if (query.get("cheat") || query.get("c")) {
            this.cheat = (query.get("cheat") || query.get("c")) === "true";
        }
        this.debug = false;
        if (query.get("debug") || query.get("d")) {
            this.debug = (query.get("debug") || query.get("d")) === "true";
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
        this.changeHtmlText(this.elementGameState, Lemmings.GameStateTypes[Lemmings.GameStateTypes.UNKNOWN]);
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

export { GameView };
