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
const keyboardShortcutActionsMethods = {
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
        const midiConfig = this.view?.getMidiConfig?.()
            ?? this.view?.midiRouter?.mapping?.config;
        if (midiConfig?.reverse?.allNotesOffOnToggle) {
          const scheduler = this.view?.midiRouter?.scheduler;
          scheduler?.allNotesOff?.();
          scheduler?.clearQueue?.();
        }
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
        const totalGroups = this.view.elementSelectLevelGroup?.options.length ||
            this.view.gameResources?.getLevelGroups().length || 0;
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
      }},
      toggleShortcutOverlay: { down: () => {
        this.view?.shortcutOverlay?.toggle?.();
      }}
    };
  },

  _selectSkill(skillType) {
    if (this._isGameplayBlocked()) return;
    const game = this.view.game;
    if (!game) return;
    game.queueCommand(new CommandSelectSkill(skillType));
    game.gameGui.skillSelectionChanged = true;
  },

  _handleAction(action, type, event) {
    const handler = this._actions[action];
    if (!handler) return false;
    const fn = type === 'up' ? handler.up : handler.down;
    if (!fn) return false;
    fn(event);
    return handler.preventDefault !== false;
  },

  _onKeyDown(e) {
    const actions = this.keybindings.getActionsForEvent(e);
    if (!actions.length) return;
    if (this._shouldIgnoreKey(e, actions)) return;
    let handled = false;
    for (const action of actions) {
      if (this._handleAction(action, 'down', e)) handled = true;
    }
    if (handled) e.preventDefault();
  },

  _onKeyUp(e) {
    const actions = this.keybindings.getActionsForEvent(e);
    if (!actions.length) return;
    let handled = false;
    for (const action of actions) {
      if (this._handleAction(action, 'up', e)) handled = true;
    }
    if (handled) e.preventDefault();
  }
};
export { keyboardShortcutActionsMethods };