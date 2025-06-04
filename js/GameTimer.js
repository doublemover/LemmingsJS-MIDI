import { Lemmings } from './LemmingsNamespace.js';

class GameTimer {
    #speedFactor;
    #frameTime;
    #rafId;
    #lastTime;
    #lastGameSecond;
    #tickIndex;
    #loopBound;
    #autoPaused;
    #normTickCount;
    #catchupSlow;
    #visHandler;

    constructor(level) {
        this.TIME_PER_FRAME_MS = 60;
        this.#speedFactor = 1;
        this.#frameTime = this.TIME_PER_FRAME_MS;
        this.#rafId = 0;
        this.#lastTime = 0;
        this.#lastGameSecond = 0;
        this.#tickIndex = 0;
        this.#loopBound = this.#loop.bind(this);
        this.onGameTick = new Lemmings.EventHandler();
        this.eachGameSecond = new Lemmings.EventHandler();
        this.onBeforeGameTick = new Lemmings.EventHandler();
        this.ticksTimeLimit = this.secondsToTicks(level.timeLimit * 60);
        this.#autoPaused = false;
        this.#normTickCount = 0;
        this.#catchupSlow = false;
        this.#visHandler = () => {
            const hidden = document.visibilityState === 'hidden' || !document.hasFocus();
            if (hidden) {
                if (this.isRunning()) {
                    this.#autoPaused = true;
                    this.suspend();
                }
            } else if (this.#autoPaused) {
                this.#autoPaused = false;
                this.continue();
            }
        };
        document.addEventListener('visibilitychange', this.#visHandler, false);
        window.addEventListener('blur',  this.#visHandler, false);
        window.addEventListener('focus', this.#visHandler, false);
        this.#updateFrameTime();
    }

    isRunning() { return this.#rafId !== 0; }

    get tickIndex() { return this.#tickIndex; }
    set tickIndex(v) {
        if (v >= Lemmings.COUNTER_LIMIT) {
            console.warn('tickIndex wrapped, resetting to 0');
            this.#tickIndex = 0;
        } else {
            this.#tickIndex = v;
        }
    }

    get normTickCount() { return this.#normTickCount; }
    set normTickCount(v) {
        if (v >= Lemmings.COUNTER_LIMIT) {
            console.warn('normTickCount wrapped, resetting to 0');
            this.normTickCount = 0;
        } else {
            this.#normTickCount = v;
        }
    }

    get speedFactor() { return this.#speedFactor; }
    set speedFactor(value) {
        if (value <= 0) return;
        if (this.#speedFactor === value) return;
        this.#speedFactor = value;
        this.#updateFrameTime();
        if (this.isRunning()) {
            this.suspend();
            this.continue();
        }
    }

    #updateFrameTime() {
        this.#frameTime = this.TIME_PER_FRAME_MS / this.#speedFactor;
    }

    toggle() {
        if (this.isRunning()) this.suspend();
        else this.continue();
    }

    continue() {
        if (this.isRunning()) return;
        this.#lastTime = performance.now();
        this.#rafId = window.requestAnimationFrame(this.#loopBound);
    }

    suspend() {
        if (this.#rafId) {
            window.cancelAnimationFrame(this.#rafId);
            this.#rafId = 0;
        }
    }

    #loop(now) {
        if (!this.isRunning()) return;
        window.cancelAnimationFrame(this.#rafId);
        this.#rafId = 0;
        const gameSeconds = Math.floor(this.#lastTime / this.TIME_PER_FRAME_MS);
        if (gameSeconds > this.#lastGameSecond) {
            if (this.eachGameSecond) {
                this.#lastGameSecond = gameSeconds;
                this.eachGameSecond.trigger();
            }
        }
        let delta = now - this.#lastTime;
        if (delta >= this.#frameTime) {
            const steps = Math.floor(delta / this.#frameTime);
            if (lemmings.bench == true) {
                this.#benchSpeedAdjust(steps);
            } else if (steps > 1) {
                this.#catchupSpeedAdjust(steps);
            } else if (this.#catchupSlow) {
                this.#restoreSpeed();
            }
            delta -= steps * this.#frameTime;
            this.#lastTime = now - delta;
            for (let i = 0; i < steps; ++i) {
                if (this.onBeforeGameTick) this.onBeforeGameTick.trigger(this.tickIndex);
                ++this.tickIndex;
                if (this.onGameTick) this.onGameTick.trigger();
            }
        }
        this.#rafId = window.requestAnimationFrame(this.#loopBound);
    }

    #benchSpeedAdjust(steps) {
        lemmings.steps = steps;
        if (steps > 100) {
            this.suspend();
            this.normTickCount = 0;
            this.#speedFactor = 1;

            if (this.#speedFactor >= 1) {
                this.#speedFactor = 0.1;
            }
        }
        else if (steps > 16) {
            this.suspend();
            this.normTickCount = 0;
            const sf = this.#speedFactor;
            if (sf > 60) {
                this.#speedFactor = 60
            }
            else if (sf > 40) {
                this.#speedFactor -= 10;
            }
            else if (sf > 10) {
                this.#speedFactor -= 9;
            }
            else if (sf <= 10 && sf > 1) {
                this.#speedFactor -= 1;
            }
            else if (sf <= 1 && sf > 0.2) {
                this.#speedFactor = ((this.#speedFactor*10)-1)/10;;
            }
        }
        if (steps > 4) {
            this.normTickCount = this.normTickCount - 32;
        }

        if (steps <= 2) {
            this.normTickCount = this.normTickCount + 1;
        }

        if (this.normTickCount > 32 && this.#speedFactor < 60) {
            this.normTickCount = 0;
            this.#speedFactor += 1;
        }
        if (this.normTickCount > 2 && this.#speedFactor < 1) {
            this.normTickCount = 0;
            this.#speedFactor = ((this.#speedFactor*10)+1)/10;
        }
        this.#updateFrameTime();
    }

    #catchupSpeedAdjust(steps) {
        const newFactor = Math.max(0.1, 1 / steps);
        if (newFactor < this.#speedFactor) {
            console.log(`catchup: ${steps} steps, speed ${newFactor}`);
            this.#speedFactor = newFactor;
            this.#updateFrameTime();
            this.#catchupSlow = true;
        }
    }

    #restoreSpeed() {
        if (this.#catchupSlow) {
            this.#catchupSlow = false;
            this.speedFactor = 1;
        }
    }

    stop() {
        this.suspend();
        document.removeEventListener('visibilitychange', this.#visHandler, false);
        window.removeEventListener('blur', this.#visHandler, false);
        window.removeEventListener('focus', this.#visHandler, false);

        // Dispose all event handlers to prevent leaks across level reloads
        if (this.onBeforeGameTick && this.onBeforeGameTick.dispose)
            this.onBeforeGameTick.dispose();
        if (this.onGameTick && this.onGameTick.dispose)
            this.onGameTick.dispose();
        if (this.eachGameSecond && this.eachGameSecond.dispose)
            this.eachGameSecond.dispose();
    }

    getGameTime() { return this.ticksToSeconds(this.tickIndex); }
    getGameTicks() { return this.tickIndex; }
    getGameLeftTime() {
        let left = this.ticksTimeLimit - this.tickIndex;
        if (left < 0) left = 0;
        return Math.floor(this.ticksToSeconds(left));
    }
    getGameLeftTimeString() {
        const secs = this.getGameLeftTime();
        return Math.floor(secs / 60) + '-' + ('0' + (secs % 60)).slice(-2);
    }
    ticksToSeconds(t) {
            if (lemmings.endless == true) {
            return 42069 * (this.TIME_PER_FRAME_MS / 1000);
        }  
        return t * (this.TIME_PER_FRAME_MS / 1000); 
    }
    secondsToTicks(s) { return s * (1000 / this.TIME_PER_FRAME_MS); }
}
Lemmings.GameTimer = GameTimer;
export { GameTimer };
