# GameView overview

tags: game-view, setup, stage

`GameView` bootstraps the game. Setting `.gameCanvas` builds a `Stage` for the canvas element. `setup()` loads available configs and `start()` wires a `Game` instance to the stage and GUI. `stage.getGameViewRect()` exposes the viewport for the mini-map. See `stage.md` for stage and canvas details.
