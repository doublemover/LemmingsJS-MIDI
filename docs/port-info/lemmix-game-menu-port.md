# Lemmix Game Menu Reference

This document collects notes on the original Lemmix Pascal code that powers the menu screen. The port in this repository mirrors much of that behavior in JavaScript.

## Menu Bitmaps and Placement

`TGameMenuBitmap` enumerates the menu graphics, including:

- `Logo`
- `Play`
- `LevelCode`
- `Music`
- `Section`
- `Exit`
- navigation arrows and icons such as `Navigation`, `MusicNote`, `FXSound`
- section bitmaps `GameSection1` through `GameSection5`

Every entry maps to fixed coordinates in `GameMenuBitmapPositions`. `DrawBitmapElement` looks up these coordinates to blit the image onto the menu screen. When `AdjustLogoInMenuScreen` is enabled the code centers the logo instead of using the default position.

## Credits Reel Animation

The menu plays a rolling credits animation using two bitmaps (`Reel` and `ReelBuffer`) that form a horizontal strip of letterboxes. `CreditList` stores the credit lines. `SetNextCredit` advances through this list, computing when a line should appear. `Application_Idle` scrolls the reel left each frame, pausing when a line is centered. During each cycle it calls `DrawWorkerLemmings` and `DrawReel` to update the screen.

## Keyboard Commands

`Form_KeyDown` handles menu shortcuts:

- `Return` or `F1` – preview the level
- `F2` – open the level code dialog
- `F3` – switch the sound option via `NextSoundSetting`
- `F4` – open options
- `F5` – open configuration
- `Esc` – exit the game
- arrow keys – change sections using `NextSection`
- `Space` – pause or unpause the credits reel
- with `Ctrl` held, `F1` opens the level finder and, in debug builds, `F2` exports levels

## Sound and Section Selection

`NextSoundSetting` cycles through sound modes (off, only sound effects, music + sound) and uses `Speak` to provide audible feedback. `NextSection` moves the highlighted section forward or backward and announces the name aloud. Both routines repaint the menu elements to reflect the new state.

