# Game note

tags: game, main-loop

`Game` in `js/Game.js` coordinates level setup and the main loop. `loadLevel()` resets any previous state and then loads the selected level via `gameResources.getLevel`. It constructs `GameTimer`, `CommandManager`, `GameSkills`, `GameVictoryCondition`, `TriggerManager`, `LemmingManager`, `ObjectManager`, `GameGui`, and `GameDisplay`, wiring them together. The timer's `onGameTick` event is bound to `onGameTimerTick`.

`onGameTimerTick()` runs `runGameLogic()`, checks for game over conditions, and renders both the playfield and GUI. `start()` resumes the timer while `_disposeCurrentLevel()` cleans up managers when a level ends or the game stops. `setGameDisplay()` and `setGuiDisplay()` attach the renderer objects when available.
