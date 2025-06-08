# Test categories

tags: tests, categories

Tests are organized into categories so you can run only the relevant suites during development. This speeds up iteration when touching specific subsystems.

- **core** – fundamental game logic such as `GameTimer` and `LemmingManager`. Example: `test/core/game-timer.js`.
- **rendering** – verifies canvas drawing helpers and animation. Example: `test/rendering/game-display.js`.
- **level** – covers level file parsing and serialization. Example: `test/level/level-reader.js`.
- **io** – reads/writes archives or pack resources. Example: `test/io/node-file-provider.js`.
- **tools** – Node command-line utilities like exporters or packers. Example: `test/tools/export-all-sprites.js`.
- **bench** – stress and benchmark scenarios to measure performance. Example: `test/bench/bench-speed-adjust.js`.
- **workflow** – developer workflow helpers including lint rules or git hooks. Example: `test/workflow/search-history.js`.
- **utils** – small helper classes and math utilities. Example: `test/utils/rectangle.js`.
