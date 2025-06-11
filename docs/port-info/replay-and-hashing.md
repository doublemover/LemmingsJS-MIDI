# Replay Storage and Level Hashing

This note summarizes how the Pascal version of **Lemmix** keeps track of replay files and verifies them against levels.

## `TReplayCache`

`Prog.Cache.pas` defines `TReplayCache`. When loading it scans `*.lrb` files under `Consts.PathToReplay`. Each replay header stores the level's 64‑bit hash (`header.Hash`) plus the level title and version. `TReplayCache.Load` indexes these items in two dictionaries:

- `fFilenameDict` maps the filename to a `TReplayCacheItem` for quick lookup.
- `fHashDict` maps the `UInt64` level hash to a list of cached replays.

This structure allows looking up replays by either filename or by the level hash.

```pascal
constructor TReplayCache.Create;
begin
  fFlatList := TReplayCacheList.Create;
  fHashDict := TObjectDictionary<UInt64, TReplayCacheList>.Create([doOwnsValues]);
  fFilenameDict := TObjectDictionary<string, TReplayCacheItem>.Create;
end;
```

When saving in game, `AddOrReplace` updates the caches so each hash entry contains the latest replay info.

## `TGameScreenReplayFinder`

The `GameScreen.ReplayFinder.pas` unit provides a grid based UI for selecting a replay. `BuildScreen` loads the replay cache and builds a sortable list of records. Each record exposes properties like folder, filename, creation date and the stored level hash.

```pascal
fSortedAscending := True;
App.ReplayCache.Load(nil);
for var i := 0 to App.ReplayCache.FlatList.Count - 1 do
begin
  newRec := TRecord.Create(i);
  fRecordList.Add(newRec);
  fRefList.Add(i);
end;
```

Users can filter replays by typing in the header row. Double‑clicking a row closes the screen and returns the selected filename.

## `TLevelHasher`

`Level.Hash.pas` implements `TLevelHasher` which computes a deterministic hash for a `TLVLRec` record. The `LongHash` method hashes the entire 2048‑byte record with MD5. `ShortHash` XORs the two halves to produce a 64‑bit value used in replay headers. `GetLevelCode` turns that 64‑bit hash into a 10‑character code using alternating vowels and consonants.

```pascal
class function TLevelHasher.LongHash(const LVL: TLVLRec): TBytes;
begin
  var H: THashMD5 := THashMD5.Create;
  H.Update(LVL, SizeOf(LVL));
  Result := H.HashAsBytes;
end;
```

```pascal
class function TLevelHasher.ShortHash(const LVL: TLVLRec): UInt64;
var
  U: Int64Rec absolute Result;
begin
  var hash := LongHash(LVL);
  for var i := 0 to 7 do
    U.Bytes[i] := hash[i] xor hash[i + 8];
end;
```

This short hash uniquely identifies a level and appears in replay headers so the engine can verify the replay matches the loaded level.
