<<<<<<< tmp_merge/ours_.agentInfo_notes_game-display.md
=======
<<<<<<< tmp_merge/ours_.agentInfo_notes_game-display.md
=======
<<<<<<< tmp_merge/ours_.agentInfo_notes_game-display.md
=======
<<<<<<< tmp_merge/ours_.agentInfo_notes_game-display.md
=======
# GameDisplay overview

tags: render, display

`js/GameDisplay.js` binds the game state to a GUI display. `setGuiDisplay()` attaches mouse handlers that select the nearest lemming on click and track the mouse position for debugging. The `render()` method draws the level, objects, and lemmings. When debug is off it highlights the selected lemming and the one under the cursor. `renderDebug()` paints additional debug information and shows a marching-ants rectangle around the nearest lemming.

`#drawSelection()` now draws bright green corner rectangles using `drawCornerRect`. Each corner uses a 1 px square so the outline looks thinner but still visible. Hover outlines call `#drawHover()` which draws lighter grey corners to indicate the focused lemming without the vivid green.

>>>>>>> tmp_merge/theirs_.agentInfo_notes_game-display.md
>>>>>>> tmp_merge/theirs_.agentInfo_notes_game-display.md
>>>>>>> tmp_merge/theirs_.agentInfo_notes_game-display.md
>>>>>>> tmp_merge/theirs_.agentInfo_notes_game-display.md
