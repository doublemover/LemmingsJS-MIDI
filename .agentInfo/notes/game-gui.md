# GameGui note

tags: gui, input

`GameGui` drives the skill panel and handles player input for the in-game GUI.

## Input handling
- `setGuiDisplay` attaches event listeners on the provided Display:
  - `onMouseDown` triggers `handleSkillMouseDown` when clicked inside the panel.
  - `onMouseRightDown` triggers `handleSkillMouseRightDown`.
  - `onDoubleClick` triggers `handleSkillDoubleClick`.
  - `onMouseMove` updates hover states through `handleMouseMove`.
  - All events run even if the simulation is paused, allowing the GUI to keep updating.

`handleSkillMouseDown` interprets panel coordinates to adjust the release rate, change game speed, prepare the nuke, or select a skill. Right-click behavior in `handleSkillMouseRightDown` provides shortcuts such as setting release rate to min/max, resetting speed, or toggling debug. `handleSkillDoubleClick` instantly nukes when double-clicking the nuke panel.

## Skill panel updates
`render` refreshes the panel whenever flags like `gameTimeChanged` or `skillsCountChanged` are set. It draws remaining skill counts, highlights the selected skill via `drawSelection`, and applies grey stippling when a skill or release-rate button is unavailable. Hover states and the nuke confirmation are drawn every frame. The marching-ants offset increments in `_guiLoop` so the selection outline animates even while paused.

When the release rate reaches its minimum or maximum, panels 0 and 1 show a stippled border rather than covering the digits. Once the lock is released the GUI refreshes the background so any leftover dots disappear.

## Mini-map synchronization
`setMiniMap` stores a MiniMap instance and passes it to the lemming manager. During `render`, after updating the panel, `miniMap.render` is called with the current `level.screenPositionX` and display width so the map matches the view.
