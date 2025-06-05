# GameDisplay overview

tags: render, display

`js/GameDisplay.js` binds the game state to a GUI display. `setGuiDisplay()` attaches mouse handlers that select the nearest lemming on click and track the mouse position for debugging. The `render()` method draws the level, objects, and lemmings. When debug is off it highlights the selected lemming and the one under the cursor. `renderDebug()` paints additional debug information and shows a marching-ants rectangle around the nearest lemming.

`#drawSelection()` now calls `drawCornerRect` to paint 2 px squares at each corner of the 10 × 13 rectangle (`x-5`, `y-11`).  The default colour is bright green (`0x00FF00`) but turns yellow when the selected skill would do nothing.  `#drawHover()` uses the same helper with a grey about 10 % lighter than `0x555555`.
