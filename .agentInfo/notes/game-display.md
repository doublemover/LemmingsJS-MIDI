# GameDisplay overview

tags: render, display

`js/GameDisplay.js` binds the game state to a GUI display. `setGuiDisplay()` attaches mouse handlers that select the nearest lemming on click and track the mouse position for debugging. The `render()` method draws the level, objects, and lemmings. When debug is off it also highlights the selected lemming with white corners and the hovered one with a grey rectangle. `renderDebug()` paints debug information for the level, lemmings and triggers and draws a marching-ants rectangle around the nearest lemming to the mouse.

Selection is drawn by `#drawSelection()` which calls `#drawCorner()` four times to paint tiny white rectangles at the lemming's corners. Hover uses `#drawHover()` which fills a 10×13 grey box. These helpers provide visual feedback without intruding on normal gameplay.
