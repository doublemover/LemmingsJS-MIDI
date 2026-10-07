# Integrated refinement validation, 2026-10-07

## Integration boundary

The candidate starts from master `059a4cab7cbe9c6bc3adda17036590d19d1a5248`.
It preserves editor-audit ancestry through merge `ab591df1` and desktop studio
ancestry through `bc7fdc82`. Animation changes `2a8e4314`, `7c836ffc` and
`ca38a684`, followed by procgen `a2e8c998` and its bounded terrain-cache follow-up
`f5a592a5`, are integrated with ordinary Git cherry-picks.

The UI, stable seeded appearances, finite native palettes, compact silhouettes,
action/death particles, shared sparse procgen lanes, learned terrain recipes,
stall recovery and musical presets are present together. The existing MIDI
master-volume changes remain covered by the full suite.

## Integration repairs

- Actor cosmetic ownership is constant-time. Action changes reset only the
  owning skin and retain its palette cache. Appearance commits, pooled IDs and
  lane-index changes invalidate the old cosmetic transition lazily without
  reviving it when an old appearance is selected again.
- Regression coverage uses 1,024 indexed actors with more than 256 distinct
  cached skins. Repeated offscreen action changes cannot allocate another
  palette or enumerate the shared caches.
- Procgen actions now share one bounded character-particle pool. Sparse terrain
  sampling reads actual source RGB and verifies that sampled pixels were
  removed. Explosion and unsafe-fall effects retain selected accessory/eyewear
  layers. Fixed-step advancement, restart and disposal manage pool lifetime.
- The shared renderer draws particle pixels directly with their current color
  and opacity, avoiding stale cached colors from a reused one-pixel frame.
  Viewport culling and the existing global particle budgets remain in force.
- Paired real-action runs verify that adding cosmetics does not change actor
  position, frame, action, failure result or terrain edits.

## Verified on the combined code

| Check | Result |
| --- | --- |
| `npm run format` | Pass |
| `npm run lint` | Pass |
| `npm run typecheck:critical` | Pass |
| `npm run check-undefined` | Pass, no undefined calls |
| `npm run depcheck` | Pass, Knip dependencies |
| `npm test` | 2,558 passing; runner 32.61 seconds, 180-second budget |
| `npm run procgen:check-recipes` | Pass; exact checked-in reproduction, no failures |
| `npm run bench-procgen-behavior` | Original-policy and revised-policy real-action reproductions complete |
| 96 learned recipes, isolated 5,000-tick routes | All alive and advancing, included in the suite |
| 10 art families, 32 independent actors × 5,000 ticks | All alive, no stalls, over 2,000 pixels minimum advance |
| Selected Playwright discovery | 16 tests across editor audit, desktop controls, instrument workbench and procgen |
| `git diff --check` | Pass |

The real-action blocker, shallow-step and pit comparisons preserve the original
master AI as a test fixture. The revised policy reaches each goal alive; the
original stalls on blocker/step and dies in the pit reproduction.

A fresh seed-42 OHNO brick repeated-cohort probe with 1,024 lanes and 600 fixed
ticks admitted 11,776 actors, all alive, with no stalls or failures. It took
2.622 seconds and reported 1.39 million actor steps per second, a 1.43 MB shared
recipe cache and 14.15 MB of sparse edits. This is a single-cloud-machine,
rendering-free measurement. It omits sprite appearance/transition work,
character particles, browser frame rendering and audio synthesis. It is not
long-run survival proof or evidence of 1,024-lane browser smoothness.

## Visual evidence and remaining checks

The native proof command was rerun against this integration:

```
node tools/character-sprites/render-motion-proof.mjs
python tools/character-sprites/render_motion_sheet.py
```

It uses the actual CharacterSpriteSet, actions, loaded Fun 1 terrain, particle
pool and DisplayImage blitter. Generated dig, explosion, walk/panic and wearable
fracture/fade images were visually inspected. All twelve shapes remain compact
inside the real dig channel; wearables remain whole before fracture and fade.
These are native Node captures, not browser gameplay screenshots.

Live browser execution was not run in this task. Chromium's process-singleton
socket and cloud loopback navigation were already blocked in this environment;
no alternative route was used to bypass either restriction. Playwright discovery
only checks that tests load, not that their assertions pass in a browser.

The published-site desktop layouts, repeated drawer/selector interactions,
actual browser frame times, audible local listening and physical MIDI hardware
still require permitted live QA. No hardware device was opened or used here.
No branch was published or merged remotely by this integration task.
