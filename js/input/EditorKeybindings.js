import { KeybindingRegistry, parseKeybindingConfig } from './KeybindingRegistry.js';
import { formatBindingSpec } from './KeybindingFormatter.js';
import { GamepadInputController } from './GamepadInputController.js';
import { EditorTools } from '../editor/EditorTools.js';

class EditorKeybindings {
  constructor(controller, options = {}) {
    this.controller = controller;
    this._onTool = options.onToolChange || null;
    this._onCopy = options.onCopy || null;
    this._onPaste = options.onPaste || null;
    this._onDuplicate = options.onDuplicate || null;
    this._onNudge = options.onNudge || null;
    this._onSnap = options.onSnap || null;
    this._onUndo = options.onUndo || null;
    this._onRedo = options.onRedo || null;
    this._onDelete = options.onDelete || null;
    this._onBringToFront = options.onBringToFront || null;
    this._onSendToBack = options.onSendToBack || null;
    this._onMoveForward = options.onMoveForward || null;
    this._onMoveBackward = options.onMoveBackward || null;
    this._onPlaytestToggle = options.onPlaytestToggle || null;
    this._onToggleShortcutOverlay = options.onToggleShortcutOverlay || null;
    this._onPreview = options.onPreview || null;
    this._onBindingsLoaded = options.onBindingsLoaded || null;
    this._down = this._onKeyDown.bind(this);
    this.keybindings = new KeybindingRegistry();
    this._actions = this._createActionHandlers();
    this.gamepad = new GamepadInputController({
      mode: 'editor',
      fileProvider: options.fileProvider || null,
      onAction: (action, type) => {
        this._handleAction(action, type);
      }
    });
    this._loadKeybindings(options.fileProvider || null);
  }

  bind() {
    window.addEventListener('keydown', this._down);
  }

  dispose() {
    window.removeEventListener('keydown', this._down);
    this.gamepad?.dispose?.();
    this.gamepad = null;
  }

  _loadKeybindings(fileProvider) {
    if (!fileProvider?.loadString) return;
    fileProvider.loadString('keybindings.json')
      .then((text) => {
        const parsed = parseKeybindingConfig(text);
        if (!parsed) return;
        this.keybindings.setConfig(parsed);
        this._onBindingsLoaded?.();
      })
      .catch(() => {});
  }

  _shouldIgnoreKey(e) {
    const target = e?.target;
    if (!target) return false;
    if (target.isContentEditable) return true;
    const tag = String(target.tagName || '').toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  _setTool(tool) {
    if (!tool) return;
    this.controller.setTool(tool);
    this._onTool?.(tool);
  }

  getDisplayBindings(action) {
    const specs = this.keybindings.getBindingsForAction(action);
    return specs.map(spec => formatBindingSpec(spec)).filter(Boolean);
  }

  getGamepadDisplayBindings(action) {
    return this.gamepad?.getDisplayBindings(action) || [];
  }

  setGamepadBindings(config, options) {
    this.gamepad?.setConfig?.(config, options);
  }

  _createActionHandlers() {
    return {
      editorToolSelect: { down: () => this._setTool(EditorTools.SELECT) },
      editorToolTerrain: { down: () => this._setTool(EditorTools.TERRAIN) },
      editorToolGadget: { down: () => this._setTool(EditorTools.GADGET) },
      editorToolTrigger: { down: () => this._setTool(EditorTools.TRIGGER) },
      editorToolMidiFlag: { down: () => this._setTool(EditorTools.MIDI_FLAG) },
      editorToolEntrance: { down: () => this._setTool(EditorTools.ENTRANCE) },
      editorToolExit: { down: () => this._setTool(EditorTools.EXIT) },
      editorToolSteel: { down: () => this._setTool(EditorTools.STEEL) },
      editorToolBrush: { down: () => this._setTool(EditorTools.BRUSH) },
      editorToolEraser: { down: () => this._setTool(EditorTools.ERASER) },
      editorCopy: { down: () => {
        this._onCopy?.();
      }},
      editorPaste: { down: () => {
        this._onPaste?.();
      }},
      editorDuplicate: { down: () => {
        this._onDuplicate?.();
      }},
      editorNudgeLeft: { down: () => {
        this._onNudge?.(-1, 0, 1);
      }},
      editorNudgeRight: { down: () => {
        this._onNudge?.(1, 0, 1);
      }},
      editorNudgeUp: { down: () => {
        this._onNudge?.(0, -1, 1);
      }},
      editorNudgeDown: { down: () => {
        this._onNudge?.(0, 1, 1);
      }},
      editorNudgeLeftFast: { down: () => {
        this._onNudge?.(-1, 0, this.controller?.gridSize || 1);
      }},
      editorNudgeRightFast: { down: () => {
        this._onNudge?.(1, 0, this.controller?.gridSize || 1);
      }},
      editorNudgeUpFast: { down: () => {
        this._onNudge?.(0, -1, this.controller?.gridSize || 1);
      }},
      editorNudgeDownFast: { down: () => {
        this._onNudge?.(0, 1, this.controller?.gridSize || 1);
      }},
      editorSnapSelection: { down: () => {
        this._onSnap?.();
      }},
      editorTogglePlaytest: { down: () => {
        this._onPlaytestToggle?.();
      }},
      editorToggleShortcutOverlay: { down: () => {
        this._onToggleShortcutOverlay?.();
      }},
      editorUndo: { down: () => {
        this._onUndo?.();
      }},
      editorRedo: { down: () => {
        this._onRedo?.();
      }},
      editorDelete: { down: () => {
        this._onDelete?.();
      }},
      editorBringToFront: { down: () => {
        this._onBringToFront?.();
      }},
      editorSendToBack: { down: () => {
        this._onSendToBack?.();
      }},
      editorMoveForward: { down: () => {
        this._onMoveForward?.();
      }},
      editorMoveBackward: { down: () => {
        this._onMoveBackward?.();
      }}
    };
  }

  _handleAction(action, type = 'down') {
    const handler = this._actions[action];
    const fn = type === 'up' ? handler?.up : handler?.down;
    if (!fn) return false;
    fn();
    this._onPreview?.();
    return true;
  }

  _onKeyDown(e) {
    if (this._shouldIgnoreKey(e)) return;
    const actions = this.keybindings.getActionsForEvent(e);
    if (!actions.length) return;
    let handled = false;
    for (const action of actions) {
      if (this._handleAction(action)) handled = true;
    }
    if (handled) e.preventDefault();
  }
}

export { EditorKeybindings };
