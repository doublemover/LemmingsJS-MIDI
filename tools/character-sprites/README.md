# Pixel body generation and decoder previews

`python3 tools/character-sprites/build_shape.py donut` regenerates the canonical
337-frame donut manifest; use `all` to rebuild all eleven additional bodies. Python 3 and Pillow are required. The recovered Hydro
action generator supplies the unchanged frame sizes, anchors, timing, tools and
canopy attachments; the new literal ring mask supplies the body. Eyes are on the
rim. `beret-fits.json` pins the accepted per-shape crown placement and cloth mask.
Native picker layer hashes and 2D placements are retained alongside explicit
custom ear/donut fits. Four pixels of cosmetic drawing space above each additional
body preserve the original body/world anchor; they do not change game collisions.
Hydro triangle remains the original manifest. `approved-beret-baseline.json`
protects all twelve reviewed fits against accidental regeneration changes. Every non-terminal body frame has an enclosed transparent aperture. Drowning
frames 8 onward cross the waterline, splatting 3 onward becomes a puddle, frying 9
onward becomes ash, exit frame 6 is only 2×2, and explosion is a separate effect.

The baseline and ten other masks came from the user's reviewed Hydro sprite and
shape packs. Donut was explicitly requested as a circle with a hole. This adds no
physics, collision, timing, identity, or replay state.

`native-color-catalog.json` records metadata returned by the recovered native
Orbit runtime's `catalog(Color)` and `accessoryColors()` APIs on 2026-10-07. It
contains nine current body colors and eleven accessory colors. The sRGB values
are rounded to 8-bit channels in `js/lemmings/characterColors.js`. The old preset
reference's `light_yellow` is absent from the active catalog and
`findSupportedItem(Color, 'light_yellow')` returns null; no color was invented for
it. The original reviewed Hydro blue/orange palette remains the default and the
custom color inputs remain available. This is catalog evidence, not a claim that
the user has reviewed every recoloring.

Metadata extraction initialized the verified WASM directly in Node with the
standard instantiateWasm hook, preloaded its supplied data file, and omitted the
browser worker pool in a temporary metadata-only copy. No renderer, WebGL,
browser permissions or remote service was involved; the native catalog itself
was unmodified.

Run these from the repository root to produce exact current-decoder previews:

```
node tools/character-sprites/render-preview.mjs
python3 tools/character-sprites/render_contact_sheet.py
```

The second script needs Pillow and DejaVu Sans. Output is under
`temp/live-instrument/`. It includes a 108-combination shape/color sheet, the
donut's 18 action states and a walking GIF. Checkerboards expose actual alpha
holes. These are sprite decoder captures, not browser gameplay screenshots.
