# NeoLemmix New Skills

This page summarizes the additional skills featured in the NeoLemmix engine.
Each entry explains the skill's purpose, typical usage and the basic logic
that the engine follows for that skill.

## Walker
Cancels nearly any active action and returns the lemming to walking.
Often used to stop a Builder early or to turn around a Climber after
reaching the top. Internally this resets the lemming's state to
`WALKING` without undoing any terrain already placed or removed.

## Swimmer
Allows safe traversal of water. A Swimmer treats the water surface as
ground, moving horizontally until reaching land or being assigned
another skill. While swimming the lemming behaves as if walking so
nearly all walking skills are usable: Walker, Blocker, Builder,
Platformer, Stacker, Stoner, Fencer, Bomber, Cloner and even permanent
skills like Climber or Floater.  Digging skills cannot start until solid
ground is reached.

## Glider
Automatically deploys after the lemming falls about 27 pixels (9
physics frames).  Once open the glider follows a fall table that reduces
the descent to roughly one pixel per frame while horizontal speed
remains unchanged.  If the glider touches a vertical wall it slides down
it until clear.  Assigning any non‑permanent skill immediately cancels
the glide; Bomber counts down while gliding and permanent skills such as
Climber or Floater remain.  The glide ends on landing.

## Disarmer
When a Disarmer steps on a trap's trigger pixel the engine pauses the
lemming, plays a short disarming animation and marks that trap as
disabled. Disarming is permanent and the same lemming can disable any
number of traps as it continues walking.

## Stoner
On the next physics frame after assignment the lemming instantly turns
into a fixed stone block.  This new terrain behaves like regular ground
and can be built on or dug through.  The lemming is removed from play,
leaving only the stone behind.

## Platformer
Builds a straight horizontal bridge at the lemming's current height.
The Platformer places one brick per step until it reaches the maximum
length or hits terrain, then resumes walking. Good for bridging gaps
without gaining altitude.

## Stacker
Creates a vertical stack of bricks directly under the lemming. One brick
is placed each frame for a total of eight bricks.  Each brick is three
pixels wide.  The stack stops early if it hits terrain.  After laying
the last brick the lemming stands on top as a Walker.

## Fencer
Cuts through terrain on a consistent upward diagonal path similar to a
Basher that angles upward. Terrain is removed in short strokes and the
lemming moves forward one pixel per frame while climbing up to two
pixels.  The skill checks ahead for indestructible terrain or open air;
encountering either makes the fencer turn or fall, leaving an angled
tunnel behind.

## Cloner
Duplicates the targeted lemming. The clone appears one pixel behind the
original with the same direction and active skill. Both continue acting
independently after the duplication.
