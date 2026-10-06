# Map editor audit deliverables

Audited published base: `a7dd33e2facbb8d043301464b3a734d203fc6444`.
Implementation and level-source commit: `fbb035da20136f25c8c287a3562a47df58a582bf`.
This branch is separate from `master` and the subsequent MIDI sequencer work.

- [Full report with embedded screenshots](editor-audit-report.html): download and open locally to view the rendered report.
- [Coverage and remaining findings](coverage.json).
- [Actual editor control inventory](control-inventory.json).
- [Compact base-level manifest](base-level-manifest.json): all 324 identities, titles, checksums and roundtrip outcomes.
- [Delivered-level verification](level-verification.json): rescue counts, validation results, reload equality and file hashes.
- [The Orchard Gate](levels/orchard-gate.nxlv): beginner basher puzzle, verified 10/10 rescued.
- [Hydro triangle surprise](levels/hydro-triangle.nxlv): no skills required, verified 10/10 rescued.
- [Installable two-level editor package](levels/audit-level-pack.json).

Import the NXLV files with the original `lemmings` pack selected, or use
Project → Install Pack for the JSON package. The original base-pack art is required.

Validation recorded 47 browser tests and 2,330 unit/integration tests passing.
Both delivered levels passed exact save/reload/export equality and live playtests.
The report distinguishes remaining issues and unrun scenarios.

## Reproduce the bulk export

Use Node 20+ (Node 22 was verified), install the locked dependencies with `npm ci`,
then run:

```text
npm run export-all-levels -- exports/reproduced-levels
```

The destination must not exist. The command exports all configured base-pack
levels and checks JSON readback, unique identities and classic semantic roundtrips.
See [the exporter](../tools/exportAllLevels.js) and [tool documentation](../docs/offline-tools.md).
The generated 324 JSON files need not be stored in Git because this manifest and
the exporter reproduce them from the committed base assets.

Browser reproduction uses the existing editor suites plus `e2e/audit.extra.spec.js`.
Serve the checkout at `http://127.0.0.1:8096`, set `AUDIT_CHROMIUM` to a Chromium
executable, and run the selected editor tests with `audit.extra.config.js`.
The `scripts/*audit*` helpers record additional playtest and MCP evidence.

Library saving was not confirmed because the supported upload helper could not
access upload preparation. Git delivery was subsequently authorized. Large local
ZIPs, browser binaries/caches, recordings, full runtime snapshots and Git recovery
bundles are intentionally excluded from this deliverables commit. The HTML report's
reference to a complete evidence archive describes that separately retained local
archive; the files linked above are the published Git deliverables.
