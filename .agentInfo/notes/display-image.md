# DisplayImage overview

tags: display, canvas, scaling, image

`DisplayImage` is an offscreen canvas that `Stage` uses for both the game area and the GUI layer.  Each instance owns an `ImageData` buffer which is created through `Stage.createImage()`.  A `Uint32Array` view (`buffer32`) aliases this buffer so drawing routines can operate on 32‑bit pixels directly.

The method `initSize(width, height)` (re)allocates this `ImageData` and buffer.  After allocating it calls `clear()` which fills the entire image with a color (default `0xFF00FF00`).  `setBackground()` copies an existing ground image into the buffer, handling both `Uint8ClampedArray` and `Uint32Array` sources and storing an optional mask for later use.

`DisplayImage` exposes several event handlers – `onMouseDown`, `onMouseUp`, `onMouseRightDown`, `onMouseRightUp`, `onMouseMove` and `onDoubleClick`.  `Stage` forwards pointer events to these handlers so the rest of the engine can listen for input relative to the offscreen canvas.

GameDisplay highlights lemmings with dashed outlines. Hover uses a dark grey rectangle while the selected lemming gets a brighter green (`0xFF30FF30`). Both use `drawDashedRect` with 1 px dashes and sit slightly above the feet. A redundant skill switches the selection outline to yellow (`0xFFFFFF00`).

`drawCornerRect(x, y, size, r, g, b, length = 1, midLine = false, midLen = 0)` draws L-shaped corner marks. The `length` parameter controls the size of the corner arms while `midLine` and `midLen` can add centered side lines. GameDisplay uses the defaults so only the corners are drawn.

`js/DisplayImage.js` now exposes three scaling helpers – `scaleNearest`, `scaleXbrz` and `scaleHqx`.  `_blit()` chooses between them using its `scaleMode` option which defaults to `'nearest'`.  The XBRZ and HQX paths require even scaling factors of 2–4 and fall back to nearest-neighbour otherwise.
