# Gamepad Bindings

Gamepad input is action-driven, like keyboard bindings.

- Default mappings are in `gamepadbindings.json`.
- Runtime parser/dispatcher lives in `js/input/GamepadInputController.js`.
- Gameplay bindings are consumed by `js/input/KeyboardShortcuts.js`.
- Editor bindings are consumed by `js/input/EditorKeybindings.js`.

## Mapping Format

```json
{
  "version": 1,
  "bindings": {
    "gameplay": {
      "togglePause": ["button:9"],
      "panLeft": ["button:14", "axis:0:-:0.35"]
    },
    "editor": {
      "editorToolTerrain": ["button:0"],
      "editorNudgeRight": ["button:15", "axis:0:+:0.35"]
    }
  }
}
```

Binding token formats:

- `button:<index>[:threshold]`
- `axis:<index>:<+|->[:deadZone]`

Examples:

- `button:0` -> face button 0 press.
- `button:7:0.7` -> trigger press with analog threshold.
- `axis:1:+:0.35` -> axis 1 positive direction past dead-zone.

## Remapping and Persistence

- File mappings are loaded from `gamepadbindings.json`.
- Runtime remaps can be applied via:
  - `KeyboardShortcuts.setGamepadBindings(config, options)`
  - `EditorKeybindings.setGamepadBindings(config, options)`
- Persisted remaps are stored in local storage key
  `lem-gamepad-bindings-v1`.
