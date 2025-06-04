# Stage overview

tags: stage, canvas, input

`js/Stage.js` creates a `Stage` bound to a canvas element. The constructor sets up a `UserInputManager` for that canvas and wires mouse handlers with helper methods like `handleOnMouseDown` and `handleOnDoubleClick`. Two `StageImageProperties` instances store layout and view information: `gameImgProps` for the gameplay area and `guiImgProps` for the GUI panel. The game display uses the default viewpoint scale while the GUI display starts with scale `2`.

`getGameDisplay` and `getGuiDisplay` lazily construct `DisplayImage` objects, each backed by its associated `StageImageProperties`. New canvases for these displays are made through `createImage`. The `clear` method fills either the whole stage or a single section with black and `redraw` pulls image data from both displays before drawing them to the main canvas.

When the game is zoomed out below scale `1` the level becomes smaller than the
display area. `updateViewPoint` now checks for that condition and offsets the
view point so the level remains centered in both directions.
