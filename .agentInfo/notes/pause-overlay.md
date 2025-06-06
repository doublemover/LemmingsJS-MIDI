# Pause overlay highlight

tags: bench-mode, gui

Bench mode previously flashed the entire stage red while pausing. It now calls `startOverlayFade(rect)` to fade a rectangle over the pause button instead.
`startOverlayFade` accepts a dash length to draw marching‑ants around `rect`.
`GameTimer.#benchSpeedAdjust` sets this length based on queued steps and passes
the color so the outline matches the fade.
