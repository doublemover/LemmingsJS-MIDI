# Playwright Tests

Playwright tests are opt-in end-to-end checks that live under `e2e/` and do not
run as part of `npm test`.

## Running
- `npm run test-e2e:install`
- `npm run test-e2e`
- `npm run test-e2e:ui`

## HTTPS dev server
Playwright runs against `https://localhost:8080` and starts the server via
`npm run start-https`, which uses the self-signed cert in `certs/`. If you need
a trusted local cert, replace the files in `certs/` with your own.

## E2E harness
Add `?e2e=1` to enable the test harness and `window.__E2E__` API. The current
schema is documented in:
- `docs/e2e-state.md`
- `docs/e2e-editor-state.md`

## WebMIDI
E2E tests can grant real MIDI permissions (Chromium-only) or use the stub in
`e2e/helpers/webmidiStub.js` to avoid hardware dependencies. The stub is
optional and should be used only when real MIDI access is unavailable.

## Phased coverage plan
1) MIDI UI: enable/disable flow, pane visibility, event list sanity.
2) Level editor: load, tool selection, save/import basics.
3) Game: initial load, basic controls, level navigation.
