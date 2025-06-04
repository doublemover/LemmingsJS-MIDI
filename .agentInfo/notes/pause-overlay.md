# Pause overlay highlight

tags: bench-mode, gui

Bench mode previously flashed the entire stage red while pausing. It now calls `startOverlayFade(rect)` to fade a rectangle over the pause button instead.
