# TApp lifecycle overview

This document summarizes the global `TApp` class from the original Delphi version
(found in `src/Prog.App.pas` in the Lemmix repository). It covers its main fields,
how the constructor and destructor handle them, form stack management and other
global behaviors.

## Key fields

`TApp` holds the overall game state and many global managers:

- **Config** – persistent settings for styles, monitor index and options.
- **ReplayFileName** – path to the replay selected in the main menu.
- **Style** / **StyleCache** – the currently active style and cached style data.
- **ReplayCache** – keeps loaded replays for quick access.
- **SoundMgr** / **VoiceMgr** – audio playback managers.
- **MainForm** – reference to the main application window.
- **GlobalGame** – the main game instance.
- **CurrentLevelInfo** – structure describing the level to load.
- **ReplayCurrent** – `True` while a replay is in progress.
- **Level** – container for the current level.
- **GraphicSet** – caches loaded graphics for the level.
- **Renderer** – draws the game using cached graphic sets.
- **TargetBitmap** – drawing surface used while playing.
- **GameResult** – final statistics copied from the game.
- **NewStyleName** – pending style change requested by the options screen.
- **NewSectionIndex** / **NewLevelIndex** – jump destination for menu screens.
- **DebugLayerEnabled** – shows additional overlays when true.
- **fFormStack** – stack of open forms; last item is the active screen.
- **fCurrentForm** – shortcut to the screen on top of the stack.

## Initialization (`Create`)

The constructor loads configuration, prepares constants and resets indices. It
then allocates managers and caches in this order:

1. `Config.Load` to read the configuration file.
2. `Consts.Init` with paths from the configuration.
3. `Consts.SetStyleName(Config.StyleName)` and store it in `NewStyleName`.
4. Assign `CurrentDisplay.MonitorIndex` from `Config.Monitor`.
5. Set `NewSectionIndex` and `NewLevelIndex` to `-1`.
6. Create `fFormStack` and clear `fCurrentForm`.
7. Create `VoiceMgr` using voice options from the configuration.
8. Instantiate `ReplayCache` and the `Level` container.
9. Create the `Renderer` and `SoundMgr` managers.
10. Call `SoundData.Init` to load sound effects.
11. Construct `GlobalGame`, the core game object.

Fields like `Style`, `GraphicSet` and `TargetBitmap` remain `nil` until the
preview or player screens prepare them.

## Cleanup (`Destroy`)

The destructor writes back changed settings and disposes of objects in reverse
order of allocation:

1. Save `Consts.StyleName` and the current monitor index to `Config`.
2. `Config.Save` writes the configuration file.
3. `FreeAndNil(GlobalGame)` and then release renderer, level and sound manager.
4. Free graphics and style caches and the replay cache.
5. Free the voice manager and the form stack.
6. Call `Consts.Done` to clean up constants.
7. Execute the inherited destructor to complete shutdown.

`TApp` does not free `Style` directly because style instances are pooled.

## Form stack

`FormBegin` pushes a form onto `fFormStack` and stores it in `fCurrentForm`.
`FormEnd` pops the stack. When it becomes empty `fCurrentForm` is reset to `nil`.
This allows nested forms (menus, dialogs) to return control to the previous one
when closed.

## Voice toggle

`ToggleVoiceEnabled` speaks a short notification as it flips
`VoiceMgr.Enabled`. The new state is stored in `Config.MiscOptions.Voice` so the
preference persists between runs.

## Interrupt handling

When an interrupt occurs, `Interrupt` copies the form stack and iterates over it
backwards, closing each form by calling `TAppForm.CloseScreen`. This ensures that
all open screens exit cleanly before the program terminates.
