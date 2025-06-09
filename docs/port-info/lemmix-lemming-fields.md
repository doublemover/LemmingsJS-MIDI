# Lemmix TLemming Structure

This document notes how the Pascal version of the game (Lemmix) models a lemming. It summarizes the fields and helper routines from `src/Game.pas` lines 60‑107 and related logic. These notes can help when porting behaviour to JavaScript.

## Key Fields

| Field | Purpose |
|-------|---------|
| `XPos`, `YPos` | Current foot position of the lemming on the map. |
| `XDelta` | Horizontal velocity (1 for right, –1 for left). |
| `Fallen` | Distance fallen when in a falling state. |
| `ExplosionTimer` | Countdown for bombers (79 down to 0). |
| `LMA`, `LAB`, `Frame`, `MaxFrame`, `AnimationType` | Animation pointers and frame indices. |
| `ParticleTimer`, `ParticleFrame` | Track explosion particle frames. |
| `FrameTopDy`, `FrameLeftDx` | Offsets from the animation foot point. |
| `FloatParametersTableIndex` | Index into the floater parameter table. |
| `NumberOfBricksLeft` | Remaining bricks for builders. |
| `Born` | Game tick when spawned. |
| `Action`, `ActionBits` | Current action enum and bit flags used by `ActionIn`. |
| `ObjectBelow`, `ObjectInFront` | Object map bytes under and ahead of the lemming. |
| `EndOfAnimation` | True when the current animation reached its final frame. |
| `IsRemoved` | Marks lemming for deletion. |
| `IsClimber`, `IsFloater` | Ability flags. |
| `IsBlocking` | True when acting as a blocker. |
| `IsNewDigger` | Indicates the first tick of a digging action. |
| `IsExploded` | Whether the bomber explosion occurred. |
| `PhotoFlashForReplay` | Replay helper flag. |
| `CombineFlags` | Combination of climber/floater/builder bits for recolouring. |
| `PixelCombine` | Function pointer for drawing effects. |
| `SavedMap[0..8]` | Backup of object-map bytes under the blocker field. |
| `RectToErase`, `ListIndex` | Rendering bookkeeping. |

### ActionIn

`ActionIn(aFlag: Integer): Boolean` returns `True` when `ActionBits` contains the provided flag. It is a fast way to check whether a lemming is in one of several related actions.

## Blocking Behaviour

When a lemming transitions into the blocking state, the game clears the builder flag from `CombineFlags`, saves the surrounding object map in `SavedMap`, then writes the blocker field so that other lemmings turn around. Upon leaving the block—either because there is no ground beneath or the blocker explodes—the saved map bytes are restored so terrain remains unchanged.
