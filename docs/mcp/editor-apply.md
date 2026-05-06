# MCP Tool Spec: `editor.apply` (Full Level Editor Control)

This repository exposes an MCP server (`mcp/server.js`) that can:
- create sessions and drive the UI with Playwright
- fetch rich, structured state via `state.get` (including editor session + assets + validation issues)
- apply in-game skills and input actions

The `editor.apply` tool is the first-class mutating API for the editor. It can
directly inspect and modify the editor model (header, skillset, terrain,
gadgets, steel, selection, history), without relying on fragile mouse/keyboard
automation.

This spec defines the shipped `editor.apply` contract. The server exposes it as
`editor_apply`.

---

## Design goals

### Primary goals
1. **Full editor parity**
   - Everything you can do in `editor.html` must be doable via MCP:
     - tools: select / terrain / object / trigger / entrance / exit / steel / brush / eraser
     - palette selection and filtering
     - level settings (header + skillset)
     - selection inspector edits (X/Y/Width/Height/Rotate/Flip/etc.)
     - ordering controls (front/back)
     - delete
     - validation + one-click fixes
     - import/export (NXLV + classic LVL)
     - history undo/redo

2. **Reliable item addressing**
   - LLMs need stable handles (IDs) rather than fragile array indices.
   - The editor currently stores terrain/gadget/steel as arrays; indices shift when inserting/removing.
   - This spec introduces optional **stable `uid` identifiers** for entries to support robust manipulation.

3. **Batching + atomicity**
   - Allow “apply 12 operations as one edit” with a single history snapshot label and one preview refresh.
   - Allow partial or atomic execution.

4. **Tooling integration**
   - Seamlessly complements existing tools:
     - use `state.get` to inspect after edits
     - use `vision.capture` to visually confirm
     - use `input.action` only when needed (e.g., shortcut overlay) — but editing should not depend on it.

---

## Tool name

Internal canonical name: `editor.apply`
External call name: `editor_apply`

---

## High-level behavior

`editor.apply` takes a list of operations (`ops`) and applies them to the active editor session in the browser (via the E2E harness).

- Operations can mutate:
  - editor model (header/skillset/entries)
  - editor controller state (tool, snap, brush size, selected palette IDs, selection)
  - history (undo/redo)
  - preview (trigger refresh + optionally preserve viewport)
  - validation (evaluate + optional auto-fix)

- The response can optionally include:
  - per-op results (success, error, return value)
  - updated editor state (same shape as `state.get.editor`)
  - exported resources (NXLV text / LVL bytes) stored in MCP ResourceStore

---

## Input schema

### Top-level request

```jsonc
{
  "sessionId": "string",
  "ops": [ /* array of operation objects */ ],

  // Execution controls:
  "atomic": false,                 // if true: all-or-nothing (rollback on error)
  "dryRun": false,                 // validate-only, do not mutate
  "history": {
    "label": "string",             // label for the history snapshot (if snapshot is taken)
    "record": true                 // if false: do not add history snapshot(s)
  },

  // Post-processing:
  "preview": {
    "refresh": true,               // call the preview pipeline once after successful ops
    "label": "string",
    "preserveViewport": true       // mirror GameView._preserveEditorViewport behavior
  },
  "validate": {
    "run": true,
    "autoFix": "none"              // "none" | "safe" | "aggressive"
  },

  // Response shaping:
  "returnState": "editor"          // "none" | "editor" | "full"
}
```

### Operation envelope

Each element of `ops` has:

```jsonc
{
  "opId": "optional string for correlation",
  "type": "string enum",
  "args": { /* operation-specific */ }
}
```

All operation payloads must be JSON-serializable (because they cross `page.evaluate`).

---

## Output schema

```jsonc
{
  "ok": true,
  "results": [
    {
      "opId": "string|null",
      "type": "string",
      "ok": true,
      "value": { /* op-specific result */ }
    }
  ],

  "state": { /* optional: editor or full state */ },

  "resources": [
    {
      "uri": "lemmings://sessions/<sessionId>/resources/<id>",
      "mimeType": "text/plain|application/octet-stream|image/png",
      "name": "string",
      "sizeBytes": 12345,
      "meta": { "kind": "export", "format": "nxlv|lvl", "label": "..." }
    }
  ]
}
```

On failure:

```jsonc
{
  "ok": false,
  "error": {
    "code": "string",
    "message": "string",
    "details": { /* optional */ }
  },
  "results": [ /* optional partial results when atomic=false */ ]
}
```

### Error codes (recommended)
- `not_in_editor_mode`
- `no_editor_session`
- `invalid_op`
- `invalid_ref`
- `asset_not_found`
- `validation_failed`
- `rollback_failed`
- `internal_error`

---

## Entity references

Many ops need to target specific items in the level (terrain/gadget/steel/etc.).

### Preferred: stable `uid`
```jsonc
{ "ref": { "kind": "terrain", "uid": "t_01H..." } }
```

### Fallback: index-based
```jsonc
{ "ref": { "kind": "gadget", "index": 12 } }
```

### Kinds
- `terrain`
- `gadget`
- `steel`
- `terrainGroup` (advanced / future-proof)
- `terrainGroupTerrain` (advanced / future-proof)
- `unknownSection` (advanced / future-proof)

**Recommendation:** implement `uid` as a non-serialized field on entries (safe because `NxlvWriter` only reads `entry.props`, `entry.order`, `entry.unknownLines`). Ensure cloning operations preserve or regenerate `uid`.

---

## Operation catalog

Below is the minimum operation set required for full editor parity.

### 1) Editor lifecycle + mode

#### `editor.ensure`
Ensures the session is currently hosting the editor UI (e.g., `editor.html`).

**Args**
```jsonc
{ "enter": true }
```

**Result**
```jsonc
{ "inEditor": true }
```

---

### 2) Level lifecycle (New / Load / Save / Export / Import)

#### `level.new`
Equivalent to “New Level”.

**Args**
```jsonc
{
  "header": {
    "TITLE": "My Level",
    "STYLE": "dirt",
    "WIDTH": 1600,
    "HEIGHT": 160,
    "LEMMINGS": 50,
    "SAVE_REQUIREMENT": 25,
    "MAX_SPAWN_INTERVAL": 50,
    "TIME_LIMIT": 5,
    "START_X": 0,
    "START_Y": 0
  },
  "skillset": {
    "CLIMBER": 0,
    "FLOATER": 0,
    "BOMBER": 0,
    "BLOCKER": 0,
    "BUILDER": 0,
    "BASHER": 0,
    "MINER": 0,
    "DIGGER": 0
  },
  "resetHistory": true
}
```

**Result**
```jsonc
{ "created": true }
```

---

#### `level.loadText`
Loads a full NXLV text blob into the editor session.

**Args**
```jsonc
{
  "text": "string (.nxlv contents)",
  "resetHistory": true,
  "sourceLabel": "Import"
}
```

---

#### `level.loadSaved`
Loads a saved level from local storage (as listed in `state.get.editor.storage.savedLevels`).

**Args**
```jsonc
{ "savedId": "string", "resetHistory": true }
```

---

#### `level.save`
Saves current editor level to local storage.

**Args**
```jsonc
{ "name": "My Saved Level", "overwriteId": "optional string" }
```

**Result**
```jsonc
{ "savedId": "string", "name": "string" }
```

---

#### `level.export`
Exports the current level (or selection subset) into a resource.

**Args**
```jsonc
{
  "format": "nxlv",         // "nxlv" | "classicLvl"
  "filename": "level.nxlv",
  "selectionOnly": false
}
```

**Result**
```jsonc
{
  "resource": {
    "uri": "lemmings://...",
    "mimeType": "text/plain",
    "name": "level.nxlv",
    "sizeBytes": 1234
  }
}
```

---

#### `level.importClassicLvl`
Imports a classic `.lvl` file.

**Args**
```jsonc
{
  "bytesBase64": "base64 string",
  "resetHistory": true,
  "sourceLabel": "Import LVL"
}
```

---

### 3) Header + skillset editing (Level Settings panel)

#### `level.patchHeader`
Partial patch of header keys.

**Args**
```jsonc
{
  "set": { "TITLE": "New Title", "STYLE": "fire" },
  "unset": ["START_Y"]
}
```

---

#### `level.patchSkillset`
Partial patch of skill counts.

**Args**
```jsonc
{
  "set": { "BUILDER": 10, "BASHER": 5 }
}
```

---

### 4) Editor controller state (Tools / Brush / Palette)

#### `editor.setTool`
**Args**
```jsonc
{ "tool": "select" }
```
Allowed values must match `EditorTools.js`.

---

#### `editor.setBrushSettings`
**Args**
```jsonc
{
  "snapEnabled": true,
  "gridSize": 4,
  "brushSize": 3,
  "eraseGadgets": false,
  "handleSize": 10
}
```

---

#### `editor.setPaletteSelection`
**Args**
```jsonc
{
  "selectedTerrainId": 12,
  "selectedGadgetId": 5,
  "selectedTriggerId": 7
}
```

---

### 5) Selection (Select tool parity)

#### `selection.clear`
No args.

---

#### `selection.set`
Sets selection explicitly.

**Args**
```jsonc
{
  "selection": [
    { "kind": "terrain", "uid": "t_..." },
    { "kind": "gadget", "index": 3 }
  ]
}
```

---

#### `selection.hitTest`
Returns the topmost entry at a world coordinate (same logic as editor click).

**Args**
```jsonc
{ "x": 120, "y": 80, "kinds": ["terrain", "gadget", "steel"] }
```

**Result**
```jsonc
{ "hit": { "kind": "terrain", "index": 10, "uid": "t_..." } }
```

---

#### `selection.boxSelect`
Equivalent to marquee selection.

**Args**
```jsonc
{
  "bounds": { "x": 0, "y": 0, "width": 320, "height": 160 },
  "mode": "replace" // "replace" | "add" | "toggle"
}
```

---

### 6) Entry CRUD (the core “inspect/manipulate all items” layer)

#### `entry.add`
Adds a new entry to a list.

**Args**
```jsonc
{
  "kind": "terrain",             // terrain | gadget | steel
  "props": {
    "PIECE": 12,
    "X": 100,
    "Y": 120,
    "FLIP_VERTICAL": true,
    "NO_OVERWRITE": false,
    "ERASE": false,
    "WIDTH": 0,
    "HEIGHT": 0,
    "ROTATE": 0,
    "FLIP_HORIZONTAL": false,
    "ONE_WAY": false,
    "SKILL": "",
    "LEMMINGS": 0,
    "PAIRING": 0
  },
  "insert": { "at": "end" }      // "end" | { "index": number }
}
```

**Result**
```jsonc
{ "ref": { "kind": "terrain", "index": 42, "uid": "t_..." } }
```

---

#### `entry.update`
Patches properties on an entry.

**Args**
```jsonc
{
  "ref": { "kind": "gadget", "uid": "g_..." },
  "set": { "X": 500, "Y": 64 },
  "unset": ["PAIRING"]
}
```

---

#### `entry.remove`
Removes one or more entries.

**Args**
```jsonc
{
  "refs": [
    { "kind": "terrain", "index": 2 },
    { "kind": "steel", "uid": "s_..." }
  ]
}
```

---

#### `entry.duplicate`
Duplicates entries with an offset (equivalent to alt-drag / duplicate / paste behavior).

**Args**
```jsonc
{
  "refs": [{ "kind": "terrain", "uid": "t_..." }],
  "offset": { "dx": 4, "dy": 0 },
  "selectNew": true
}
```

---

#### `entry.reorder`
Equivalent to Bring to Front / Send to Back / Move Forward / Move Back for the current selection.

**Args**
```jsonc
{ "action": "bringToFront" } // sendToBack | moveForward | moveBackward
```

---

### 7) Tool-stroke operations (exact UI tool parity)

These ops are convenience wrappers that apply the same logic as the UI tools, including snapping, stamping, eraser gadget removal rules, entrance/exit limits, steel drafting behavior, etc.

#### `tool.place`
Places a single stamp (terrain/object/trigger/entrance/exit).

**Args**
```jsonc
{
  "tool": "terrain",
  "x": 100,
  "y": 120,
  "pieceId": 12,          // optional override; otherwise uses controller.selected*Id
  "snap": "useCurrent"    // useCurrent | none | { "gridSize": 8 }
}
```

---

#### `tool.stroke`
Applies a drag stroke using one tool, like dragging in the canvas.

**Args**
```jsonc
{
  "tool": "brush",
  "points": [{ "x": 100, "y": 120 }, { "x": 110, "y": 120 }, { "x": 120, "y": 120 }],
  "button": 0,
  "keys": { "shift": false, "alt": false }
}
```

---

#### `tool.erase`
Alias of `tool.stroke` for erasing, but supports extra options.

**Args**
```jsonc
{
  "points": [{ "x": 10, "y": 10 }],
  "eraseGadgets": true
}
```

---

#### `tool.steelRect`
Adds steel rectangle(s) directly (matches steel draft result).

**Args**
```jsonc
{
  "rects": [
    { "x": 100, "y": 120, "width": 64, "height": 16 }
  ]
}
```

---

### 8) History (Undo / Redo)

#### `history.undo`
**Args**
```jsonc
{ "count": 1 }
```

#### `history.redo`
**Args**
```jsonc
{ "count": 1 }
```

#### `history.getEntry`
Returns the serialized NXLV text for a history entry (LLM-friendly).

**Args**
```jsonc
{ "index": 0 }
```

**Result**
```jsonc
{ "text": "..." }
```

---

### 9) Validation

#### `validate.run`
Runs `validateLevel` and returns issues (same as editor UI list).

**Args**
```jsonc
{ "autoFix": "none" } // none | safe | aggressive
```

**Result**
```jsonc
{
  "issues": [
    { "severity": "error|warning|info", "message": "...", "fixLabel": "...", "fixable": true }
  ]
}
```

---

## Tool-to-UI mapping (completeness checklist)

| Editor UI feature | Covered by ops |
|---|---|
| New / Load (pack/group/index) | `level.new`, `level.loadText`, plus existing `session.create` + navigation |
| Saved levels | `level.loadSaved`, `level.save` |
| Export / Export LVL | `level.export` |
| Import / Import LVL | `level.loadText`, `level.importClassicLvl` |
| Tools (select/terrain/object/trigger/entrance/exit/steel/brush/eraser) | `editor.setTool`, `tool.place`, `tool.stroke`, `tool.steelRect` |
| Brush settings (snap/grid/brushSize/eraseGadgets) | `editor.setBrushSettings` |
| Palette selection | `editor.setPaletteSelection` |
| Selection inspector edits | `entry.update` (or `selection.set` + `entry.update`) |
| Ordering buttons | `entry.reorder` |
| Delete selection | `entry.remove` |
| Validation fixes | `validate.run` with `autoFix`, or `issue.fix` optional future op |
| Undo/Redo | `history.undo`, `history.redo` |
| Viewport preservation | `preview.preserveViewport` |

---

## Implementation notes (where to hook in this codebase)

### A) Extend the E2E harness (`js/app/e2eHarness.js`)
Add a new method, e.g.:

- `editorApply(ops, options)`
- `editorExport(format, options)`
- `editorHistoryGet(index)`

These should:
- locate the editor controller via `context.view.editorUi?.controller`
- mutate `controller.session.level` via existing controller methods whenever possible
- call `controller.history.pushSnapshot(...)` when requested
- trigger preview via the already-wired `onPreviewRequest` callback *or* by calling `view.loadEditorPreviewLevel(...)` directly when `preview.refresh=true`
- return structured results (per-op success + values)

### B) Add the MCP tool in `mcp/server.js`
- Define `EditorApplySchema` (zod) matching this spec
- Add tool entry `{ name: 'editor.apply', ... }` into `TOOL_SPECS`
- Implement handler:
  - validate session exists
  - call `callE2E(session, 'editorApply', ops, options)`
  - if `level.export` produces bytes/text: store via `resourceStore.put(...)`
  - return resources + optionally new state

### C) Stable `uid` support
This is the single biggest usability win for LLM editing.

Suggested implementation strategy:
- when a level is loaded or created, walk all entries and ensure `entry.uid` exists
- preserve `uid` on clone/duplicate/paste when desired, or generate new ones for clones
- update selection serialization in `e2eHarness` to include `uid` in selection entries and refs

---

## Example workflows

### Example 1: “Create a new level, place an entrance/exit, add terrain, export”
```jsonc
{
  "sessionId": "S1",
  "atomic": true,
  "history": { "label": "Initial layout", "record": true },
  "preview": { "refresh": true, "preserveViewport": true },
  "validate": { "run": true, "autoFix": "safe" },
  "returnState": "editor",
  "ops": [
    { "type": "level.new", "args": { "header": { "TITLE": "Demo", "STYLE": "dirt", "WIDTH": 1600, "HEIGHT": 160, "LEMMINGS": 10, "SAVE_REQUIREMENT": 10, "MAX_SPAWN_INTERVAL": 50, "TIME_LIMIT": 5 } } },
    { "type": "tool.place", "args": { "tool": "entrance", "x": 64, "y": 96 } },
    { "type": "tool.place", "args": { "tool": "exit", "x": 1400, "y": 96 } },
    { "type": "tool.stroke", "args": { "tool": "brush", "points": [{ "x": 0, "y": 140 }, { "x": 1600, "y": 140 }] } },
    { "type": "level.export", "args": { "format": "nxlv", "filename": "demo.nxlv" } }
  ]
}
```

### Example 2: “Move every exit 32px right”
```jsonc
{
  "sessionId": "S1",
  "ops": [
    { "type": "query.find", "args": { "kind": "gadget", "where": { "triggerEffectId": "EXIT_LEVEL" } } },
    { "type": "entry.update", "args": { "ref": { "kind": "gadget", "uid": "g_..." }, "set": { "X": 1232 } } }
  ]
}
```

(Where `query.find` is an optional but strongly recommended quality-of-life op.)

---

## Recommended “minimum viable” subset (if you want to implement iteratively)

If you want to ship quickly, implement in this order:

1. `level.new`, `level.loadText`, `level.export`
2. `entry.add`, `entry.update`, `entry.remove`
3. `history.undo`, `history.redo`
4. `validate.run`
5. Tool parity wrappers: `tool.place`, `tool.stroke`, `tool.steelRect`
6. Stable `uid` support + `query.find` + `selection.hitTest`

That already enables an LLM to fully build and modify levels without UI automation.
