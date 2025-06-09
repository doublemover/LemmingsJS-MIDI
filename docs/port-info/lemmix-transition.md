# Lemmix Transition and TurnAround

This document summarizes the behavior of the `Transition` and `TurnAround` procedures in **Lemmix** (Pascal), based on the implementation found in `src/Game.pas`.

## Transition

`Transition` changes a lemming's state and loads the appropriate animation. The procedure:

1. If a turn-around is requested, the horizontal velocity `xDelta` is negated.
2. It loads animation metadata for the new action and facing direction:
   - `MetaLemmingAnimation` (frame data and type)
   - `LemmingBitmap` (sprite set)
   - maximum frame count and alignment offsets
3. When the action actually changes, counters and flags reset:
   - `Frame` set to `0`
   - `EndOfAnimation`, `Fallen`, and builder-related flags cleared
4. A `case` statement updates action-specific state. Examples:
   - *Splatting* resets the explosion timer and stops horizontal movement.
   - *Building* sets `NumberOfBricksLeft` to `12` and clears the builder flag.
5. When combine flags change, `UpdatePixelCombine` refreshes the rendering state.

## TurnAround

`TurnAround` mirrors the lemming's direction without changing its action. It flips `xDelta` and reloads the same animation for the opposite orientation so frame counters remain valid.

