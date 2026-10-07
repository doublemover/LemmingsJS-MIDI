# Neon Cabaret Power Station

An original indexed-pixel theme: raspberry velvet, turquoise glass, champagne brass,
heart-shaped machinery, and generous incandescent footlights. All artwork is
code-native and deterministic; there are no fetched/generated raster dependencies,
fonts, vendor artwork, random animation states, or changes to actor physics.

![Neon Cabaret stage and hazard artwork](previews/neon-cabaret.png)

## Delivered assets

- Six scenery pieces: bulb garland, dancing spotlight rail, heart transformer,
  velvet dynamo, glass catwalk fascia, footlight chase.
- Six terrain tiles: velvet foundation, glass slab, brass stairs, steel amplifier,
  connector column, hollow heart marquee arch.
- Three hazard-ready assets: live arc (FRYING), curtain press (TRAP), coolant bath
  (DROWN). Each has a fixed local trigger rectangle and visible danger markings.

`createNeonCabaretPack()` in `js/decorations/NeonCabaretPack.js` implements the
shared decoration contract. Its scenery contains no triggers. The companion
`createNeonCabaretTheme()` in `NeonCabaretTheme.js` supplies the terrain and hazard
asset catalog. These additional assets are authoring ingredients, not registered
runtime hazards or a selectable original-game groundset. Operational integration
must bind the engine's trap lifecycle and cooldown, not derive collisions from
cosmetic animation frames. The indexed terrain masks are ready for stamping;
the amplifier carries `isSteel` and the arch's interior remains transparent.

The shared decoration registry integration is owned by the companion casino pack
change. Once integrated, select Neon Cabaret or use `decoration=neon-cabaret`.
Without that companion change, open the standalone preview below.

## Preview and validation

Serve the repository with `npm start`, then open
`docs/previews/neon-cabaret.html`. It includes a composed stage, every animated
asset, terrain palette and hazard gallery. Pause freezes all previews;
`prefers-reduced-motion` starts paused. The scene intentionally separates the
hazard gallery from decorative machinery, avoiding misleading lethal scenery.

Run `npx mocha test/neon-cabaret-pack.test.js` for determinism, dimensions,
transparency, palette indices, trigger bounds, scenery separation and storage.

All animated assets are baked into 16 indexed frames during catalog creation.
The entire theme uses 429,760 bytes (about 420 KiB) of raw indexed frame storage.
The palette has 20 entries, encoded ABGR for existing renderers; index 128 is
transparent. No raster generation is required during game rendering. The preview
caches RGBA canvases once. Main runtime rendering uses the shared decoration
renderer caches and culling rather than a per-actor draw loop.

## Art direction and semantics

Decoration lighting uses slow chase rhythms and short sweeps, never whole-screen
flashes. Turquoise glass edges define walkable material; bright opaque highlights
keep its collision silhouette legible. Brass step tops define each riser. Steel
is deliberately opaque, with a charcoal grille and corner rivets. Hazards use
red rims or yellow-black stripes in addition to color; the live arc always spans
the central dangerous opening. Decorative transformer coils sit behind a guard
rail and are visually distinct from the striped, exposed arc hazard.
