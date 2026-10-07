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

## Accessories and eyewear

All eight native accessories are implemented: headphones, bow tie, beanie, hat,
beret, bulb, tuft and crown. Exactly one accessory is selected; a new choice
replaces the previous one. Eyewear is separate: monocle, tall oval frames,
separate trapezoid lenses, classic sunglasses and round sunglasses. Body,
accessory and eyewear-frame colors are independent. Dark pads, knots and lenses
retain their material. Classic lemmings load no alternate assets.

`native-selection-contract.json` records the exact native validator diagnostic
“Select at most one accessory”, API categories, and decoded preset evidence.
The 108 native ORBAST1 appearances contain zero (41) or one (67) accessory;
33 pair an accessory with separate eyewear. Catalog ears/neck/headwear values
are attachment locations, not simultaneous user-facing slots. The earlier
stacked-slot prototype and its previews are superseded and must not be published.

`derive_accessory_fits.py /path/to/runtime/orbit-thumbnails` and
`derive_headwear_fits.py /path/to/runtime/orbit-thumbnails` read the verified
native composition recipes and alpha pixels. They retain hashes and explicit
literal-pixel adaptations in `accessory-fits.json` and `headwear-fits.json`.
All eleven native bodies have source recipes for headphones, bow and eyewear.
Native crown recipes are absent for the two ear bodies, and all native recipes
are absent for donut; those custom adaptations are labeled. Each crown item uses
its own native width, slope and perch, including the heart's different left/right
lobe choices. The tuft uses its rounded asymmetric source mask, not crown prongs.
At this scale native curves simplify; these are not newly rendered 3D meshes.

`build_accessory_layers.py` generates sparse layers for the approved beret plus
optional eyewear. `build_headwear_layers.py` supplies bare bodies and alternate
accessories, so choosing headphones or a bow actually removes the beret. Both
leave the twelve approved base manifests unchanged. Hydro's uncovered crown is
reconstructed exactly as its reviewed landing animation already does. Four
pixels of cosmetic top space preserve the body/world anchor, including Hydro
when wearing alternative accessories. Action timing, body pixels, collision,
RNG and replay state remain unchanged; palettes stay within 16 indexed colors.

Attachments sample on the body's exact pixel lattice. Hydro's original 9×7
floating face has its own eye anchors. Tools, canopy and foreground effects
remain in front. The beret retains its lift/open/reattach animation. Other
accessories stay attached while the separate gameplay canopy opens, with natural
occlusion during opening, and return to the normal walking pose. Accessories
vanish with the destroyed body instead of leaving obsolete beret debris.

Run the following from the repository root (Node dependencies + Python/Pillow):

```
python3 tools/character-sprites/build_accessory_layers.py
python3 tools/character-sprites/build_headwear_layers.py
node tools/character-sprites/render-accessory-preview.mjs
node tools/character-sprites/render-headwear-preview.mjs
python3 tools/character-sprites/render_accessory_sheet.py
python3 tools/character-sprites/render_headwear_sheet.py /path/to/runtime/orbit-thumbnails
```

Output is under `temp/live-instrument/accessory-review/` and `headwear-review/`:
individual accessories on every body, all eleven native colors, both directions,
wall climbing, floating and return to walking. The source-comparison sheet must
be retained alongside mask tests. These are actual `CharacterSpriteSet` and
`PixelSpriteSkin` decoder proofs; browser gameplay and user visual acceptance
are still separate. Only the existing twelve beret fits have prior user approval.

## Runtime readability and motion

`CharacterSpriteSet` applies `CharacterPresentation` after source validation and
accessory composition. The original manifests and reviewed fit hashes are kept.
Every shape uses one uniform (same x/y) scale about the original foot/world
anchor, with a seven-pixel maximum neutral body extent. The nine-pixel digging
channel therefore has visible space around a single actor. Tool timing, cells,
collision masks, brick placement and wall contacts are unchanged. Tiny eyes and
the donut's enclosed transparent aperture receive topology-aware pixel retention
when nearest-neighbor sampling would lose them.

Walking uses a stable neutral silhouette and a shape-specific restrained cadence;
there is no inherited two-pixel hop/squash applied to every body. The panic strip
holds a nervous beat, looks both ways, then does quick shivering hops with sweat.
The beret's landing transition finishes on the new walking pose.

`CharacterParticles` samples actual terrain RGB before a removal and emits only
samples that were actually cleared. Four short-lived digging chips throw away
from the channel edges; bashing/mining use six. Explosions, splats, drowning and
fire have distinct small bursts. Actual recolored accessory/eyewear frames eject
intact for three ticks, then fracture into up to three source-image pieces and
fade. Terminal sprites do not keep duplicate attached wearables. Cosmetic state
is outside simulation/replay snapshots and clears on rewind and disposal.

One shared pool is capped at 384 live particles, 72 births per tick, 2,048 sample
checks per tick and 8,192 rendered particle pixels per frame. Seeded cosmetic
variation does not consume simulation randomness; paused repeated renders do
not advance particles.

Generate bounded, reproducible motion evidence with:

```
node tools/character-sprites/render-motion-proof.mjs
python3 tools/character-sprites/render_motion_sheet.py
```

`temp/character-motion/` contains a one-digger-per-shape Fun 1 contact sheet,
walking/panic and all four death animations for every shape, a bashing animation,
and a wearable fracture sequence. These use real loaded `Just dig!` terrain,
`CharacterSpriteSet`, action systems and `DisplayImage` blitting in Node. They are
native-renderer evidence, not browser gameplay or a substitute for browser QA.

Drowning now raises little hands at contact, then sinks behind a fixed waterline
using the exact `easeInExpo` function from https://easings.net/#easeInExpo:
`x === 0 ? 0 : 2 ** (10 * x - 10)`. The sink runs from sprite frames 3 through
14, with the final bubble at frame 15. Frying adds a small sizzling skillet,
hot-foot hops, an overdone silhouette, and a smoke/ash finish. Both use only the
existing palette and frame cells. The 16-tick drowning and 14-tick frying action
systems, world movement, source assets, classic sprites, and particle budgets
are unchanged.

The drowning/frying GIFs play at the engine's normal 60 ms per tick. Their
`*-12-shapes-timeline.png` sheets label exact ticks and follow each actor's
unchanged horizontal drift. The proof receipt records action-returned removal
and stops drawing the actor immediately, preventing a looping animation from
reappearing on its terminal tick. Wearable particles continue their normal fade.
