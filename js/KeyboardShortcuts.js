import { Lemmings } from './LemmingsNamespace.js';

class KeyboardShortcuts {
    constructor(view) {
        this.view = view;
        this._down = this._onKeyDown.bind(this);
        this._up = this._onKeyUp.bind(this);
        window.addEventListener('keydown', this._down);
        window.addEventListener('keyup', this._up);
        this.mod = { shift:false };
        this.pan = { left:false,right:false,up:false,down:false,vx:0,vy:0 };
        this.zoom = { anim:null };
        this._raf = null;
        this._last = 0;
    }

    dispose() {
        window.removeEventListener('keydown', this._down);
        window.removeEventListener('keyup', this._up);
    }

    _startLoop() {
        if (!this._raf) {
            this._last = performance.now();
            this._raf = requestAnimationFrame((t) => this._step(t));
        }
    }

    _step(t) {
        const stage = this.view.stage;
        let again = false;
        const dt = Math.min(60, t - this._last) / 16.666;
        this._last = t;
        if (stage) {
            const img = stage.gameImgProps;
            const vp = img.viewPoint;
            const scale = vp.scale;
            // hold shift to pan slightly further per frame
            const shiftMul = this.mod.shift ? 1.5 : 1;

            // ----- panning -----
            // tweak distance per frame; previous values felt too large
            const baseX = 25 * scale;
            const baseY = 12 * scale;
            const accelBase = this.mod.shift ? 0.15 : 0.05;
            const accel = accelBase / scale * dt;
            const targetVX = (this.pan.right - this.pan.left) * baseX * shiftMul;
            const targetVY = (this.pan.down - this.pan.up)   * baseY * shiftMul;
            this.pan.vx += (targetVX - this.pan.vx) * accel;
            this.pan.vy += (targetVY - this.pan.vy) * accel;
            // extend easing so velocity decays more gradually
            const damp = this.mod.shift ? 0.94 : 0.9;
            this.pan.vx *= damp;
            this.pan.vy *= damp;
            const dx = this.pan.vx;
            const dy = this.pan.vy;
            if (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05) {
                stage.updateViewPoint(img, dx, dy, 0);
                stage.redraw();
                again = true;
            } else {
                this.pan.vx = this.pan.vy = 0;
            }

            // ----- zooming -----
            if (this.zoom.anim) {
                const a = this.zoom.anim;
                const p = Math.min(1, (t - a.startTime) / a.duration);
                const ease = 1 - Math.pow(1 - p, 3); // cubic out
                const raw = a.startScale + (a.targetScale - a.startScale) * ease;
                stage._applyZoom(raw, a.worldX, a.worldY, a.screenX, a.screenY, p >= 1);
                again = true;
                if (p >= 1) this.zoom.anim = null;
            }
        }
        if (again) {
            this._raf = requestAnimationFrame((tt) => this._step(tt));
        } else {
            this._raf = null;
        }
    }

    _cycleSkill() {
        const skills = this.view.game.getGameSkills();
        let next = skills.getSelectedSkill() + 1;
        if (next > Lemmings.SkillTypes.DIGGER) next = Lemmings.SkillTypes.CLIMBER;
        this.view.game.queueCommand(new Lemmings.CommandSelectSkill(next));
        this.view.game.gameGui.skillSelectionChanged = true;
    }

    _instantNuke() {
        const mgr = this.view.game.getLemmingManager?.();
        if (!mgr || !mgr.lemmings) return;
        for (const lem of mgr.lemmings) {
            mgr.setLemmingState(lem, Lemmings.LemmingStateType.EXPLODING);
        }
    }

    _changeSpeed(dir, isShift) {
        const timer = this.view.game.getGameTimer();
        const gui = this.view.game.gameGui;
        // Shift should noticeably speed things up
        const steps = isShift ? 5 : 1;
        for (let i=0;i<steps;i++) {
            if (dir > 0) {
                if (timer.speedFactor < 1) {
                    timer.speedFactor = Math.round((timer.speedFactor + 0.1) * 100) / 100;
                    gui.drawSpeedChange(true);
                } else if (timer.speedFactor < 120) {
                    timer.speedFactor += 1;
                    gui.drawSpeedChange(true);
                }
            } else {
                if (timer.speedFactor > 1) {
                    timer.speedFactor -= 1;
                    gui.drawSpeedChange(false);
                } else if (timer.speedFactor > 0.1) {
                    timer.speedFactor = Math.round((timer.speedFactor - 0.1) * 100) / 100;
                    gui.drawSpeedChange(false);
                }
            }
        }
    }

    _startZoomTo(scale) {
        const stage = this.view.stage;
        if (!stage) return;
        const img = stage.gameImgProps;
        const vp = img.viewPoint;
        const cx = img.display.getWidth()  / 2;
        const cy = img.display.getHeight() / 2;
        const target = stage.limitValue(0.25, scale, 4);
        if (Math.abs(target - stage._rawScale) < 0.001) return;

        const now = performance.now();
        if (this.zoom.anim) {
            const a = this.zoom.anim;
            const p = Math.min(1, (now - a.startTime) / a.duration);
            const ease = 1 - Math.pow(1 - p, 3);
            const raw = a.startScale + (a.targetScale - a.startScale) * ease;
            stage._applyZoom(raw, a.worldX, a.worldY, a.screenX, a.screenY);
            this.zoom.anim = {
                startScale: raw,
                targetScale: target,
                worldX: vp.x + cx / vp.scale,
                worldY: vp.y + cy / vp.scale,
                screenX: cx,
                screenY: cy,
                startTime: now,
                duration: a.duration
            };
        } else {
            this.zoom.anim = {
                startScale: stage._rawScale,
                targetScale: target,
                worldX: vp.x + cx / vp.scale,
                worldY: vp.y + cy / vp.scale,
                screenX: cx,
                screenY: cy,
                startTime: now,
                duration: 200
            };
        }
        this._startLoop();
    }

    _zoomStep(dir) {
        const stage = this.view.stage;
        if (!stage) return;
        const step = this.mod.shift ? 0.5 : 0.25;
        const target = stage._rawScale + dir * step;
        this._startZoomTo(target);
    }

    _onKeyDown(e) {
        const game = this.view.game;
        if (!game || e.ctrlKey || e.metaKey) return;
        let handled = true;
        switch (e.code) {
            case 'Digit1':
                if (e.shiftKey) {
                    const diff = game.getVictoryCondition().getCurrentReleaseRate() - game.getVictoryCondition().getMinReleaseRate();
                    if (diff > 0) game.queueCommand(new Lemmings.CommandReleaseRateDecrease(diff));
                } else {
                    game.queueCommand(new Lemmings.CommandReleaseRateDecrease(1));
                }
                game.gameGui.releaseRateChanged = true;
                break;
            case 'Digit2':
                if (e.shiftKey) {
                    const vc = game.getVictoryCondition();
                    const max = vc.getMaxReleaseRate?.() ?? Lemmings.GameVictoryCondition.maxReleaseRate;
                    const diff = max - vc.getCurrentReleaseRate();
                    if (diff > 0) game.queueCommand(new Lemmings.CommandReleaseRateIncrease(diff));
                } else {
                    game.queueCommand(new Lemmings.CommandReleaseRateIncrease(1));
                }
                game.gameGui.releaseRateChanged = true;
                break;
            case 'Digit3':
                game.queueCommand(new Lemmings.CommandSelectSkill(Lemmings.SkillTypes.CLIMBER));
                game.gameGui.skillSelectionChanged = true;
                break;
            case 'Digit4':
                game.queueCommand(new Lemmings.CommandSelectSkill(Lemmings.SkillTypes.FLOATER));
                game.gameGui.skillSelectionChanged = true;
                break;
            case 'Digit5':
                game.queueCommand(new Lemmings.CommandSelectSkill(Lemmings.SkillTypes.BOMBER));
                game.gameGui.skillSelectionChanged = true;
                break;
            case 'Digit6':
                game.queueCommand(new Lemmings.CommandSelectSkill(Lemmings.SkillTypes.BLOCKER));
                game.gameGui.skillSelectionChanged = true;
                break;
            case 'KeyQ':
                game.queueCommand(new Lemmings.CommandSelectSkill(Lemmings.SkillTypes.BUILDER));
                game.gameGui.skillSelectionChanged = true;
                break;
            case 'KeyW':
                game.queueCommand(new Lemmings.CommandSelectSkill(Lemmings.SkillTypes.BASHER));
                game.gameGui.skillSelectionChanged = true;
                break;
            case 'KeyE':
                game.queueCommand(new Lemmings.CommandSelectSkill(Lemmings.SkillTypes.MINER));
                game.gameGui.skillSelectionChanged = true;
                break;
            case 'KeyR':
                game.queueCommand(new Lemmings.CommandSelectSkill(Lemmings.SkillTypes.DIGGER));
                game.gameGui.skillSelectionChanged = true;
                break;
            case 'Space':
                game.getGameTimer().toggle();
                game.gameGui.skillSelectionChanged = true;
                break;
            case 'KeyT':
                if (e.shiftKey) this._instantNuke();
                else game.queueCommand(new Lemmings.CommandNuke());
                break;
            case 'Backspace':
                this.view.moveToLevel(0);
                break;
            case 'ArrowLeft':
                if (this.pan.vx > 0) this.pan.vx = 0;
                this.pan.left = true; this._startLoop();
                break;
            case 'ArrowRight':
                if (this.pan.vx < 0) this.pan.vx = 0;
                this.pan.right = true; this._startLoop();
                break;
            case 'ArrowUp':
                if (this.pan.vy > 0) this.pan.vy = 0;
                this.pan.up = true; this._startLoop();
                break;
            case 'ArrowDown':
                if (this.pan.vy < 0) this.pan.vy = 0;
                this.pan.down = true; this._startLoop();
                break;
            case 'KeyZ':
                if (!e.repeat) this._zoomStep(1);
                break;
            case 'KeyX':
                if (!e.repeat) this._zoomStep(-1);
                break;
            case 'KeyV':
                if (!e.repeat) this._startZoomTo(2);
                break;
            case 'Tab':
                this._cycleSkill();
                break;
            case 'Backslash':
                game.showDebug = !game.showDebug;
                break;
            case 'Minus':
            case 'NumpadSubtract':
                this._changeSpeed(-1, e.shiftKey);
                break;
            case 'Equal':
            case 'NumpadAdd':
                this._changeSpeed(1, e.shiftKey);
                break;
            case 'Comma':
                if (e.shiftKey) {
                    if (this.view.levelGroupIndex > 0) this.view.selectLevelGroup(this.view.levelGroupIndex - 1);
                } else {
                    this.view.moveToLevel(-1);
                }
                break;
            case 'Period':
                if (e.shiftKey) {
                    this.view.selectLevelGroup(this.view.levelGroupIndex + 1);
                } else {
                    this.view.moveToLevel(1);
                }
                break;
            case 'ShiftLeft':
            case 'ShiftRight':
                this.mod.shift = true; this._startLoop();
                handled = false; // allow others maybe
                break;
            default:
                handled = false;
        }
        if (handled) e.preventDefault();
    }

    _onKeyUp(e) {
        switch (e.code) {
            case 'ArrowLeft': this.pan.left = false; break;
            case 'ArrowRight': this.pan.right = false; break;
            case 'ArrowUp': this.pan.up = false; break;
            case 'ArrowDown': this.pan.down = false; break;
            case 'ShiftLeft':
            case 'ShiftRight':
                this.mod.shift = false; break;
        }
        this._startLoop();
    }
}

Lemmings.KeyboardShortcuts = KeyboardShortcuts;
export { KeyboardShortcuts };
