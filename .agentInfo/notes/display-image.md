# DisplayImage overview

tags: display, canvas

`DisplayImage` is an offscreen canvas that `Stage` uses for both the game area and the GUI layer.  Each instance owns an `ImageData` buffer which is created through `Stage.createImage()`.  A `Uint32Array` view (`buffer32`) aliases this buffer so drawing routines can operate on 32‑bit pixels directly.

The method `initSize(width, height)` (re)allocates this `ImageData` and buffer.  After allocating it calls `clear()` which fills the entire image with a color (default `0xFF00FF00`).  `setBackground()` copies an existing ground image into the buffer, handling both `Uint8ClampedArray` and `Uint32Array` sources and storing an optional mask for later use.

`DisplayImage` exposes several event handlers – `onMouseDown`, `onMouseUp`, `onMouseRightDown`, `onMouseRightUp`, `onMouseMove` and `onDoubleClick`.  `Stage` forwards pointer events to these handlers so the rest of the engine can listen for input relative to the offscreen canvas.

GameDisplay now draws hover and selection rectangles using `drawDashedRect` with
`dashLen` 2. Hover uses a mid-dark grey (`0xFF555555`) while the selected
lemming gets a bright green outline (`0xFF00FF00`). If the selected skill would
be redundant (basher, blocker, digger or miner) the outline turns yellow
(`0xFFFFFF00`). The rectangle sits three pixels higher than before so more of the
lemming is visible.
