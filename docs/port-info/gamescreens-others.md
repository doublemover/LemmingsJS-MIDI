# Other GameScreen modules

This note summarises the remaining screens from the Pascal Lemmix codebase. Each section lists the screen's purpose, important fields and notes on how the JavaScript port mirrors the original logic. See [game-screen-base.md](game-screen-base.md) for details common to all screens and [gamescreen-player.md](gamescreen-player.md) for the gameplay screen.

## GameScreen.Config
- **Purpose**: displays configuration options such as mechanics, voices and custom folder paths.
- **Major fields**:
  - `Config`: the `TConfig` instance being edited.
  - `MainPanel`: container for all checkboxes and edit fields.
  - `EditPathToStyles`, `EditPathToMusic`, `EditPathToSounds`, `EditPathToReplay`: path editors.
  - `InfoLabel`: shows instructions at the bottom of the form.
  - `CheatClicks`: counts developer-mode clicks on the "Mech" label.
- **Porting notes**: uses a custom `TCheck` control to draw checkboxes with PNG images. `BuildScreen` populates one column per option group and attaches click handlers that update the config. The `Save` method validates folder paths and signals when a restart is required.

## GameScreen.Finder
- **Purpose**: grid based level browser with sorting and filtering.
- **Major fields**:
  - `fRecordList`: list of `TRecord` objects describing each level.
  - `fRefList`: indexes into `fRecordList` after filtering.
  - `fGrid`: `TDrawGridEx` showing level data.
  - `fUserFilters`: text filters for each column.
  - `fLabelRecordCount`: shows number of matching entries.
- **Porting notes**: `TRecord` exposes 28 properties like style name, release rate and object counts. `BuildScreen` sizes columns based on text metrics then fills the grid. Keyboard and mouse handlers drive in-place editing and sorting.

## GameScreen.Help
- **Purpose**: modal help overlay describing controls.
- **Major fields**:
  - `fTitle`: window caption.
  - `fText`: `THelpString` containing the help paragraphs.
  - `fKeys` / `fCommands`: split text displayed on left and right.
  - `fPillarTop`, `fPillar`: decorative side images.
- **Porting notes**: `BuildScreen` only separates the help text; drawing occurs in `Form_Paint` where the pillars and purple text are rendered. Any key or mouse click closes the screen.

## GameScreen.LevelCode
- **Purpose**: enter a password or cheat code.
- **Major fields**:
  - `BlinkTimer`: controls the flashing cursor.
  - `LevelCode`: string being typed.
  - `CursorPosition`: current text index.
  - `ValidLevelCode`: result of the last check.
- **Porting notes**: the idle handler toggles the cursor every `INTERNAL_BLINK` ms. `CheckLevelCode` searches the level system and updates `App.CurrentLevelInfo` when a match is found.

## GameScreen.Options
- **Purpose**: choose the active style pack.
- **Major fields**:
  - `fGrid`: displays style thumbnails.
  - `fInfoList`: list of `TStyleInformation` entries.
  - `fNewStyleSelected`: set when the chosen style differs from the current one.
- **Porting notes**: grid cells draw a coloured panel with the style name and author. `DoExitScreen` copies the selected style into `App.NewStyleName` before closing.

## GameScreen.Postview
- **Purpose**: post-level results showing percentage rescued and a next-level code.
- **Major fields**:
  - `fPlayedLevelInfo`: the level just completed.
  - `fNextCode`: code for the next level when earned.
  - `fGameIsSaved`: tracks whether replay and stats were stored.
- **Porting notes**: `GetScreenText` builds the multiline summary including congratulations and lemming counts. If the player cheated a voice line is played.

## GameScreen.Preview
- **Purpose**: show a level preview before starting play.
- **Major fields**:
  - `fLevelErrorCount`: number of issues reported by the renderer.
  - `fInitialLevelInfo`: first level when entering the screen.
  - `fSelectedReplayFilename`: replay chosen via the replay finder.
- **Porting notes**: loads the level and renders it into a 640×350 bitmap. Mouse wheel switches levels and F10/F12 shortcuts toggle debug features in developer mode.

## GameScreen.ReplayFinder
- **Purpose**: locate replays matching the current level.
- **Major fields**:
  - `fRecordList` and `fRefList`: store all cached replay entries and the filtered order.
  - `fGrid`: editable grid used for filtering and selection.
  - `fEdit`: inline editor for filter text.
  - `fResultFile`: filename chosen when closing the screen.
- **Porting notes**: similar to the level finder but working on the replay cache. `BuildScreen` loads entries from `App.ReplayCache` and `Execute` returns the selected file path.

