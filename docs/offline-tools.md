# Offline Tools

This document describes the Node.js scripts used for offline asset work. These
utilities help export, patch and package game assets. They are meant for local
development and are not part of the runtime site. Non-asset developer helpers
live under `scripts/`.

All scripts accept paths to level packs. A pack can be a folder or an archive
(`.zip`, `.tar`, `.tar.gz`, `.tgz`, or `.rar`). The `NodeFileProvider` class lets
the tools read from these sources without extracting them first.

## exportAllPacks.js

```
node tools/exportAllPacks.js [pack1 pack2 ...]
```

Exports panel, lemming and ground sprites for each pack. If no pack names are
provided it reads `config.json` to determine pack paths. Assets are saved in
`exports/export_<pack>` directories.

## exportAllSprites.js

```
node tools/exportAllSprites.js [packPath] [outDir]
```

Exports the skill panel, lemming animations and ground object sprites for a
single pack. `packPath` defaults to the first entry in `config.json`. Output goes
to `outDir` (`exports/<pack>_all` by default).

## exportPanelSprite.js

```
node tools/exportPanelSprite.js [packPath] [outDir]
```

Saves the skill panel background as `panelSprite.png`.

## exportLemmingsSprites.js

```
node tools/exportLemmingsSprites.js [packPath] [outDir]
```

Exports every lemming animation as individual PNGs plus sprite sheets. The files
are placed in `outDir` (`exports/<pack>_sprites` by default).

## exportGroundImages.js

```
node tools/exportGroundImages.js [packPath] [groundIndex] [outDir]
```

Writes terrain and object images from one ground set to PNGs. `groundIndex`
selects the `GROUND?O.DAT` and `VGAGR?.DAT` pair.

## listSprites.js

```
node tools/listSprites.js [packPath] [--out file]
```

Lists sprite names, dimensions and frame counts. Use `--out` to write the list
to a file instead of stdout.

## patchSprites.js

```
node tools/patchSprites.js [--sheet-orientation=horizontal|vertical] <target DAT> <png dir> <out DAT>
```

Replaces sprites in an existing DAT archive with PNG data. Multiple frames can
be supplied as a sprite sheet when `--sheet-orientation` matches the sheet
layout.

Implementation note:
- Output serialization is streamed with backpressure handling, so patching large
  DAT archives does not require a single full-size output allocation.

## packLevels.js

```
node tools/packLevels.js <level dir> <out DAT>
```

Compresses a directory of 2048 byte `.lvl` files into a single DAT file. Useful
for building custom level packs.

Implementation note:
- Packed bytes are streamed to disk as each level is processed to keep memory
  usage stable on large level directories.

## packPipeline.js

```
node tools/packPipeline.js unpack <input DAT> <out dir>
node tools/packPipeline.js pack <meta.json> <out DAT>
node tools/packPipeline.js patch <input DAT> <out DAT> --part <index> --offset <byte> --file <patch bin>
```

Provides a generic DAT workflow:
- `unpack` writes each decompressed part to `part-###.bin` plus a `meta.json`
  manifest.
- `pack` rebuilds a DAT archive from the manifest and part files.
- `patch` applies a binary patch to one decompressed part and writes a rebuilt
  DAT in one step.

Implementation notes:
- `pack` rejects absolute, null-byte, or parent-traversal part paths in
  `meta.json`; part files must stay inside the metadata directory.
- Archive caches used by `NodeFileProvider` are bounded by entry count and
  estimated payload bytes and can still be cleared explicitly with
  `clearCache()`.

## archiveDir.js

```
node -e "import('./tools/archiveDir.js').then(m => m.archiveDir('dir', 'zip'))"
```

Utility function to create `.zip`, `.tar.gz` or `.rar` archives from a folder.

## cleanExports.js

```
node tools/cleanExports.js
```

Removes all `export_*` directories created by the other scripts.

---

Exported assets now live under the `exports/` directory. The game can load levels
directly from packed archives, so you may keep your level packs compressed while
still running these tools.


## All configured classic levels

`npm run export-all-levels -- <new-directory>` exports all 324 configured classic
levels as `lemmings-classic-json` records with stable pack/rank/index identities
and a SHA-256 manifest. Each level is checked through the classic binary writer
and reader, then the saved JSON is read back. An existing destination is refused.
These are archival classic-level JSON records, not editor-import project bundles.

Pack export resolves `config.json` through `fileURLToPath`, including paths with
spaces and Windows file URLs. Missing or malformed configuration fails clearly
instead of silently falling back to one pack.


## Original shape foundry

`npm run build:shape-foundry -- --name=rook` authors the original pocket bar,
slotted plate and asymmetric pebble as experimental 8/16/32-mode sample packs.
Options select `--shape=pocket-bar`, `--mode-count=8`, `--sample-rate=48000`,
`--seconds=2` and an output folder under `dist/`. A tier with insufficient supported
site response is explicitly unavailable; it is not silently replaced. This build
has not yet been executed in the current development pass.

The source meshes are actual closed tetrahedral solids with an explicit model-unit
to meter scale, density in kg/m3, Young modulus in Pa, Poisson ratio and Rayleigh
loss. They are chosen musical assumptions, not measurements of game materials.
The original implementation uses constant-strain tetrahedra, lumped nodal mass
and a mass-whitened symmetric Jacobi eigensolve. Its stiffness formulation follows
the standard virtual-work integral described in [TU Wien's finite-element
formulation](https://www.iue.tuwien.ac.at/phd/orio/node53.html). Amplitude T60 is
`ln(1000)/(dampingRatio * angularFrequencyRadiansPerSecond)`; substituting Hz
would introduce a factor of 2π error.

Input limits are 64 vertices, 192 tetrahedra, four excitation/four pickup sites,
80 sweeps, a 30-second solve deadline and 32 MiB admitted solver workspace.
Cancellation, invalid geometry, unexpected zero modes or failed residuals produce
no playable result. Signed excitation vectors and independent signed pickup
vectors are retained with the modal displacement shapes. The selected tiers rank
all-site-to-pickup impulse-response energy, with negligible, unsupported-frequency
and unsupported-decay modes excluded. Their numerical retained-salience fraction
is not a perceptual quality claim.

The build emits immutable content-hash directories with ordinary `pack.json`,
recipe, provenance data and calibration WAV assets, then atomically changes its
small `current.json` head. A failed build keeps the last published head. The
runtime consumes the existing owned sampler and explicit site articulations; no
C++, Faust compilation or FEM solve is required for playback. Selected-site WAVs
share one body gain calibration instead of independent loudness normalization.
No generated binaries need to be committed.

Algebraic residual/orthogonality qualification is distinct from geometric mesh
convergence, acoustic material accuracy, level-matched listening and runtime cost.
Those remain required acceptance work; the build labels its output experimental.
A refined bar source is available for a later mesh comparison. The plate and
pebble do not yet provide a bounded refinement family. Pocket Foundry's physical
zone scene remains dependent work. The Sound panel now offers an in-app Shape
foundry using the actual bound worker, ordinary verified content installation,
selected-site prelisten and canonical lane Apply. Those browser paths are
implemented but not yet runtime-qualified.


### Compare nested original bar meshes

`npm run qualify:shape-refinement -- --name=rook` solves the original coarse and
refined pocket bar, then compares the fixed `low-eight-v1` profile. Optional
`--output=dist/shape-refinement`, `--shape=pocket-bar` and
`--profile=low-eight-v1` keep the selected source and tolerances explicit.
The browser foundry offers the same operation for its exact currently prepared
bar through one admitted background worker.

The comparison checks matching physical sites, constraints and complete nested
parent-volume coverage. It reassembles elastic residuals and mass orthogonality
before correlating mode shapes. The [Ansys MAC documentation](https://ansyshelp.ansys.com/public/Views/Secured/corp/v242/en/mech_addon/ds_results_nvh_maccalc_method.html)
describes correlation on matched/mapped nodes; this implementation explicitly
uses coarse lumped mass at exactly matched vertices. A global one-to-one assignment
combines shape correlation and fine-reference relative frequency error. The fixed
profile requires all eight lowest elastic modes to meet 5% frequency error and
MAC at least 0.9. Nearly degenerate mode groups are inconclusive pending a separate
subspace comparison; mode order alone is not a correspondence certificate.

The output contains content-addressed full input artifacts and a hashed comparison
package. `current.json` identifies the latest **comparison result**, including an
out-of-tolerance or inconclusive status. Those statuses return exit code one.
A comparison exception/cancellation leaves the previous result head intact. Input
file hashes and modal asset hashes are named separately. No pack, playback setting
or quality tier changes. Two-mesh agreement is a limited numerical observation;
it does not prove asymptotic convergence, physical material accuracy, listening
quality or measured real-time capacity. No accepted comparison is claimed until
this tool has actually run and its receipt has been reviewed.

## Compare sound renders visually

Run the same A/B comparison directly from a generated blind listening package:

```powershell
npm run compare:sounds -- --package=temp/my-listening-set/listening.json --trial=1 --out-dir=temp/my-spectral-comparison --name=rook
```

Alternatively provide `--a=temp/clip-a.wav --b=temp/clip-b.wav`. Inputs must be aligned stereo float32 WAV files at the same 44.1/48/96k rate, with the same frame count; no automatic time warp, pitch correction or level normalization is applied. A listening-package input verifies both files against their exact published hashes without opening its private key. Inputs and new output directories stay under repository `temp/`. Work is bounded to 60 seconds and 64 MiB combined encoded/decoded PCM.

The command writes `comparison.html`, `comparison.json` and, by default, a Playwright-rendered `comparison.png`. Use `--png=false` for data/HTML only. `--browser=chromium|firefox|webkit`, optional Chromium `--channel=` or `--executable=` select the report renderer. PNG capture uses a 1920×1080 desktop viewport, checks the full/active timeline toggle and aligned spectral hover, and captures the complete figure.

The report contains shared-scale A/B spectrograms, an active-band A−B heatmap, 10 ms RMS envelopes and their mean-relative 0.5–20 Hz modulation spectra. It opens on the shared active region; the full PCM, including silence, remains in the analysis and can be shown. Hover for exact window time, display-band frequency and A/B power. FFT spacing, Hann window, power normalization, display floor and nearest-bin policy are recorded. A modulation peak may reflect the existing note pattern, gaps or decay; it does not prove a hidden LFO. Spectral and waveform differences do not establish musical quality or audible relatedness.

Source files and WAV bytes are hash-bound. The stable analysis hash excludes agent labels, profiling and rasterization metadata. Wall-time/RSS are developer-tool observations, not realtime audio capacity. Generated PCM, plots and dense matrices remain private artifacts; commit the analysis code and concise qualification records.


## Generate export-delivery schedules

Run a bounded campaign against the actual prepared-artifact and native-delivery owners:

```powershell
npm run model:deliveries -- --seed=1979 --runs=4096 --steps=64 --max-ms=60000 --max-heap-mib=256 --out-dir=temp/my-delivery-model --name=rook
```

Each generated command has a reference-model precondition. After every transition the driver compares immutable source bytes and identity, retention, consumer leases, reserved bytes, request outcome and native-owner retirement. It explores independent consumers, retry, expiry, cancellation before open, late writes, rejection and reversed close/abort acknowledgments. A failure report retains the seed, original trace, observations and a bounded deletion-shrunk trace with the same failure. A shrinking error or exhausted budget preserves the original failure. The committed deliberate adapter-fault fixture demonstrates shrinking; it is not a historical product defect.

Replay a report’s `minimalTrace` by saving it as `{"trace":[...]}` under `temp/`, then add `--replay=temp/my-trace.json` with a new output directory. No existing output directory is overwritten. The report hashes the complete owned export source closure, the model, runner and fixture, and refuses a source change during execution. Wall time and observed Node heap are checked at every transition and shrink attempt; the heap observation is not a process RSS bound. At most4096schedules,128generated steps plus bounded cleanup,160commands per replay and128shrink attempts are admitted. Controlled adapter promises establish ownership behavior, not real browser filesystem support or disk durability.


## Generate asset-acquisition schedules

```powershell
npm run model:assets -- --seed=1979 --runs=4096 --steps=64 --max-ms=120000 --max-heap-mib=256 --out-dir=temp/my-asset-model --name=rook
```

The serial reference drives the actual FileProvider, raw handle, reader and byte-lease owners with controlled XHR responses and an inline digest adapter. Every transition checks exact resident/pinned/accounted bytes, shared requests, cache locators, consumer outcome, source hash, requesting provider epoch and immutable pinned generations. Schedules include normal/reload/probe acquisition, per-consumer hash mismatch and cancellation, cache clear, reversed responses, independent reader forks, exclusive copy transfer and deferred provider disposal through a runtime lease.

Both `model:assets` and `model:deliveries` share the bounded campaign/replay/shrinking runner. The asset runner admits at most256generated steps,512commands per replay and12raw sources per schedule. The owned source graph is bounded to512files/16MiB; the runner, source collector, shrinker and regression fixture are also hashed. A complete trace and stable failure signature survive an interrupted shrink. Replay accepts the same `--replay=temp/trace.json` shape described above. These controlled acquisition schedules do not qualify persistent cache transactions, real browser transport, background worker admission or process RSS; native Playwright receipts remain separate.


## Generate persistent-cache publication schedules

```powershell
npm run model:cache -- --seed=1979 --runs=4096 --steps=128 --max-ms=120000 --max-heap-mib=256 --out-dir=temp/my-cache-model --name=rook
```

This model uses the real persistent FileProvider methods through two isolated database connections. A controlled adapter serializes overlapping transactions, supplies cloned request snapshots and publishes complete writes only on commit. An independent serial reference checks paired payload/metadata generations, UTF-8 byte totals, per-provider last observed totals, request outcomes and native transaction retirement after every event. Clear/dispose abort only their requesting provider; queued peers keep their own publication. Read-only snapshots remain coherent when a newer writer queues between metadata and payload responses.

Half the deterministic seeds begin with an acknowledged stored entry; half begin empty. The adaptive scheduler chooses only available test-adapter events and current owner commands, then records concrete `native-step` traces for replay and shrinking. This is not an independent assertion of the production request sequence. A replay may use `drain` to expand an owned pending transaction into bounded individual events; the saved result contains the concrete events. At most24explicit operations,128generated steps and2048events per drain are admitted; write values are at most256UTF-8 bytes. The shared wall/observed-heap/source caps apply.

The committed stale-total fixture injects an error after an actual write acknowledgment and demonstrates shrinking; it is not a historical production bug. This small-entry corpus does not qualify eviction capacity, concurrent read-only browser scheduling, actual native IndexedDB behavior, clock injection or process RSS. Real desktop IndexedDB/Web Lock qualification remains in the asset-resilience Playwright suite.
