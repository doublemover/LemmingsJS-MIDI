# Usage

This repo is intended for local development and offline tooling. It runs a
browser-based Lemmings port with optional MIDI control and a standalone editor.

## Quick start

- Install Node.js 20.19+ (20.x) or 22.12+. Package engines: `^20.19.0 || >=22.12.0`.
- `npm ci`
- `npm start`
- Open `http://127.0.0.1:8080`
- Editor: `http://127.0.0.1:8080/editor.html`

## Optional HTTPS and automation

The HTTP command binds to loopback port 8080. HTTPS is a separate command:
`npm run start-https` serves `https://127.0.0.1:8080` and
`https://127.0.0.1:8080/editor.html`. It requires `certs/localhost.pem` and
`certs/localhost-key.pem`, with the certificate trusted locally and valid for
`127.0.0.1`. Stop the HTTP listener before starting HTTPS on the same port.

MCP and Playwright setup are optional contributor/automation workflows; see the
README's MCP section. Set their base URL to the exact protocol of the running
server. A successful HTTP run does not qualify an unconfigured HTTPS route.

## Saved levels

Saved levels are stored in localStorage and appear after the default packs.
Use the Saved selector to pick them, or export/import `.nxlv` files.

## E2E harness

Add `?e2e=1` to enable the E2E harness and `window.__E2E__` API. See
`docs/e2e-state.md` for the full snapshot, buffer, and capture-rectangle
formats.

## URL parameters

Use query parameters to jump to packs, toggle bench modes, or enable debug.
The README includes the current list and shortcuts.
