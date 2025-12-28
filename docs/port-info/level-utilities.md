# Level utility overview

This note summarizes three Pascal modules from the original Lemmix project and their JavaScript counterparts.

## `Level.Hash.pas`

`TLevelHasher` produces unique identifiers for a 2048 byte `.LVL` record:

- `LongHash` computes an MD5 digest of the raw record.
- `ShortHash` XORs the two halves of the MD5 to create an eight byte value.
- `GetLevelCode` converts that value into a 10‑character code alternating vowels and consonants.

These hashing helpers are now implemented in `js/level/LevelHasher.js`:
`LevelHasher.longHash()` returns MD5 bytes, `shortHash()` returns the 64-bit hash
as a BigInt, and `getLevelCode()` builds the 10-character code.

## `Level.Loader.pas`

`TLevelLoader` converts between the on‑disk structure (`TLVLRec`) and the runtime `TLevel` class.
`LoadLVLFromFile` reads a binary file into a record and `TranslateLevel` fills a `TLevel` instance.
The process swaps endianness on every word and unpacks coordinates and drawing flags.
A second overload performs the reverse when saving.
`TLemminiLoader.LoadLVLFromFile` also parses a simple text‑based format.

The JavaScript port implements these features in `js/level/LevelReader.js`, `js/level/LevelWriter.js` and
`js/level/LevelLoader.js`. The reader/writer handle the binary format while `LevelLoader` resolves the
correct graphics sets, decodes terrain and objects and attaches the data to a `Level` object.
The editor UI now exports/imports `.lvl` files using the writer/reader pipeline.

## Saving and replay data

The original `Game.pas` contains methods like `TRecorder.SaveToFile` and `SaveToStream` for replay files
and level states. The JS port records replays via `CommandManager.serialize()` and stores the result on
`GameResult.replay` (see `docs/replays.md`). File-based replay formats and replay caches are still
unported.

## Remaining work

- Port file-based replay serialization (save/load + metadata) and replay cache support.
