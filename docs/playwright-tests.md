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

## WebMIDI stubbing
For now, E2E tests stub WebMIDI using `e2e/helpers/webmidiStub.js` to avoid
permission prompts and hardware dependencies. The stub provides fake inputs and
outputs, so MIDI coverage is limited to UI flows until real devices are wired
in.

## Phased coverage plan
1) MIDI UI: enable/disable flow, pane visibility, event list sanity.
2) Level editor: load, tool selection, save/import basics.
3) Game: initial load, basic controls, level navigation.
