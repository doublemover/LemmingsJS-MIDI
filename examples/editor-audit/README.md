# Recovered editor audit examples

These files were copied byte-for-byte from remote branch `editor-audit`, commit
`56fb14989fb48d73c4039d5c37505e9398e0154f`, on 2026-10-07. Original paths were
`evidence/levels/`, `evidence/level-verification.json`, `evidence/control-inventory.json`
and `evidence/coverage.json`.

The Orchard Gate and Hydro Triangle levels, and the two-level pack archive, are
preserved for repeatable editor import/playtest exercises. The `historical-*`
files record that earlier branch's observations; they are not current-branch
acceptance and may mention controls now disabled pending supported runtime
semantics. The name inside Hydro Triangle is original source text, not a claim
that any new art or implementation was approved.

Current checks should parse/import these fixtures, retain their level content,
and exercise archive completeness. A fresh browser playthrough remains required
before relying on the historical playtest results.

## Historical report and base-pack manifest

The standalone [HTML report](historical-editor-audit-report.html) and
[324-level manifest](historical-base-level-manifest.json) are also copied
byte-for-byte from the same source commit. The HTML includes its original
screenshots and dated findings. Its passing counts, unresolved findings and
references to separately retained archives describe the 2026-10-06 audit only.
Some findings were subsequently fixed; these files are not a current status report.

## Current reproduction

With the normal repository Playwright/browser and HTTPS server setup, run:

```text
npm run test-e2e -- e2e/editor-audit.spec.js
```

The current suite reuses these fixtures for editor controls, supported terrain
transforms, disabled rotation/one-way controls, project archive recovery, and
both ten-lemming playthroughs followed by exact saved-level export roundtrips.
It writes fresh screenshots and downloads to ignored `test-results/`, never
overwriting historical fixtures or receipts. The original audit's hardcoded
report generator and duplicate server configurations are intentionally retired.

To reproduce the base-pack JSON archive in a new directory, run
`npm run export-all-levels -- <new-directory>`. The historical manifest is a
reference receipt; compare its identities and hashes with the newly generated
manifest before claiming an exact reproduction.
