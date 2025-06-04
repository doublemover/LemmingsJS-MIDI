# Mechanics config

tags: mechanics, config, level-loading

Configuration entries may include an optional **mechanics** object that tweaks gameplay behavior (e.g., gravity or fall distance). `ConfigReader` attaches this object to each `GameConfig`. `GameResources` exposes it for later access, and `LevelLoader` copies the mechanics settings into newly loaded `Level` instances. The test suite verifies this flow.
