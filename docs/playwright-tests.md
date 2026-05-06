# Playwright Tests

Playwright tests are opt-in end-to-end checks that live under `e2e/` and do not
run as part of `npm test`.

## Running
- `npm run test-e2e:install`
- `npm run test-e2e`
- `npm run test-e2e:ui`
- `LEMMINGS_E2E_BASE_URL=https://10.0.0.126:8080 npm run test-e2e`

## HTTPS dev server
Playwright defaults to `https://localhost:8080` and starts the server via
`npm run start-https`, which uses the self-signed cert in `certs/`. Set
`LEMMINGS_E2E_BASE_URL` to a reachable origin when the browser must use a LAN
or VM/container host instead of loopback. If you need a trusted local cert,
replace the files in `certs/` with your own.

## E2E harness
Add `?e2e=1` to enable the test harness and `window.__E2E__` API. The current
schema is documented in:
- `docs/e2e-state.md`
- `docs/e2e-editor-state.md`

## WebMIDI
E2E tests can grant real MIDI permissions (Chromium-only) or use the stub in
`e2e/helpers/webmidiStub.js` to avoid hardware dependencies. The stub is
optional and should be used only when real MIDI access is unavailable.

## Disposable visual captures
Use the visual capture CLI for local inspection while working on UI, editor,
procgen, or HUD issues. Captures are written under ignored
`temp/e2e-captures/`; do not commit generated screenshots, manifests, baselines,
or image inventories.

Common runs:
- `npm run capture:e2e:midi`
- `npm run capture:e2e:editor`
- `npm run capture:e2e:procgen`
- `npm run capture:e2e:game-hud`

Direct CLI form:
- `node scripts/e2e-capture-rects.js --config=e2e/capture-targets/midi.js`
- `node scripts/e2e-capture-rects.js --config=e2e/capture-targets/editor.js --viewport=tablet`
- `node scripts/e2e-capture-rects.js --config=e2e/capture-targets/game-hud.js --target=game-runtime-hud --json`

The script uses `LEMMINGS_E2E_BASE_URL` when set, otherwise it follows the
Playwright default base URL. Start `npm run start-https` first when running the
CLI directly outside Playwright's test runner.

Capture configs export a plain object:

```js
export default {
  name: 'example',
  route: '/',
  async setup(page) {
    await page.waitForFunction(() => window.__E2E__?.getState?.()?.ready);
  },
  targets: [
    { name: 'controls', type: 'selector', selector: '#controlLeft' },
    { name: 'header', type: 'pageRect', rect: { x: 0, y: 0, width: 480, height: 120 } },
    { name: 'canvas', type: 'runtimeRect', id: 'canvas' },
    { name: 'stage-parts', type: 'runtimeRects', ids: ['game', 'gui', 'minimap'] },
    { name: 'world-start', type: 'worldRect', rect: { x: 0, y: 0, width: 320, height: 160 }, padding: 8 },
    { name: 'viewport', type: 'viewport' },
    { name: 'page', type: 'fullPage' }
  ]
};
```

Probe output is printed as warnings unless a config marks a probe as required.
When a capture is useful for an issue or review, attach the relevant PNGs from
`temp/e2e-captures/<run>/` manually.

## Phased coverage plan
1) MIDI UI: enable/disable flow, pane visibility, event list sanity.
2) Level editor: load, tool selection, save/import basics.
3) Game: initial load, basic controls, level navigation.
