# Repository overview

tags: overview, doc

**LemmingsJS-MIDI** reimplements the classic game in modern JavaScript with optional WebMIDI sequencing.
Browser modules live under `js/` and Node tools under `tools/`.

## Key features
- Browser rendering engine and GUI, fully playable without Node.
- Multiple level packs in `config.json` (Lemmings, Oh No, Xmas91/92, Holiday93/94).
- Traps animate with cooldowns, arrow walls bounce lemmings, minimap shows entrances/exits/deaths.
- Bench mode (`&bench=true`) spawns endless lemmings to stress test the engine.
- Keyboard shortcuts control skills, speed, pause and debug; panel actions also respond to right-click.
- Progressive Web App via `site.webmanifest` with fullscreen landscape and install icons.
- CLI tools export sprites, list resources and pack levels using `NodeFileProvider` for `.zip`, `.tar.gz` or `.rar` archives.
- Automated tests under `test/` run with Mocha; Node imports `js/LogHandler.js` via `--import`.
- Notes for agents live in `.agentInfo/` (see `index.md`).

## Development workflow
- Requires Node 20+ (`package.json` uses ES modules). CI tests on Node 20.
- `npm install` brings in ESLint and Mocha.
- Run `npm run format` then `npm run lint` and `npm test` before commits.
- `npm start` launches `http-server` for local play.
- Browser code avoids Node-only modules. Do not modify asset folders like `lemmings/` or `holiday94/`.

## Additional facts
- Over 100 ES modules in `js/` cover actions, rendering, GUI and resources.
- Level packs contain 2048‑byte `.lvl` files ordered in `config.json`.
- `steelSprites.json` maps steel indexes per pack for precise terrain placement.
- README documents debug (`&debug=true`), speed keys (`f`/`-`), and the crosshair cursor from `MAIN.DAT` part 5.
- Docs include `docs/tools.md`, `docs/exporting-sprites.md`, `docs/TESTING.md` and `docs/ci.md`.
- `fileformat.txt` describes the `.lvl` binary layout.
- Colors use `0xAABBGGRR` (alpha, blue, green, red). Prefer this format when adding color features unless alpha is unsupported.
- NodeFileProvider caches archive entries to avoid repeated disk reads; call `clearCache()` to release memory.
