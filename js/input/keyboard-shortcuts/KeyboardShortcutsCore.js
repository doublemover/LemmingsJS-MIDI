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
import { keyboardShortcutRuntimeMethods } from './KeyboardShortcutRuntime.js';
import { keyboardShortcutActionsMethods } from './KeyboardShortcutActions.js';
class KeyboardShortcuts {
  constructor(view, options = {}) {
    this.view = view;
    this._down = this._onKeyDown.bind(this);
    this._up = this._onKeyUp.bind(this);
    this.window = options.window ?? view?.runtime?.window ?? getRuntimeDependency('window', null);
    this.performance = options.performance ?? view?.runtime?.performance ?? getRuntimeDependency('performance', null);
    this.requestAnimationFrame = options.requestAnimationFrame ??
        view?.runtime?.requestAnimationFrame ??
        this.window?.requestAnimationFrame?.bind?.(this.window) ??
        null;
    this.cancelAnimationFrame = options.cancelAnimationFrame ??
        view?.runtime?.cancelAnimationFrame ??
        this.window?.cancelAnimationFrame?.bind?.(this.window) ??
        null;
    this.window?.addEventListener?.('keydown', this._down);
    this.window?.addEventListener?.('keyup', this._up);
    this.mod = { shift:false };
    this.pan = { left:false,right:false,up:false,down:false,vx:0,vy:0,changed:false };
    this.zoom = { dir:0,v:0,reset:null };
    this.keybindings = new KeybindingRegistry();
    this._actions = this._createActionHandlers();
    this.gamepad = new GamepadInputController({
      mode: 'gameplay',
      fileProvider: this.view?.gameFactory?.fileProvider || null,
      window: this.window,
      navigator: options.navigator ?? view?.runtime?.navigator ?? this.window?.navigator ?? getRuntimeDependency('navigator', null),
      storage: options.storage ?? view?.runtime?.localStorage ?? this.window?.localStorage ?? getRuntimeDependency('localStorage', null),
      onAction: (action, type) => {
        this._handleAction(action, type, null);
      }
    });
    this._raf = null;
    this._last = 0;
    this._loadKeybindings();
  }
}
for (const methods of [
  keyboardShortcutRuntimeMethods,
  keyboardShortcutActionsMethods
]) {
  Object.defineProperties(KeyboardShortcuts.prototype, Object.getOwnPropertyDescriptors(methods));
}
export { KeyboardShortcuts };