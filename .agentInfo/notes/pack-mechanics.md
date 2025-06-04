# Pack mechanics defaults

tags: config, mechanics

`packMechanics.js` enumerates glitch flag defaults for each level pack. When `ConfigReader` builds a `GameConfig`, it merges these values with any `mechanics` object present in `config.json`. The merged result is stored on `GameConfig.mechanics` so the game code can check feature flags regardless of the active pack.

Each entry uses the pack's folder name (`lemmings`, `xmas92`, etc.) as the key. Flags are simple booleans and can be expanded in the future if new glitch options appear.
