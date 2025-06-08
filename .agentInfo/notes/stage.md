# Stage overview

tags: stage, canvas, input

`js/Stage.js` binds the canvas and sets up a `UserInputManager` for mouse events. `getGameDisplay` and `getGuiDisplay` create offscreen `DisplayImage` buffers used by `redraw`. `updateViewPoint` keeps the level centered when zoomed out. See `game-view.md` for how the stage is created.

The HUD always renders at **4× scale**. Older notes suggested a value of 2, but `Stage.updateStageSize()` clamps it to four for consistent layout.

GameView.gameCanvas now calls `stage.updateStageSize()` right after creating the Stage so the HUD and game panel line up on first load. See [js/GameView.js](../../js/GameView.js) and [js/Stage.js](../../js/Stage.js).

## HUD offset and anchoring

`updateStageSize()` centers the HUD panel horizontally with:
```
this.guiImgProps.x = (stageW - hudW) / 2
this.guiImgProps.y = gameH
```
where `gameH = stageH - hudH`. This keeps the panel flush against the bottom of the game area.

The game viewport anchors to the bottom of the level by setting
```
viewPoint.y = worldH - viewH_world
```
so the top of the HUD touches the terrain even when zoomed out. If the level is narrower than the canvas the X position is centered; otherwise it clamps to the left edge.

## Viewport calculations

`updateViewPoint()` converts the cursor to world coordinates before adjusting the scale. After zooming it repositions the view so the same world point stays under the cursor. Panning divides drag distances by the current scale and clamps the result between 0 and the level bounds. Tests `stage.updateStageSize.test.js` and `stage.updateviewpoint.test.js` verify these behaviors.
