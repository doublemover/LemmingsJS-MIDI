<<<<<<< tmp_merge/ours_.agentInfo_notes_stage.md
=======
<<<<<<< tmp_merge/ours_.agentInfo_notes_stage.md
=======
# Stage overview

tags: stage, canvas, input

`js/Stage.js` binds the canvas and sets up a `UserInputManager` for mouse events. `getGameDisplay` and `getGuiDisplay` create offscreen `DisplayImage` buffers used by `redraw`. `updateViewPoint` keeps the level centered when zoomed out. See `game-view.md` for how the stage is created.

The HUD always renders at **4× scale**. Older notes suggested a value of 2, but `Stage.updateStageSize()` clamps it to four for consistent layout.

GameView.gameCanvas now calls `stage.updateStageSize()` right after creating the Stage so the HUD and game panel line up on first load. See [js/GameView.js](../../js/GameView.js) and [js/Stage.js](../../js/Stage.js).
>>>>>>> tmp_merge/theirs_.agentInfo_notes_stage.md
>>>>>>> tmp_merge/theirs_.agentInfo_notes_stage.md
