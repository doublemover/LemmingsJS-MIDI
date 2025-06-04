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
                //console.log(e.x +" "+ e.y);
                let lem = this.lemmingManager.getLemmingAt(e.x, e.y);
                if (!lem)
                    return;
                this.game.queueCommand(new Lemmings.CommandLemmingsAction(lem.id));
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
        }
        renderDebug() {
            if (this.display == null)
                return;
            this.level.renderDebug(this.display);
            this.lemmingManager.renderDebug(this.display);
            this.triggerManager.renderDebug(this.display);
            if (this.highlightLemming) {
                const lem = this.highlightLemming;
                const x = lem.x - 5;
                const y = lem.y - 11;
                const selected = this.lemmingManager.getLemmingAt(this.mouseX, this.mouseY) === lem;
                if (selected) {
                    this.display.drawDashedRect(x, y, 10, 13, 64, 180, 64);
                } else {
                    this.display.drawDashedRect(x, y, 10, 13, 64, 64, 64);
                }
            }
        }
    }
    Lemmings.GameDisplay = GameDisplay;

export { GameDisplay };
