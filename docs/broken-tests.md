# Broken tests

The following unit tests are currently failing and need additional investigation:

- [`test/gametimer.test.js`](../test/gametimer.test.js) – the *pause/resume via visibilitychange stops ticks* and *catchupSpeedAdjust scales across repeated delays* cases do not yield the expected `speedFactor` when run with fake timers. Mocked `requestAnimationFrame` calls and changes to the timer logic were unable to match the test expectations.
- [`test/stage.updateviewpoint.test.js`](../test/stage.updateviewpoint.test.js) – the *keeps cursor position stable while zooming*, *wheel zoom keeps cursor position stable* and *preserves world coords at multiple cursor positions* cases drift by over 80 pixels after the wheel zoom changes. The new center-preserving math diverges from the test's expectations and needs further refinement.

