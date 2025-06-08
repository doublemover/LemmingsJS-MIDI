<<<<<<< tmp_merge/ours_.agentInfo_notes_trigger-manager.md
=======
<<<<<<< tmp_merge/ours_.agentInfo_notes_trigger-manager.md
=======
# TriggerManager notes

tags: trigger-system, grid

`TriggerManager` maintains spatial triggers such as exits, traps and blocker
zones. It divides the level into a grid of fixed-size cells (default 16px) and
stores a set of triggers per cell for quick lookup.

`add()` registers a trigger, placing it in all grid cells that intersect its
bounding box. `trigger(x, y)` checks the corresponding cell for hits and returns
a `TriggerTypes` enum value. Each trigger holds a `disabledUntilTick` counter to
avoid repeated activation.

Removal uses the stored bucket indices to efficiently delete triggers from the
grid. When rendering debug overlays `renderDebug()` highlights visited cells and
draws trigger rectangles via a prebuilt `Frame`.

>>>>>>> tmp_merge/theirs_.agentInfo_notes_trigger-manager.md
>>>>>>> tmp_merge/theirs_.agentInfo_notes_trigger-manager.md
