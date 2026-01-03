# Usage

This repo is intended for local development and offline tooling. It runs a
browser-based Lemmings port with optional MIDI control and a standalone editor.

## Quick start

- Install Node.js 20+.
- `npm install`
- `npm start`
- Open `http://127.0.0.1:8080`
- Editor: `http://127.0.0.1:8080/editor.html`

## Saved levels

Saved levels are stored in localStorage and appear after the default packs.
Use the Saved selector to pick them, or export/import `.nxlv` files.

## E2E harness

Add `?e2e=1` to enable the E2E harness and `window.__E2E__` API. See
`docs/e2e-state.md` for the full snapshot and buffer formats.

## URL parameters

Use query parameters to jump to packs, toggle bench modes, or enable debug.
The README includes the current list and shortcuts.
