import { Lemmings } from './LemmingsNamespace.js';

class GameDisplay {
        constructor(game, level, lemmingManager, objectManager, triggerManager) {
            this.game = game;
            this.level = level;
            this.lemmingManager = lemmingManager;
            this.objectManager = objectManager;
            this.triggerManager = triggerManager;
            this.display = null;
            this.highlightLemming = null;
            this.mouseX = 0;
            this.mouseY = 0;
            this.flashTicks = 0;
            this.flashDuration = 12;
        }
        setGuiDisplay(display) {
            this.display = display;
            this.display.onMouseDown.on((e) => {
                const lem = this.lemmingManager.getLemmingAt(e.x, e.y);
                const selected = this.lemmingManager.getSelectedLemming();
                if (lem) {
                    if (lem === selected) {
                        const skill = this.game.getGameSkills()?.getSelectedSkill?.();
                        if (skill != null) {
                            this.game.applySkillToSelected(skill);
                        }
                    } else {
                        this.lemmingManager.setSelectedLemming(lem);
                        this.flashSelected();
                    }
                } else {
                    this.lemmingManager.setSelectedLemming(null);
                }
            });
            this.display.onMouseMove.on((e) => {
                this.mouseX = e.x;
                this.mouseY = e.y;
                this.highlightLemming = this.lemmingManager.getLemmingAt(e.x, e.y);
            });
        }

        flashSelected() {
            this.flashTicks = this.flashDuration;
        }
        render() {
            if (this.display == null)
                return;
            this.level.render(this.display);
            this.objectManager.render(this.display);
            this.lemmingManager.render(this.display);

            if (this.highlightLemming && this.highlightLemming.removed) {
                this.highlightLemming = null;
            }

            const selected = this.lemmingManager.getSelectedLemming();
            if (this.highlightLemming && this.highlightLemming !== selected) {
                const lem = this.highlightLemming;
                const size = 13;
                const x = lem.x - 6;
                const y = lem.y - 12;
                this.display.drawDashedRect(x, y, size, size, 64, 64, 64);
            }

            if (selected) {
                const size = 13;
                const x = selected.x - 6;
                const y = selected.y - 12;
                const fade = this.flashTicks / this.flashDuration;
                const r = Math.round(40 + 80 * fade);
                const g = Math.round(160 + 95 * fade);
                const b = Math.round(40 + 80 * fade);
                this.display.drawCornerRect(x, y, size, r, g, b, 2);
            }
            if (this.flashTicks > 0) this.flashTicks--;
        }
        renderDebug() {
            if (this.display == null)
                return;
            if (this.highlightLemming && this.highlightLemming.removed) {
                this.highlightLemming = null;
            }
            this.level.renderDebug(this.display);
            this.lemmingManager.renderDebug(this.display);
            this.triggerManager.renderDebug(this.display);
            if (this.highlightLemming) {
                const lem = this.highlightLemming;
                const size = 13;
                const x = lem.x - 6;
                const y = lem.y - 12;
                const inRange = lem.getClickDistance(this.mouseX, this.mouseY) >= 0;
                const isSelected = this.lemmingManager.getSelectedLemming() === lem;
                if (isSelected) {
                    const fade = this.flashTicks / this.flashDuration;
                    const r = Math.round(64 + 56 * fade);
                    const g = Math.round(160 + 95 * fade);
                    const b = Math.round(64 + 56 * fade);
                    this.display.drawDashedRect(x, y, size, size, r, g, b);
                } else if (inRange) {
                    this.display.drawDashedRect(x, y, size, size, 64, 180, 64);
                } else {
                    this.display.drawDashedRect(x, y, size, size, 64, 64, 64);
                }
            }
        }
    }
    Lemmings.GameDisplay = GameDisplay;

export { GameDisplay };
