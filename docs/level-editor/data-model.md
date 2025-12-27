# Level Editor Data Model

## EditorLevel

`EditorLevel` is a structured representation of `.nxlv` files.

### Header keys
- `TITLE`, `AUTHOR`, `VERSION`, `ID`
- `STYLE`, `THEME`, `MUSIC`
- `LEMMINGS`, `SAVE_REQUIREMENT`, `TIME_LIMIT`
- `MAX_SPAWN_INTERVAL`, `SPAWN_INTERVAL_LOCKED`
- `WIDTH`, `HEIGHT`, `START_X`, `START_Y`, `BACKGROUND`

### Skillset
- Stored as `Map` keyed by classic skill names.
- NeoLemmix skills not in classic Lemmings are currently ignored.

### Terrain and gadget entries
- Each entry is `{ props, order, unknownLines }`.
- Common props: `STYLE`, `PIECE`, `X`, `Y`, `ROTATE`, `FLIP_HORIZONTAL`, `FLIP_VERTICAL`, `WIDTH`, `HEIGHT`.
- Editor UI snaps `ROTATE` to 0/90/180/270 for classic preview.
- Terrain flags: `NO_OVERWRITE`, `ERASE`, `ONE_WAY`.
- Gadgets can define `SKILL`, `LEMMINGS`, `PAIRING`.

### Terrain groups
- `terrainGroups` holds group-level props and nested terrain entries.
- `STEEL` in group props marks a steel-only group.

### Steel rectangles
- `steel` holds editor steel rectangles as `{ props, order, unknownLines }`.
- Each entry uses `X`, `Y`, `WIDTH`, `HEIGHT`.
- Serialized as `$STEEL` sections for classic tooling and preview parity.

### Unknown sections
- Unknown lines and sections are preserved to avoid data loss.

## Style registry

`StyleRegistry` links style names to classic ground set IDs and piece lists.

- `groundSet` maps to `GROUNDxO.DAT` / `VGAGRx.DAT`.
- `terrainPieces` and `gadgetPieces` provide piece names and IDs.
- Registry can be extended later for NeoLemmix style packs.

## Asset metadata

Editor asset metadata is loaded from classic DAT files and used for:
- Palette lists (piece names, trigger flags).
- Hit testing (piece width/height).
- Determining entrance and exit pieces (by trigger metadata).

## Preview mapping

The editor mapping converts `EditorLevel` to classic runtime data:
- `STYLE` -> `graphicSet1` via `StyleRegistry` ground set.
- Terrain and gadget entries -> `LevelElement` with `DrawProperties`.
- `TIME_LIMIT` of `INFINITE` -> 0 seconds for classic runtime.
- Steel rectangles are projected into classic `Level.steel` ranges.
