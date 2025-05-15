import { Lemmings } from './LemmingsNamespace.js';

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
            this.miniMap = null;
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
        setMiniMap(miniMap) { 
            this.miniMap = miniMap;
            this.game.lemmingManager.setMiniMap(this.miniMap);
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
            // if not clicking on nuke, reset nuke confirmation state
            if (panelIndex != 11) {
                this.game.nukePrepared = false;
            }
            // lower release rate
            if (panelIndex == 0) {
                this.deltaReleaseRate = -3;
                this.doReleaseRateChanges();
                return;
            }
            // raise release rate
            if (panelIndex == 1) {
                this.deltaReleaseRate = 3;
                this.doReleaseRateChanges();
                return;
            }
            // pause game
            if (panelIndex == 10) {
                this.gameTimer.toggle();
                return;
            }
            // nuke
            if (panelIndex == 11) {
                if (this.game.nukePrepared) {
                    this.game.queueCmmand(new Lemmings.CommandNuke());
                } else {
                    this.game.nukePrepared = true;
                }
                return;
            }
            // speedup
            if (panelIndex == 12) {
                if (this.gameTimer.speedFactor > 1) {
                    this.gameTimer.speedFactor = this.gameTimer.speedFactor - 1;
                }
                return;
            }
            // slowdown
            if (panelIndex == 13) {
                if (this.gameTimer.speedFactor < 10) {
                    this.gameTimer.speedFactor = this.gameTimer.speedFactor + 1;
                }
                return;
            }
            // reset speed
            if (panelIndex == 14) {
                // prevent resetting speed if already at default, causes slowdowns otherwise
                if (this.gameTimer.speedFactor == 1) {
                    return;
                }
                this.gameTimer.speedFactor = 1;
                return;
            }
            // enable debug mode
            if (panelIndex == 15) {
                this.game.showDebug = !this.game.showDebug;
                console.log("showDebug = " + this.game.showDebug);
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
            if (!this.miniMap) {
                this.setMiniMap(new Lemmings.MiniMap(this, this.game.level, display));
            }
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
                for (let i = 1 /* jump over unknown */ ; i < Object.keys(Lemmings.SkillTypes).length; i++) {
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

            if (this.miniMap) {
                const viewX = this.game.level.screenPositionX;
                const viewW = this.display.getWidth();
                this.miniMap.render(viewX, viewW);
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

export { GameGui };
