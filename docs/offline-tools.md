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
