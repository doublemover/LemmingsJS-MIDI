import {
  CommandLemmingsAction,
  CommandNuke,
  CommandReleaseRateDecrease,
  CommandReleaseRateIncrease,
  CommandSelectSkill,
  GameVictoryCondition,
  GamepadInputController,
  KeybindingRegistry,
  LemmingStateType,
  SkillTypes,
  formatBindingSpec,
  getRuntimeDependency,
  parseKeybindingConfig
} from './KeyboardShortcutsShared.js';
const keyboardShortcutRuntimeMethods = {
  dispose() {
    if (this._raf) {
      this.cancelAnimationFrame?.(this._raf);
      this._raf = null;
    }
    this.gamepad?.dispose?.();
    this.gamepad = null;
    this.window?.removeEventListener?.('keydown', this._down);
    this.window?.removeEventListener?.('keyup', this._up);
  },

  _startLoop() {
    if (!this._raf && typeof this.requestAnimationFrame === 'function') {
      this._last = this.performance?.now?.() ?? Date.now();
      this._raf = this.requestAnimationFrame((t) => this._step(t));
    }
  },

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
      const shiftMul = this.mod.shift ? 2 : 1;
  
      // ----- panning -----
      // tweak distance per frame; previous values felt too large
      const baseX = 18 * scale;
      const baseY = 9 * scale;
      // smoother acceleration with immediate jump when direction changes
      const accel = 0.18 / scale * dt;
      const targetVX = (this.pan.right - this.pan.left) * baseX * shiftMul;
      const targetVY = (this.pan.down - this.pan.up)   * baseY * shiftMul;
      if (this.pan.changed) {
        this.pan.vx = targetVX;
        this.pan.vy = targetVY;
        this.pan.changed = false;
      } else {
        this.pan.vx += (targetVX - this.pan.vx) * accel;
        this.pan.vy += (targetVY - this.pan.vy) * accel;
      }
      // extend easing so velocity decays more gradually
      this.pan.vx *= 0.85;
      this.pan.vy *= 0.85;
      const dx = this.pan.vx;
      const dy = this.pan.vy;
      if (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05) {
        const nx = vp.x + dx / vp.scale;
        const ny = vp.y + dy / vp.scale;
        stage.applyViewport(img, nx, ny, stage._rawScale);
        stage.redraw();
        again = true;
      } else {
        this.pan.vx = this.pan.vy = 0;
      }
  
      // ----- zooming -----
      // anchor zooming around the current screen centre without
      // drifting the viewpoint. Using updateViewPoint() directly was
      // causing the camera to slide left as the scale changed.
      const { width: vpW, height: vpH } = img.canvasViewportSize;
      const cx = vpW / 2;
      const cy = vpH / 2;
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
        stage.applyViewport(img, nx, ny, stage._rawScale);
        stage.redraw();
        again = true;
      } else if (this.zoom.reset !== null) {
        stage.applyViewport(img, vp.x, vp.y, this.zoom.reset);
        this.zoom.reset = null;
        stage.redraw();
        this.zoom.v = 0;
      } else if (this.zoom.dir !== 0) {
        again = true;
      } else {
        this.zoom.v = 0;
      }
    }
    if (again) {
      if (typeof this.requestAnimationFrame === 'function') {
        this._raf = this.requestAnimationFrame((tt) => this._step(tt));
      } else {
        this._raf = null;
      }
    } else {
      this._raf = null;
    }
  },

  _cycleSkill(dir = 1) {
    if (this._isGameplayBlocked()) return;
    const game = this.view.game;
    if (!game) return;
    const skills = game.getGameSkills();
    let next = skills.getSelectedSkill() + dir;
    if (next > SkillTypes.DIGGER) next = SkillTypes.CLIMBER;
    if (next < SkillTypes.CLIMBER) next = SkillTypes.DIGGER;
    game.queueCommand(new CommandSelectSkill(next, false));
    game.gameGui.skillSelectionChanged = true;
  },

  _instantNuke() {
    if (this._isGameplayBlocked()) return;
    const mgr = this.view.game?.getLemmingManager?.();
    const lems = mgr?.getLemmings?.() ?? mgr?.lemmings;
    if (!lems) return;
    for (const lem of lems) {
      if (lem.removed) continue;
      if (lem.hasExploded) continue;
      if (lem.countdownAction) continue;
      if (lem.action === mgr.actions?.[LemmingStateType.EXPLODING]) continue;
      if (lem.action === mgr.actions?.[LemmingStateType.OHNO]) continue;
      mgr.setLemmingState(lem, LemmingStateType.EXPLODING);
    }
  },

  _changeSpeed(dir, isShift) {
    const game = this.view.game;
    if (!game) return;
    const timer = game.getGameTimer?.();
    const gui = game.gameGui;
    // Some lightweight test and embed flows do not wire a timer/gui yet.
    if (!timer) return;
    // Shift should noticeably speed things up
    const steps = isShift ? 5 : 1;
    for (let i=0;i<steps;i++) {
      if (dir > 0) {
        if (timer.speedFactor < 1) {
          timer.speedFactor = Math.round((timer.speedFactor + 0.1) * 100) / 100;
          gui?.drawSpeedChange?.(true);
        } else if (timer.speedFactor < 120) {
          timer.speedFactor += 1;
          gui?.drawSpeedChange?.(true);
        }
      } else {
        if (timer.speedFactor > 1) {
          timer.speedFactor -= 1;
          gui?.drawSpeedChange?.(false);
        } else if (timer.speedFactor > 0.1) {
          timer.speedFactor = Math.round((timer.speedFactor - 0.1) * 100) / 100;
          gui?.drawSpeedChange?.(false);
        }
      }
    }
    this.view.gameSpeedFactor = timer.speedFactor;
  },

  _isGameplayBlocked() {
    return !!this.view?.game?.timeTravel?.isReversing;
  },

  _shouldIgnoreKey(e, actions = []) {
    const target = e?.target;
    if (!target) return false;
    if (target.isContentEditable) return true;
    const tag = String(target.tagName || '').toUpperCase();
    if (tag === 'SELECT') {
      if (actions.includes('toggleReverse') ||
            actions.includes('stepBackward') ||
            actions.includes('stepForward')) {
        return false;
      }
      return true;
    }
    return tag === 'INPUT' || tag === 'TEXTAREA';
  },

  _loadKeybindings() {
    const provider = this.view?.gameFactory?.fileProvider;
    if (!provider?.loadString) return;
    provider.loadString('keybindings.json')
      .then((text) => {
        const parsed = parseKeybindingConfig(text);
        if (!parsed) return;
        this.keybindings.setConfig(parsed);
      })
      .catch(() => {});
  },

  getDisplayBindings(action) {
    const specs = this.keybindings.getBindingsForAction(action);
    return specs.map(spec => formatBindingSpec(spec)).filter(Boolean);
  },

  getGamepadDisplayBindings(action) {
    return this.gamepad?.getDisplayBindings(action) || [];
  },

  setGamepadBindings(config, options) {
    this.gamepad?.setConfig?.(config, options);
  }
};
export { keyboardShortcutRuntimeMethods };