import { Lemmings } from './LemmingsNamespace.js';

class GameDisplay {
        constructor(game, level, lemmingManager, objectManager, triggerManager) {
            this.game = game;
            this.level = level;
            this.lemmingManager = lemmingManager;
            this.objectManager = objectManager;
            this.triggerManager = triggerManager;
            this.display = null;
            this._mouseHandler = null;
        }
        setGuiDisplay(display) {
            this.display = display;
            this._mouseHandler = (e) => {
                //console.log(e.x +" "+ e.y);
                let lem = this.lemmingManager.getLemmingAt(e.x, e.y);
                if (!lem)
                    return;
                this.game.queueCommand(new Lemmings.CommandLemmingsAction(lem.id));
            };
            this.display.onMouseDown.on(this._mouseHandler);
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
        }

        dispose() {
            if (this.display && this._mouseHandler) {
                this.display.onMouseDown.off(this._mouseHandler);
                this._mouseHandler = null;
            }
            this.display = null;
            this.game = null;
            this.level = null;
            this.lemmingManager = null;
            this.objectManager = null;
            this.triggerManager = null;
        }
    }
    Lemmings.GameDisplay = GameDisplay;

export { GameDisplay };
