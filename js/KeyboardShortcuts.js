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
        stage.updateViewPoint(img, cx, cy, delta, zx, zy);
    }

    _pan(dirX, dirY) {
        const stage = this.view.stage;
        if (!stage) return;
        const vp = stage.gameImgProps.viewPoint;
        const xStep = 20 * vp.scale * vp.scale;
        const yStep = 10 * vp.scale * vp.scale;
        stage.updateViewPoint(stage.gameImgProps, dirX * xStep, dirY * yStep, 0);
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
        switch (e.key) {
            case '1':
                if (e.shiftKey) {
                    const diff = vc.getCurrentReleaseRate() - vc.getMinReleaseRate();
                    if (diff > 0) game.queueCommand(new Lemmings.CommandReleaseRateDecrease(diff));
                } else {
                    game.queueCommand(new Lemmings.CommandReleaseRateDecrease(1));
                }
                gui.releaseRateChanged = true;
                break;
            case '2':
                if (e.shiftKey) {
                    const max = vc.getMaxReleaseRate?.() ?? Lemmings.GameVictoryCondition.maxReleaseRate;
                    const diff = max - vc.getCurrentReleaseRate();
                    if (diff > 0) game.queueCommand(new Lemmings.CommandReleaseRateIncrease(diff));
                } else {
                    game.queueCommand(new Lemmings.CommandReleaseRateIncrease(1));
                }
                gui.releaseRateChanged = true;
                break;
            case '3':
                game.queueCommand(new Lemmings.CommandSelectSkill(Lemmings.SkillTypes.CLIMBER));
                gui.skillSelectionChanged = true;
                break;
            case '4':
                game.queueCommand(new Lemmings.CommandSelectSkill(Lemmings.SkillTypes.FLOATER));
                gui.skillSelectionChanged = true;
                break;
            case '5':
                game.queueCommand(new Lemmings.CommandSelectSkill(Lemmings.SkillTypes.BOMBER));
                gui.skillSelectionChanged = true;
                break;
            case '6':
                game.queueCommand(new Lemmings.CommandSelectSkill(Lemmings.SkillTypes.BLOCKER));
                gui.skillSelectionChanged = true;
                break;
            case 'q':
            case 'Q':
                game.queueCommand(new Lemmings.CommandSelectSkill(Lemmings.SkillTypes.BUILDER));
                gui.skillSelectionChanged = true;
                break;
            case 'w':
            case 'W':
                game.queueCommand(new Lemmings.CommandSelectSkill(Lemmings.SkillTypes.BASHER));
                gui.skillSelectionChanged = true;
                break;
            case 'e':
            case 'E':
                game.queueCommand(new Lemmings.CommandSelectSkill(Lemmings.SkillTypes.MINER));
                gui.skillSelectionChanged = true;
                break;
            case 'r':
            case 'R':
                game.queueCommand(new Lemmings.CommandSelectSkill(Lemmings.SkillTypes.DIGGER));
                gui.skillSelectionChanged = true;
                break;
            case ' ':
                timer.toggle();
                gui.skillSelectionChanged = true;
                break;
            case 't':
            case 'T':
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
            case 'z':
            case 'Z':
                this._zoom(100);
                break;
            case 'x':
            case 'X':
                this._zoom(-100);
                break;
            case 'v':
            case 'V':
                if (this.view.stage) {
                    const vp = this.view.stage.gameImgProps.viewPoint;
                    vp.scale = 2;
                    this.view.stage.redraw();
                }
                break;
            case 'Tab':
                this._cycleSkill();
                break;
            case '\\':
                game.showDebug = !game.showDebug;
                break;
            case '-':
                if (timer.speedFactor > 1) {
                    timer.speedFactor -= 1;
                    gui.drawSpeedChange(false);
                } else if (timer.speedFactor > 0.1) {
                    timer.speedFactor = Math.round((timer.speedFactor - 0.1) * 100) / 100;
                    gui.drawSpeedChange(false);
                }
                break;
            case '=':
            case '+':
                if (timer.speedFactor < 1) {
                    timer.speedFactor = Math.round((timer.speedFactor + 0.1) * 100) / 100;
                    gui.drawSpeedChange(true);
                } else if (timer.speedFactor < 120) {
                    timer.speedFactor += 1;
                    gui.drawSpeedChange(true);
                }
                break;
            case ',':
                this.view.moveToLevel(-1);
                break;
            case '.':
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
