# Lemmix Game controller

This note summarizes `Game.pas` from the original Pascal **Lemmix** project. The unit manages the main game state, updates lemmings, handles traps and triggers and plays sounds.

## Initialization

`Prepare` receives a `TGameInfoRec` with level data, style and options. It:

- Stores references to the renderer, target bitmap, level and style.
- Loads animation palettes and bitmaps for lemmings and masks.
- Reads the particle table used for explosions.
- Sets up the world bitmap, object map and minimap.
- Loads music through `SoundMgr` when available.
- Copies optional mechanics (pause glitch, nuke glitch, right‑click glitch) to the local `fMechanics` set.

`Start` resets the runtime state before gameplay begins:

- Clears lemming and object lists, resets counters and timers.
- Initializes entrance data and release order tables.
- Builds the object map and minimap then draws static HUD elements.
- Resets release rates and skill counts from the level info.
- Sets `Playing := True` so `UpdateLemmings` will run.

## Main loop

`UpdateLemmings` is called once per frame. It performs these steps:

1. Exit early if the game already finished then call `CheckForGameFinished`.
2. If not paused, adjust the release rate.
3. Increment iteration counters and update timers.
4. Erase sprites from the previous frame.
5. Release new lemmings when appropriate.
6. Call `CheckLemmings` to update each lemming via `HandleLemming`.
7. Update nuking state and interactive objects (traps, water, exits).
8. Update in‑game messages and draw all objects, lemmings and particles.
9. Process replay actions and queued sound effects.

`CheckLemmings` loops over `LemmingList`, updating explosion timers and invoking `HandleLemming` for the current state. If a lemming survives the update it may trigger terrain objects via `CheckForInteractiveObjects`.

## State transitions

`Transition` changes a lemming's `Action` and loads the corresponding animation set. It resets frame counters, handles turn‑around when requested and performs extra setup such as setting brick counts for builders or starting the splat sound. `TurnAround` simply flips `xDelta` and reloads the mirrored animation metadata.

## Global constants and fields

The unit defines several global tables and constants:

- `ParticleColorIndices` and `FloatParametersTable` control explosion particles and floater descent.
- `OBJMAPOFFSET`, `DOM_EXIT`, `DOM_WATER`, etc. describe the 4‑pixel‑resolution object map used for triggers.
- `LEM_MIN_X`, `LEM_MAX_X` and related limits bound lemming movement.
- Numerous sound effect indices (`SFX_*`) are stored as fields of `TLemmingGame` after loading.

## Differences from the JavaScript port

- The Pascal version keeps most game logic inside the single `TLemmingGame` class. The JS code splits responsibilities across `Game`, `LemmingManager`, `ObjectManager` and `GameTimer`.
- Lemmix drives the game loop through `UpdateLemmings` and explicit iteration counters, while the JS port relies on `GameTimer` events and per‑tick callbacks.
- Replay recording, pause/nuke glitches and hyper‑speed handling exist in `Game.pas` but are only partially implemented or stubbed in the JS code.
- JS modules use separate action systems per state rather than the large `HandleLemming` switch used in Pascal.

## Open questions / TODOs

- How should blocker `SaveMap`/`RestoreMap` behaviour be mapped to the JS object map?
- Several replay features (`Recorder.SaveToTxt`, glitch pause iteration handling) are not ported.
- The JS code lacks direct equivalents for `GameMessage` pop‑ups and some sound cue logic.
- Hyper‑speed and photo‑flash effects are only hinted at in the port; verify how they should behave.

