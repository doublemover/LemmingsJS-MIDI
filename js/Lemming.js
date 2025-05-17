import { Lemmings } from './LemmingsNamespace.js';

class Lemming {
        constructor(x, y, id) {
            this.x = 0;
            this.y = 0;
            this.lookRight = true;
            this.frameIndex = 0;
            this.canClimb = false;
            this.hasParachute = false;
            this.removed = false;
            this.countdown = 0;
            this.state = 0;
            this.disabled = false;
            this.x = x;
            this.y = y;
            this.id = id;
        }
        /** return the number shown as countdown */
        getCountDownTime() {
            return (8 - (this.countdown >> 4));
        }
        /** switch the action of this lemming */
        setAction(action) {
            this.action = action;
            this.frameIndex = 0;
            this.state = 0;
        }
        /** set the countdown action of this lemming */
        setCountDown(action) {
            this.countdownAction = action;
            if (this.countdown > 0) {
                return false;
            }
            this.countdown = 80;
            return true;
        }
        /** return the distance of this lemming to a given position */
        getClickDistance(x, y) {
            let yCenter = this.y - 5;
            let xCenter = this.x;
            let x1 = xCenter - 5;
            let y1 = yCenter - 6;
            let x2 = xCenter + 5;
            let y2 = yCenter + 7;
            //console.log(this.id + " : "+ x1 +"-"+ x2 +"  "+ y1 +"-"+ y2);
            if ((x >= x1) && (x <= x2) && (y >= y1) && (y < y2)) {
                return ((yCenter - y) * (yCenter - y) + (xCenter - x) * (xCenter - x));
            }
            return -1;
        }
        /** render this lemming to the display */
        render(gameDisplay) {
            if (!this.action) {
                return;
            }
            if (this.countdownAction != null) {
                this.countdownAction.draw(gameDisplay, this);
            }
            this.action.draw(gameDisplay, this);
        }
        /** render this lemming debug "information" to the display */
        renderDebug(gameDisplay) {
            if (!this.action) {
                return;
            }
            gameDisplay.setDebugPixel(this.x, this.y);
        }
        /** process this lemming one tick in time */
        process(level) {
            if ((this.x < 0) || (this.x >= level.width) || (this.y < 0) || (this.y >= level.height + 6)) {
                // level height -12 so that minimap rect does not obscure them
                // TODO: fix minimap rect
                lemmings.game.lemmingManager.miniMap.addDeath(this.x, level.height-12);
                return Lemmings.LemmingStateType.OUT_OF_LEVEL;
            }
            /// run main action
            // TODO: why is this necessary
            if (!this.action) {
                lemmings.game.lemmingManager.miniMap.addDeath(this.x, level.height-12);
                return Lemmings.LemmingStateType.OUT_OF_LEVEL;
            }
            /// run secondary action
            if (this.countdownAction) {
                let newAction = this.countdownAction.process(level, this);
                if (newAction != Lemmings.LemmingStateType.NO_STATE_TYPE) {
                    return newAction;
                }
            }
            if (this.action) {
                var returnedState = this.action.process(level, this);
                return returnedState;
            }
            // prevent falling through function without returning a type
            //  can cause random undefined is not a function errors
            console.log("lemming state falling through, fix it")
            return LemmingStateType.NO_STATE_TYPE;
        }
        /** disable this lemming so it can no longer be triggered
         *   or selected by the user */
        disable() {
            this.disabled = true;
        }
        /** remove this lemming */
        remove() {
            this.action = null;
            this.countdownAction = null;
            this.removed = true;
        }
        isDisabled() {
            return this.disabled;
        }
        isRemoved() {
            return (this.action == null);
        }
    }
    Lemming.LEM_MIN_Y = -5;
    Lemming.LEM_MAX_FALLING = 59;
    Lemmings.Lemming = Lemming;

export { Lemming };
