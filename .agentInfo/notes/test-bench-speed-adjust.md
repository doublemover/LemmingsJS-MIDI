# Bench speed adjust test

tags: tests, bench-mode

Adds a unit test that simulates dropped and normal ticks using fake timers. The test verifies `GameTimer.#benchSpeedAdjust()` lowers `speedFactor` when the timer falls behind and restores it once stable again.
