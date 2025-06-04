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
        this.bench = false; // just keep spawning lems
        this.endless = false; // time doesn't run out, game doesn't end
        this.nukeAfter = 0; // nuke after x seconds
        this.scale = 0; // zoom 
        this.laggedOut = 0;
        this.extraLemmings = 0;
        this.steps = 0;
        this.applyQuery();
        this.elementGameState = null;

        this.log.log("selected level: " + Lemmings.GameTypes.toString(this.gameType) + " : " + this.levelIndex + " / " + this.levelGroupIndex);
    }

    set gameCanvas(el) {
        this.stage = new Lemmings.Stage(el);
    }

    /** start or continue the game */
    async start(replayString) {
        if (!this.gameFactory) return;
        if (this.game != null) {
            this.continue();
            return;
        }
        try {
            const game = await this.gameFactory.getGame(this.gameType);
            await game.loadLevel(this.levelGroupIndex, this.levelIndex);
            if (replayString != null) {
                game.getCommandManager().loadReplay(replayString);
            }
            game.setGameDisplay(this.stage.getGameDisplay());
            game.setGuiDisplay(this.stage.getGuiDisplay());
            game.getGameTimer().speedFactor = this.gameSpeedFactor;
            game.start();
            this.changeHtmlText(this.elementGameState, Lemmings.GameStateTypes.toString(Lemmings.GameStateTypes.RUNNING));
            game.onGameEnd.on(state => this.onGameEnd(state));
            this.game = game;
            if (this.cheat) this.game.cheat();
            if (this.debug) this.game.showDebug = true;
        } catch (e) {
            this.log.log("Error starting game:", e);
        }
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

    async loadReplay(replayString) {
        await this.start(replayString);
    }

    cheat() {
        if (this.game == null) {
            return;
        }
        this.game.cheat();
    }

    suspend() {
        if (this.game == null) {
            return;
        }
        this.game.getGameTimer().suspend();
    }

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
async moveToLevel(moveInterval = 0) {
        if (this.levelIndex + moveInterval < 0 && this.levelGroupIndex == 0) return;
        if (this.inMoveToLevel) return;
        this.inMoveToLevel = true;
        this.levelIndex = (this.levelIndex + moveInterval) | 0;
        try {
            const config = await this.gameFactory.getConfig(this.gameType);
            const groupLength = config.level.getGroupLength(this.levelGroupIndex);

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
            if ((this.levelIndex < 0) && (this.levelGroupIndex > 0)) {
                this.levelGroupIndex--;
                this.levelIndex = groupLength - 1;
            }
            if (!Lemmings.GameTypes[Object.keys(Lemmings.GameTypes)[this.gameType]]) {
                this.gameType = 1;
                this.levelGroupIndex = 0;
                this.levelIndex = 0;
            }
            await this.loadLevel();
        } finally {
            this.inMoveToLevel = false;
        }
    }
    /** helper to parse a numeric query value */
    parseNumber(query, names, def, min, max, multiplier = 1) {
        for (const name of names) {
            const raw = query.get(name);
            if (raw !== null) {
                const val = parseFloat(raw);
                if (!isNaN(val) && val >= min && val <= max) {
                    return val * multiplier;
                }
            }
        }
        return def;
    }

    /** helper to parse a boolean query value */
    parseBool(query, names, def = false) {
        for (const name of names) {
            if (query.has(name)) {
                return query.get(name) === "true";
            }
        }
        return def;
    }

    /** read parameters from the current URL */
    applyQuery() {
        this.gameType = 1;
        const query = new URLSearchParams(window.location.search);
        this.gameType = this.parseNumber(query, ["version", "v"], 1, 1, 6);
        this.levelGroupIndex = this.parseNumber(query, ["difficulty", "d"], 1, 1, 5) - 1;
        this.levelIndex = this.parseNumber(query, ["level", "l"], 1, 1, 30) - 1;
        this.gameSpeedFactor = this.parseNumber(query, ["speed", "s"], 1, 0, 100);
        this.cheat = this.parseBool(query, ["cheat", "c"]);
        this.debug = this.parseBool(query, ["debug", "dbg"]);
        this.bench = this.parseBool(query, ["bench", "b"]);
        this.endless = this.parseBool(query, ["endless", "e"]);
        this.nukeAfter = this.parseNumber(query, ["nukeAfter", "na"], 0, 1, 60, 10);
        this.extraLemmings = this.parseNumber(query, ["extra", "ex"], 0, 1, 1000);
        this.scale = this.parseNumber(query, ["scale", "sc"], 0, 0.0125, 5);
        this.laggedOut = 0;
        this.shortcut = this.parseBool(query, ["shortcut", "_"]); 
    }
    updateQuery() {
        const params = new URLSearchParams(window.location.search);
        const setParam = (longName, shortName, value, def, always) => {
            params.delete(longName);
            params.delete(shortName);
            if (always || (value !== undefined && value !== def)) {
                params.set(this.shortcut ? shortName : longName, value);
            }
        };

        // main game state should always remain visible
        setParam('version', 'v', this.gameType, undefined, true);
        setParam('difficulty', 'd', this.levelGroupIndex + 1, undefined, true);
        setParam('level', 'l', this.levelIndex + 1, undefined, true);
        setParam('speed', 's', this.gameSpeedFactor, undefined, true);
        setParam('cheat', 'c', this.cheat, undefined, true);

        // optional flags only appear when non-default
        setParam('debug', 'dbg', this.debug, false);
        setParam('bench', 'b', this.bench, false);
        setParam('endless', 'e', this.endless, false);
        setParam('nukeAfter', 'na', this.nukeAfter ? this.nukeAfter / 10 : undefined);
        setParam('extra', 'ex', this.extraLemmings, 0);
        setParam('scale', 'sc', this.scale, 0);

        if (this.shortcut) {
            params.set('_', true);
        } else {
            params.delete('_');
        }

        this.setHistoryState(params);
    }
    setHistoryState(params) {
        const query = params instanceof URLSearchParams ? params : new URLSearchParams(params);
        history.replaceState(null, null, "?" + query.toString());
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
    async setup() {
        this.applyQuery();
        const newGameResources = await this.gameFactory.getGameResources(this.gameType);
        this.gameResources = newGameResources;
        this.arrayToSelect(this.elementSelectLevelGroup, this.gameResources.getLevelGroups());
        await this.loadLevel();
    }
    /** load a level and render it to the display */
    async loadLevel() {
        if (!this.gameResources) return;
        if (this.game) {
            this.game.stop();
            this.game = null;
        }
        this.changeHtmlText(this.elementGameState, Lemmings.GameStateTypes[Lemmings.GameStateTypes.UNKNOWN]);
        const level = await this.gameResources.getLevel(this.levelGroupIndex, this.levelIndex);
        if (!level) return;
        this.changeHtmlText(this.elementLevelName, level.name);
        if (this.stage) {
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
    }
}
Lemmings.GameView = GameView;

export { GameView };
