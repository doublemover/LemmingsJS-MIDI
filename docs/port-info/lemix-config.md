# Lemmix Configuration Summary

This document summarizes how configuration is managed in the **Lemmix** project. It references the `TConfig` record defined in `src/Prog.Config.pas` and outlines how configuration files are loaded and saved.

## Structure of `TConfig`

The record groups all persistent options for the game. Key fields include sets of options and paths to assets:

```pascal
TConfig = record
  FormOptions       : TFormOptions;
  GameOptions       : TGameOptions;
  OptionalMechanics : TOptionalMechanics;
  SoundOptions      : TSoundOptions;
  VoiceOptions      : TVoiceOptions;
  MiscOptions       : TMiscOptions;
  StyleName         : string;
  PathToStyles      : string;
  PathToMusic       : string;
  PathToSounds      : string;
  PathToReplay      : string;
  Language          : string;
  ZoomFactor        : Integer;
  Monitor           : Integer;
  procedure Load;
  procedure Save;
  function LanguageIsDefault: Boolean;
end;
```

### Default values loaded in `Load`

`Load` assigns defaults before reading the configuration file:

```pascal
FormOptions       := TFormOptions.DEFAULT;
GameOptions       := TGameOptions.DEFAULT;
SoundOptions      := TSoundOptions.DEFAULT;
OptionalMechanics := TOptionalMechanics.DEFAULT;
VoiceOptions      := TVoiceOptions.DEFAULT;
MiscOptions       := TMiscOptions.DEFAULT;

ZoomFactor := 0;
StyleName  := 'Orig';
Monitor    := 0;
```

## Parsing configuration file fields

The configuration file is a simple list of key\-value pairs. For each option set a loop checks values with keys like `Forms.Blah` or `Game.SomeOption`:

```pascal
for var form: TFormOption in TFormOptions.ALL do begin
  value := list.Values['Forms.' + form.AsString].Trim;
  if value.Length = 1 then
    FormOptions.&Set(form, value.StartsWith('1'));
end;
```

The same pattern repeats for `GameOptions`, `OptionalMechanics`, `SoundOptions`, `VoiceOptions`, and `MiscOptions`. The parser then reads numeric and string values for zoom factor, monitor index, selected style, paths and language.

## Saving configuration

The `Save` method writes entries in the same format, outputting `"1"` or `"0"` for booleans and including optional paths only when they are not empty.

```pascal
for var form: TFormOption in TFormOptions.ALL do
  list.Values['Forms.' + form.AsString] := BoolEntry(form in FormOptions);
// Repeated for the other option sets
list.Values['Display.Monitor'] := Monitor.ToString;
list.Values['Display.ZoomFactor'] := ZoomFactor.ToString;
list.Values['Style'] := StyleName;
if not PathToStyles.IsEmpty then
  list.Values['PathToStyles'] := PathToStyles;
// ...
list.SaveToFile(filename);
```

## Helper `LanguageIsDefault`

This helper returns `true` when no language or the literal string `"Default"` is selected:

```pascal
function TConfig.LanguageIsDefault: Boolean;
begin
  Result := Language.IsEmpty or SameText(Language, 'Default');
end;
```

In summary, `TConfig` encapsulates all configuration state. `Load` initializes defaults and then overrides them by parsing the configuration file. `Save` writes out the same structure. `LanguageIsDefault` checks whether the language entry indicates the default language.
