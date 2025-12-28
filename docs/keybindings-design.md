# Keybindings Configuration Design

## Overview
Introduce a JSON-driven keyboard binding system so every action handled by `KeyboardShortcuts` can be remapped without code changes. The config is loaded at runtime from `keybindings.json` and falls back to built-in defaults if the file is missing or invalid.

## Goals
- Make every keyboard action configurable through JSON.
- Allow multiple bindings per action.
- Keep defaults stable and documented.
- Preserve existing behavior when no config file is present.

## Non-goals
- UI for live rebinding in-game.
- Saving keybindings to localStorage (future work).

## JSON Schema

```json
{
  "version": 1,
  "bindings": {
    "togglePause": ["Space"],
    "stepForward": ["BracketRight"],
    "stepBackward": ["BracketLeft", "Alt+BracketRight"],
    "toggleReverse": ["KeyB"],
    "panLeft": ["ArrowLeft"],
    "panRight": ["ArrowRight"],
    "panUp": ["ArrowUp"],
    "panDown": ["ArrowDown"],
    "panBoost": ["ShiftLeft", "ShiftRight"],
    "zoomIn": ["KeyZ"],
    "zoomOut": ["KeyX"],
    "zoomReset": ["KeyV"],
    "releaseRateDown": ["Digit1"],
    "releaseRateDownMax": ["Shift+Digit1"],
    "releaseRateUp": ["Digit2"],
    "releaseRateUpMax": ["Shift+Digit2"],
    "selectSkillClimber": ["Digit3"],
    "selectSkillFloater": ["Digit4"],
    "selectSkillBomber": ["Digit5"],
    "selectSkillBlocker": ["Digit6"],
    "selectSkillBuilder": ["KeyQ"],
    "selectSkillBasher": ["KeyW"],
    "selectSkillMiner": ["KeyE"],
    "selectSkillDigger": ["KeyR"],
    "cycleSkillNext": ["Tab"],
    "cycleSkillPrev": ["Shift+Tab"],
    "applySkillToSelected": ["KeyK"],
    "nuke": ["KeyT"],
    "nukeInstant": ["Shift+KeyT"],
    "restartLevel": ["Backspace"],
    "toggleDebug": ["Backslash"],
    "speedDown": ["Minus", "NumpadSubtract", "Alt+Equal", "Alt+NumpadAdd"],
    "speedDownFast": ["Shift+Minus", "Shift+NumpadSubtract", "Alt+Shift+Equal", "Alt+Shift+NumpadAdd"],
    "speedUp": ["Equal", "NumpadAdd"],
    "speedUpFast": ["Shift+Equal", "Shift+NumpadAdd"],
    "levelPrev": ["Comma"],
    "levelNext": ["Period"],
    "levelGroupPrev": ["Shift+Comma"],
    "levelGroupNext": ["Shift+Period"],
    "editorToggle": ["Shift+Backquote"],
    "editorToolSelect": ["KeyS"],
    "editorToolTerrain": ["KeyT"],
    "editorToolGadget": ["KeyG"],
    "editorToolTrigger": ["KeyR"],
    "editorToolEntrance": ["KeyE"],
    "editorToolExit": ["KeyX"],
    "editorToolSteel": ["KeyF"],
    "editorToolBrush": ["KeyB"],
    "editorToolEraser": ["KeyD"],
    "editorCopy": ["Ctrl+KeyC"],
    "editorPaste": ["Ctrl+KeyV"],
    "editorDuplicate": ["Ctrl+KeyD"],
    "editorNudgeLeft": ["ArrowLeft"],
    "editorNudgeRight": ["ArrowRight"],
    "editorNudgeUp": ["ArrowUp"],
    "editorNudgeDown": ["ArrowDown"],
    "editorNudgeLeftFast": ["Shift+ArrowLeft"],
    "editorNudgeRightFast": ["Shift+ArrowRight"],
    "editorNudgeUpFast": ["Shift+ArrowUp"],
    "editorNudgeDownFast": ["Shift+ArrowDown"],
    "editorSnapSelection": ["Ctrl+KeyG"],
    "editorTogglePlaytest": ["KeyP"],
    "editorUndo": ["KeyZ"],
    "editorRedo": ["Shift+KeyZ"],
    "editorDelete": ["Delete", "Backspace"]
  }
}
```

## Parsing Rules
- Binding strings use `+` to join modifiers with a physical key `code` (e.g. `Shift+KeyT`).
- Modifiers are case-insensitive: `Ctrl`, `Control`, `Alt`, `Shift`, `Meta`, `Cmd`, `Command`, `Win`.
- The final token is treated as a `KeyboardEvent.code` value.
- For pure modifier keys, use `ShiftLeft`, `ShiftRight`, `ControlLeft`, etc.
- Invalid bindings are ignored and do not crash the loader.

## Loading Flow
- `KeyboardShortcuts` loads defaults immediately.
- It attempts to load `keybindings.json` from the project root via `FileProvider.loadString` and overrides defaults if parsing succeeds.
- If loading fails (missing file, non-browser tests), defaults remain active.

## Conflict Resolution
- Multiple actions can bind to the same chord; all are dispatched in declaration order.
- If an exact modifier match exists, only those actions fire.
- If no exact match exists, Shift is treated as optional unless Ctrl/Alt/Meta are pressed.
- If Ctrl/Alt/Meta are pressed and no exact match exists, the event is ignored to preserve browser shortcuts.

## Extensibility
- Future actions can be added by extending the defaults and adding handlers in `KeyboardShortcuts`.
- A UI layer can update bindings by calling `KeyboardShortcuts.keybindings.setConfig()`.
