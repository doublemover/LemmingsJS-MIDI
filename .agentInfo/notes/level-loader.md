# Level.Loader.pas overview

`src/Level.Loader.pas` from [Lemmix](https://github.com/ericlangedijk/Lemmix) translates classic `.LVL` files to `TLevel` objects and back. Two overloads of `TLevelLoader.TranslateLevel` handle these conversions.

## LVL \u2192 TLevel

```pascal
class procedure TLevelLoader.TranslateLevel(const LVL: TLVLRec; aLevel: TLevel);
```
Reads the 2048-byte record into `aLevel`. Every word-sized field goes through
`SwapWord` to correct endianness:

```pascal
aLevel.Info.ReleaseRate := SwapWord(LVL.ReleaseRate);
```

Object coordinates are stored big endian and are offset by 16 pixels horizontally
and 0 pixels vertically:

```pascal
Obj.Left := Integer(O.B0) shl 8 + Integer(O.B1) - 16;
Obj.Top  := Integer(O.B2) shl 8 + Integer(O.B3);
```

Terrain entries have a packed Y value. The loader combines the high bit from
`B3`, then subtracts 4 to align with the engine origin:

```pascal
H := Integer(T.B2) shl 1 + Integer(T.B3 and $80) shr 7;
if H >= 256 then Dec(H, 512);
Dec(H, 4);
Ter.Top := H;
```

Steel blocks use 4-pixel units and a similar high-bit scheme:

```pascal
Steel.Left := ((Integer(S.B0) shl 1) + (Integer(S.B1 and Bit7) shr 7)) * 4 - 16;
Steel.Width := Integer(S.B2 shr 4) * 4 + 4;
```

`Modifier` and `DisplayMode` bits are converted into `DrawingFlags` such as
`odf_NoOverwrite`, `odf_OnlyOnTerrain` and `odf_UpsideDown`.

## TLevel \u2192 LVL

```pascal
class procedure TLevelLoader.TranslateLevel(aLevel: TLevel; var LVL: TLVLRec);
```
Zeroes the record, copies fields from `aLevel`, then applies `SwapWord` before
writing them out. Coordinates add the offset in reverse and re-encode the extra
bits:

```pascal
Int16 := Obj.Left + 16;
LVL.Objects[i].XPos := System.Swap(Word(Int16));
```

Terrain and steel follow the same adjustments, packing drawing flags back into
the modifier bytes.

## File helpers

`LoadLVLFromFile` and `LoadLVLFromStream` read a raw record from disk or a
`TStream` and then call `TranslateLevel`. `SaveLVLToFile` and
`SaveLVLToStream` perform the opposite, writing the swapped record back to
storage.

## Lemmini text format

`TLemminiLoader.LoadLVLFromFile` supports the Lemmini text-based format. It
loads the file with a `TStringList`, splits each line on `=` and parses keys with
helpers like `TryInfo`, `TryObject`, `TryTerrain` and `TrySteel`. After
validation the routine converts the temporary `TLevel` instance into a `TLVLRec`
via `TranslateLevel`.
