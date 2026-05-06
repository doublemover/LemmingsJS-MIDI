# Playwright Tests

Playwright tests are opt-in end-to-end checks under `e2e/`. They do not run as
part of `npm test`.

## Running

- `npm run test-e2e:install`
- `npm run test-e2e`
- `npm run test-e2e:ui`
- `npm run test-e2e -- e2e/harness.game.spec.js`

Playwright defaults to `https://localhost:8080` and starts the HTTPS server via
`npm run start-https`. To point tests at another same-origin server:

```powershell
$env:LEMMINGS_E2E_BASE_URL = "https://127.0.0.1:8080"
npm run test-e2e
Remove-Item Env:\LEMMINGS_E2E_BASE_URL
```

The server uses the self-signed certs in `certs/`. Replace those files locally
if a trusted certificate is needed for a device or VM.

## E2E Harness

Add `?e2e=1` to enable `window.__E2E__`. The current schemas are documented in:

- [`e2e-state.md`](e2e-state.md)
- [`e2e-editor-state.md`](e2e-editor-state.md)

Playwright specs use this harness for deterministic state snapshots, time
control, editor mutations, MIDI intent automation, and runtime capture
rectangles.

## WebMIDI

Chromium can be granted MIDI permission through Playwright context options. For
hardware-independent tests, use `e2e/helpers/webmidiStub.js`.

## Disposable Visual Captures

The visual capture CLI is a local developer aid for UI, editor, procgen, HUD,
and docs review. It writes PNGs only under ignored `temp/e2e-captures/`. Do not
commit generated screenshots, manifests, baselines, or image inventories.

Start the server first when running the CLI directly:

```powershell
npm run start-https
```

Common commands:

- `npm run capture:e2e:midi`
- `npm run capture:e2e:editor`
- `npm run capture:e2e:procgen`
- `npm run capture:e2e:game-hud`

Direct CLI form:

- `node scripts/e2e-capture-rects.js --config=e2e/capture-targets/midi.js`
- `node scripts/e2e-capture-rects.js --config=e2e/capture-targets/editor.js --viewport=tablet`
- `node scripts/e2e-capture-rects.js --config=e2e/capture-targets/game-hud.js --target=game-runtime-hud --json`

Supported flags:

- `--config=<path>`: required config module.
- `--base-url=<origin>`: overrides `LEMMINGS_E2E_BASE_URL` and the Playwright
  default.
- `--out-dir=<path>`: output directory; it must stay under
  `temp/e2e-captures/`.
- `--viewport=desktop|tablet|mobile`: viewport preset.
- `--target=name[,name...]`: capture only named targets.
- `--json`: machine-readable output.

Capture configs export a plain object with optional async setup:

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
  ],
  probes: [
    {
      name: 'controls-overflow',
      selector: '#controlLeft',
      checks: ['horizontalOverflow', 'verticalOverflow', 'unexpectedScrollbar']
    }
  ]
};
```

Target types:

- `selector`: exactly one visible Playwright locator match.
- `pageRect`: explicit page-space CSS-pixel rectangle.
- `runtimeRect`: one rectangle id from `window.__E2E__.getCaptureRects()`.
- `runtimeRects`: multiple runtime ids, or all available ids when `ids` is
  omitted.
- `worldRect`: world-space rectangle converted through the E2E harness.
- `viewport`: current viewport screenshot.
- `fullPage`: full-page screenshot.

Visual probes report warnings by default. A probe with `required: true` makes
matching issues fail the CLI. Supported checks are `horizontalOverflow`,
`verticalOverflow`, `clippedText`, `zeroSizeVisibleText`, `hiddenFocusedElement`,
`smallTapTarget`, and `unexpectedScrollbar`.

When captures are useful for an issue or review, attach selected PNGs from the
run directory manually. Keep `temp/e2e-captures/` disposable.
