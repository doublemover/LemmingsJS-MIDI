# .agentInfo detailed index

This expanded listing preserves the original bullet format with short descriptions. See `index.md` for a terse `path: tags` table.

## Notes by tag
- **binary-reader**: [notes/binary-reader.md](notes/binary-reader.md) - BinaryReader abstracts sequential and random-access reads from a Uint8Array.
- **bit-reader**: [notes/bit-reader.md](notes/bit-reader.md) - BitReader reads bits in reverse order from a BinaryReader. It maintains a
- **bit-writer**: [notes/bit-writer.md](notes/bit-writer.md) - BitWriter builds an output buffer backwards while reading bits from a
- **tools, validation**: [notes/check-undefined.md](notes/check-undefined.md) - tools/check-undefined.js scans JavaScript and HTML files for function calls. If a call cannot be ...
- **commands, replay**: [notes/command-manager.md](notes/command-manager.md) - js/CommandManager.js manages player commands and replay data. It registers a listener on gameTime...
- **display, canvas**: [notes/display-image.md](notes/display-image.md) - DisplayImage is an offscreen canvas that Stage uses for both the game area and the GUI layer. Eac...
 - **canvas, helper**: [notes/draw-corner-rect.md](notes/draw-corner-rect.md) - drawCornerRect paints L-shaped corners and can add centered side lines.
- **debug, render**: [notes/drawMarchingAntRect.md](notes/drawMarchingAntRect.md) - drawMarchingAntRect draws a dashed rectangle whose dashes alternate between two colors. The dashL...
- **file-container**: [notes/file-container.md](notes/file-container.md) - FileContainer parses a resource file containing multiple compressed parts. Each
- **render, display**: [notes/game-display.md](notes/game-display.md) - js/GameDisplay.js binds the game state to a GUI display. setGuiDisplay() attaches mouse handlers ...
- **gui, input**: [notes/game-gui.md](notes/game-gui.md) - GameGui drives the skill panel and handles player input for the in-game GUI.
- **resources, caching**: [notes/game-resources.md](notes/game-resources.md) - GameResources centralizes asset loading. getMainDat() fetches MAIN.DAT only once using FileProvid...
- **game-view, setup, stage**: [notes/game-view.md](notes/game-view.md) - GameView orchestrates the page's startup sequence. Assigning to the .gameCanvas property construc...
- **game, main-loop**: [notes/game.md](notes/game.md) - Game in js/Game.js coordinates level setup and the main loop. loadLevel() resets any previous sta...
- **render, ground**: [notes/ground-renderer.md](notes/ground-renderer.md) - js/GroundRenderer.js builds the bitmap used as the level background. createGroundMap allocates a ...
- **example, doc**: [notes/initial.md](notes/initial.md) - This sample note demonstrates the tagging system used in .agentInfo/.
- **keyboard, input, game-view**: [notes/keyboard-shortcuts.md](notes/keyboard-shortcuts.md) - KeyboardShortcuts hooks global key events and lets the player pan and zoom the gameplay view. Gam...
- **webmidi, doc, overview**: [notes/webmidi-overview.md](notes/webmidi-overview.md) - Summary of the getting-started docs with enable(), device listing and environment support.
- **lemming-manager, actions**: [notes/lemming-manager.md](notes/lemming-manager.md) - LemmingManager orchestrates all lemming entities. The constructor receives the
- **level-loading**: [notes/level-loader.md](notes/level-loader.md) - LevelLoader.getLevel constructs a Level in five phases.
- **level-parsing**: [notes/level-reader.md](notes/level-reader.md) - js/LevelReader.js consumes a 2048 byte .DAT level file. The first 0x20 bytes contain the release ...
- **level-writing**: [notes/level-writer.md](notes/level-writer.md) - js/LevelWriter.js converts a level object back into the original 2048‑byte binary format used by ...
- **mechanics, config, level-loading**: [notes/mechanics-config.md](notes/mechanics-config.md) - Configuration entries may include an optional **mechanics** object that tweaks gameplay behavior ...
- **game, config, mechanics**: [notes/mechanics-flags.md](notes/mechanics-flags.md) - ConfigReader parses config.json into GameConfig objects but currently does not expose any mechani...
- **file-system, archives**: [notes/node-file-provider.md](notes/node-file-provider.md) - tools/NodeFileProvider.js allows the rest of the project to read files from
- **todo, notes**: [notes/note-review.md](notes/note-review.md) - The index lists many short notes. Review each file to remove duplicate sentences and keep the inf...
- **overview, doc**: [notes/overview.md](notes/overview.md) - **LemmingsJS-MIDI** reimplements the classic game in modern JavaScript with optional WebMIDI sequ...
- **config, mechanics**: [notes/pack-mechanics.md](notes/pack-mechanics.md) - packMechanics.js enumerates glitch flag defaults for each level pack. When ConfigReader builds a ...
- **stage, canvas, input**: [notes/stage.md](notes/stage.md) - js/Stage.js creates a Stage bound to a canvas element. The constructor sets up a UserInputManager...
- **todo, cleanup, code-review**: [notes/todo-review.md](notes/todo-review.md) - This note lists lines across the repository containing TODO-like markers. They can guide future w...
- **tools, cli**: [notes/tools.md](notes/tools.md) - The tools/ directory contains small command-line utilities for working with level packs and sprites.
- **trigger-system, grid**: [notes/trigger-manager.md](notes/trigger-manager.md) - TriggerManager maintains spatial triggers such as exits, traps and blocker
- **unpack-file-part**: [notes/unpack-file-part.md](notes/unpack-file-part.md) - UnpackFilePart represents a single compressed chunk inside a container. It
- **todo, gui, stage**: [notes/gui-stage-tasks.md](notes/gui-stage-tasks.md) - Collection of UI fixes: panel placement, viewport scaling, selection visuals, skill auto-apply, cursor alignment, and cursor removal.
- **bench-mode, gui**: [notes/pause-overlay.md](notes/pause-overlay.md) - Bench mode highlights the pause button rectangle with `startOverlayFade(rect)` instead of flashing the entire stage.
- **webmidi-todo**: [notes/webmidi-tasks.md](notes/webmidi-tasks.md) - Follow-ups on WebMIDI TODOs such as master tuning and browser support for `Output.clear()`.


- **webmidi, browser**: [notes/webmidi.md](notes/webmidi.md) - WebMIDI works only in secure contexts and requires user permission for device access.
- **pack-toolkit, resources, doc**: [notes/nl-pack-toolkit.md](notes/nl-pack-toolkit.md) - Overview of the NeoLemmix Flexi Toolkit features and how the pack folders here follow a similar layout for Node tools.
- **doc, bench-mode**: [notes/bench-mode-docs.md](notes/bench-mode-docs.md) - Expanded README bench-mode section detailing `missedTicks`, `stableTicks`, speed adjustments, and the meaning of the "T"/"L" displays. Noted that thresholds will scale with `speedFactor` after Issue 1.
- **bench-mode, speed-control**: [notes/bench-mode.md](notes/bench-mode.md) - Bench mode enables performance testing by spawning lemmings without limit and automatically adjusting the game speed. `LemmingManager.addNewLemmings()` skips the remaining-count check so new lemmings always appear. `GameTimer.#benchSpeedAdjust()` modifies `speedFactor` whenever the game falls behind, slowing to 0.1 if more than 100 ticks are pending and gradually increasing again when caught up.
- **game-timer, bench-mode**: [notes/bench-speed-adjust.md](notes/bench-speed-adjust.md) - `GameTimer.#benchSpeedAdjust()` now scales its slow and recovery thresholds by the current `speedFactor`. The game slows down when pending frames exceed `16 / speedFactor` (clamped to at least 10) and speeds back up when the backlog drops below `4 / speedFactor`. This keeps bench mode responsive at different speeds.
- **config, mechanics, doc**: [notes/config.md](notes/config.md) - `config.json` lists available level packs and key fields like `level.filePrefix`, `level.groups` and `level.order`. Each pack may also include a `mechanics` object. `packMechanics.js` provides defaults for these mechanic flags which `ConfigReader` merges with the pack entries. See [docs/config.md](../docs/config.md) for a full description.
- **display, canvas**: [notes/display-image.md](notes/display-image.md) - `DisplayImage` is an offscreen canvas that `Stage` uses for both the game area and the GUI layer.  Each instance owns an `ImageData` buffer which is created through `Stage.createImage()`.  A `Uint32Array` view (`buffer32`) aliases this buffer so drawing routines can operate on 32‑bit pixels directly.
 - **canvas, helper**: [notes/draw-corner-rect.md](notes/draw-corner-rect.md) - `DisplayImage.drawCornerRect(x, y, size, r, g, b, length = 1, midLine = false, midLen = 0)` draws L-shaped corners. When `midLine` is true it also adds centered side lines.
- **debug, render**: [notes/drawMarchingAntRect.md](notes/drawMarchingAntRect.md) - `drawMarchingAntRect` draws a dashed rectangle whose dashes alternate between two colors. The `dashLen` and `offset` arguments control the length of each dash and its animated offset. GameGui uses this helper when highlighting UI elements like skill selections or the nuke button.
- **easing, animation**: [notes/easing-functions.md](notes/easing-functions.md) - This note summarizes commonly used easing equations for smooth animations:
- **editor-mode, gui, level-editor**: [notes/editor-mode.md](notes/editor-mode.md) - Editor mode disables game-over checks so the game never ends. LemmingManager keeps spawning new lemmings indefinitely and a black GUI panel appears at the bottom with controls for terrain and trigger editing. This behavior serves as the basis for the level editor.
- **game-view, speed**: [notes/game-speed-input.md](notes/game-speed-input.md) - `GameView.applyQuery` reads the `speed` URL parameter to set `gameSpeedFactor`. Values greater than `1` represent integer speed steps, so the query value is rounded to the nearest whole number. Fractional speeds at or below `1` are left untouched.
- **level-format, doc**: [notes/level-format.md](notes/level-format.md) - `docs/level-file-format.md` explains the 2048-byte `.lvl` layout produced by LemEdit. It lists all field offsets along with object IDs for each graphics set.
- **level-packs, resources, doc**: [notes/level-packs.md](notes/level-packs.md) - `docs/levelpacks.md` describes the repository's level pack layout and how Node
- **nl-file-format, doc**: [notes/nl-file-format.md](notes/nl-file-format.md) - `docs/nl-file-format.md` details the NeoLemmix level and pack formats: `.nxlv` text-based levels, the 4 KB binary `.lvl` layout, high-res folders, `alias.nxmi`, pack files like `info.nxmi`, and legacy `.NXP` archives.
- **nl-objects, doc**: [notes/nl-objects.md](notes/nl-objects.md) - `docs/nl-objects.md` summarizes NeoLemmix object logic with references to the source files implementing teleporters, locked exits, pickup-skills, single-use traps, updrafts and splat pads.
- **nl-skills, doc, resources**: [notes/nl-skills.md](notes/nl-skills.md) - Short note summarizing the `docs/nl-skills.md` reference for the nine
- **cleanup, game-timer**: [notes/norm-tick-count-removal.md](notes/norm-tick-count-removal.md) - The obsolete `normTickCount` field in `GameTimer` was folded into
- **tests, bench-mode**: [notes/test-bench-speed-adjust.md](notes/test-bench-speed-adjust.md) - Adds a unit test that simulates dropped and normal ticks using fake timers. The test verifies `GameTimer.#benchSpeedAdjust()` lowers `speedFactor` when the timer falls behind and restores it once stable again.
- **tests, tools, exports**: [notes/test-coverage.md](notes/test-coverage.md) - Small Mocha tests create dummy packs and run the export tools via `node`.
- **stage, input, tests**: [notes/userinput-zoom.md](notes/userinput-zoom.md) - The mouse wheel now zooms around the pointer by converting the cursor's screen
- **webmidi, enumerations, doc**: [notes/webmidi-enumerations.md](notes/webmidi-enumerations.md) - `js/webmidi.js` defines several tables describing MIDI message codes.
- **webmidi, environment, doc**: [notes/webmidi-environments.md](notes/webmidi-environments.md) - The official "Supported Environments" page outlines where WebMIDI.js works:

