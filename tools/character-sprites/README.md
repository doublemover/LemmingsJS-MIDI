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

## Wearable layers

The seven implemented additions are headphones, bow tie, monocle, tall oval
frames, separate trapezoid lenses, classic sunglasses and round sunglasses.
They have independent ears/neck/eyewear slots and colors. Dark ear pads, knots
and lenses retain their material, and clear rims reveal the underlying face.
Only one item occupies each slot; all three slots can stack with the beret.
Classic lemmings load no alternate assets. Accessory packs are lazy-loaded only
when an accessory is selected on an alternate body.

`derive_accessory_fits.py /path/to/runtime/orbit-thumbnails` reads the verified
native composition recipes and alpha pixels, then records their hashes and
literal game-pixel adaptations in `accessory-fits.json`. All eleven native
bodies have recipes for these seven items. Donut is an explicit custom circle
adaptation whose center remains transparent. Eye frames are cleaned around each
body's actual eye columns. At this resolution the native curves necessarily
simplify; they are not newly rendered 3D meshes.

`python3 tools/character-sprites/build_accessory_layers.py` writes deduplicated
sparse layers under `assets/characters/accessories/`, leaving all approved base
manifests unchanged. The generator checks its underlying action frames against
the approved manifests, follows the original body sampling lattice, and keeps
the cap, tools, canopy and foreground effects in front. Original Hydro's 9×7
floating face has its own exact eye anchors. Layers cover all 337 action frames
plus 42 cosmetic landing frames, disappear with the body, and finish landing at
the corresponding walking pose. No actor, collision, RNG or replay fields are
added. The palette stays within the existing 16-color indexed contract.

Run `node tools/character-sprites/render-accessory-preview.mjs`, then
`python3 tools/character-sprites/render_accessory_sheet.py` for actual runtime
decoder images: all bodies, all eleven named accessory colors, both directions,
wall climbing, floating, landing and a stacked-slot animation. Output is in
`temp/live-instrument/accessory-review/`. These require the existing Node
dependencies plus Python/Pillow. The images are decoder proofs; browser gameplay
and user visual acceptance remain separate.

Still to adapt: beanie, hat, bulb, tuft and crown. Native headwear recipes are
absent for both ear bodies, and all native recipes are absent for donut. Their
custom fits must be reviewed without changing the accepted beret placements.
