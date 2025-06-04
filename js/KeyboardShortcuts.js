import { Lemmings } from './LemmingsNamespace.js';

class KeyboardShortcuts {
    constructor(view) {
        this.view = view;
        this._bound = this._onKeyDown.bind(this);
        window.addEventListener('keydown', this._bound);
    }

    dispose() {
        window.removeEventListener('keydown', this._bound);
    }

    _zoom(delta) {
        const stage = this.view.stage;
        if (!stage) return;
        const img = stage.gameImgProps;
        const cx = img.width / 2;
        const cy = img.height / 2;
        const zx = img.viewPoint.getSceneX(cx);
        const zy = img.viewPoint.getSceneY(cy);
        const steps = 10;
        const dz = delta / steps;
        let done = 0;
        const step = () => {
            stage.updateViewPoint(img, cx, cy, dz, zx, zy);
            if (++done < steps) {
                requestAnimationFrame(step);
            } else {
                stage.redraw();
            }
        };
        requestAnimationFrame(step);
    }

    _pan(dirX, dirY) {
        const stage = this.view.stage;
        if (!stage) return;
        const vp = stage.gameImgProps.viewPoint;
        const xStep = 20 * vp.scale * vp.scale * dirX;
        const yStep = 10 * vp.scale * vp.scale * dirY;
        const steps = 10;
        const dx = xStep / steps;
        const dy = yStep / steps;
        let done = 0;
        const step = () => {
            stage.updateViewPoint(stage.gameImgProps, dx, dy, 0);
            if (++done < steps) {
                requestAnimationFrame(step);
            } else {
                stage.redraw();
            }
        };
        requestAnimationFrame(step);
    }

    _cycleSkill() {
        const skills = this.view.game.getGameSkills();
        let next = skills.getSelectedSkill() + 1;
        if (next > Lemmings.SkillTypes.DIGGER) {
            next = Lemmings.SkillTypes.CLIMBER;
        }
        this.view.game.queueCommand(new Lemmings.CommandSelectSkill(next));
        this.view.game.gameGui.skillSelectionChanged = true;
    }

    _onKeyDown(e) {
        const game = this.view.game;
        if (!game) return;
        const timer = game.getGameTimer();
        const vc    = game.getVictoryCondition();
        const gui   = game.gameGui;
        let handled = true;
        switch (e.code) {
            case 'Digit1':
                if (e.shiftKey) {
                    const diff = vc.getCurrentReleaseRate() - vc.getMinReleaseRate();
                    if (diff > 0) game.queueCommand(new Lemmings.CommandReleaseRateDecrease(diff));
                } else {
                    game.queueCommand(new Lemmings.CommandReleaseRateDecrease(1));
                }
                gui.releaseRateChanged = true;
                break;
            case 'Digit2':
                if (e.shiftKey) {
                    const max = vc.getMaxReleaseRate?.() ?? Lemmings.GameVictoryCondition.maxReleaseRate;
                    const diff = max - vc.getCurrentReleaseRate();
                    if (diff > 0) game.queueCommand(new Lemmings.CommandReleaseRateIncrease(diff));
                } else {
                    game.queueCommand(new Lemmings.CommandReleaseRateIncrease(1));
                }
                gui.releaseRateChanged = true;
                break;
            case 'Digit3':
                game.queueCommand(new Lemmings.CommandSelectSkill(Lemmings.SkillTypes.CLIMBER));
                gui.skillSelectionChanged = true;
                break;
            case 'Digit4':
                game.queueCommand(new Lemmings.CommandSelectSkill(Lemmings.SkillTypes.FLOATER));
                gui.skillSelectionChanged = true;
                break;
            case 'Digit5':
                game.queueCommand(new Lemmings.CommandSelectSkill(Lemmings.SkillTypes.BOMBER));
                gui.skillSelectionChanged = true;
                break;
            case 'Digit6':
                game.queueCommand(new Lemmings.CommandSelectSkill(Lemmings.SkillTypes.BLOCKER));
                gui.skillSelectionChanged = true;
                break;
            case 'KeyQ':
                game.queueCommand(new Lemmings.CommandSelectSkill(Lemmings.SkillTypes.BUILDER));
                gui.skillSelectionChanged = true;
                break;
            case 'KeyW':
                game.queueCommand(new Lemmings.CommandSelectSkill(Lemmings.SkillTypes.BASHER));
                gui.skillSelectionChanged = true;
                break;
            case 'KeyE':
                game.queueCommand(new Lemmings.CommandSelectSkill(Lemmings.SkillTypes.MINER));
                gui.skillSelectionChanged = true;
                break;
            case 'KeyR':
                game.queueCommand(new Lemmings.CommandSelectSkill(Lemmings.SkillTypes.DIGGER));
                gui.skillSelectionChanged = true;
                break;
            case 'Space':
                timer.toggle();
                gui.skillSelectionChanged = true;
                break;
            case 'KeyT':
                game.queueCommand(new Lemmings.CommandNuke());
                break;
            case 'Backspace':
                this.view.moveToLevel(0);
                break;
            case 'ArrowLeft':
                this._pan(-1, 0);
                break;
            case 'ArrowRight':
                this._pan(1, 0);
                break;
            case 'ArrowUp':
                this._pan(0, -1);
                break;
            case 'ArrowDown':
                this._pan(0, 1);
                break;
            case 'KeyZ':
                this._zoom(100);
                break;
            case 'KeyX':
                this._zoom(-100);
                break;
            case 'KeyV':
                if (this.view.stage) {
                    const vp = this.view.stage.gameImgProps.viewPoint;
                    vp.scale = 2;
                    this.view.stage.redraw();
                }
                break;
            case 'Tab':
                this._cycleSkill();
                break;
            case 'Backslash':
                game.showDebug = !game.showDebug;
                break;
            case 'Minus':
            case 'NumpadSubtract':
                if (timer.speedFactor > 1) {
                    timer.speedFactor -= 1;
                    gui.drawSpeedChange(false);
                } else if (timer.speedFactor > 0.1) {
                    timer.speedFactor = Math.round((timer.speedFactor - 0.1) * 100) / 100;
                    gui.drawSpeedChange(false);
                }
                break;
            case 'Equal':
            case 'NumpadAdd':
                if (timer.speedFactor < 1) {
                    timer.speedFactor = Math.round((timer.speedFactor + 0.1) * 100) / 100;
                    gui.drawSpeedChange(true);
                } else if (timer.speedFactor < 120) {
                    timer.speedFactor += 1;
                    gui.drawSpeedChange(true);
                }
                break;
            case 'Comma':
                this.view.moveToLevel(-1);
                break;
            case 'Period':
                this.view.moveToLevel(1);
                break;
            default:
                handled = false;
        }
        if (handled) {
            e.preventDefault();
        }
    }
}

Lemmings.KeyboardShortcuts = KeyboardShortcuts;
export { KeyboardShortcuts };
