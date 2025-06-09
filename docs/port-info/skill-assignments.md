# Lemmix Skill Assignment Logic

This note summarizes how the original **Lemmix** engine assigns skills to a lemming. The routines appear in `src/Game.pas` around lines 2039–2216.

Each routine verifies that the chosen skill is available, checks the lemming's current action, then decreases the skill counter and records the assignment for replay. A boolean `fAssignmentIsRightClickGlitch` indicates whether a "Right-Click Glitch" triggered the assignment and is stored with the replay entry.

## AssignClimber
- Requires at least one climber remaining.
- The lemming cannot already be a climber and must not be blocking, splatting or exploding.
- When the `AssignClimberShruggerActionBug` mechanic is enabled, a shrugging lemming is forced back to walking before becoming a climber.
- On success, the climber counter is decreased, the toolbar count is redrawn and the assignment is logged.

## AssignFloater
- Similar checks to climber: ensures a floater is available and the lemming is neither blocking, splatting nor exploding.
- Adds the floater flag, updates the toolbar and logs the replay entry.

## AssignBomber
- Requires available bombers and that the lemming's explosion timer is zero.
- The lemming must not be oh-noing, exploding, vaporizing or splatting.
- Sets an explosion timer of 79 ticks, decreases the bomber count and records the assignment.

## AssignBlocker
- Needs blockers available.
- Allowed when the lemming is walking, shrugging, building, bashing, mining or digging and there is no blocker field overlap.
- Decreases the blocker counter, transitions the lemming to blocking and logs the action.

## AssignBuilder
- Verifies builders remain and that the lemming is not near the level's top (`YPos + FrameTopdy >= HEAD_MIN_Y`).
- Applies when walking, shrugging, bashing, mining or digging. If the main selection fails, the code may assign the skill to a secondary lemming instead.
- Decrements the builder count, starts building and logs the action (noting whether the second lemming was used).

## AssignBasher
- Requires bashers remaining.
- Accepts a lemming currently walking, shrugging, building, mining or digging. May select a second lemming if the first does not qualify.
- Aborts if facing steel or an opposing one-way wall.
- On success, the basher counter decreases, the lemming begins bashing and the assignment is recorded.

## AssignMiner
- Similar to basher but also rejects if steel lies below or when facing one-way walls in the wrong direction.
- When valid, reduces the miner count, transitions the lemming to mining and logs the event.

## AssignDigger
- Requires diggers available and checks the tile below for steel.
- Accepts either lemming if walking, shrugging, building, bashing or mining.
- Decreases the digger count, starts digging and records the assignment.
