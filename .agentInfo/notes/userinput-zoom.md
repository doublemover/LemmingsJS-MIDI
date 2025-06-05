# UserInputManager zoom updates

tags: stage, input, tests

The mouse wheel now zooms around the pointer by converting the cursor's screen
position into world coordinates before applying the scale change. `Stage.updateViewPoint`
tracks a raw scale for smooth steps, snaps the value for crisp pixels and adjusts
the view so the same world point stays under the cursor.

The test [`test/stage.updateviewpoint.test.js`](../../test/stage.updateviewpoint.test.js)
verifies this behavior by confirming that zooming preserves the cursor's world
position.
