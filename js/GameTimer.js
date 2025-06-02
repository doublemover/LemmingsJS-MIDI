import { Lemmings } from './LemmingsNamespace.js';

class GameTimer {
    constructor(level) {
        this.TIME_PER_FRAME_MS = 60;
        this._speedFactor = 1;
        this._frameTime = this.TIME_PER_FRAME_MS;
        this._rafId = 0;
        this._lastTime = 0;
        this._lastGameSecond = 0;
        this.tickIndex = 0;
        this._loopBound = this._loop.bind(this);
        this.onGameTick = new Lemmings.EventHandler();
        this.eachGameSecond = new Lemmings.EventHandler();
        this.onBeforeGameTick = new Lemmings.EventHandler();
        this.ticksTimeLimit = this.secondsToTicks(level.timeLimit * 60);
        this._autoPaused = false;
        this._visHandler = () => {
            const hidden = document.visibilityState === 'hidden' || !document.hasFocus();
            if (hidden) {
                if (this.isRunning()) {
                    this._autoPaused = true;
                    this.suspend();
                }
            } else if (this._autoPaused) {
                this._autoPaused = false;
                this.continue();
            }
        };
        document.addEventListener('visibilitychange', this._visHandler, false);
        window.addEventListener('blur',  this._visHandler, false);
        window.addEventListener('focus', this._visHandler, false);
        this._updateFrameTime();
    }

    isRunning() { return this._rafId !== 0; }

    get speedFactor() { return this._speedFactor; }
    set speedFactor(value) {
        if (value <= 0) return;
        if (this._speedFactor === value) return;
        this._speedFactor = value;
        this._updateFrameTime();
        if (this.isRunning()) {
            this.suspend();
            this.continue();
        }
    }

    _updateFrameTime() {
        this._frameTime = this.TIME_PER_FRAME_MS / this._speedFactor;
    }

    toggle() {
        if (this.isRunning()) this.suspend();
        else this.continue();
    }

    continue() {
        if (this.isRunning()) return;
        this._lastTime = performance.now();
        this._rafId = window.requestAnimationFrame(this._loopBound);
    }

    suspend() {
        if (this._rafId) {
            window.cancelAnimationFrame(this._rafId);
            this._rafId = 0;
        }
    }

    _loop(now) {
        if (!this.isRunning()) return;
        window.cancelAnimationFrame(this._rafId);
        const gameSeconds = (this._lastTime / this.TIME_PER_FRAME_MS) | 0;
        if (gameSeconds > this._lastGameSecond) {
            if (this.eachGameSecond) {
                this._lastGameSecond = gameSeconds;
                this.eachGameSecond.trigger();
            }
        }
        let delta = now - this._lastTime;
        if (delta >= this._frameTime) {
            const steps = Math.floor(delta / this._frameTime);
            if (lemmings.bench == true) {
                this._benchSpeedAdjust(steps);
            }
            delta -= steps * this._frameTime;
            this._lastTime = now - delta;
            for (let i = 0; i < steps; ++i) {
                if (this.onBeforeGameTick) this.onBeforeGameTick.trigger(this.tickIndex);
                ++this.tickIndex;
                if (this.onGameTick) this.onGameTick.trigger();
            }
        }
        this._rafId = window.requestAnimationFrame(this._loopBound);
    }

    _benchSpeedAdjust(stepsMissed) {
        if (stepsMissed > 24) {
            window.cancelAnimationFrame(this._rafId);
            const sf = this._speedFactor;
            if (sf > 30) {
                this.speedFactor = 30;
            }
            else if (sf > 10) {
                this._speedFactor = 10;
            } 
            else if (sf <= 10 && sf > 1) {
                this._speedFactor = 1;
                this.suspend();
            }
            else if (sf <= 1 && sf > 0.5) {
                this._speedFactor = ((this.speedFactor*10)-2)/10;
                this.suspend();
            }
            this._updateFrameTime();
        }
    }

    stop() {
        this.suspend();
        document.removeEventListener('visibilitychange', this._visHandler, false);
        window.removeEventListener('blur', this._visHandler, false);
        window.removeEventListener('focus', this._visHandler, false);

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
