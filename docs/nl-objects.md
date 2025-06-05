# NeoLemmix Object Types

NeoLemmix adds several interactive objects beyond the classic hatches and exits. The following list summarises each object's behaviour.

## Teleporters and Receivers
A teleporter is paired with a receiver. Lemmings entering an active teleporter vanish then reappear at the linked receiver, facing the same direction unless the graphics are flipped. Only one lemming can use a teleporter at a time and receivers are ignored otherwise.

## Locked Exits and Buttons
Some exits start locked. One or more buttons elsewhere in the level must be pressed by walking lemmings to open the exit. After all buttons are triggered the exit behaves normally.

## Pickup Skills
These icons grant an extra skill when collected. Guiding a lemming through the pickup removes the icon and adds the shown skill to the skill bar.

## Traps
- **Continuous traps** are always active and instantly kill lemmings. They cannot be disarmed.
- **Discrete traps** only activate when a lemming enters their trigger area. They can be disarmed with the disarmer skill.
- **Single-use traps** kill one lemming then become harmless. Disarmers also work on them.

## Water
Any liquid counts as water. Lemmings drown unless they are swimmers. The trigger height varies per pool so check its physics outline.

## One-Way Fields and Splitters
One-way fields are non-solid zones that allow passage in only one direction. Lemmings facing the opposite way are turned around. Terrain removal skills do not work on them and builders turn but keep building. Splitters are one-way fields that swap direction each time they are used.

## Updrafts
Updrafts slow falling or floating lemmings, effectively extending the safe fall distance. Gliders caught in an updraft rise instead of descending.

## Splat Pads
A splat pad kills any lemming landing on it unless protected by floating or gliding. It is marked by a red wire animation.

## Decoration Objects
Some objects are purely decorative. They may resemble traps or terrain but have no effect on the lemmings. Use Clear Physics Mode if unsure.
