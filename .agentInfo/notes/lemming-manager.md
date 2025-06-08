<<<<<<< tmp_merge/ours_.agentInfo_notes_lemming-manager.md
=======
<<<<<<< tmp_merge/ours_.agentInfo_notes_lemming-manager.md
=======
<<<<<<< tmp_merge/ours_.agentInfo_notes_lemming-manager.md
=======
# LemmingManager overview

tags: lemming-manager, actions

`LemmingManager` orchestrates all lemming entities. The constructor receives the
level, sprite resources, a `TriggerManager` instance and the victory condition.
It creates arrays of `Action*System` objects, one for each lemming state and
skill.

On every `tick()` it spawns new lemmings from level entrances, advances each
lemming via `lem.process(level)` and processes triggers through
`runTrigger(lem)`. The result of each action or trigger is passed to
`processNewAction` which ultimately calls `setLemmingState`.

`setLemmingState` assigns a new `Action*System` to a lemming and handles special
cases such as removing a lemming when it leaves the level. It also logs state
changes via the inherited `BaseLogger`.

The manager tracks selected lemmings for user interaction and maintains minimap
dots. Nuking all lemmings iterates through the array, applying the bomber skill
to each in turn.

>>>>>>> tmp_merge/theirs_.agentInfo_notes_lemming-manager.md
>>>>>>> tmp_merge/theirs_.agentInfo_notes_lemming-manager.md
>>>>>>> tmp_merge/theirs_.agentInfo_notes_lemming-manager.md
