# NeoLemmix Object Types

NeoLemmix adds several interactive objects beyond the classic hatches and exits. The following list summarises each object's behaviour.

## Teleporters and Receivers
Teleporters search for a receiver with the same ID using `FindReceiverID`. When
`HandleTeleport` detects a lemming inside the trigger area it moves that
lemming to the receiver. Only one lemming may occupy a teleporter at once and
the object's frame toggles while in use. The lemming emerges facing the same
direction unless the receiver graphics are flipped.

## Locked Exits and Buttons
Buttons call `HandleButton` whenever a lemming walks over them. The button
switches frames between pressed and unpressed. Once every linked button is
active `HandleExit` unlocks the exit and its sprite changes to the open state.
Until unlocked the exit does not remove lemmings.

## Pickup Skills
`HandlePickup` awards the shown skill when a lemming touches the icon. The
object flips to a blank frame so only the first lemming collects it and the
skill is added to the skill panel.

## Traps
`HandleTrap` covers all trap types:
- **Continuous traps** are always active and cannot be disarmed.
- **Discrete traps** trigger only while their animation is ready; disarmers can
  disable them before they fire.
- **Single-use traps** kill once then switch to a spent frame and become
  harmless.

## Water
Any liquid counts as water. Lemmings drown unless they are swimmers. The trigger height varies per pool so check its physics outline.

## One-Way Fields and Splitters
One-way fields are non-solid zones that allow passage in only one direction. Lemmings facing the opposite way are turned around. Terrain removal skills do not work on them and builders turn but keep building. Splitters are one-way fields that swap direction each time they are used.

## Updrafts
`HandleFalling` slows falling or floating lemmings when they enter an updraft.
This effectively increases the safe fall distance. Gliders caught in an updraft
rise instead of descending.

## Splat Pads
Splat pads are also checked in `HandleFalling`. Any lemming landing on one is
killed unless protected by floating or gliding. They are marked by a red wire
animation.

## Force Fields
Force fields push lemmings while they remain inside the trigger area. The
direction of the push comes from the object's orientation and the movement is
handled alongside falling logic in `HandleFalling`.

## Decoration Objects
Some objects are purely decorative. They may resemble traps or terrain but have no effect on the lemmings. Use Clear Physics Mode if unsure.
