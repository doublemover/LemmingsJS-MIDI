# GUI and viewport tasks

tags: todo, gui, stage

A collection of fixes requested by users:
1. Ensure the GUI panel remains visible by scaling its height correctly in `Stage.updateStageSize()`.
2. Increase the zoom limit and fix panning by recomputing camera bounds after scale changes.
3. Draw the selection rectangle with transparent dashes and no corner art.
4. Simplify the hover outline to a dark grey dashed rectangle.
5. When a skill is chosen with a lemming selected, apply it immediately if valid.
6. Correct input scaling in `UserInputManager.getRelativePosition()` so cursor position matches the pointer.
7. Remove the custom cursor and display the system pointer instead.
8. Verify clicking a lemming selects it and add unit tests for `GameDisplay`.
