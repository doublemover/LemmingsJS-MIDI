# GameView overview

tags: game-view, setup, stage

`GameView` orchestrates the page's startup sequence. Assigning to the `.gameCanvas` property constructs a new `Stage` bound to the HTML canvas element. Calling `setup()` uses `GameFactory` to read available configs and fills the level and group selectors. `start()` then acquires a `Game` instance, connects its displays via the stage, and begins play.

During `Game.start()` the GUI's mini‑map is created when `GameGui.setMiniMap` runs, storing the map on `gameGui.miniMap`.

`stage.getGameViewRect()` provides the current viewport bounds. `GameGui` feeds
this rectangle to `MiniMap.render` so the map can draw an accurate view frame.
