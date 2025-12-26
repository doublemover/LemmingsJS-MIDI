# LemmingsJS-MIDI
![Coverage](https://img.shields.io/badge/coverage-83.6%25-yellow)

High-performance JavaScript port of Lemmings with WebMIDI sequencing ambitions.

<p align=center><b><a href="https://doublemover.github.io/LemmingsJS-MIDI/">Play it in your browser</a></b></p>

<p align=center><img src="https://github.com/user-attachments/assets/291d0c6a-ca2e-4de1-bee7-5c0cfb169ae9" width=50% height=50%></img></p>

## Highlights

- Accurate, fast Lemmings engine focused on performance first.
- Smooth zoom, minimap, and precise trigger handling.
- Bench mode for stress testing with live T/TPS/Active/Spawned stats.
- WebMIDI hooks and sequencing features planned.

## Quick Start

- Install [Node.js 20+](https://nodejs.org)
- Clone: `git clone https://github.com/doublemover/LemmingsJS-MIDI`
- Install and run:
  - `npm install`
  - `npm start`
- Open http://127.0.0.1:8080
- This repo is intended for local development and offline tooling, not npm distribution.

If you hit an issue, please open one: https://github.com/doublemover/LemmingsJS-MIDI/issues

## Performance

- Highly optimized: Capable of >100,000 lemmings/tick at original speed, or ~5,000/tick at 30x (500 Hz).
- Try it at 30x speed in bench mode:
  https://doublemover.github.io/LemmingsJS-MIDI/?version=1&difficulty=3&level=8&speed=30&cheat=false&bench=true&scale=0.8&endless=true&nukeAfter=8

## Features

- Multiple entrances work correctly
- Traps animate, are deadly, and have cooldowns
- Frying, Jumping, Hoisting animations
- Steel terrain improvements using `js/steelSprites.json`
- Arrow walls
- Minimap
  - Accumulates ground at full resolution
  - Shows entrances, exits, lemmings, and deaths
  - Click and drag to reposition view
- Zoom in and out with mouse wheel
- Skill selection while paused
- Original crosshair cursor (from `MAIN.DAT` part 5)
- Dashed debug box for nearest lemming
- Speed display on the Paws (Pause) button
  - Click `f` for faster, `-` for slower
  - Right click Paws resets speed to 1
  - Speed is a divisor of original tick speed `(60ms / gameSpeed)`
- Right click release rate buttons for instant min or max

## Controls

- `(Shift+)1`: Decrease release rate (minimum)
- `(Shift+)2`: Increase release rate (maximum)
- `3, 4, 5, 6`: Select Climber, Floater, Bomber, Blocker
- `Q, W, E, R`: Select Builder, Basher, Miner, Digger
- `Space`: Pause
- `[` / `]`: Step backward / forward one tick while paused
- `(Shift+)T`: Nuke (instant)
- `Backspace`: Restart level
- Arrow keys: Pan viewport (Shift for faster)
- `Z` / `X`: Zoom in / out (Shift for faster)
- `V`: Reset zoom to 2
- `(Shift+)-` / `=`: Decrease / increase game speed (Shift for faster)
- `,` / `.`: Previous / next level
- `Shift+,` / `Shift+.`: Previous / next group
- `Tab`: Cycle through skills
- `\`: Toggle debug mode

## Options

URL parameters (shortcuts in brackets):

- `version (v)`:
  - 1: [Lemmings](https://doublemover.github.io/LemmingsJS-MIDI?version=0) (default)
  - 2: [Oh no! More Lemmings](https://doublemover.github.io/LemmingsJS-MIDI?version=1)
  - 3: [Xmas 1991](https://doublemover.github.io/LemmingsJS-MIDI?version=2)
- `difficulty (d)`: 1-5 (default: 1)
- `level (l)`: 1-30 (default: 1)
- `speed (s)`: 0-100 (default: 1)
- `cheat (c)`: true/false (default: false)
- `debug (dbg)`: true/false (default: false)
- `bench (b)`: Bench mode (endless spawning with speed modulation)
- `benchSequence (bs)`: Auto-run bench series (50/25/10/1 entrances + extras)
- `endless (e)`: Disable time limit
- `nukeAfter (na)`: Auto-nuke after x*10 seconds
- `scale (sc)`: Starting zoom .0125-5 (default: 2)
- `extra (ex)`: Extra lemmings per spawn 1-1000 (default: 0)

<details>
  <summary><b>Debug and Bench Notes</b></summary>

  - Right click Nuke toggles debug mode
    - Blue pixel under lemmings (engine position)
    - Red rectangles for triggers (traps, blockers, exit)
    - Cyan rectangles show steel
    - Orange and green show left/right arrow triggers
    - Speed can drop below 1 in 0.1 steps and rise to 120 in steps of 10
  - Bench mode spawns lemmings endlessly at max rate and shows T/TPS/Active/Spawned
  - Bench sequence measures extra lemming capacity, then runs multiple entrance counts
</details>

## Development and Testing

- `npm test` runs the full Mocha suite.
- Individual groups are in [docs/TESTING.md](docs/TESTING.md).
- `npm run lint` checks ESLint rules.
- `npm run format` fixes formatting.

## Docs

- Offline tools: [docs/offline-tools.md](docs/offline-tools.md)
- Exporting sprites: [docs/exporting-sprites.md](docs/exporting-sprites.md)
- Testing: [docs/TESTING.md](docs/TESTING.md)
- CI: [docs/ci.md](docs/ci.md)
- Config: [docs/config.md](docs/config.md)
- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)

## Progressive Web App

This repo ships with [site.webmanifest](site.webmanifest) so it can be installed
as a PWA. It launches fullscreen in landscape mode. Touch input still needs
polish, so please file bugs for any issues you hit.

<details open>
  <summary><b>In Progress</b></summary>

  - 100% test coverage
  - Pack decompression/patch/compression pipeline
  - High resolution and 32-bit color sprite support
  - Full touch interaction support
  - Full support for pack-specific glitches
  - Support for other popular pack types
  - Procedural endless level generation
  - Tick step
  - Improved documentation
  - Xmas 91/92 and Holiday 93/94 polish (steel sprite data, triggers, palette)
</details>

<details>
  <summary><b>Roadmap</b></summary>

  - Arrow walls
    - Confirm builder bounce behavior
    - Fix 2-2-19 left arrows not rendering
    - Consider built-stairs handling
  - Traps
    - Squish missing
    - "Generic trap" just vanishes lemmings
  - Bombs
    - Remove ground overlapping steel to reveal it
  - Super lemmings act twice per tick
  - MIDI
    - Channel selection
    - I/O display
    - Debug display
  - Performance
    - Investigate using GameTimer catchup slowdown as a failsafe for perf spikes
</details>

<details>
  <summary><b>Bugs and Misc</b></summary>

  - No palette-swapped frying animation (2-2-9, 1-4-30)
  - Previous pack flashing, crash if navigating 1 -> 2 then past 2-4-20
  - Cannot go back to version 1 from version 2
  - Building stairs off the horizontal edge causes wraparound steps
  - Need a level editor or a custom DAT flow for music-driven levels
  - Ability to place flags to trigger MIDI events
</details>

## Credits

- Lemmings fans and archivists
- [Lemmings Forums](https://www.lemmingsforums.net/)
- [Camanis.net Lemmings Archives](https://www.camanis.net/lemmings/)
- [tomsoftware](https://github.com/tomsoftware)
- [oklemenz/LemmingsJS](https://github.com/oklemenz/LemmingsJS)
- The Throng (Blackmirror S7E4)
- [Mumdance](https://www.mumdance.com/)
