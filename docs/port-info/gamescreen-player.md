# Lemmix GameScreen.Player overview

This document summarizes the inner workings of `GameScreen.Player.pas` from the original Lemmix project. The JavaScript port emulates these behaviors.

## Timers and `Application_Idle`
`FrameTimer` and `ScrollTimer` are `TTicker` objects whose intervals vary with game speed (e.g. `INTERVAL_FRAME` = 58 ms, `INTERVAL_FRAME_SUPERLEMMING` = 20 ms). `Application_Idle` polls these timers every idle cycle:

- When a timer has elapsed it is reset and an action is taken.
- `FrameTimer` drives `Game.Update`, advancing lemmings and physics.
- `ScrollTimer` calls `CheckScroll` to pan the viewport when scrolling is active.
- The method sets `Done := False` so the loop runs continuously, pausing briefly when not fast-forwarding.

## Cursor logic and map dragging
- `GetHelpText` builds the help screen strings describing all keyboard and mouse shortcuts.
- `CheckResetCursor` ensures the image cursor matches `Game.CurrentCursor`.
- `SetAdjustedGameCursorPoint` converts bitmap coordinates to the game's hotspot by applying an offset of `(−3, +2)`.
- Holding `Alt` while left-clicking in `Img_MouseDown` begins map dragging (`fDraggingMap := True`), adjusting `Img.OffsetHorz` as the mouse moves until `Img_MouseUp` releases it.

## Keyboard and mouse events
- `Form_KeyDown` selects skills via `VK_F3`..`VK_F10`, toggles pause (`VK_F11` or `VK_PAUSE`), nukes (`VK_F12`) and starts scrolling with the arrow keys. With `Ctrl` pressed, `F1` and `F2` set the release rate to minimum or maximum.
- `Form_KeyUp` stops scrolling or release-rate changes when the key is released.
- `Form_KeyPress` handles shortcuts such as skipping/rewinding (`1`, `!`, space), fast-forward (`f`), loading replays (`l`), saving (`u`), showing help (`?`) and changing music volume (`+`, `-`).
- Mouse handlers (`Img_MouseDown`, `Img_MouseMove`, `Img_MouseUp`) update `Game.CursorPoint`, apply skills, manage map dragging and trigger scrolling when the pointer touches screen edges.

## Save states and replays
- `SaveState` records the current frame number (`fSaveStateIteration`) so play can return to it later.
- `GotoSaveState` calls `Game.GotoIteration` to restore that frame when available.
- `StartReplay` plays back the current `Game.Recorder` contents while `StartNoReplay` restarts the level with no replay loaded.
- `StartReplayFromFile` loads a replay file via `Game.Recorder.LoadFromFile` and begins playback if successful, otherwise an error is shown.
