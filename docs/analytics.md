# Privacy-First Analytics

This project uses a privacy-first analytics model with an explicit opt-in
consent default and a local-only event buffer.

## Consent Defaults

- Default state: analytics is disabled.
- No cookies are required.
- No device fingerprinting or cross-site identity is used.
- Consent is stored locally in `localStorage` only:
  - key: `lemmings.analytics.consent.v1`
  - values: `granted` or `denied`

Runtime query overrides:

- `?analytics=1` enables consent for the session and stores `granted`.
- `?analytics=0` (or `?analytics=off`) disables consent and stores `denied`.
- `?analyticsOff=1` forces runtime disable regardless of consent.

## Data Minimization

Analytics events are schema-locked and low-cardinality:

- `visitor.page_view`
- `gameplay.level_select`
- `gameplay.midi_toggle`
- `gameplay.saved_level`
- `editor.action`
- `runtime.boot_error`

Only bounded enum/boolean/integer fields are captured. Free-form text payloads
and high-cardinality identifiers are intentionally excluded.

## Local Ring Buffer

Events are stored in a fixed-size in-memory ring buffer and mirrored to
`localStorage`:

- key: `lemmings.analytics.buffer.v1`
- schema version: `1`
- explicit export/import API for local workflows:
  - `window.__LEMMINGS_ANALYTICS__.exportBuffer()`
  - `window.__LEMMINGS_ANALYTICS__.importBuffer(data, { replace })`
  - `window.__LEMMINGS_ANALYTICS__.clearBuffer()`

This supports development telemetry with no backend service.

## Optional Managed Beacon Path

Managed beacon delivery is optional and disabled by default.

Enable only when all conditions are met:

1. consent is granted,
2. a valid HTTPS endpoint is configured,
3. managed beacon is explicitly requested.

Runtime controls:

- `?analyticsBeacon=1` requests managed beacon delivery.
- `?analyticsSample=<0..1>` sets managed-beacon sampling.

Endpoint sources:

- runtime override (`__LEMMINGS_ANALYTICS_BEACON_ENDPOINT__`)
- `<meta name="lemmings-analytics-endpoint" content="https://...">`

## Kill Switches

Hard-disable (deployment-wide):

- `__LEMMINGS_ANALYTICS_HARD_DISABLED__ = true`
- or `<meta name="lemmings-analytics" content="off">`

Runtime disable:

- `__LEMMINGS_ANALYTICS_DISABLED__ = true`
- or query `?analyticsOff=1`

Even when analytics code is present, these switches keep collection disabled.
