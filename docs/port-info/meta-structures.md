# Meta.Structures overview

This note summarizes the classes and constants from `src/Meta.Structures.pas` in the **Lemmix** repository. These types bridge binary DOS metadata (`Dos.Structures`) with higher level objects used across the game code.

## Constants

### Object animation types

| Constant | Meaning |
|----------|---------|
| `oat_None` | Object has no animation. |
| `oat_Triggered` | Starts moving when triggered by a lemming. |
| `oat_Continuous` | Loops continuously. |
| `oat_Once` | Plays only once when the object appears. |

### Object trigger effects

| Constant | Effect |
|----------|--------|
| `ote_None` | Harmless; no effect. |
| `ote_Exit` | Marks a lemming as exiting the level. |
| `ote_BlockerLeft` / `ote_BlockerRight` | Reserved for blocker fields. |
| `ote_TriggeredTrap` | Trap that animates once and kills. |
| `ote_Drown` | Water tile drowning. |
| `ote_Vaporize` | Desintegration objects. |
| `ote_OneWayWallLeft` / `ote_OneWayWallRight` | One-way terrain arrows. |
| `ote_Steel` | Steel area reserved id. |

### Object sound effects

`Meta.Structures.pas` enumerates sound effect IDs matching the DOS assets. Examples include `ose_SkillSelect`, `ose_OhNo`, `ose_Explosion` and `ose_BuilderWarning`.

## Type definitions

`TLemmingAnimationType` enumerates animation modes `Loop` and `Once`.

Several classes describe metadata loaded from DOS structures:

- **`TAbstractMetaAnimation`** – base class storing description, frame count, dimensions, image location and bit depth.
- **`TMetaLemmingAnimation`** – adds `AnimationType` and foot offsets for lemming sprites.
- **`TMetaExtraAnimation`** – used for masks and countdown digits.
- **`TMetaTerrain`** – width, height and image location for terrain pieces. `AssignFromDos` copies fields from `TDosMetaTerrain`.
- **`TMetaObject`** – full description of interactive objects including trigger areas, effect IDs and sound. `AssignFromDos` converts from `TDosMetaObject`.

List classes like `TMetaLemmingAnimationList` wrap `TFastObjectList` for convenience.

These structures are consumed by many modules when loading graphic sets or preparing animations. They isolate the binary layout from game logic, making it easier to port the engine to JavaScript.
