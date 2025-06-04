import { Lemmings } from './LemmingsNamespace.js';

class TriggerManager {
        constructor(gameTimer) {
            this.gameTimer = gameTimer;
            this.triggers = [];
        }
        /** add a new trigger to the manager */
        add(trigger) {
            this.triggers.push(trigger);
        }
        /** remove all triggers having a giving owner */
        // go in reverse so splicing doesn't move unchecked 
        // only iterates once instead of looping
        removeByOwner(owner) {
            for (let i = this.triggers.length - 1; i >= 0; --i) {
                if (this.triggers[i].owner == owner) {
                    this.triggers.splice(i, 1);   // 
                }
            }
        }
        /** add a new trigger to the manager */
        remove(trigger) {
            let triggerIndex = this.triggers.indexOf(trigger);
            if (triggerIndex >= 0) {
                this.triggers.splice(triggerIndex, 1);
            }
        }
        addRange(newTriggers) {
            for (let i = 0; i < newTriggers.length; i++) {
                this.triggers.push(newTriggers[i]);
            }
        }
        renderDebug(gameDisplay) {
            for (let i = 0; i < this.triggers.length; i++) {
                this.triggers[i].draw(gameDisplay);
            }
        }
        /** test all triggers. Returns the triggered type that matches */
        trigger(x, y) {
            let l = this.triggers.length;
            let tick = this.gameTimer.getGameTicks();
            for (var i = 0; i < l; i++) {
                let type = this.triggers[i].trigger(x, y, tick);
                if (type != Lemmings.TriggerTypes.NO_TRIGGER)
                    return type;
            }
            return Lemmings.TriggerTypes.NO_TRIGGER;
        }
    }
    Lemmings.TriggerManager = TriggerManager;

export { TriggerManager };
