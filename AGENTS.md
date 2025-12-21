# AGENTS guidelines for LemmingsJS-MIDI

This repository is a JavaScript/Node implementation of Lemmings with WebMIDI
support. These notes are written for Codex-5.2 and Devstral 2 style agents.

## Environment and tooling
- Use Node.js 20+.
- This repo is for local development and offline asset tooling; it is not
  intended for npm distribution.
- Use npm scripts for linting and tests. Avoid bash-only commands on Windows.
- JavaScript uses two-space indentation (see `js/BitReader.js`).
- Run `npm run format` before committing to normalize formatting.

## Tests and checks
- `npm test` runs the Mocha suite.
- `npm run lint` checks ESLint rules.
- `npm run check-undefined` scans for undefined JS calls.
- `npm run depcheck` reports unused dependencies.

## Codebase constraints
- The `js/` directory runs in the browser; avoid Node-only modules there.
- External libraries live in `js/vendor/`; do not modify or reformat them.
- Keep code comments rare and focused when logic is non-obvious.

## Level packs and assets
- Level packs follow the NeoLemmix folder layout described in
  `docs/levelpacks.md`.
- Asset export and pack tooling is documented in `docs/offline-tools.md`.

## Docs and changelog
- Documentation-only updates should not be listed in `CHANGELOG.md`.
