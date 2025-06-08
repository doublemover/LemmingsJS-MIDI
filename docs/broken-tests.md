# Broken tests

The following unit tests are currently failing and need additional investigation:

- [`test/gametimer.test.js`](../test/gametimer.test.js) – the *pause/resume via visibilitychange stops ticks* and *catchupSpeedAdjust scales across repeated delays* cases do not yield the expected `speedFactor` when run with fake timers. Mocked `requestAnimationFrame` calls and changes to the timer logic were unable to match the test expectations.


The following additional tests failed during the agent's review and could not be fixed:

### Core tests
- `test/action-systems.test.js` – *ActionDrowningSystem behavior - draw records death once frame >= 15*
- `test/action-systems.test.js` – *ActionExplodingSystem behavior - clears ground and exits at frame 52*
- `test/action-systems.test.js` – *ActionExplodingSystem behavior - process increments frameIndex and disables on first frame*
- `test/action-systems.test.js` – *ActionMineSystem state handling - returns SHRUG when steel or arrow under mask*
- `test/action-systems.test.js` – *ActionMineSystem state handling - increments y at frame 3 and falls without ground*
- `test/action-systems.test.js` – *ActionMineSystem state handling - clears ground and continues when unobstructed*
- `test/action-systems.test.js` – *Action Systems process() - ActionExplodingSystem clears mask and exits*
- `test/action-systems.test.js` – *Action Systems process() - ActionFryingSystem burns then exits*
- `test/action-systems.test.js` – *Action Systems process() - ActionExplodingSystem clears mask on first frame*
- `test/bench-sequence-start.test.js` – *benchSequenceStart - computes extras and starts bench with first count*
- `test/bench-tps.test.js` – *bench TPS - render shows queued frames and TPS in bench mode*
- `test/bitreader.test.js` – *BitReader - reads across byte boundary and errors at EOF*
- `test/displayimage.primitives.test.js` – *DisplayImage primitives - drawDashedRect draws dashed pattern*
- `test/displayimage.primitives.test.js` – *DisplayImage primitives - drawVerticalLine and drawHorizontalLine write pixels*
- `test/displayimage.test.js` – *DisplayImage drawing and scaling - drawVerticalLine clamps to bounds*
- `test/displayimage.test.js` – *DisplayImage drawing and scaling - blits frames with nearest scaling*
- `test/exportScripts.test.js` – *exportPanelSprite.js writes PNG*
- `test/game.test.js` – *Game - timer tick triggers logic, game over check and rendering*
- `test/gamegui.test.js` – *GameGui - setGuiDisplay attaches listeners and creates MiniMap*
- `test/gamegui.test.js` – *GameGui - render draws digits and letters when flags set*
- `test/gamegui.test.js` – *GameGui - mouse clicks adjust release rate and speed*
- `test/gamegui.test.js` – *GameGui - drawSpeedChange and drawSelection trigger drawing*
- `test/gamegui.test.js` – *GameGui - pauses and resumes with pause button*
- `test/gamegui.test.js` – *GameGui - changes speed with fast-forward buttons*
- `test/gamegui.test.js` – *GameGui - queues nuke command after confirmation*
- `test/gamegui.test.js` – *GameGui - selects skills and dispatches command*
- `test/gamegui.test.js` – *GameGui - renders minimap view*
- `test/gametimer.test.js` – *GameTimer - pause/resume via visibilitychange stops ticks*
- `test/gametimer.test.js` – *GameTimer - catchupSpeedAdjust scales across repeated delays*
- `test/gamevictory.test.js` – *Game victory condition - emits GameResult on game end*
- `test/gameview.applyquery.test.js` – *GameView.moveToLevel offsets - advances to next level within group*
- `test/gameview.helpers.test.js` – *moveToLevel transitions - advances to next game type when past last group*
- `test/gameview.test.js` – *GameView - calls updateStageSize when canvas is set*
- `test/gameview.test.js` – *GameView - suspendWithColor fades and resumes timer*
- `test/gameview.test.js` – *GameView - resetFade is called when loading a level*
- `test/keyboardshortcuts.loop.test.js` – *KeyboardShortcuts _step loop - "before each" hook for "updates view when panning"*
- `test/keyboardshortcuts.loop.test.js` – *KeyboardShortcuts _step loop - "after each" hook for "updates view when panning"*
- `test/keyboardshortcuts.test.js` – *KeyboardShortcuts - pans right when ArrowRight held*
- `test/keyboardshortcuts.test.js` – *KeyboardShortcuts - starts and stops loop when arrow key released*
- `test/keyboardshortcuts.zoomClear.test.js` – *KeyboardShortcuts zoom redraw clearing - "before each" hook for "clears both layers when zooming with keyboard"*
- `test/keyboardshortcuts.zoomClear.test.js` – *KeyboardShortcuts zoom redraw clearing - "after each" hook for "clears both layers when zooming with keyboard"*
- `test/stage.updateStageSize.test.js` – *Stage updateStageSize - initializes with HUD offset without resize*
- `test/stage.updateviewpoint.test.js` – *Stage updateViewPoint - keeps cursor position stable while zooming*
- `test/stage.updateviewpoint.test.js` – *Stage updateViewPoint - keeps level bottom glued to the HUD when zooming*
- `test/stage.updateviewpoint.test.js` – *Stage updateViewPoint - preserves world coords at multiple cursor positions*
- `test/stage.updateviewpoint.test.js` – *Stage updateViewPoint - glues bottom when view taller than world*
- `test/stage.utilities.test.js` – *Stage utilities - "before each" hook for "snapScale clamps and snaps to gcd step"*
- `test/stage.utils.test.js` – *Stage utils - clampViewPoint centers or clamps within world*

### Tools and misc tests
- `test/tools/exportAllSprites.integration.test.js` – *exportAllSprites integration - uses default output path and writes sprites*
- `test/tools/exportAllSprites.integration.test.js` – *exportAllSprites integration - accepts custom paths*
- `test/tools/exportAllSprites.test.js` – *exportAllSprites tool - uses defaults when no arguments provided*
- `test/tools/exportAllSprites.test.js` – *exportAllSprites tool - accepts pack path and output dir arguments*
- `test/tools/exportAllSprites.test.js` – *exportAllSprites tool - exports panel letters and numbers*
- `test/tools/exportAllSprites.test.js` – *exportAllSprites tool - exports lemming sheets and ground objects*
- `test/tools/exportAllSprites.test.js` – *exportAllSprites tool - skips a ground pair when loadBinary throws*
- `test/tools/exportGroundImages.test.js` – *tools/exportGroundImages.js - exports a real ground file*
- `test/tools/exportGroundImages.test.js` – *tools/exportGroundImages.js - with mock NodeFileProvider - writes PNGs using a mock NodeFileProvider*
- `test/tools/exportGroundImages.test.js` – *tools/exportGroundImages.js - with mock NodeFileProvider - uses config.json when run without arguments*
- `test/tools/exportGroundImages.test.js` – *tools/exportGroundImages.js - with mock NodeFileProvider - fails for an out-of-range index*
- `test/tools/exportGroundImages.test.js` – *tools/exportGroundImages.js - with mock NodeFileProvider - defaults to lemmings when config.json is unreadable*
- `test/tools/exportGroundImages.test.js` – *tools/exportGroundImages.js - with mock NodeFileProvider - handles missing files without output*
- `test/tools/exportScripts.test.js` – *export scripts default path - exportAllPacks.js exports under ./exports*
- `test/tools/exportScripts.test.js` – *export scripts default path - exportAllSprites.js exports under ./exports*
- `test/tools/exportScripts.test.js` – *export scripts default path - exportGroundImages.js exports under ./exports*
- `test/tools/exportScripts.test.js` – *export scripts default path - exportLemmingsSprites.js exports under ./exports*
- `test/tools/exportScripts.test.js` – *export scripts default path - exportPanelSprite.js exports under ./exports*
- `test/tools/exportScripts.test.js` – *export scripts default path - renderCursorSizes.js exports under ./exports*
- `test/tools/exportScripts.test.js` – *export scripts default path - scanGreenPanel.js exports under ./exports*
- `test/tools/listSprites.stdout.test.js` – *tools/listSprites.js stdout - prints sprite listing when no output file is given*
- `test/tools/listSprites.test.js` – *tools/listSprites.js - writes sprite listing to a file*
- `test/tools/listSprites.test.js` – *tools/listSprites.js - writes spriteList.txt with sprite names*
- `test/nodefileprovider.test.js` – *NodeFileProvider - _validateEntry rejects absolute or parent paths*
- `test/nodefileprovider.test.js` – *NodeFileProvider - _findZipEntry matches case-insensitively*
- `test/tools/packLevels.test.js` – *tools/packLevels.js - packs a directory of levels into a DAT file*
- `test/tools/patchSprites.test.js` – *tools/patchSprites.js - patches sprite data using PNG files*
- `test/tools/patchSprites.test.js` – *tools/patchSprites.js - patches multiple sprites and preserves palette offsets*
- `test/tools/patchSprites.test.js` – *tools/patchSprites.js (mocked PNG) - updates frames in an existing sprite sheet*
- `test/processHtmlFile.test.js` – *processHtmlFile - extracts inline event handler attributes*
- `test/tools/search-script.test.js` – *tools/search.js - supports fuzzy search and context option*
- `test/tools/search-script.test.js` – *tools/search.js - --human-json output has friendly structure*
- `test/tools/search-script.test.js` – *tools/search.js - records queries with no results*
- `test/tools/search-script.test.js` – *tools/search.js - appends to noResultQueries on subsequent searches with no hits*
- `test/squooshhqx.test.js` – *squooshhqx initSync - initializes wasm and forwards resize arguments*
- `test/tools/scanGreenPanel.test.js` – *tools/scanGreenPanel.js - marks green pixels blue*
- `test/tools/scanGreenPanel.test.js` – *tools/scanGreenPanel.js - handles missing panel sprite*

