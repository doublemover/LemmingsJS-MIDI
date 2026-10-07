# Old Vegas / Casino Grand Revue

Select **Scenery → Old Vegas · Grand Revue** in procedural controls, or open
`procgen.html?decoration=old-vegas`. The terrain pack stays independently
selectable; shared links retain the scenery choice.

For the full-size architectural spectacle, import
`examples/neon-cabaret/grand-revue.nxlv` in the editor. It uses the real
**neon-cabaret** custom groundset, 1280×320 level dimensions, twelve selectable
terrain pieces and 65 gadgets. The original Opening Night level and gadget
IDs 0–10 are preserved. The Grand Revue includes gameplay hazards and skill
supplies; it is an editable playable scene, not a flat card-game interface.

## Architecture and identity

- 256 px black-marble promenade and gold cornice;128 px velvet/gold stairs
- 160 px ivory/black fluted marble pillars;192 px velvet dais
- 256 px double festoon ropes and velvet proscenium; oversized neon crown
- Three 192×192 adult humanoid hydro revue sprites with slim cobalt enamel
  triangle heads, dark oval eyes, winged eyeliner, tilted orange berets and fully
  cobalt-blue exposed bodies. Fitted chrome/obsidian futuristic stagewear keeps
  intimate areas covered, with cyan luminous seams, orange accents, gauntlets and
  small feathers. Distinct shimmy, Charleston and kickline
  poses have procedural torso/hip bounce and delayed head/feather follow-through.
  These use actual image-generated pixels imported into the runtime indexed
  palette; they are not enlarged versions of the former primitive human face.

There are 53 scenery pieces, each exposing 16 frame slots. Static architecture
reuses its frame buffer. The six new architectural terrain entries are IDs 6–11;
scenery versions remain noncolliding. At 192 px, the performer is three times the
height of the earlier 64 px version in editor/world coordinates. Procedural lanes
are 96 px high, so tall stage sprites explicitly fit within 68 px there; full-size
presentation belongs to the supplied 320 px-high level.

## Current chip references and original design

First-party product references were checked on 7 October 2026:

- [Poker Foundry, The Foundry ceramic chips](https://pokerfoundry.net/products/the-foundry/),
  including its current denomination and close-up image links. Its direct-print
  faces and edge patterns informed distinct center inlays and contrasting spots.
- [Poker Merchant, Skyline cash-game chips](https://pokermerchant.com/products/poker-chips-set-skyline-cash-game-500),
  including the product image showing face values and aligned colored edges.

No vendor logo, skyline artwork or proprietary chip face is copied. This pack
uses original HYDRO/VEGAS inlays, small suit marks, denomination-specific split
edge groups, concentric rings and matching side-stack edge colors. The complete
chosen values remain **1, 5, 25, 100, 500, 1, 000, 5, 000 and 25, 000**, abbreviated 1 K/5 K/25 K
where appropriate. These are authored values and colors, not a universal casino
standard. Eight full 50 px playing cards and genuinely rolling clipped slot reels
remain available as supporting props rather than the whole visual setting.

## Smoke hazard

Stable gadget 11 is a 96×88 dense gray cigarette-smoke cloud rising from an
ashtray. It uses the existing FRYING trigger timing with explicit
`characterHazard: 'smoke'`; the shared character-effects integration supplies
its coughing/collapse presentation. The fixed local contact rectangle is
x 7,y 12,width 82,height 66. The object cloud is dense and continuous, not a flame
or steam jet. Scenery-only catalogs never activate this trigger.

## Runtime and provenance

`OldVegasPack.js`, `CasinoArchitecture.js` and `HydroRevue.js` produce actual
renderer-compatible indexed frames. Transparency is 128. Individual pieces may
use their own palettes; the exported manifest records those palettes.
`HydroRevuePixels.js` comes from the approved transparent source sheet at
`assets/decorations/hydro-revue/source.png`. `tools/importHydroRevue.py` identifies
its three original-alpha connected components, scales to 192 px cells and
quantizes 127 colors. Animation is deterministic deformation of those pixels.
The source was generated with OpenAI imagegen, not copied from a third-party
character illustration. See the adjacent provenance file for the generation brief.

The decoration layer uses viewport-sized canvases, cached frames/placements and
screen-space sampling; tiny sprites become representative-color bins at far
zoom instead of disappearing. Pack identity and reduced-motion settings
invalidate its caches. Terrain masks stay in front of background art, actors
stay readable, and architecture/scenery does not mutate collision. Actual
terrain and hazard entries are supplied separately through the existing editor
and game contracts.

## Reproduce proofs

1. `node tools/exportDecorationPack.js`
2. `node tools/exportCasinoShowcase.js <temporary-frame-directory>`
3. `python tools/exportCasinoProof.py <temporary-frame-directory>`

The PNG and GIF proofs combine an actual level-asset render with full-size
runtime sprites. The HTML gallery uses the same frames. PNG crops were visually
reviewed. Live browser QA remains unavailable after the cloud browser blocked
the local gallery; no browser-playtest screenshot is claimed.

Final verification: 2,669 tests passed, including a real Grand Revue Level load
and smoke-trigger contact. Lint, critical typecheck, undefined-call scan,
dependency check and deterministic recipe regeneration check passed.
