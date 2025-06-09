# Lemmix Action Enumeration

This document summarizes key constants from the `Dos.Consts.pas` unit in the Lemmix project. It covers the `TLemmingAction` enumeration, bit flags, the skill panel mapping and assignable skills.

## TLemmingAction

`TLemmingAction` defines the set of states a lemming can be in. In `Dos.Consts.pas` the enumeration is:

```
TLemmingAction = (
  None,
  Walking,
  Jumping,
  Digging,
  Climbing,
  Drowning,
  Hoisting,
  Building,
  Bashing,
  Mining,
  Falling,
  Floating,
  Splatting,
  Exiting,
  Vaporizing,
  Blocking,
  Shrugging,
  Ohnoing,
  Exploding
);
```

Each action except `None` has a corresponding bit flag constant:

```
ACTION_BIT_WALKING    = 1 shl Ord(TLemmingAction.Walking);
ACTION_BIT_JUMPING    = 1 shl Ord(TLemmingAction.Jumping);
ACTION_BIT_DIGGING    = 1 shl Ord(TLemmingAction.Digging);
ACTION_BIT_CLIMBING   = 1 shl Ord(TLemmingAction.Climbing);
ACTION_BIT_DROWNING   = 1 shl Ord(TLemmingAction.Drowning);
ACTION_BIT_HOISTING   = 1 shl Ord(TLemmingAction.Hoisting);
ACTION_BIT_BUILDING   = 1 shl Ord(TLemmingAction.Building);
ACTION_BIT_BASHING    = 1 shl Ord(TLemmingAction.Bashing);
ACTION_BIT_MINING     = 1 shl Ord(TLemmingAction.Mining);
ACTION_BIT_FALLING    = 1 shl Ord(TLemmingAction.Falling);
ACTION_BIT_FLOATING   = 1 shl Ord(TLemmingAction.Floating);
ACTION_BIT_SPLATTING  = 1 shl Ord(TLemmingAction.Splatting);
ACTION_BIT_EXITING    = 1 shl Ord(TLemmingAction.Exiting);
ACTION_BIT_VAPORIZING = 1 shl Ord(TLemmingAction.Vaporizing);
ACTION_BIT_BLOCKING   = 1 shl Ord(TLemmingAction.Blocking);
ACTION_BIT_SHRUGGING  = 1 shl Ord(TLemmingAction.Shrugging);
ACTION_BIT_OHNOING    = 1 shl Ord(TLemmingAction.Ohnoing);
ACTION_BIT_EXPLODING  = 1 shl Ord(TLemmingAction.Exploding);
```

## Skill panel mapping

The Lemmix skill panel uses an enumeration `TSkillPanelButton`. The `ActionToSkillPanelButton` array maps each `TLemmingAction` to the associated skill button:

```
ActionToSkillPanelButton: array[TLemmingAction] of TSkillPanelButton = (
  None,
  None,
  None,
  Digger,
  Climber,
  None,
  None,
  Builder,
  Basher,
  Miner,
  None,
  Umbrella,
  None,
  None,
  None,
  Blocker,
  None,
  None,
  Explode
);
```

The reverse lookup table `SkillPanelButtonToAction` converts a button back to an action.

## Assignable skills

Only a subset of actions can be assigned through the panel or hotkeys. `AssignableSkills` is defined as:

```
AssignableSkills = [
  TLemmingAction.Digging,
  TLemmingAction.Climbing,
  TLemmingAction.Building,
  TLemmingAction.Bashing,
  TLemmingAction.Mining,
  TLemmingAction.Floating,
  TLemmingAction.Blocking,
  TLemmingAction.Exploding
];
```

These correspond to the Digger, Climber, Builder, Basher, Miner, Umbrella, Blocker and Explode buttons.

