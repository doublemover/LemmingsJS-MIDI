import { Lemmings } from './LemmingsNamespace.js';

class GameTimer {
        constructor(level) {
            this.TIME_PER_FRAME_MS = 60;
            this._speedFactor = 1;
            this.gameTimerHandler = 0;
            /** the current game time in number of steps the game has made  */
            this.tickIndex = 0;
            /** event raising on every tick (one step in time) the game made */
            this.onGameTick = new Lemmings.EventHandler();
            /** event raising on before every tick (one step in time) the game made */
            this.onBeforeGameTick = new Lemmings.EventHandler();
            this.ticksTimeLimit = this.secondsToTicks(level.timeLimit * 60);
        }
        /** return if the game timer is running or not */
        isRunning() {
            return (this.gameTimerHandler != 0);
        }
        /** define a factor to speed up >1 or slow down <1 the game */
        get speedFactor() {
            return this._speedFactor;
        }
        /** set a factor to speed up >1 or slow down <1 the game */
        set speedFactor(newSpeedFactor) {
            this._speedFactor = newSpeedFactor;
            if (!this.isRunning()) {
                return;
            }
            this.suspend();
            this.continue();
        }
        /** Pause the game */
        suspend() {
            if (this.gameTimerHandler != 0) {
                clearInterval(this.gameTimerHandler);
            }
            this.gameTimerHandler = 0;
        }
        /** End the game */
        stop() {
            this.suspend();
            this.onBeforeGameTick.dispose();
            this.onGameTick.dispose();
        }
        /** toggle between suspend and continue */
        toggle() {
            if (this.isRunning()) {
                this.suspend();
            } else {
                this.continue();
            }
        }
        /** Run the game timer */
        continue () {
            if (this.isRunning()) {
                return;
            }
            this.gameTimerHandler = setInterval(() => {
                this.tick();
            }, (this.TIME_PER_FRAME_MS / this._speedFactor));
        }
        /** run the game one step in time */
        tick() {
            if (this.onBeforeGameTick != null)
                this.onBeforeGameTick.trigger(this.tickIndex);
            this.tickIndex++;
            if (this.onGameTick != null)
                this.onGameTick.trigger();
        }
        /** return the past game time in seconds */
        getGameTime() {
            return Math.floor(this.ticksToSeconds(this.tickIndex));
        }
        /** return the past game time in ticks */
        getGameTicks() {
            return this.tickIndex;
        }
        /** return the left game time in seconds */
        getGameLeftTime() {
            let leftTicks = this.ticksTimeLimit - this.tickIndex;
            if (leftTicks < 0)
                leftTicks = 0;
            return Math.floor(this.ticksToSeconds(leftTicks));
        }
        /** return the left game time in seconds */
        getGameLeftTimeString() {
            let leftSeconds = this.getGameLeftTime();
            let secondsStr = "0" + Math.floor(leftSeconds % 60);
            return Math.floor(leftSeconds / 60) + "-" + secondsStr.substr(secondsStr.length - 2, 2);
        }
        /** convert a game-ticks-time to in game-seconds. Returns Float */
        ticksToSeconds(ticks) {
            return ticks * (this.TIME_PER_FRAME_MS / 1000);
        }
        /** calc the number ticks form game-time in seconds  */
        secondsToTicks(seconds) {
            return seconds * (1000 / this.TIME_PER_FRAME_MS);
        }
        /** return the maximum time in seconds to win the game  */
        getGameTimeLimit() {
            return this.ticksTimeLimit;
        }
    }
    Lemmings.GameTimer = GameTimer;

export { GameTimer };
