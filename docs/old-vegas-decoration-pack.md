# Old Vegas decoration pack

Select **Scenery → Old Vegas · velvet & bulbs** in procedural controls, or open
`procgen.html?decoration=old-vegas&lanes=1&shape=rounded_triangle&zoom=4&follow=0`.
The source terrain pack remains independently selectable. Shared links retain the
scenery choice. **Original scenery** restores the existing presentation.

## Contents

44 original code-native indexed pixel-art pieces, each with 16 frames:

- Six chasing marquees: Old Vegas, Jackpot, Cabaret, hydro, Lucky 7, Showtime
- Symmetric, hand-authored heart, club, spade and diamond medallions
- Pearl, ruby-square and diamond-star bulb chases
- Garnet velvet swag with delayed tassel sway
- Roulette rosette, continuously rolling slot reels and Art Deco fan lights
- Three clearly adult humanoid hydro revue dancers: hip shimmy, Charleston and
  kickline. Fitted red stage bodices and shorts, small cobalt feather bustle,
  orange hair, long stockings, gloves, heels, hip sway, torso bounce and delayed
  tassel follow-through. Intimate areas remain covered; these are non-explicit
  stylized cabaret sprites. The earlier triangle performer is preserved in Git
  history, not used as the revised showgirl's body.
- Eight chosen chip denominations, each as labeled side-view stacks and a
  face-on chip: **1, 5, 25, 100, 500, 1,000, 5,000 and 25,000**. Labels abbreviate
  thousands as 1K/5K/25K. Colors are cream, red, green, black, purple, pale gold,
  orange and cobalt respectively. This is the pack's complete authored set,
  **not a claim of universal casino denominations or standardized colors**.
- Eight full 50-native-pixel playing cards: ace and ten of each suit, red
  hearts/diamonds and black clubs/spades, with inverted lower corner indices.
  At a typical 200-pixel native viewport this is around one quarter-screen high;
  camera zoom and viewport size naturally change the fraction.

Slot symbols travel vertically by three native pixels per frame through separate
clipped 12×16 reel windows. Adjacent symbols are visible at the window edges;
this is rolling strip animation rather than instantaneous icon replacement.

The actual renderer-compatible source is `js/decorations/OldVegasPack.js`.
`assets/decorations/old-vegas/pack.json` describes the exported atlas;
`atlas.png` contains every frame, and `contact-sheet.png` is a 3× pixel preview.
Regenerate these with `node tools/exportDecorationPack.js`, then optionally
`python tools/exportDecorationAnimation.py` (Pillow) for the animated contact sheet.
`examples/old-vegas-gallery.html` animates the same runtime sprites and links to play.
No generated-image placeholder or external asset download is needed at runtime.

## Rendering contract

`getDecorationPack(id)` returns a cached catalog. Each piece contains a stable ID,
name, placement (`ceiling`, `stage`, `trim`) and indexed `image` with fixed width,
height, frame arrays and palette `getColor(index)` returning packed ABGR. Index
128 is transparent. The same adapter also registers **Neon Cabaret Power Station**.
Neon hazard artwork in this scenery layer is idle, never operational collision or
triggers. The separate playable Neon editor theme supplies real hazard behavior.

The decoration layer never queries, composes, evicts or changes collision chunks.
Ceiling/stage art is masked behind the existing terrain raster, and actors render
last. Fascia begins at local y=80, below the generated walking surface's maximum
of 78. It decorates lower foundations; it is not traversable new terrain.
At raster steps ≥4, decoration is omitted. Otherwise only visible lanes/chunks
are visited, with a 1,024-placement ceiling. Frame bitmaps, terrain occlusion and
composited frames are cached. Animation advances once per four simulation ticks,
pauses with simulation, and freezes for `prefers-reduced-motion: reduce`.

## Verification

`test/decoration-packs.test.js` checks palette/alpha integrity, unique IDs, frame
changes, catalog memory below 2 MiB, symmetric suit stencils, explicit chip values
and both views, complete 50px cards, actual slot-window translation, three distinct
human dance loops, deterministic noninteractive placement, share URLs, occlusion
reuse and reduced-motion caching. The frame payload is approximately 1.57 MiB.

The final refinement suite passed 2,627 tests; lint, critical typecheck,
undefined-call checks and dependency checks also passed. PNG sprite crops were visually inspected. Live Chromium
QA was attempted but its download returned invalid/truncated ZIPs, and the cloud
GUI browser blocked the local gallery with `net::ERR_BLOCKED_BY_CLIENT`. No live
browser screenshot is claimed.
