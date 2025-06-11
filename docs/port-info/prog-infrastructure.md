# Prog infrastructure overview

This note summarizes the foundational Pascal modules used by **Lemmix** (`Prog.App`, `Prog.Base`, `Prog.Cache`, `Prog.Config`, `Prog.Data`, `Prog.Tools` and `Prog.Voice`). They provide the runtime scaffolding around the game engine. The current JavaScript port mirrors many of these responsibilities.

## Application startup (`Prog.App`)

`TApp` is the global manager that owns configuration, caches and game objects. Its key fields include the loaded style, replay cache and the managers for sound and voice. The constructor loads the configuration, sets constants and instantiates managers in a fixed order. Shutdown saves any modified settings and disposes resources in reverse order.【F:docs/port-info/TApp-overview.md†L10-L63】

## Configuration handling (`Prog.Config`)

`TConfig` stores persistent options such as paths, option sets and the monitor index. `Load` initializes defaults then parses the configuration file, while `Save` writes the values back. A small helper `LanguageIsDefault` checks if the language string is empty or equal to `"Default"`.【F:docs/port-info/lemix-config.md†L1-L90】

## Cache management (`Prog.Cache`)

Caches keep heavy data like replays and styles in memory so screens can switch quickly. `ReplayCache` is created during startup and cleared on shutdown. `StyleCache` holds previously used styles. Graphics sets are cached for the current level.【F:docs/port-info/TApp-overview.md†L14-L24】【F:docs/port-info/TApp-overview.md†L44-L60】

## Helper utilities (`Prog.Base`, `Prog.Data`, `Prog.Tools` and `Prog.Voice`)

`Prog.Base` defines enums and constants shared across the engine. `Prog.Data` loads resources such as graphics or data files. `Prog.Tools` collects assorted helper procedures used throughout the codebase. `Prog.Voice` implements the voice manager that announces events; see [Lemmix Voice Manager Overview](../../port-info/lemmix-voice.md) for details.

These modules hide platform specifics so the game logic can stay portable. The JavaScript port implements similar helpers to keep code organized.
