# Norm tick count removal

tags: cleanup, game-timer

The obsolete `normTickCount` field in `GameTimer` was folded into
`#stableTicks` and its accessor methods removed. Bench mode now updates
`#stableTicks` directly and the last assignment to `normTickCount`
was deleted.
