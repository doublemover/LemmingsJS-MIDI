# GameGui note

tags: gui, input

`GameGui` manages the skill panel and all GUI mouse actions. `setGuiDisplay` attaches handlers that keep responding even while the game is paused. Clicking adjusts release rate or selects a skill, and right-clicks provide shortcuts. `render` draws the panel with a marching-ants highlight around the active skill and greys out unavailable buttons. `setMiniMap` updates the mini-map, and `GameSkills.selectFirstAvailable` chooses the first usable skill on level load. See the README for keyboard shortcuts.
