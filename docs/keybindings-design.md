# Keybindings Configuration

Keyboard bindings are JSON-driven so gameplay and editor actions can be
remapped without code changes. The current file-level defaults live in
[`../keybindings.json`](../keybindings.json); this document describes the format
and loading rules rather than duplicating the full action list.

## Scope

- Gameplay actions: pause/step/reverse, rate and speed controls, skill
  selection, nuke/restart, level navigation, panning/zooming, shortcut overlay.
- Editor actions: mode toggle, tool selection, MIDI flag tool, copy/paste,
  duplicate, nudge, ordering, playtest, undo/redo/delete, shortcut overlay.
- Multiple bindings per action are supported.

## JSON shape

```json
{
  "version": 1,
  "bindings": {
    "togglePause": ["Space"],
    "stepForward": ["BracketRight"],
    "editorToolTerrain": ["KeyT"],
    "editorBringToFront": ["Ctrl+Shift+BracketRight"]
  }
}
```

## Parsing rules

- Binding strings use `+` to join modifiers with a physical
  `KeyboardEvent.code`, for example `Shift+KeyT`.
- Modifiers are case-insensitive: `Ctrl`, `Control`, `Alt`, `Shift`, `Meta`,
  `Cmd`, `Command`, `Win`.
- The final token is treated as the physical key code.
- Pure modifier keys use physical codes such as `ShiftLeft`, `ShiftRight`, or
  `ControlLeft`.
- Invalid bindings are ignored and do not crash the loader.

## Loading flow

- Built-in defaults are available immediately.
- `KeyboardShortcuts` attempts to load `keybindings.json` via
  `FileProvider.loadString`.
- If the file is missing, invalid, or unavailable in a test harness, built-in
  defaults remain active.
- Runtime code can update bindings through `KeyboardShortcuts.keybindings` APIs.

## Conflict resolution

- Multiple actions can bind to the same chord; actions dispatch in declaration
  order.
- If an exact modifier match exists, only exact-match actions fire.
- If no exact match exists, Shift is optional unless Ctrl, Alt, or Meta are
  pressed.
- If Ctrl, Alt, or Meta are pressed and no exact match exists, the event is
  ignored to preserve browser shortcuts.

Gamepad binding format is documented separately in
[`gamepad-bindings.md`](gamepad-bindings.md).
