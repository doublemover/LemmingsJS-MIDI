# Sound effect references

## Lemmix
- `TSoundEffect` enumerates all base and custom SFX IDs such as `BuilderWarning`, `AssignSkill`, `Yippee`, `Splat` and various trap sounds.
- `SoundData.Init` loads each sound by filename and stores an index so other units can queue effects.
- `CueSoundEffect` triggers sounds during gameplay. Examples include:
  - `SFX_SPLAT` when a lemming splats.
  - `SFX_YIPPEE` when a lemming exits.
  - `SFX_ASSIGN_SKILL` whenever a skill is assigned.
  - Builder warnings play when the brick count drops below three.
  - Digging and mining play `SFX_DIGGER` or `SFX_MINER` as terrain is removed.
  - `SFX_HITS_STEEL` fires when bashing or mining hits steel.

### Frame details
Frame timings are hard coded in the action handlers:
  - `HandleBuilding` checks frame `10` to play `SFX_BUILDER_WARNING` when `NumberOfBricksLeft <= 3`.
  - `HandleBashing` plays `SFX_BASHER` on frame `5` of the swing animation.
  - `HandleMining` plays `SFX_MINER` on frame `2` as the second mask is applied.
  - `HandleFloating` triggers `SFX_OPENUMBRELLA` when the floater animation begins.
  - Exit, drowning and trap transitions cue sounds immediately.

## NeoLemmix
- `LemStrings.pas` defines many sound IDs including `SFX_ASSIGN_FAIL`, `SFX_BUILDER_WARNING`, `SFX_YIPPEE`, `SFX_SPLAT`, `SFX_TIMEUP`, `SFX_PORTAL` and others.
- `LemGame.pas` uses `CueSoundEffect` to play these sounds:
  - Failed assignments or hitting steel queue `SFX_ASSIGN_FAIL` or `SFX_HITS_STEEL`.
  - State changes such as splatting, exiting, or exploding play `SFX_SPLAT`, `SFX_YIPPEE`, `SFX_OHNO`, or `SFX_EXPLOSION`.
  - Builder warnings occur on physics frame 10 and when bricks run low.
  - Gadgets and pickups trigger effects like `SFX_EXIT_OPEN` and `SFX_PICKUP`.
  - When the timer reaches zero the game plays `SFX_TIMEUP`.
The countdown beeps at frames 79, 59, 39 and 19 before time up.

Both engines rely on enumerated IDs and call `CueSoundEffect` (or `SoundManager.PlaySound`) at animation milestones and when objects activate.
