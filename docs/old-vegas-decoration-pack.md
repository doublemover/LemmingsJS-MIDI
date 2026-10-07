# Old Vegas decoration pack

Select **Scenery → Old Vegas · velvet & bulbs** in the procedural controls, or open
`procgen.html?decoration=old-vegas&lanes=1&shape=rounded_triangle&zoom=4&follow=0`.
The source terrain pack remains independently selectable. Shared links retain the
scenery choice. **Original scenery** restores the existing presentation.

## Contents

18 original code-native indexed pixel-art pieces, each with 16 frames:

- Six chasing marquees: Old Vegas, Jackpot, Cabaret, hydro, Lucky 7, Showtime
- Heart, club, spade and diamond illuminated medallions
- Pearl, ruby-square and diamond-star bulb chases
- Garnet velvet swag with delayed tassel sway
- Roulette rosette, animated slot reels and Art Deco fan lights
- Adult fictional hydro feather revue: established blue rounded-triangle shape,
  two dark eyes and orange beret; opaque red velvet stage costume, feather fan,
  hip sway, doubled bounce and lagging tassels. No anatomy swap or nudity.

The actual renderer-compatible source is `js/decorations/OldVegasPack.js`.
`assets/decorations/old-vegas/pack.json` describes the exported atlas;
`atlas.png` contains every frame, and `contact-sheet.png` is a 3× pixel preview.
Regenerate these with `node tools/exportDecorationPack.js`.
`examples/old-vegas-gallery.html` animates the same runtime sprites and links to play.
No generated-image placeholder or external asset download is needed at runtime.

## Rendering contract

`getDecorationPack(id)` returns a cached catalog. Each piece contains a stable ID,
name, placement (`ceiling`, `stage`, `trim`) and indexed `image` with fixed width,
height, frame arrays and palette `getColor(index)` returning packed ABGR. Index
128 is transparent. The same adapter also registers **Neon Cabaret Power Station**.
Neon hazard artwork is idle scenery, never operational collision or triggers.

The decoration layer never queries, composes, evicts or changes collision chunks.
Ceiling/stage art is masked behind the existing terrain raster, and actors render
last. Fascia begins at local y=80, below the generated walking surface's maximum
of 78. It decorates the lower foundations; it is not traversable new terrain.
At raster steps ≥4, decoration is omitted. Otherwise only visible lanes/chunks
are visited, with a 1,024-placement ceiling. Frame bitmaps, terrain occlusion and
composited frames are cached. Animation advances once per four simulation ticks,
pauses with simulation, and freezes for `prefers-reduced-motion: reduce`.

## Verification

`test/decoration-packs.test.js` checks palette/alpha integrity, unique IDs, frame
changes, catalog memory below 1 MiB, deterministic noninteractive placement,
share URLs, occlusion reuse and reduced-motion caching. Existing lane renderer
and procedural UI suites are also exercised. The final integrated full suite passed (2,624 tests), as did lint, critical
typecheck, undefined-call checks and dependency checks.

Live Chromium QA was attempted but the cloud workspace had no browser binary and
Playwright's download returned invalid/truncated ZIPs. The PNG contact sheet was
visually inspected. The cloud GUI browser also blocked the local gallery with
`net::ERR_BLOCKED_BY_CLIENT`; no live-browser screenshot is claimed.
