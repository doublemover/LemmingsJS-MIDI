# Skill Panel Toolbar

This document summarizes how the original Lemmix Pascal source implements the skill panel toolbar, focusing on the `TSkillPanelToolbar` class found in `src/Game.SkillPanel.pas`.

## Bitmap Loading and Button Setup
- The toolbar reads sprites from the current style in `ReadBitmapFromStyle`.
  - Both the normal and "hi-res" palettes are combined into the bitmap's palette.
  - Style images and fonts are loaded at this stage.
- Button rectangles are initialized through `SetButtonRects` so each skill button has a bounding box for hit detection.

## Mouse Interaction
`TSkillPanelToolbar` exposes several mouse related events which are fired from internal handlers:
- **`ImgMouseDown`** – Checks if the click lands in the minimap or on a skill button.
  - Triggers `OnMinimapClick` if inside the minimap.
  - Triggers `OnSkillButtonsMouseDown` when a skill button is pressed.
- **`ImgMouseMove`** – While the left mouse button is held down over the minimap, dragging moves the minimap cursor.
- **`ImgMouseUp`** – Signals `OnSkillButtonsMouseUp` so the rest of the UI can react when the user releases the mouse.

## Text Drawing and Pause Highlighting
- `DrawSkillCount` draws each numeric skill counter using glyphs from `fSkillFont`. If the count reaches zero, the area is cleared with a solid color.
- Information text such as the current release rate or timer is written to buffers with helpers like `SetInfoSeconds` and later rendered by `DrawNewStr`.
- The pause button highlight is tracked by `SetPauseHighlight` and redrawn with `DrawCheckPauseButton` when the highlight state changes.

## Image Updates and Scaling
- `BeginUpdateImg` and `EndUpdateImg` bracket bitmap modifications to avoid unnecessary redraws.
- `SetStyleAndGraph` loads the style images, initializes the pause-button buffer, applies scaling, and then invalidates the control so it repaints at the new dimensions.

## Minimap and Selection Colors
- `DrawMinimap` copies the minimap bitmap to the toolbar and outlines the current viewport using `fRectColor`.
- `DrawButtonSelector` employs the same color when highlighting a skill button.
- In **Lemmix** the constructor sets `fRectColor` based on the active palette: it uses the Christmas palette's red entry when `Consts.ChristmasPalette` is true, otherwise the standard white entry.
- **NeoLemmix** initializes this highlight color to the constant `$FFF0D0D0`, which is then used for both minimap framing and button selection.

