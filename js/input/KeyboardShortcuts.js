import { CommandLemmingsAction } from '../commands/CommandLemmingsAction.js';
import { CommandNuke } from '../commands/CommandNuke.js';
import { CommandReleaseRateDecrease } from '../commands/CommandReleaseRateDecrease.js';
import { CommandReleaseRateIncrease } from '../commands/CommandReleaseRateIncrease.js';
import { CommandSelectSkill } from '../commands/CommandSelectSkill.js';
import { GameVictoryCondition } from '../game/GameVictoryCondition.js';
import { LemmingStateType } from '../lemmings/LemmingStateType.js';
import { SkillTypes } from '../game/SkillTypes.js';
import { KeybindingRegistry, parseKeybindingConfig } from './KeybindingRegistry.js';

class KeyboardShortcuts {
  constructor(view) {
    this.view = view;
    this._down = this._onKeyDown.bind(this);
    this._up = this._onKeyUp.bind(this);
    window.addEventListener('keydown', this._down);
    window.addEventListener('keyup', this._up);
    this.mod = { shift:false };
    this.pan = { left:false,right:false,up:false,down:false,vx:0,vy:0,changed:false };
    this.zoom = { dir:0,v:0,reset:null };
    this.keybindings = new KeybindingRegistry();
    this._actions = this._createActionHandlers();
    this._raf = null;
    this._last = 0;
    this._loadKeybindings();
  }

  dispose() {
    if (this._raf) {
      window.cancelAnimationFrame(this._raf);
      this._raf = null;
    }
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
      // hold shift to pan much further per frame
      const shiftMul = this.mod.shift ? 2.5 : 1;

      // ----- panning -----
      // tweak distance per frame; previous values felt too large
      const baseX = 25 * scale;
      const baseY = 12 * scale;
      // faster acceleration with immediate jump when direction changes
      const accel = 0.25 / scale * dt;
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
      this.pan.vx *= 0.9;
      this.pan.vy *= 0.9;
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
    if (this._isGameplayBlocked()) return;
    const game = this.view.game;
    if (!game) return;
    const skills = game.getGameSkills();
    let next = skills.getSelectedSkill() + dir;
    if (next > SkillTypes.DIGGER) next = SkillTypes.CLIMBER;
    if (next < SkillTypes.CLIMBER) next = SkillTypes.DIGGER;
    game.queueCommand(new CommandSelectSkill(next, false));
    game.gameGui.skillSelectionChanged = true;
  }

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
  }

  _changeSpeed(dir, isShift) {
    const game = this.view.game;
    if (!game) return;
    const timer = game.getGameTimer();
    const gui = game.gameGui;
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
    this.view.gameSpeedFactor = timer.speedFactor;
  }

  _isGameplayBlocked() {
    return !!this.view?.game?.timeTravel?.isReversing;
  }

  _shouldIgnoreKey(e) {
    const target = e?.target;
    if (!target) return false;
    if (target.isContentEditable) return true;
    const tag = String(target.tagName || '').toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

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
  }

  _createActionHandlers() {
    return {
      releaseRateDown: { down: () => {
        if (this._isGameplayBlocked()) return;
        const game = this.view.game;
        if (!game) return;
        game.queueCommand(new CommandReleaseRateDecrease(1));
        game.gameGui.releaseRateChanged = true;
      }},
      releaseRateDownMax: { down: () => {
        if (this._isGameplayBlocked()) return;
        const game = this.view.game;
        if (!game) return;
        const vc = game.getVictoryCondition();
        const diff = vc.getCurrentReleaseRate() - vc.getMinReleaseRate();
        if (diff > 0) game.queueCommand(new CommandReleaseRateDecrease(diff));
        game.gameGui.releaseRateChanged = true;
      }},
      releaseRateUp: { down: () => {
        if (this._isGameplayBlocked()) return;
        const game = this.view.game;
        if (!game) return;
        game.queueCommand(new CommandReleaseRateIncrease(1));
        game.gameGui.releaseRateChanged = true;
      }},
      releaseRateUpMax: { down: () => {
        if (this._isGameplayBlocked()) return;
        const game = this.view.game;
        if (!game) return;
        const vc = game.getVictoryCondition();
        const max = vc.getMaxReleaseRate?.() ?? GameVictoryCondition.maxReleaseRate;
        const diff = max - vc.getCurrentReleaseRate();
        if (diff > 0) game.queueCommand(new CommandReleaseRateIncrease(diff));
        game.gameGui.releaseRateChanged = true;
      }},
      selectSkillClimber: { down: () => this._selectSkill(SkillTypes.CLIMBER) },
      selectSkillFloater: { down: () => this._selectSkill(SkillTypes.FLOATER) },
      selectSkillBomber: { down: () => this._selectSkill(SkillTypes.BOMBER) },
      selectSkillBlocker: { down: () => this._selectSkill(SkillTypes.BLOCKER) },
      selectSkillBuilder: { down: () => this._selectSkill(SkillTypes.BUILDER) },
      selectSkillBasher: { down: () => this._selectSkill(SkillTypes.BASHER) },
      selectSkillMiner: { down: () => this._selectSkill(SkillTypes.MINER) },
      selectSkillDigger: { down: () => this._selectSkill(SkillTypes.DIGGER) },
      togglePause: { down: () => {
        const game = this.view.game;
        if (!game) return;
        if (game.timeTravel?.isReversing) {
          game.timeTravel.stopReverse();
          game.gameGui.skillSelectionChanged = true;
          return;
        }
        game.getGameTimer().toggle();
        game.gameGui.skillSelectionChanged = true;
      }},
      stepForward: { down: () => {
        const timer = this.view.game?.getGameTimer?.();
        if (!timer || timer.isRunning()) return;
        this.view.nextFrame();
      }},
      stepBackward: { down: () => {
        const timer = this.view.game?.getGameTimer?.();
        if (!timer || timer.isRunning()) return;
        this.view.prevFrame();
      }},
      toggleReverse: { down: () => {
        const game = this.view.game;
        if (!game?.timeTravel) return;
        game.timeTravel.toggleReverse();
        if (game.gameGui) game.gameGui.gameTimeChanged = true;
      }},
      nuke: { down: () => {
        if (this._isGameplayBlocked()) return;
        const game = this.view.game;
        if (!game) return;
        game.queueCommand(new CommandNuke());
      }},
      nukeInstant: { down: () => this._instantNuke() },
      restartLevel: { down: () => this.view.moveToLevel(0) },
      panLeft: {
        down: () => {
          if (this.pan.vx > 0) this.pan.vx = 0;
          this.pan.left = true;
          this.pan.changed = true;
          this._startLoop();
        },
        up: () => {
          this.pan.left = false;
          this.pan.changed = true;
          this._startLoop();
        }
      },
      panRight: {
        down: () => {
          if (this.pan.vx < 0) this.pan.vx = 0;
          this.pan.right = true;
          this.pan.changed = true;
          this._startLoop();
        },
        up: () => {
          this.pan.right = false;
          this.pan.changed = true;
          this._startLoop();
        }
      },
      panUp: {
        down: () => {
          if (this.pan.vy > 0) this.pan.vy = 0;
          this.pan.up = true;
          this.pan.changed = true;
          this._startLoop();
        },
        up: () => {
          this.pan.up = false;
          this.pan.changed = true;
          this._startLoop();
        }
      },
      panDown: {
        down: () => {
          if (this.pan.vy < 0) this.pan.vy = 0;
          this.pan.down = true;
          this.pan.changed = true;
          this._startLoop();
        },
        up: () => {
          this.pan.down = false;
          this.pan.changed = true;
          this._startLoop();
        }
      },
      panBoost: {
        preventDefault: false,
        down: () => {
          this.mod.shift = true;
          this._startLoop();
        },
        up: () => {
          this.mod.shift = false;
          this._startLoop();
        }
      },
      zoomIn: {
        down: () => {
          this.zoom.dir = 1;
          this._startLoop();
        },
        up: () => {
          if (this.zoom.dir > 0) this.zoom.dir = 0;
          this._startLoop();
        }
      },
      zoomOut: {
        down: () => {
          this.zoom.dir = -1;
          this._startLoop();
        },
        up: () => {
          if (this.zoom.dir < 0) this.zoom.dir = 0;
          this._startLoop();
        }
      },
      zoomReset: { down: () => {
        this.zoom.reset = 2;
        this._startLoop();
      }},
      cycleSkillNext: { down: () => this._cycleSkill(1) },
      cycleSkillPrev: { down: () => this._cycleSkill(-1) },
      applySkillToSelected: { down: () => {
        if (this._isGameplayBlocked()) return;
        const mgr = this.view.game?.getLemmingManager?.();
        const lem = mgr?.getSelectedLemming?.();
        if (!lem || !this.view.game) return;
        this.view.game.queueCommand(new CommandLemmingsAction(lem.id));
      }},
      toggleDebug: { down: () => {
        const game = this.view.game;
        if (!game) return;
        game.showDebug = !game.showDebug;
      }},
      speedDown: { down: () => this._changeSpeed(-1, false) },
      speedDownFast: { down: () => this._changeSpeed(-1, true) },
      speedUp: { down: () => this._changeSpeed(1, false) },
      speedUpFast: { down: () => this._changeSpeed(1, true) },
      levelPrev: { down: () => this.view.moveToLevel(-1) },
      levelNext: { down: () => this.view.moveToLevel(1) },
      levelGroupPrev: { down: () => {
        if (this.view.levelGroupIndex > 0) {
          this.view.selectLevelGroup(this.view.levelGroupIndex - 1);
        } else if (this.view.gameType > 1) {
          this.view.selectGameType(this.view.gameType - 1);
        }
      }},
      levelGroupNext: { down: () => {
        const totalGroups = this.view.gameResources?.getLevelGroups().length || 0;
        if (this.view.levelGroupIndex + 1 < totalGroups) {
          this.view.selectLevelGroup(this.view.levelGroupIndex + 1);
        } else {
          this.view.selectGameType(this.view.gameType + 1);
        }
      }},
      editorToggle: { down: () => {
        if (typeof this.view.toggleEditorMode === 'function') {
          this.view.toggleEditorMode();
        }
      }}
    };
  }

  _selectSkill(skillType) {
    if (this._isGameplayBlocked()) return;
    const game = this.view.game;
    if (!game) return;
    game.queueCommand(new CommandSelectSkill(skillType));
    game.gameGui.skillSelectionChanged = true;
  }

  _handleAction(action, type, event) {
    const handler = this._actions[action];
    if (!handler) return false;
    const fn = type === 'up' ? handler.up : handler.down;
    if (!fn) return false;
    fn(event);
    return handler.preventDefault !== false;
  }

  _onKeyDown(e) {
    if (this._shouldIgnoreKey(e)) return;
    const actions = this.keybindings.getActionsForEvent(e);
    if (!actions.length) return;
    let handled = false;
    for (const action of actions) {
      if (this._handleAction(action, 'down', e)) handled = true;
    }
    if (handled) e.preventDefault();
  }

  _onKeyUp(e) {
    const actions = this.keybindings.getActionsForEvent(e);
    if (!actions.length) return;
    let handled = false;
    for (const action of actions) {
      if (this._handleAction(action, 'up', e)) handled = true;
    }
    if (handled) e.preventDefault();
  }
}

export { KeyboardShortcuts };
