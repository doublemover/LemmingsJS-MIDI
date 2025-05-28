import { Lemmings } from './LemmingsNamespace.js';

/**
 * GameGui – unchanged public API, now updates itself
 * even while the simulation is paused.
 */
class GameGui {
    constructor(game, skillPanelSprites, skills, gameTimer, gameVictoryCondition) {
        /* external handles */
        this.game                 = game;
        this.skillPanelSprites    = skillPanelSprites;
        this.skills               = skills;
        this.gameTimer            = gameTimer;
        this.gameVictoryCondition = gameVictoryCondition;

        /* change-tracking flags (original names) */
        this.gameTimeChanged       = false;
        this.skillsCountChangd     = true;
        this.skillSelectionChanged = true;
        this.backgroundChanged     = true;
        this.releaseRateChanged    = true;
        this.lastGameSpeed      = 0;

        /* sprite caches */
        this._panelSprite    = skillPanelSprites.getPanelSprite();
        this._numLeftCache   = new Array(10);
        this._numRightCache  = new Array(10);
        this._numEmptySprite = skillPanelSprites.getNumberSpriteEmpty();
        this._letterCache    = new Map();

        /* runtime state */
        this.display          = null;
        this.miniMap          = null;
        this.deltaReleaseRate = 0;

        this._guiRafId        = 0;

        /* timer heartbeat – fires every RAF tick */
        gameTimer.onGameTick.on((paused) => {
            this._applyReleaseRateAuto();
        });

        gameTimer.eachGameSecond.on(() => {
            this.gameTimeChanged = true;
        })

        skills.onCountChanged.on(() => {
            this.skillsCountChangd = true;
            this.backgroundChanged = true;
        });

        skills.onSelectionChanged.on(() => {
            this.skillSelectionChanged = true;
            this.backgroundChanged     = true;
        });
    }

    setMiniMap(miniMap) {
        this.miniMap = miniMap;
        this.game?.lemmingManager?.setMiniMap?.(miniMap);
    }

    _applyReleaseRateAuto() {
        if (!this.deltaReleaseRate) return;
        if (this.gameTimer.isPaused?.()) {
            const min = this.gameVictoryCondition.getMinReleaseRate?.() ?? 0;
            const max = this.gameVictoryCondition.getMaxReleaseRate?.() ?? 99;
            const cur = this.gameVictoryCondition.getCurrentReleaseRate();
            let   neu = cur + this.deltaReleaseRate;
            if (neu < min) neu = min;
            if (neu > max) neu = max;
            this.gameVictoryCondition.setCurrentReleaseRate?.(neu) ??
                (this.gameVictoryCondition.currentReleaseRate = neu);
            this.skillsCountChangd = true;
        }
        if (this.deltaReleaseRate > 0)
            this.game.queueCommand(new Lemmings.CommandReleaseRateIncrease(this.deltaReleaseRate));
        else
            this.game.queueCommand(new Lemmings.CommandReleaseRateDecrease(-this.deltaReleaseRate));
    }

    handleSkillMouseDown(e) {
        const panelIndex = Math.trunc(e.x / 16);
        if (panelIndex !== 11) this.game.nukePrepared = false;
        if (panelIndex === 0 || panelIndex === 1) {
            const step = panelIndex === 0 ? -3 : +3;
            if (this.gameTimer.isPaused?.()) {
                const min = this.gameVictoryCondition.getMinReleaseRate?.() ?? 0;
                const max = this.gameVictoryCondition.getMaxReleaseRate?.() ?? 99;
                const cur = this.gameVictoryCondition.getCurrentReleaseRate();
                let   neu = cur + step;
                if (neu < min) neu = min;
                if (neu > max) neu = max;
                this.lastGameSpeed = neu;
                this.gameVictoryCondition.setCurrentReleaseRate?.(neu) ??
                    (this.gameVictoryCondition.currentReleaseRate = neu);
                this.skillsCountChangd = true;
                this.gameSpeedChanged = true;
            }
            this.deltaReleaseRate = step;
            this._applyReleaseRateAuto();
            return;
        }
        if (panelIndex === 10) {
            if (e.y >= 34) { // if it is the bottom of the pause button
                const pauseX = e.x - 160; // 160 is the leftmost position
                const pauseIndex = Math.trunc(pauseX / 8); // 15px buttons
                const speedFac = this.gameTimer.speedFactor;
                if (pauseIndex === 0) {
                    if (this.game.showDebug && speedFac > 10) {
                        this.gameTimer.speedFactor -= 10;
                        return;
                    }
                    if (speedFac > 1) {
                        this.gameTimer.speedFactor--; 
                        return
                    }
                    if (this.game.showDebug && speedFac == 1) {
                        this.gameTimer.speedFactor = 0.5;
                        return;
                    }
                }
                if (pauseIndex === 1) {
                    if (speedFac == 0.5) {
                        this.gameTimer.speedFactor = 1;
                        return;
                    }
                    if (this.game.showDebug && speedFac >= 10 && speedFac < 60) {
                        this.gameTimer.speedFactor += 10;
                        return;
                    }
                    if (speedFac < 10) {
                        this.gameTimer.speedFactor++;
                        return;
                    }
                }
            } else {
                this.gameTimer.toggle(); 
            }
            return; 
        }
        if (panelIndex === 11) {
            if (this.game.nukePrepared) {
                this.game.queueCommand(new Lemmings.CommandNuke());
            }
            else {
                this.game.nukePrepared = true;
            }
            return;
        }
        const newSkill = this.getSkillByPanelIndex(panelIndex);
        if (newSkill === Lemmings.SkillTypes.UNKNOWN) return;
        if (this.gameTimer.isPaused?.()) {
            this.skills.setSelectedSkill(newSkill);
            this.skillSelectionChanged = true;
        }
        this.game.queueCommand(new Lemmings.CommandSelectSkill(newSkill));
    }

    handleSkillMouseRightDown(e) {
        const panelIndex = Math.trunc(e.x / 16);

        this.game.nukePrepared = false; // always cancel nuke confirmation on right click

        if (panelIndex === 10) { // reset game speed if you right click pause
            if (this.gameTimer.speedFactor !== 1) {
                this.gameTimer.speedFactor = 1;
            }
        }

        if (panelIndex === 11) { // enable debug mode if you right click nuke
            this.game.showDebug = !this.game.showDebug;
            return;
        }
    }

    handleSkillDoubleClick(e) {
        if (Math.trunc(e.x / 16) === 11)
            this.game.queueCommand(new Lemmings.CommandNuke());
    }

    setGuiDisplay(display) {
        if (this.display && this._displayListeners) {
            for (const [event, handler] of this._displayListeners) {
                this.display[event].off(handler);
            }
        }
        this.display = display;
        if (!this.miniMap) {
            this.setMiniMap(new Lemmings.MiniMap(this, this.game.level, display));
        }

        this._displayListeners = [
            ['onMouseDown', e => { this.deltaReleaseRate = 0; if (e.y > 15) this.handleSkillMouseDown(e); }],
            ['onMouseUp', () => { this.deltaReleaseRate = 0; }],
            ['onMouseRightDown', e => { this.deltaReleaseRate = 0; if (e.y > 15) this.handleSkillMouseRightDown(e); }],
            ['onMouseRightUp', () => { this.deltaReleaseRate = 0; }],
            ['onDoubleClick', e => { this.deltaReleaseRate = 0; if (e.y > 15) this.handleSkillDoubleClick(e); }]
        ];
        for (const [event, handler] of this._displayListeners) {
            display[event].on(handler);
        }

        this.gameTimeChanged = this.skillsCountChangd = this.skillSelectionChanged = this.backgroundChanged = true;

        if (this._guiRafId) window.cancelAnimationFrame(this._guiRafId);
        const guiLoop = () => {
            this.render();
            // THIS is the important part: always update the on-screen display
            if (this.display && typeof this.display.redraw === "function") {
                this.display.redraw();
            }
            this._guiRafId = window.requestAnimationFrame(guiLoop);
        };
    }

    dispose() {
        if (this._guiRafId) {
            window.cancelAnimationFrame(this._guiRafId);
            this._guiRafId = 0;
        }
        if (this.display && this._displayListeners) {
            for (const [event, handler] of this._displayListeners) {
                this.display[event].off(handler);
            }
        }
        this._letterCache = null;
        this._numRightCache = null;
        this._numLeftCache = null;
        this._panelSprite = null;
        this._numEmptySprite = null;

    }

    render() {
        if (!this.display) return;
        const d = this.display;

        if (this.backgroundChanged) {
            this.backgroundChanged = false;
            d.initSize(this._panelSprite.width, this._panelSprite.height);
            d.setBackground(this._panelSprite.getData());
            this.gameTimeChanged = this.skillsCountChangd = this.skillSelectionChanged = true;
        }


        // --- Always update timer text so it reflects "frozen" state
        if (this.gameTimeChanged) {
            this.drawGreenString(d, 'Time ' + this.gameTimer.getGameLeftTimeString() + '-00', 248, 0);
            const outCount = this.gameVictoryCondition.getOutCount();
            if (outCount >= 0) {
                this.drawGreenString(d, 'Out ' + this.gameVictoryCondition.getOutCount() + '  ', 112, 0);
            }
            this.drawGreenString(d, 'In'  + this._pad(this.gameVictoryCondition.getSurvivorPercentage(), 3) + '%', 186, 0);
            this.drawPanelNumber(d, this.gameVictoryCondition.getMinReleaseRate(),     0);
            this.drawPanelNumber(d, this.gameVictoryCondition.getCurrentReleaseRate(), 1);
            this.gameTimeChanged = false;
        }

        if (this.skillsCountChangd) {
            d.drawRect(160, 32, 16, 10, 0, 0, 0, true); // draw bottom black rect on pause button

            let greenS  = this._getGreenLetter("f");
            d.drawFrameResized(greenS, 173, 34, 3, 4);
            let greenP  = this._getGreenLetter("-");
            d.drawFrameResized(greenP, 161, 33, 3, 6);

            const speedFac = this.gameTimer.speedFactor;
            const tens  = Math.floor(speedFac / 10);
            const ones  = speedFac % 10;
            const left  = this._getRightDigit(tens);
            const right = this._getRightDigit(ones);
            let rightX = 163;
            if (left && tens > 0) {
                rightX = 164;
                d.drawFrameResized(left, rightX-4, 33, 8, 6);
            }
            if (right) {
                d.drawFrameResized(right, rightX, 33, 8, 6);
            }
            this.backgroundChanged = true;
        }


        if (this.skillsCountChangd) {
            this.skillsCountChangd = false;
            for (let s = 1; s < Object.keys(Lemmings.SkillTypes).length; ++s)
                this.drawPanelNumber(d, this.skills.getSkill(s), this.getPanelIndexBySkill(s));
        }
        if (this.skillSelectionChanged) {
            this.skillSelectionChanged = false;
            this.drawSelection(d, this.getPanelIndexBySkill(this.skills.getSelectedSkill()));
        }
        if (this.miniMap) {
            const viewX = this.game.level.screenPositionX;
            const viewW = d.getWidth();
            this.miniMap.render(viewX, viewW);
        }
    }

    _pad(v, len) { const s = String(v); return s.length >= len ? s : ' '.repeat(len - s.length) + s; }
    _getLeftDigit(d)  { if (d <= 0) return null;
        if (!this._numLeftCache[d])  this._numLeftCache[d]  = this.skillPanelSprites.getNumberSpriteLeft(d);
        return this._numLeftCache[d]; }
    _getRightDigit(d) { if (!this._numRightCache[d])
        this._numRightCache[d] = this.skillPanelSprites.getNumberSpriteRight(d);
        return this._numRightCache[d]; 
    }
    _getGreenLetter(ch) {
        const cachedGreenLet  = this._letterCache.get(ch);
        if (!cachedGreenLet) { 
            const newGreenLet = this.skillPanelSprites.getLetterSprite(ch); 
            this._letterCache.set(ch, newGreenLet); 
            return newGreenLet;
        } else {
            return cachedGreenLet;
        }
    }

    drawSelection(d, panelIdx) { d.drawRect(16 * panelIdx, 16, 16, 23, 255, 255, 255); }
    drawPanelNumber(d, num, panelIdx) { this.drawNumber(d, num, 4 + 16 * panelIdx, 17); }

    drawNumber(d, num, x, y, small = false) {
        if (num <= 0) { d.drawFrame(this._numEmptySprite, x, y); return; }
        const tens  = Math.floor(num / 10);
        const ones  = num % 10;
        const left  = this._getLeftDigit(tens);
        const right = this._getRightDigit(ones);
        if (left) d.drawFrameCovered(left,  x, y, 0, 0, 0);
        d.drawFrame(right, x, y);
    }

    drawGreenString(d, text, x, y) {
        for (let i = 0; i < text.length; ++i) {
            const ch = text[i];
            let img  = this._letterCache.get(ch);
            if (!img) { img = this.skillPanelSprites.getLetterSprite(ch); this._letterCache.set(ch, img); }
            if (img) d.drawFrameCovered(img, x, y, 0, 0, 0);
            x += 8;
        }
    }

    getSkillByPanelIndex(idx) {
        switch (Math.trunc(idx)) {
            case 2:  return Lemmings.SkillTypes.CLIMBER;
            case 3:  return Lemmings.SkillTypes.FLOATER;
            case 4:  return Lemmings.SkillTypes.BOMBER;
            case 5:  return Lemmings.SkillTypes.BLOCKER;
            case 6:  return Lemmings.SkillTypes.BUILDER;
            case 7:  return Lemmings.SkillTypes.BASHER;
            case 8:  return Lemmings.SkillTypes.MINER;
            case 9:  return Lemmings.SkillTypes.DIGGER;
            default: return Lemmings.SkillTypes.UNKNOWN;
        }
    }

    getPanelIndexBySkill(skill) {
        switch (skill) {
            case Lemmings.SkillTypes.CLIMBER: return 2;
            case Lemmings.SkillTypes.FLOATER: return 3;
            case Lemmings.SkillTypes.BOMBER:  return 4;
            case Lemmings.SkillTypes.BLOCKER: return 5;
            case Lemmings.SkillTypes.BUILDER: return 6;
            case Lemmings.SkillTypes.BASHER:  return 7;
            case Lemmings.SkillTypes.MINER:   return 8;
            case Lemmings.SkillTypes.DIGGER:  return 9;
            default: return -1;
        }
    }
}

Lemmings.GameGui = GameGui;
export { GameGui };
