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
    this.zoom = { dir:0,v:0,reset:null };
    this._raf = null;
    this._last = 0;
  }

  dispose() {
    if (this._raf) {
      window.cancelAnimationFrame(this._raf);
      this._raf = null;
    }
    window.removeEventListener('keydown', this._down);
    window.removeEventListener('keyup', this._up);
    if (this._raf !== null) {
      cancelAnimationFrame(this._raf);
      this._raf = null;
    }
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
      // hold shift to pan much further per frame
      const shiftMul = this.mod.shift ? 2.5 : 1;

      // ----- panning -----
      // tweak distance per frame; previous values felt too large
      const baseX = 25 * scale;
      const baseY = 12 * scale;
      // slow the acceleration a touch for smoother motion
      const accel = 0.05 / scale * dt;
      const targetVX = (this.pan.right - this.pan.left) * baseX * shiftMul;
      const targetVY = (this.pan.down - this.pan.up)   * baseY * shiftMul;
      this.pan.vx += (targetVX - this.pan.vx) * accel;
      this.pan.vy += (targetVY - this.pan.vy) * accel;
      // extend easing so velocity decays more gradually
      this.pan.vx *= 0.9;
      this.pan.vy *= 0.9;
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
      // anchor zooming around the current screen centre without
      // drifting the viewpoint. Using updateViewPoint() directly was
      // causing the camera to slide left as the scale changed.
      const cx = img.width / 2;
      const cy = img.height / 2;
      const centerX = vp.x + cx / vp.scale;
      const centerY = vp.y + cy / vp.scale;
      let targetZ = 0;
      if (this.zoom.reset !== null) {
        targetZ = (this.zoom.reset - vp.scale) * 0.2;
      } else {
        // smaller default zoom step; shift increases it only modestly
        const baseZ = 20 * (this.mod.shift ? 1.5 : 1);
        targetZ = this.zoom.dir * baseZ;
      }
      // gentler acceleration for zooming
      this.zoom.v += (targetZ - this.zoom.v) * 0.07 * dt;
      this.zoom.v *= 0.9;
      const dz = this.zoom.v;
      if (Math.abs(dz) > 0.001) {
        stage._rawScale = stage.limitValue(0.25, stage._rawScale * (1 + dz / 1500), 8);
        const newScale = stage.snapScale(stage._rawScale);
        const nx = centerX - cx / newScale;
        const ny = centerY - cy / newScale;
        const maxX = img.display.worldDataSize.width  - img.canvasViewportSize.width  / newScale;
        const maxY = img.display.worldDataSize.height - img.canvasViewportSize.height / newScale;
        vp.x = Math.min(Math.max(0, nx), maxX);
        vp.y = Math.min(Math.max(0, ny), maxY);
        vp.scale = newScale;
        stage.redraw();
        again = true;
      } else if (this.zoom.reset !== null) {
        stage._rawScale = this.zoom.reset;
        vp.scale = stage.snapScale(stage._rawScale);
        this.zoom.reset = null;
        stage.redraw();
        this.zoom.v = 0;
      } else {
        this.zoom.v = 0;
      }
    }
    if (again) {
      this._raf = requestAnimationFrame((tt) => this._step(tt));
    } else {
      this._raf = null;
    }
  }

  _cycleSkill(dir = 1) {
    const skills = this.view.game.getGameSkills();
    let next = skills.getSelectedSkill() + dir;
    if (next > Lemmings.SkillTypes.DIGGER) next = Lemmings.SkillTypes.CLIMBER;
    if (next < Lemmings.SkillTypes.CLIMBER) next = Lemmings.SkillTypes.DIGGER;
    this.view.game.queueCommand(new Lemmings.CommandSelectSkill(next, false));
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
    case 'BracketRight':
      if (!game.getGameTimer().isRunning()) this.view.nextFrame();
      break;
    case 'BracketLeft':
      if (!game.getGameTimer().isRunning()) this.view.prevFrame();
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
      this.zoom.dir = 1; this._startLoop();
      break;
    case 'KeyX':
      this.zoom.dir = -1; this._startLoop();
      break;
    case 'KeyV':
      this.zoom.reset = 2; this._startLoop();
      break;
    case 'Tab':
      this._cycleSkill(e.shiftKey ? -1 : 1);
      break;
    case 'KeyK': {
      const mgr = this.view.game.getLemmingManager?.();
      const lem = mgr?.getSelectedLemming?.();
      if (lem) this.view.game.queueCommand(new Lemmings.CommandLemmingsAction(lem.id));
      break; }
    case 'KeyN':
      // selection cleared via keyboard no longer supported
      break;
    case 'Backquote':
      // cycling lemming selection removed
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
        if (this.view.levelGroupIndex > 0) {
          this.view.selectLevelGroup(this.view.levelGroupIndex - 1);
        } else if (this.view.gameType > 1) {
          this.view.selectGameType(this.view.gameType - 1);
        }
      } else {
        this.view.moveToLevel(-1);
      }
      break;
    case 'Period':
      if (e.shiftKey) {
        const totalGroups = this.view.gameResources?.getLevelGroups().length || 0;
        if (this.view.levelGroupIndex + 1 < totalGroups) {
          this.view.selectLevelGroup(this.view.levelGroupIndex + 1);
        } else {
          this.view.selectGameType(this.view.gameType + 1);
        }
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
    case 'KeyZ': if (this.zoom.dir > 0) this.zoom.dir = 0; break;
    case 'KeyX': if (this.zoom.dir < 0) this.zoom.dir = 0; break;
    case 'ShiftLeft':
    case 'ShiftRight':
      this.mod.shift = false; break;
    }
    this._startLoop();
  }
}

Lemmings.KeyboardShortcuts = KeyboardShortcuts;
export { KeyboardShortcuts };
