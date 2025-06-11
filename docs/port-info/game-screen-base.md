# GameScreen.Base port notes

This document collects details about `TPurpleFont` and `TGameBaseScreen` from the Delphi `GameScreen.Base.pas` module used by **Lemmix**. It summarises how the DOS-style text font is created and how screen images and transitions are handled. See [forms-overview.md](forms-overview.md) for the overall screen lifecycle.

## TPurpleFont setup

* The purple DOS font defines a constant `PURPLEFONTCOUNT` to allocate one `TBitmap32` per printable character from `!` through `~`.
* A `TPurpleFont` instance holds these images in the `fBitmaps` array. Each bitmap uses draw mode `dmCustom` with a custom pixel combine function that simply copies the source pixel when it is non-zero.
* `GetBitmapOfChar` indexes this array to obtain the bitmap for a given character, while `SaveBitmaps` writes all bitmaps to disk.
* `TGameBaseScreen.ExtractPurpleFont` loads these bitmaps from `main.dat` and stores them in the screen's `fPurpleFont` field.

## TGameBaseScreen fields and methods

* Important fields include:
  * `fScreenImg` – the visible image shown in the form.
  * `fBackGround` – a bitmap used when tiling the backdrop.
  * `fBackBuffer` – an off-screen buffer for temporary drawing.
  * `fPurpleFont` – the DOS font described above.
  * Flags for the original image rectangle, whether the screen is stretched, and a closing delay.
* `TileBackgroundBitmap` repeatedly draws `fBackGround` across a destination bitmap, defaulting to the main screen image.
* `DrawPurpleText` renders DOS-style text by drawing each character's bitmap. `DrawPurpleTextCentered` splits multi-line text and centres each line before calling `DrawPurpleText`.
* `FadeOut` decreases the window's `AlphaBlendValue` in steps, repainting between each step to produce a fade effect before the form closes.

## Image stretching and transitions

* The `Stretched` property controls whether the screen image should fill the form. `AdjustImage` aligns and scales the image accordingly.
* `InitializeImageSizeAndPosition` sets up the bitmap size, centres it, stores the original bounds and then calls `AdjustImage` to honour the stretching mode.
* `BeforeCloseScreen` waits for `fCloseDelay` milliseconds when set and performs a fade-out if configured to ensure smooth transitions between screens.

