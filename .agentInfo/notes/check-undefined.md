# Undefined checker

tags: tools, validation

`tools/check-undefined.js` scans the game's data files for leftover `undefined` placeholders. Run it via `npm run check-undefined` to verify that exported assets and packed levels contain valid values. It's best executed after modifying sprite archives or level packs to catch missing resources before committing.
