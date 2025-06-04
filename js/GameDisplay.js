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
        }
        setGuiDisplay(display) {
            this.display = display;
            this.display.onMouseDown.on((e) => {
                const lem = this.lemmingManager.getLemmingAt(e.x, e.y);
                if (lem) {
                    this.lemmingManager.setSelectedLemming(lem);
                }
            });
            this.display.onMouseMove.on((e) => {
                this.mouseX = e.x;
                this.mouseY = e.y;
                this.highlightLemming = this.lemmingManager.getNearestLemming(e.x, e.y);
            });
        }
        render() {
            if (this.display == null)
                return;
            this.level.render(this.display);
            this.objectManager.render(this.display);
            this.lemmingManager.render(this.display);
            const selected = this.lemmingManager.getSelectedLemming();
            if (selected) {
                const size = 13;
                const x = selected.x - 6;
                const y = selected.y - 11;
                this.display.drawCornerRect(x, y, size, 96, 220, 96);
            }
        }
        renderDebug() {
            if (this.display == null)
                return;
            this.level.renderDebug(this.display);
            this.lemmingManager.renderDebug(this.display);
            this.triggerManager.renderDebug(this.display);
            if (this.highlightLemming) {
                const lem = this.highlightLemming;
                const size = 13;
                const x = lem.x - 6;
                const y = lem.y - 11;
                const inRange = lem.getClickDistance(this.mouseX, this.mouseY) >= 0;
                const isSelected = this.lemmingManager.getSelectedLemming() === lem;
                if (isSelected) {
                    this.display.drawDashedRect(x, y, size, size, 96, 220, 96);
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
