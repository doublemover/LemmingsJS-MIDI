<<<<<<< tmp_merge/ours_.agentInfo_notes_mechanics-flags.md
=======
# Mechanics flags

tags: game, config, mechanics

`ConfigReader` parses `config.json` into `GameConfig` objects but currently does not expose any mechanics options. `GameResources` simply stores the chosen `GameConfig`. `Game` passes that config through when instantiating a `Level` via `LevelLoader`. The `Level` class only tracks `isSuperLemming`, so no other mechanics flags exist yet.

Planned flags might include physics variations or other rule tweaks. Once implemented they should start in the config, flow through `GameResources` into `Game`, and finally land on the `Level` instance for use by gameplay systems.

Existing flag:
- `isSuperLemming` (stored per level)

>>>>>>> tmp_merge/theirs_.agentInfo_notes_mechanics-flags.md
