# GameDisplay overview

tags: render, display

`js/GameDisplay.js` binds the game state to a GUI display. `setGuiDisplay()` attaches mouse handlers that select the nearest lemming on click and track the mouse position for debugging. The `render()` method draws the level, objects, and lemmings. When debug is off it highlights the selected lemming and the one under the cursor. `renderDebug()` paints additional debug information and shows a marching-ants rectangle around the nearest lemming.

`#drawSelection()` now uses `drawDashedRect` and `drawCornerRect` to outline the current lemming with a bright green (`0xFF30FF30`) 1 px dashed rectangle. The dashes use length 1 so the box is thin. Hover outlines call `#drawHover()` which draws a dark grey rectangle raised slightly higher and adds 3 px corner squares via `drawCornerRect`.
