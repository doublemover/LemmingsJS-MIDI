# Time Travel State Audit

## Snapshot coverage (HistoryStore)
- Lemming: position, facing, frame index, action/state, climb/parachute flags,
  removed/disabled, countdown + exploded flag, last trigger type.
- Lemming manager: selected index, spawn total, release tick, minimap tick,
  nuke queue index + target ids; active list rebuilt on apply.
- Level: ground mask + ground image, entrance open state.
- Triggers: static cooldowns, dynamic trigger add/remove + cooldown updates.
- Objects: animation first-frame index + finished flag.
- Skills: selected skill, cheat mode, per-skill counts.
- Victory: release rate, min rate, left/out/survivor counts, finalize flag.
- Timer: tick index + speed factor.
- Minimap: dead dots/TTLs + dead count (live dots are recomputed in forward ticks).
- Game: final game state.

## Known omissions (intentional)
- UI-only state (debug overlays, minimap live dots/selection, viewport).
- Bench/debug flags and URL parameters.
- Seeded RNG and deterministic replay outside history capture.

## Notes
- The audit did not find additional mutable simulation fields beyond the items
  listed above. Any future gameplay flags should be added to HistoryStore
  snapshots if they can affect simulation.
