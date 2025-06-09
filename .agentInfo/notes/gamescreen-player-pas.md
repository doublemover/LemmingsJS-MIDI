# GameScreen.Player.pas overview

Source: [Lemmix/GameScreen.Player.pas](https://github.com/ericlangedijk/Lemmix/blob/master/src/GameScreen.Player.pas).

## Timers and Application_Idle
- `FrameTimer` and `ScrollTimer` are `TTicker` instances. Their intervals depend on game speed, e.g. `INTERVAL_FRAME` (58 ms) or `INTERVAL_FRAME_SUPERLEMMING` (20 ms). `Application_Idle` is registered with `TIdle`. It checks these timers every idle cycle:
  - When either timer has elapsed it resets it and performs an action.
  - `FrameTimer` drives `Game.Update` which advances lemmings and physics.
  - `ScrollTimer` calls `CheckScroll` to pan the viewport when keyboard or mouse scrolling is active.
  - The method sets `Done := False` so the idle handler runs repeatedly. It sleeps briefly when not fast-forwarding.

## Cursor logic and map dragging
- `GetHelpText` composes help strings listing all hotkeys and mouse actions shown by the in‑game help screen.
- `CheckResetCursor` ensures `Img.Cursor` and `Screen.Cursor` match the cursor selected by the game (`Game.CurrentCursor`).
- `SetAdjustedGameCursorPoint` converts a point from bitmap coordinates to the game's expected hotspot (offset by `(−3, +2)`).
- Holding `Alt` while left-clicking in `Img_MouseDown` starts map dragging (`fDraggingMap := True`), using `DragMap` to adjust `Img.OffsetHorz` as the mouse moves. Releasing the button via `Img_MouseUp` stops dragging.

## Keyboard and mouse events
- `Form_KeyDown` reacts to function keys for skill selection (`VK_F3`..`VK_F10`), pausing (`VK_F11` or `VK_PAUSE`), and nuking (`VK_F12`). Arrow keys initiate scrolling when held. With `Ctrl` pressed, `F1`/`F2` instantly set release rate to min/max.
- `Form_KeyUp` stops scrolling and release‑rate changes when the key is released.
- `Form_KeyPress` handles miscellaneous shortcuts such as skipping/rewinding time (`1`, `!`, space), toggling fast‑forward (`f`), loading replays (`l`), saving (`u`), showing help (`?`), and adjusting music volume (`+`, `-`).
- Mouse handlers (`Img_MouseDown`, `Img_MouseMove`, `Img_MouseUp`) update `Game.CursorPoint`, process skill assignments, start or stop map dragging, and trigger scrolling when the pointer reaches the screen edges.

## Save states and replay
- `SaveState` stores the current iteration index (`fSaveStateIteration`) so the player can return to this frame.
- `GotoSaveState` calls `Game.GotoIteration` when a save state exists.
- `StartReplay` runs the current `Game.Recorder` contents. `StartNoReplay` restarts the level with no replay loaded.
- `StartReplayFromFile` loads a replay file via `Game.Recorder.LoadFromFile` and begins playback if successful, otherwise displaying an error.
