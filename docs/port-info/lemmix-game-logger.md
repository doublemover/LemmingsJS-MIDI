# Lemmix `TGameLogger`

`Game.Logger.pas` from [Lemmix](https://github.com/ericlangedijk/Lemmix) implements a simple debug logger used while running the Pascal version of the engine. The file is only compiled when `debug` is defined:

```
{$ifndef debug}
Only in debugmode
{$endif}
```

The nonsensical line `Only in debugmode` causes a compilation error if the unit is included in a non-debug build. This ensures the logger never ships with release binaries.

## Log file

All logging goes to `game.log` in the current working directory. `Add` opens the file on first use and writes each line immediately:

```pascal
class procedure TGameLogger.Add(const s: string);
begin
  if _Txt = nil then
  begin
    New(_Txt);
    AssignFile(_Txt^, 'game.log');
    Rewrite(_Txt^);
  end;
  WriteLn(_Txt^, s);
  Flush(_Txt^);
end;
```

Because this class variable persists for the entire session, every call appends a line that is flushed to disk right away.

## Mapping arrays

`TGameLogger` contains two string lookup tables. `LemmingActionNames` converts values of `TLemmingAction` into human friendly names and `CommandNames` does the same for `TSkillPanelButton`:

```pascal
LemmingActionNames: array[TLemmingAction] of string = (
  'NONE', 'WALKING', 'JUMPING', 'DIGGING', 'CLIMBING', 'DROWNING',
  'HOISTING', 'BUILDING', 'BASHING', 'MINING', 'FALLING', 'FLOATING',
  'SPLATTING', 'EXITING', 'VAPORIZING', 'BLOCKING', 'SHRUGGING',
  'OHNOING', 'EXPLODING'
);

CommandNames: array[TSkillPanelButton] of string = (
  'NONE', 'RR_SLOWDOWN', 'RR_SPEEDUP', 'SELECT_CLIMBER',
  'SELECT_UMBRELLA', 'SELECT_EXPLODE', 'SELECT_BLOCKER',
  'SELECT_BUILDER', 'SELECT_BASHER', 'SELECT_MINER',
  'SELECT_DIGGER', 'PAUSE', 'NUKE'
);
```

These arrays allow the logger to display actions and commands as readable text instead of numeric values.

## Key methods

### `LogTransition`
Writes the old and new action when a lemming changes state. The boolean `turn` records whether a turn occurred at the same time.

```pascal
class procedure TGameLogger.LogTransition(
  e: TLemmingGame; Lemming: TLemming;
  oldAction, newAction: TLemmingAction; turn: Boolean);
begin
  var s :=
    IterationStr(e) + ' TRANSITION: lemming ' +
    LemmingIndexStr(Lemming) + ' from ' +
    LemmingActionNames[oldAction] + ' to ' +
    LemmingActionNames[newAction] + ' turn = ' + BoolStr(turn);
  Add(s);
end;
```

### `LogAssignment`
Records when a skill is assigned. It logs both the acting lemming and the lemming receiving the command (if different) plus the cursor position. `R:` prefixes replayed assignments while `A:` indicates a live action.

```pascal
class procedure TGameLogger.LogAssignment(
  e: TLemmingGame; Lemming1, Lemming2: TLemming;
  skill: TLemmingAction; const cursorpos: TPoint);
begin
  var s := IterationStr(e) + ' ASSIGN ' +
    LemmingActionNames[skill] + ' Lemming1 ' +
    LemmingIndexStr(Lemming1) + ' Lemming2 ' +
    LemmingIndexStr(Lemming2) + ' cursor ' +
    cursorpos.x.ToString + ':' + cursorpos.y.ToString;
  if e.Replaying then s := 'R:' + s else s := 'A:' + s;
  Add(s);
end;
```

### `LogTrapTriggering`
Used when an interactive object such as a trap activates. It writes the current animation frame and total frame count to help debug animation logic.

```pascal
class procedure TGameLogger.LogTrapTriggering(
  e: TLemmingGame; trap: TInteractiveObjectInfo);
begin
  var s := IterationStr(e) + ' TRAPTRIGGERING ' +
    'frame =' + trap.CurrentFrame.ToString +
    ' framecount=' + trap.MetaObj.AnimationFrameCount.ToString;
  Add(s);
end;
```

These methods share a common pattern: they format a message using helper functions, then append it to `game.log` using `Add`.

## Usage

`TGameLogger` is a class with only class methods and variables. Any part of the game can call `TGameLogger.Log…` methods to append diagnostic information. Because compilation fails when `debug` is not defined, it is safe to leave these calls in the source without affecting release builds.
