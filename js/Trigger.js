import { Lemmings } from './LemmingsNamespace.js';

class Trigger {
        constructor(type, x1, y1, x2, y2, disableTicksCount = 0, soundIndex = -1, owner = null) {
            this.x1 = 0;
            this.y1 = 0;
            this.x2 = 0;
            this.y2 = 0;
            this.type = Lemmings.TriggerTypes.NO_TRIGGER;
            this.disableTicksCount = 0;
            this.disabledUntilTick = 0;
            this.owner = owner;
            this.type = type;
            this.x1 = Math.min(x1, x2);
            this.y1 = Math.min(y1, y2);
            this.x2 = Math.max(x1, x2);
            this.y2 = Math.max(y1, y2);
            this.disableTicksCount = disableTicksCount;
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
            gameDisplay.drawRect(this.x1, this.y1, this.x2 - this.x1, this.y2 - this.y1, 255, 0, 0);
        }
    }
    Lemmings.Trigger = Trigger;

export { Trigger };
