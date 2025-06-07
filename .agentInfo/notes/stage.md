# Stage overview

tags: stage, canvas, input

`js/Stage.js` binds the canvas and sets up a `UserInputManager` for mouse events. `getGameDisplay` and `getGuiDisplay` create offscreen `DisplayImage` buffers used by `redraw`. `updateViewPoint` keeps the level centered when zoomed out. See `game-view.md` for how the stage is created.

GameView.gameCanvas now calls `stage.updateStageSize()` right after creating the Stage so the HUD and game panel line up on first load. See [js/GameView.js](../../js/GameView.js) and [js/Stage.js](../../js/Stage.js).
