import { Lemmings } from './LemmingsNamespace.js';

class Trigger {
        constructor(type = Lemmings.TriggerTypes.NO_TRIGGER, x1 = 0, y1 = 0, x2 = 0, y2 = 0, disableTicksCount = 0, soundIndex = -1, owner = null) {
            this.disabledUntilTick = 0;
            this.owner = owner;
            this.type = type;
            this.x1 = Math.min(x1, x2);
            this.y1 = Math.min(y1, y2);
            this.x2 = Math.max(x1, x2);
            this.y2 = Math.max(y1, y2);
            this.disableTicksCount = disableTicksCount;
                        console.log(type)
        }
        trigger(x, y, tick) {
            if (this.disabledUntilTick <= tick) {
                if ((x >= this.x1) && (y >= this.y1) && (x <= this.x2) && (y <= this.y2)) {
                    this.disabledUntilTick = tick + this.disableTicksCount;
                    if (this.owner?.onTrigger){
                        this.owner.onTrigger(tick);  
                    } 
                    return this.type;
                }
            }
            return Lemmings.TriggerTypes.NO_TRIGGER;
        }
        draw(gameDisplay) {

            if (this.type == 7 || this.type == 8) {
                return; // don't render arrow triggers to debug display, that is handled in level
            }
            gameDisplay.drawRect(this.x1, this.y1, this.x2 - this.x1, this.y2 - this.y1, 255, 0, 0);
        }
    }
    Lemmings.Trigger = Trigger;

export { Trigger };
