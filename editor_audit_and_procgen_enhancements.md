# Level Editor Audit + Procgen Enhancement Plan (LemmingsJS-MIDI)

This document covers three things:

1) **Editor audit**: bugs, errors, mistakes, mismatches, missing features, and quality-of-life improvements  
2) **Editor ↔ engine parity gaps**: places where the editor exposes properties that the runtime does not honor  
3) **Procgen mode upgrade plan**: terrain-pack-driven generation, triggers, decoration, and richer lemming behaviors (AI-driven skill use)

---

## 1) Editor audit

### A. High-impact bugs / correctness gaps

- **`$TERRAINGROUP` is parsed and preserved… but never loaded into the preview/runtime**
  - `NxlvParser` populates `EditorLevel.terrainGroups`, and `NxlvWriter` can write them back out.
  - However `loadEditorLevel()` / `EditorLevelLoader.js` only reads:
    - `editorLevel.terrains`
    - `editorLevel.gadgets`
    - `editorLevel.steel`
  - Result:
    - Levels that rely on `terrainGroups` will appear incomplete in preview/playtest.
    - Export-to-classic (`.lvl`) will silently omit grouped terrain.
  - **Fix**: extend `EditorLevelLoader.createLevelElements()` to also flatten `terrainGroups` into elements (while preserving order semantics), or explicitly block/flag unsupported sections via validation.

- **Several selection inspector fields do not affect preview or classic export**
  - In `editor.html`, the selection inspector supports:
    - `Rotate`, `Flip H`, `One Way`, and explicit `Width`/`Height`
  - But `EditorLevelLoader.createDrawProperties()` only maps:
    - `FLIP_VERTICAL`, `NO_OVERWRITE`, `ERASE`
  - The renderer (`render/GroundRenderer.js`) also only supports vertical flip + overwrite/erase flags.
  - Result:
    - Users can edit properties that have **no effect** (misleading).
  - **Fix options**:
    1) Hide/disable these fields unless the runtime supports them, **or**
    2) Implement them end-to-end:
       - add horizontal flip / rotation in terrain blitting
       - define semantics for `ONE_WAY`
       - define semantics for `WIDTH/HEIGHT` (scale? crop? trigger-only resize?)

- **NXLV comment preservation bug: comments inside sections are mis-filed**
  - In `NxlvParser`, any line whose trimmed form starts with `#` is appended to `level.unknownLines` **even if it appears inside a section** (e.g., inside `$TERRAIN`, `$GADGETS`, etc.).
  - Result:
    - Exporting a level can reorder/move comments, breaking round-trip fidelity.
  - **Fix**: when `ctx` is active, append comment lines to `ctx.data.unknownLines` instead of `level.unknownLines`.

- **Unlimited editor history can grow without bound**
  - `EditorUiController` sets `MAX_HISTORY = Number.MAX_SAFE_INTEGER` and uses it for `EditorHistory`.
  - Each snapshot stores full serialized NXLV text → memory growth is unbounded during long sessions.
  - **Fix**: cap history entries (e.g., 200–1000) and/or implement “delta history” (structural diffs) or compression.

- **Very large level sizes can freeze/crash the browser**
  - Header `WIDTH`/`HEIGHT` are only validated as numeric; there is **no max bound**.
  - Preview loads allocate:
    - `groundImage` RGBA array (`width * height * 4`)
    - `groundMask` arrays
  - A typo like `WIDTH=1000000` will likely hang or crash.
  - **Fix**: enforce max sizes in validation + input clamping (reasonable bounds based on engine limits).

- **Export LVL “INFINITE” time limit semantics are unclear / inconsistent**
  - `EditorLevelLoader.resolveTimeLimit()` converts `TIME_LIMIT='INFINITE'` into a very large number.
  - The engine timer expects time limit in **minutes** (`GameTimer` multiplies by 60).
  - Current behavior effectively sets *thousands of minutes*, producing odd UI values.
  - **Fix**:
    - Either treat `INFINITE` as `lemmings.endless` in preview, or
    - Introduce a clear sentinel and adjust timer display accordingly (e.g., show `∞`).

---

### B. Medium-impact bugs / design footguns

- **Preview refresh coalescing can drop “latest label” context**
  - `EditorController._requestPreview()` ignores calls while a timer is pending.
  - If multiple edits happen quickly, the preview refresh reason/label can become stale.
  - **Enhancement**: store the *latest* requested label/options and run once after debounce.

- **LocalStorage pressure from previews and saved levels**
  - `EditorPreviewCache` stores thumbnail data URLs.
  - Saved levels are also stored in localStorage.
  - Browsers have limited quotas; storage write failures are caught, but UX may degrade silently.
  - **Enhancement**:
    - LRU eviction strategy
    - configurable “cache off”
    - storage usage indicator + clear-cache button

- **Brush/eraser performance scales poorly with brush size**
  - Brush/eraser loop over `(2*brushSize+1)^2` points per pointer event.
  - Each eraser stamp does hit tests scanning entries (O(N)).
  - **Enhancement**:
    - clamp max brush size
    - spatial index for hit testing (grid buckets / quadtree)
    - batch paint/erase operations into a single history snapshot (already mostly done, but the per-point hit test remains expensive)

- **No explicit “dirty” indicator for unsaved changes**
  - The editor can save/export, but there’s no persistent UI indicator (“*unsaved changes*”).
  - **Enhancement**: set dirty flag when history diverges from last save; show in title bar and on navigation.

- **No dedicated Undo/Redo buttons in UI**
  - Undo/Redo exist in keybindings, but UI lacks buttons.
  - **Enhancement**: add toolbar buttons + show current history label.

---

### C. Editor ↔ engine parity gaps (missing or partial implementations)

These are not necessarily “bugs” if the intent is classic Lemmings compatibility, but they *are* feature gaps relative to the editor surface area and NXLV semantics.

- **Horizontal flip (`FLIP_HORIZONTAL`)**: editor supports editing; runtime ignores.
- **Rotation (`ROTATE`)**: editor supports editing; runtime ignores.
- **Resizing (`WIDTH`/`HEIGHT`)**: editor supports drag handles + numeric edits; runtime ignores.
- **One-way terrain (`ONE_WAY`)**: editor supports flag; runtime ignores (engine uses arrow trigger ranges, not terrain flag).
- **Per-object skill / lemming count / pairing (`SKILL`, `LEMMINGS`, `PAIRING`)**:
  - Editor supports fields.
  - Engine’s entrance spawns are global and ignore per-entrance lemming counts.
  - Pairing/skill appear unused in runtime.
- **Per-entry STYLE override (multi-style levels)**:
  - Editor always uses header STYLE for new placements.
  - Loader resolves ids using header STYLE.
  - True multi-style NXLV levels are not supported.

**Recommendation:** Either:
- (A) explicitly scope the editor to “classic” and hide unsupported fields, or
- (B) commit to NXLV features and implement runtime support.

---

## 2) Editor enhancements (feature roadmap)

### A. Reliability + safety
- Add hard caps and validation rules for:
  - WIDTH/HEIGHT maximums
  - brush size maximum
  - steel rect maximum size
  - spawn interval and lemming counts (reasonable bounds)
- Add “unsupported feature” validation warnings:
  - terrainGroups present
  - ROTATE / FLIP_HORIZONTAL / WIDTH / HEIGHT / ONE_WAY present
  - SKILL/PAIRING/LEMMINGS used on gadgets
- Add robust round-trip support for NXLV comments/unknown lines:
  - preserve blank lines
  - preserve section-local comments

### B. Editing power
- Multi-select property editing:
  - allow editing X/Y offsets for all selected
  - allow toggling flags across selection
- Paste-at-cursor (or paste at last click) mode
- Duplicate hotkey (explicit) separate from alt-drag
- “Align / distribute” commands:
  - align left/right/top/bottom/center
  - distribute spacing evenly
- Layer visibility toggles:
  - show/hide terrain
  - show/hide objects
  - show/hide triggers
  - show/hide steel overlay

### C. UX + discoverability
- Style picker as dropdown (backed by `StyleRegistry.getStyleNames()`)
- Palette filters:
  - “steel only”
  - “trigger only”
  - “decorations only”
- Better tool cursors:
  - show brush radius
  - show terrain piece bounding box
  - show object trigger rectangle when placing triggers
- Mini-map / overview
- Shortcut overlay improvements:
  - show current bindings from keybindings.json
  - include “search shortcuts” field

### D. Engine parity improvements (if desired)
- Implement horizontal flip and rotation in `GroundRenderer` blitting.
- Define semantics for WIDTH/HEIGHT:
  - option 1: scale piece (nearest neighbor) into terrain bitmap
  - option 2: crop from source sprite
  - option 3: treat width/height as “trigger override area” only for objects
- Implement one-way terrain:
  - either by translating `ONE_WAY` terrain into directional trigger ranges
  - or by adding collision rule in lemming movement (more work)
- Implement terrain groups:
  - load into preview
  - preserve export ordering
  - optional UI support (group list, group visibility)

---

## 3) Procgen mode: comprehensive enhancement plan

Current procgen (`js/app/procgenController.js`) does:
- paint ground via direct pixel writes (`level.setGroundAt`)
- occasional bomb / nuke
- fixed game type + style (`OHNO` + `fire`)
- no terrain pieces, no objects/triggers beyond the entrance, no decoration variety

Below is a concrete upgrade plan.

---

### A. Terrain + objects from *all* level packs

#### 1) Support choosing **pack** and **style** dynamically
- Add procgen options:
  - `gameType`: choose from config.json packs (`lemmings`, `ohno`, `xmas91`, etc.)
  - `style`: choose from `StyleRegistry.getStyleNames()` or by groundSet
  - `seed`: deterministic generation
- Implement “biome rotation”:
  - every N chunks, switch style (and optionally pack) with a smooth transition

#### 2) Load real terrain/object assets for the chosen pack/style
- Reuse `EditorAssetCache.loadStyleAssets(styleName, config, fileProvider)` to get:
  - `terrainImages` with masks and steel flags
  - `gadgetImages` (objects) with trigger metadata
  - `terrain/gadgets/triggers` metadata lists
- Categorize assets once:
  - **terrainSolid**: most terrain pieces
  - **terrainSteel**: terrain with `isSteel`
  - **objectsDecor**: `triggerEffectId == 0`
  - **objectsHazard**: traps/drown/fry/kill
  - **objectsExit/Entrance**: special trigger types

#### 3) Replace “flat painted ground” with **terrain-piece stamping**
Instead of writing palette indices directly, build the ground by *blitting terrain pieces* into:
- `level.groundMask`
- `level.groundImage`

Implementation options (in increasing “properness”):
1. **Simple blit**: iterate pixels of a terrain image and call `level.setGroundAt(x, y, ...)` for solid pixels.  
   - easy, but slower
2. **Direct array copy**: copy pixels directly into `level.groundImage` and update `groundMask` bits.  
   - faster, but you must match `GroundRenderer` mask semantics
3. **Reuse GroundRenderer**: create a “streaming ground renderer” that can stamp pieces incrementally.  
   - best long-term

#### 4) Chunk-based streaming world generation
The existing procgen effectively preallocates a giant width. Consider chunk streaming:

- Maintain:
  - `chunkSize = 256 or 512 px`
  - `generatedUntilX`
  - a ring-buffer or world arrays sized to `visibleRange + safetyMargin`
- As camera approaches `generatedUntilX - margin`, generate next chunk:
  - platforms
  - gaps
  - obstacles
  - hazards
  - decorations
- Optionally recycle old chunks behind camera to keep memory bounded.

---

### B. Place “occasional triggers” + decoration

#### 1) Decoration pass
- Place non-trigger objects (`triggerEffectId == 0`) on:
  - ceilings
  - platform edges
  - background zones (if you implement non-solid decorative layers)
- Use spacing constraints so decoration doesn’t become clutter:
  - minimum distance between objects
  - per-chunk density cap

#### 2) Hazard / trigger pass
Place trigger objects occasionally, but with guard rails:

- Use weighted random selection by trigger type:
  - 70%: none
  - 20%: mild hazard (small trap)
  - 8%: major hazard (water / fire)
  - 2%: special (teleporter if supported, etc.)

- Always ensure there is a counterplay route:
  - add nearby terrain pieces that allow building over
  - add a tunnelable wall for bashing/mining
  - add a “safe ledge” for blockers

#### 3) Runtime trigger integration
Because procgen is running during gameplay:
- Create `level.addObject(...)` helper that:
  - instantiates `MapObject`
  - adds it to `level.objects`
  - creates and registers `Trigger` rectangles with `game.triggerManager.add(...)`
  - updates arrow areas if you ever use arrow triggers

---

### C. Make procgen levels *intentionally solvable*

Procedural levels are only fun if they’re usually solvable (or at least “recoverable”).

Recommended approach:
1) Generate a **golden path** from entrance → “forward progress” direction.
2) Sprinkle optional hazards/bonuses around it.
3) Run a lightweight **simulator** (or heuristic check) to ensure:
   - no unavoidable splats
   - no unavoidable drown/fry sections
   - at least one feasible route forward within skill budget

You do not need full search/pathfinding to start:
- start with rule-based constraints and a “forward progress” invariant

---

## 4) “More interesting behavior” for lemmings in procgen

The core engine already contains classic skill systems (builder, basher, miner, blocker, climber, etc.). Procgen currently only uses builder defensively.

### A. Add a Procgen “AI director”
Add a module that:
- watches leading lemmings
- predicts imminent failure states
- assigns skills to 1–N lemmings to maintain forward progress

This should be purely optional and tunable:
- “spectator” mode (minimal interventions)
- “assist” mode (prevents cheap deaths)
- “solver” mode (actively pushes through obstacles)

### B. Environment sensing primitives (needed for any AI)
Add helpers in procgen controller:
- `measureDropAhead(lem, lookRight, maxScan)`
- `measureWallHeightAhead(lem, lookRight, maxScan)`
- `findGapWidthAhead(lem, lookRight, maxScan)`
- `isHazardAhead(lem, lookRight, distance)`
- `isCrowdedAt(x, y)` (for blocker decisions)
- `estimateBuildNeededForGap(gapWidth)`

These can query:
- `level.hasGroundAt(x, y)`
- trigger manager ranges (hazards)

### C. Skill decision heuristics (concrete behaviors)

Below are behaviors you specifically asked for, with feasible triggers:

#### 1) Bash through terrain
- Condition:
  - lemming hits a wall (blocked horizontally)
  - wall thickness within a bashable limit
- Action:
  - `doLemmingAction(lemming, ActionType.BASH)`
- Safety:
  - don’t bash into water/fire trigger zones without an escape route
  - avoid bashing steel

#### 2) Mine / dig down
- Condition:
  - next chunk goal is below current platform
  - or lemming needs to descend but drop is lethal
- Action:
  - `ActionType.MINE` (angled) or `ActionType.DIG` (vertical)
- Safety:
  - ensure there’s ground below to land on
  - avoid digging into hazards

#### 3) Climb up walls
- Condition:
  - encountering frequent vertical walls in the forward direction
  - climber skill budget available
- Action:
  - assign `CLIMBER` (trait) if your engine supports it as a permanent trait, or trigger climb action.
- Safety:
  - climbers can walk off cliffs → combine with floater or proactive builder.

#### 4) Block to prevent lemmings going off ledges while ramp is built
This is a classic multi-lemming coordination pattern:

- Detect a lethal drop ahead with a gap that requires a builder ramp.
- Pick a lemming *near the ledge* to become a blocker.
- While the crowd is contained, assign builder to create a safe ramp.
- Release blocker:
  - bash into blocker
  - dig under blocker
  - or bomb a small hole next to blocker (if you want occasional chaos)

Implementation details:
- maintain a “current construction site” state:
  - `blockerId`
  - `builderId`
  - `rampTargetComplete` flag
- do not place multiple blockers too close.

#### 5) Floater assignment (optional, but makes procgen feel smarter)
- When a lemming is about to fall farther than the safe height:
  - assign floater, not builder, if you want variety
- Builders then become “progress” tools instead of pure safety tools.

### D. Add “skill budget” and pacing
To keep procgen interesting:
- Provide infinite skills (arcade mode), or
- Provide skill regeneration over distance/time, or
- Provide per-chunk skill allowances.

### E. Add “events” for emergent gameplay
- occasional “rescue bonus” (temporary skill surge)
- occasional “storm” that increases spawn rate
- occasional “boss obstacle” chunk requiring 2–3 coordinated skills

---

## 5) Concrete implementation checklist (engineering tasks)

### A. Procgen terrain stamping
- [ ] Add `ProcgenAssetManager` using `EditorAssetCache`
- [ ] Categorize terrain/object assets
- [ ] Add `stampTerrainPiece(pieceId, x, y, {flipV,noOverwrite,erase})`
- [ ] Add chunk generator that picks terrain pieces and places platforms

### B. Runtime object + trigger placement
- [ ] Implement `addObjectAt(pieceId, x, y)` that registers triggers via `game.triggerManager.add(...)`
- [ ] Add decoration object placement rules (spacing + density caps)
- [ ] Add hazard placement rules (always with counterplay route)

### C. AI director
- [ ] Add environment sensing primitives
- [ ] Add skill decision state machine
- [ ] Add coordinated “blocker + builder + release” pattern
- [ ] Add safety constraints to avoid infinite loops and self-sabotage

### D. Debugging/visibility
- [ ] On-screen debug overlay for procgen:
  - current seed
  - current chunk index
  - recent AI decisions (“builder @ x=…”, “bash @ x=…”)
- [ ] Toggleable visualization of triggers and steel

---