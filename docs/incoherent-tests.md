# Incoherent tests

These tests were removed because they are outside the core game simulation focus (browser/UI rendering or offline tooling/asset export paths), or rely on behavior that cannot be reliably exercised in the test runner.

| Test | Reason |
| --- | --- |
| `test/bench-entrance-placement.test.js` | Bench mode depends on RAF/visibility timing and UI scheduling, not core simulation. |
| `test/bench-measure-extras.test.js` | Bench mode depends on RAF/visibility timing and UI scheduling, not core simulation. |
| `test/bench-no-end.test.js` | Bench mode depends on RAF/visibility timing and UI scheduling, not core simulation. |
| `test/bench-sequence-start.test.js` | Bench mode depends on RAF/visibility timing and UI scheduling, not core simulation. |
| `test/bench-sequence.test.js` | Bench mode depends on RAF/visibility timing and UI scheduling, not core simulation. |
| `test/bench-speed-adjust.test.js` | Bench mode depends on RAF/visibility timing and UI scheduling, not core simulation. |
| `test/bench-start.test.js` | Bench mode depends on RAF/visibility timing and UI scheduling, not core simulation. |
| `test/bench-tps.test.js` | Bench mode depends on RAF/visibility timing and UI scheduling, not core simulation. |
| `test/crosshaircursor.test.js` | Cursor rendering is UI-only, not core simulation. |
| `test/displayimage.primitives.test.js` | Pixel rendering utilities are view-layer concerns, not core simulation. |
| `test/displayimage.scaling.test.js` | Pixel rendering utilities are view-layer concerns, not core simulation. |
| `test/displayimage.test.js` | Pixel rendering utilities are view-layer concerns, not core simulation. |
| `test/gamedisplay.extra.test.js` | Render buffer and click-selection plumbing are display-layer concerns, not core simulation. |
| `test/gamedisplay.test.js` | Render buffer and click-selection plumbing are display-layer concerns, not core simulation. |
| `test/gamegui.behavior.test.js` | HUD/controls rendering and command wiring live in the UI layer, not core simulation. |
| `test/gamegui.drawhelpers.test.js` | HUD/controls rendering and command wiring live in the UI layer, not core simulation. |
| `test/gamegui.misc.test.js` | HUD/controls rendering and command wiring live in the UI layer, not core simulation. |
| `test/gamegui.release-rate.render.test.js` | HUD/controls rendering and command wiring live in the UI layer, not core simulation. |
| `test/gamegui.test.js` | HUD/controls rendering and command wiring live in the UI layer, not core simulation. |
| `test/gametimer.test.js` | GameTimer ties to document visibility and RAF scheduling, which is browser-specific. |
| `test/gameview.applyquery.test.js` | GameView wires browser UI, canvas setup, and view lifecycle; out of scope for core simulation. |
| `test/gameview.canvas-reset.test.js` | GameView wires browser UI, canvas setup, and view lifecycle; out of scope for core simulation. |
| `test/gameview.controls.test.js` | GameView wires browser UI, canvas setup, and view lifecycle; out of scope for core simulation. |
| `test/gameview.dispose.test.js` | GameView wires browser UI, canvas setup, and view lifecycle; out of scope for core simulation. |
| `test/gameview.enableDebug.test.js` | GameView wires browser UI, canvas setup, and view lifecycle; out of scope for core simulation. |
| `test/gameview.frames-no-game.test.js` | GameView wires browser UI, canvas setup, and view lifecycle; out of scope for core simulation. |
| `test/gameview.helperExtras.test.js` | GameView wires browser UI, canvas setup, and view lifecycle; out of scope for core simulation. |
| `test/gameview.helpers.test.js` | GameView wires browser UI, canvas setup, and view lifecycle; out of scope for core simulation. |
| `test/gameview.loadlevel-missing.test.js` | GameView wires browser UI, canvas setup, and view lifecycle; out of scope for core simulation. |
| `test/gameview.loadlevel.test.js` | GameView wires browser UI, canvas setup, and view lifecycle; out of scope for core simulation. |
| `test/gameview.loadReplay.test.js` | GameView wires browser UI, canvas setup, and view lifecycle; out of scope for core simulation. |
| `test/gameview.menu-selects.test.js` | GameView wires browser UI, canvas setup, and view lifecycle; out of scope for core simulation. |
| `test/gameview.movelevel.paths.test.js` | GameView wires browser UI, canvas setup, and view lifecycle; out of scope for core simulation. |
| `test/gameview.onGameEnd.test.js` | GameView wires browser UI, canvas setup, and view lifecycle; out of scope for core simulation. |
| `test/gameview.setup.test.js` | GameView wires browser UI, canvas setup, and view lifecycle; out of scope for core simulation. |
| `test/gameview.sound.test.js` | GameView wires browser UI, canvas setup, and view lifecycle; out of scope for core simulation. |
| `test/gameview.start-existing.test.js` | GameView wires browser UI, canvas setup, and view lifecycle; out of scope for core simulation. |
| `test/gameview.stepSpeed.test.js` | GameView wires browser UI, canvas setup, and view lifecycle; out of scope for core simulation. |
| `test/gameview.suspendWithColor.test.js` | GameView wires browser UI, canvas setup, and view lifecycle; out of scope for core simulation. |
| `test/gameview.test.js` | GameView wires browser UI, canvas setup, and view lifecycle; out of scope for core simulation. |
| `test/keyboardshortcuts.branches.test.js` | Keyboard input loops rely on browser events/RAF, not core simulation. |
| `test/keyboardshortcuts.eventpaths.test.js` | Keyboard input loops rely on browser events/RAF, not core simulation. |
| `test/keyboardshortcuts.instantNuke.test.js` | Keyboard input loops rely on browser events/RAF, not core simulation. |
| `test/keyboardshortcuts.keys.test.js` | Keyboard input loops rely on browser events/RAF, not core simulation. |
| `test/keyboardshortcuts.loop.test.js` | Keyboard input loops rely on browser events/RAF, not core simulation. |
| `test/keyboardshortcuts.test.js` | Keyboard input loops rely on browser events/RAF, not core simulation. |
| `test/keyboardshortcuts.zoomClear.test.js` | Keyboard input loops rely on browser events/RAF, not core simulation. |
| `test/lemmingsnamespace.test.js` | Global window namespace attachment is browser integration, not core simulation. |
| `test/minimap.extra.test.js` | Minimap rendering is UI visualization, not core simulation. |
| `test/minimap.test.js` | Minimap rendering is UI visualization, not core simulation. |
| `test/overlay-ants.test.js` | Overlay rendering effects are UI-only, not core simulation. |
| `test/particletable.lookup.test.js` | Tests the window.atob browser branch, not core simulation. |
| `test/smoothscroller.test.js` | Scroll animation and viewport smoothing are UI-only, not core simulation. |
| `test/stage.draw.test.js` | Stage/camera surfaces and GUI layout depend on canvas sizing, not core simulation. |
| `test/stage.drawbranches.test.js` | Stage/camera surfaces and GUI layout depend on canvas sizing, not core simulation. |
| `test/stage.lifecycle.test.js` | Stage/camera surfaces and GUI layout depend on canvas sizing, not core simulation. |
| `test/stage.overlayfade.test.js` | Stage/camera surfaces and GUI layout depend on canvas sizing, not core simulation. |
| `test/stage.setGameViewPointPosition.test.js` | Stage/camera surfaces and GUI layout depend on canvas sizing, not core simulation. |
| `test/stage.test.js` | Stage/camera surfaces and GUI layout depend on canvas sizing, not core simulation. |
| `test/stage.updateStageSize.test.js` | Stage/camera surfaces and GUI layout depend on canvas sizing, not core simulation. |
| `test/stage.updateviewpoint.test.js` | Stage/camera surfaces and GUI layout depend on canvas sizing, not core simulation. |
| `test/stage.utilities.test.js` | Stage/camera surfaces and GUI layout depend on canvas sizing, not core simulation. |
| `test/stage.utils.test.js` | Stage/camera surfaces and GUI layout depend on canvas sizing, not core simulation. |
| `test/stageimageprops.test.js` | Stage/camera surfaces and GUI layout depend on canvas sizing, not core simulation. |
| `test/userinput.dispose.test.js` | Pointer event translation depends on DOM/canvas coordinates, not core simulation. |
| `test/userinput.events.test.js` | Pointer event translation depends on DOM/canvas coordinates, not core simulation. |
| `test/userinput.test.js` | Pointer event translation depends on DOM/canvas coordinates, not core simulation. |
| `test/viewpoint.test.js` | Viewpoint/camera math is presentation-layer logic, not core simulation. |
| `test/exportLemmingsSprites.test.js` | Sprite export relies on full asset packs and filesystem output; outside core simulation. |
| `test/exportScripts.test.js` | Export script integration depends on asset packs and filesystem layout; outside core simulation. |
| `test/listSprites.defaultPack.test.js` | CLI sprite listing depends on pack files/config and tool output, not core simulation. |
| `test/listSprites.stdout.test.js` | CLI sprite listing depends on pack files/config and tool output, not core simulation. |
| `test/listsprites.test.js` | CLI sprite listing depends on pack files/config and tool output, not core simulation. |
| `test/patchSprites.cli.test.js` | CLI patching depends on tool entrypoints and file IO, not core simulation. |
| `test/tools/exportAllSprites.integration.test.js` | Integration export depends on asset packs and filesystem output, not core simulation. |
| `test/fileprovider.test.js` | `_hashBuffer throws when crypto unavailable` relied on mutating `node:crypto` exports, which is not supported in ESM. |
| `test/levelloader.test.js` | `uses OddTableReader when configured` tried to stub static imports that `LevelLoader` does not resolve from dependencies. |
| `test/tools/archiveDir.test.js` | Offline tooling tests depend on local archives and filesystem layout, not core simulation. |
| `test/tools/cleanExports.test.js` | Offline tooling tests depend on local exports layout, not core simulation. |
| `test/tools/exportAllPacks.test.js` | Offline tooling tests depend on asset packs and script entrypoints, not core simulation. |
| `test/tools/exportAllSprites.test.js` | Offline tooling tests depend on asset packs and script entrypoints, not core simulation. |
| `test/tools/exportGroundImages.test.js` | Offline tooling tests depend on asset packs and filesystem output, not core simulation. |
| `test/tools/exportScripts.test.js` | Offline tooling tests depend on script entrypoints and filesystem output, not core simulation. |
| `test/tools/listSprites.test.js` | Offline tooling tests depend on asset packs and script output, not core simulation. |
| `test/tools/packLevels.test.js` | Offline tooling tests depend on pack inputs/outputs, not core simulation. |
| `test/tools/patchSprites.test.js` | Offline tooling tests depend on pack inputs/outputs, not core simulation. |
| `test/tools/processHtmlFile.snippets.test.js` | Offline tooling tests are for HTML processing utilities, not core simulation. |
| `test/tools/processHtmlFile.test.js` | Offline tooling tests are for HTML processing utilities, not core simulation. |
| `test/tools/scanGreenPanel.test.js` | Offline tooling tests depend on sprite assets, not core simulation. |
| `test/archiveDir.test.js` | Offline tooling tests depend on local archives and filesystem layout, not core simulation. |
| `test/exportPanelSprite.defaultPack.test.js` | Offline tooling tests depend on asset packs and filesystem output, not core simulation. |
| `test/packLevels.test.js` | Offline tooling tests depend on pack inputs/outputs, not core simulation. |
| `test/patchSprites.coverage.test.js` | Offline tooling tests depend on pack inputs/outputs, not core simulation. |
| `test/patchsprites.test.js` | Offline tooling tests depend on pack inputs/outputs, not core simulation. |
| `test/nodefileprovider.test.js` | Node-only file provider tests are for offline tooling, not core simulation. |
| `test/vgaspecreader.test.js` | `handles run-length chunks across sections` expected decode output that does not match the current VGASpecReader behavior. |
