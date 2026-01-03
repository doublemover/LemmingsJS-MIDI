# Procgen (Endless) Specification

This page describes the standalone `procgen.html` experience: an endless,
full-viewport Lemmings run with no HUD/minimap/cursor and a procedural ground
generator that keeps the lemmings moving to the right.

## Scope
- Use the second pack (Oh No) assets and the second classic style (fire).
- Full-viewport canvas, no MIDI UI, no HUD/minimap, no cursor.
- Endless spawning: the level never ends and lemmings keep releasing.
- Procedural ground extends to the right so lemmings continue traveling.
- Camera stays centered on the rightmost lemming, with smooth follow.

## Fixed constants
- Game type: `OHNO` (second pack).
- Style: `fire` (groundSet 1).
- Level width: 8192 (long runway without reallocating buffers).
- Level height: `DEFAULT_LEVEL_HEIGHT` (classic height).
- Release rate: 50, release count: 50, save requirement: 0.
- Time limit: `INFINITE` (endless mode handles time).
- Ground height: 8 px.
- Initial ground width: 240 px.
- Ground segment width: 160 px.
- Ground extension threshold: 80 px.
- Lookahead distance: 240 px.
- Camera follow lerp: 0.12.

## Level bootstrap
- Create an empty editor level and convert it via `loadEditorLevel`.
- Add a single entrance gadget (`PIECE: 1`) near the left edge.
- Place initial ground beneath the entrance so the first lemmings land safely.
- Set `endless = true` on the view so spawning never stops.

## Procedural ground rules
- Track the rightmost lemming X.
- If `rightmostX + lookahead >= groundEndX - threshold`, append a new ground
  segment starting at `groundEndX`.
- Clamp ground placement within level bounds.
- Ground uses a single palette index for now (no terrain sprites yet).

## Camera follow
- Each tick, compute target X so the rightmost lemming is centered.
- Smoothly lerp the camera toward the target (no snapping).
- Use Stage clamping to keep the view within bounds.

## E2E smoke checks
- Page loads and `__E2E__.getState().ready` is true.
- Lemmings spawn over time (count increases after steps).
- View X increases as the rightmost lemming advances.
