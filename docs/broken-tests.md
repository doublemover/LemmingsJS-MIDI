# Broken tests

The following unit tests are currently failing and need additional investigation:

- [`test/gametimer.test.js`](../test/gametimer.test.js) – the *pause/resume via visibilitychange stops ticks* and *catchupSpeedAdjust scales across repeated delays* cases do not yield the expected `speedFactor` when run with fake timers. Mocked `requestAnimationFrame` calls and changes to the timer logic were unable to match the test expectations.

