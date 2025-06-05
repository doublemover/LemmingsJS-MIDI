# GameTimer test coverage

tags: tests, gametimer

Additional tests validate that `GameTimer` pauses automatically when the
`visibilitychange` event reports a hidden document and resumes once visible
again. They also verify the private speed adjustment logic through bench and
catch-up modes by driving the timer with `fakeTimers`.
