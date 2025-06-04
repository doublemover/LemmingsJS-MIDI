import { Lemmings } from './LemmingsNamespace.js';

class GameDisplay {
        constructor(game, level, lemmingManager, objectManager, triggerManager) {
            this.game = game;
            this.level = level;
            this.lemmingManager = lemmingManager;
            this.objectManager = objectManager;
            this.triggerManager = triggerManager;
            this.display = null;
            this._highlight = null;
            this._rightDown = false;
        }
        setGuiDisplay(display) {
            this.display = display;
            this.display.onMouseDown.on((e) => {
                //console.log(e.x +" "+ e.y);
                let lem = this.lemmingManager.getLemmingAt(e.x, e.y);
                if (this.level.mechanics?.RightClickGlitch && this._rightDown && this._highlight)
                    lem = this._highlight;
                if (!lem) return;
                this.game.queueCommand(new Lemmings.CommandLemmingsAction(lem.id));
            });
            this.display.onMouseRightDown.on((e)=>{
                this._rightDown = true;
                this._highlight = this.lemmingManager.getLemmingAt(e.x, e.y);
            });
            this.display.onMouseRightUp.on(()=>{ this._rightDown=false; this._highlight=null; });
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
    }
    Lemmings.GameDisplay = GameDisplay;

export { GameDisplay };
