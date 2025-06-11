# Level utility overview

This note summarizes three Pascal modules from the original Lemmix project and their JavaScript counterparts.

## `Level.Hash.pas`

`TLevelHasher` produces unique identifiers for a 2048 byte `.LVL` record:

- `LongHash` computes an MD5 digest of the raw record.
- `ShortHash` XORs the two halves of the MD5 to create an eight byte value.
- `GetLevelCode` converts that value into a 10‑character code alternating vowels and consonants.

These hashing helpers are not yet ported to JavaScript.

## `Level.Loader.pas`

`TLevelLoader` converts between the on‑disk structure (`TLVLRec`) and the runtime `TLevel` class.
`LoadLVLFromFile` reads a binary file into a record and `TranslateLevel` fills a `TLevel` instance.
The process swaps endianness on every word and unpacks coordinates and drawing flags.
A second overload performs the reverse when saving.
`TLemminiLoader.LoadLVLFromFile` also parses a simple text‑based format.

The JavaScript port implements these features in `js/LevelReader.js`, `js/LevelWriter.js` and
`js/LevelLoader.js`. The reader/writer handle the binary format while `LevelLoader` resolves the
correct graphics sets, decodes terrain and objects and attaches the data to a `Level` object.

## Saving and replay data

The original `Game.pas` contains methods like `TRecorder.SaveToFile` and `SaveToStream` for replay files
and level states. Only a basic binary writer has been ported so far. Replay serialization and the
hash‑based level codes still rely on the Pascal sources.

## Remaining work

- Port `TLevelHasher` to generate MD5 hashes and level codes in JS.
- Integrate `LevelWriter` with actual save/load UI.
- Port recorder and replay serialization routines.
