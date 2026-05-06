# LemmingsJS-MIDI
![Coverage](https://img.shields.io/badge/coverage-99.51%25-brightgreen)

High-performance JavaScript port of Lemmings with WebMIDI sequencing support.

<p align=center><b><a href="https://doublemover.github.io/LemmingsJS-MIDI/">Play it in your browser</a></b></p>

<p align=center><img src="https://github.com/user-attachments/assets/291d0c6a-ca2e-4de1-bee7-5c0cfb169ae9" width=50% height=50%></img></p>

## Highlights

- Accurate, fast Lemmings engine. 
  - Supports over 25,000,000 simultaneous Lemmings!
  - Capable of running at >60x original game speed, with 450,000 Lems
  - Runs backwards at full speed
  - Tick-by-tick stepping
- WebMIDI routing, input mapping, and sequencing controls.
- Fully featured [level editor](https://doublemover.github.io/LemmingsJS-MIDI/editor.html)
- MCP servers, so your LLM can play and edit Lemmings levels!
  - Efficient JSON based communication of game state & user interaction
  - If you consider that "cheating", vision capture via Playwright is supported
  - Interactive Spectator mode lets you watch, help, or mess with them

## Quick Start

You can [Play](https://doublemover.github.io/LemmingsJS-MIDI/) and [Edit](https://doublemover.github.io/LemmingsJS-MIDI/editor.html) in your browser right now!

For a private, local copy: 
- Install [Node.js 20+](https://nodejs.org)
- Clone: `git clone https://github.com/doublemover/LemmingsJS-MIDI`
- Install and run:
  - `npm install`
  - `npm start`
- Open https://localhost:8080
- Open https://localhost:8080/editor.html for the standalone level editor.
- This repo is intended for local development and offline tooling, not npm distribution.

If you hit an issue, _please_ open one: https://github.com/doublemover/LemmingsJS-MIDI/issues

## MCP Quick Start

LemmingsJS-MIDI includes an MCP server for automation, state inspection, input
control, and vision capture using Playwright sessions.

- Run `npm run start-https` in a separate tab.
- Add the following config to Codex CLI `config.toml` (version 0.77):

```toml
[mcp_servers.lemmings]
  command = "node"
  args = ["C:\\Users\\sneak\\Development\\Lemmings-MIDI-CODEX\\mcp\\server.js"]

[mcp_servers.lemmings.env]
  LEMMINGS_MCP_BASE_URL = "https://localhost:8080"
  LEMMINGS_MCP_PATH = "/?e2e=1"
```

## Features

- Faithful & enhanced port of Lemmings
- Steel terrain accuracy improvements using `js/steelSprites.json`
- Minimap
  - Accumulates ground at full resolution
  - Shows entrances, exits, lemmings, and deaths
  - Click and drag to reposition view
- Speed display on the Paws (Pause) button
  - Click left/right side of bottom bar on Paws to slow down or speed up
  - Use `-` / `=` (Shift for faster steps) to adjust speed
  - Right click Paws resets speed to 1
  - Speed is a divisor of original tick speed `(60ms / gameSpeed)`
- Right click release rate buttons for instant min or max
- Configurable key bindings

## Controls

- `F1` or `Shift+/` Show the keyboard shortcuts overlay in-game
- `1` / `Shift+1`: Decrease release rate by 1 / to minimum
- `2` / `Shift+2`: Increase release rate by 1 / to maximum
- `3, 4, 5, 6`: Select Climber, Floater, Bomber, Blocker
- `Q, W, E, R`: Select Builder, Basher, Miner, Digger
- `K`: Apply selected skill to selected lemming
- `Space`: Pause/resume
- `[` / `]`: Step backward / forward one tick while paused
- `Alt+]`: Step backward (mirror of step forward)
- `B`: Toggle continuous reverse playback
- `T` / `Shift+T`: Nuke / instant nuke
- `Backspace`: Restart level
- Arrow keys: Pan viewport (Shift for faster)
- `Z` / `X`: Zoom in / out (Shift for faster)
- `V`: Reset zoom to 2
- `-` / `=`: Decrease / increase game speed (Shift for faster, numpad +/- also supported)
- `Alt+=`: Decrease speed (Shift for faster)
- `,` / `.`: Previous / next level
- `Shift+,` / `Shift+.`: Previous / next group
- `Tab` / `Shift+Tab`: Cycle through skills forward / backward
- `\`: Toggle debug mode
- `Shift+Backquote`: Toggle editor mode (preview only)

<details>
  <summary><b>URL parameters (shortcuts in brackets)</b></summary>


- `version (v)`:
  - 1: [Lemmings](https://doublemover.github.io/LemmingsJS-MIDI?version=1) (default)
  - 2: [Oh no! More Lemmings](https://doublemover.github.io/LemmingsJS-MIDI?version=2)
  - 3: [Xmas 1991](https://doublemover.github.io/LemmingsJS-MIDI?version=3)
  - 4: [Xmas 1992](https://doublemover.github.io/LemmingsJS-MIDI?version=4)
  - 5: [Holiday 1993](https://doublemover.github.io/LemmingsJS-MIDI?version=5)
  - 6: [Holiday 1994](https://doublemover.github.io/LemmingsJS-MIDI?version=6)
- `difficulty (d)`: 1-6 (default: 1)
- `level (l)`: 1-100 (default: 1)
- `speed (s)`: 0-100 (default: 1)
- `cheat (c)`: true/false (default: false)
- `debug (dbg)`: true/false (default: false)
- `bench (b)`: Benchmark mode
- `endless (e)`: Disable time limit, win/loss conditions
- `scale (sc)`: Starting zoom .0125-8 (default: 2)
- `extra (ex)`: Extra lemmings per spawn 1-1000 (default: 0)
- `performanceAPI (pa)`: Enable Performance API instrumentation
- `shortcut`/`_`: Prefer short query keys when updating the URL
</details>


<details>
  <summary><b>Debug & Benchmarking Notes</b></summary>

  - Right click Nuke toggles debug mode
    - Blue pixel under lemmings (engine position)
    - Red rectangles for triggers (traps, blockers, exit)
    - Cyan rectangles show steel
    - Orange and green show left/right arrow triggers
    - Speed can drop below 1 in 0.1 steps and rise to 120 in steps of 10
  - Bench mode spawns lemmings endlessly at max rate and shows T/TPS/Active/Spawned
  - Bench sequence measures extra lemming capacity, then runs multiple entrance counts
</details>

### Editor

- Standalone editor page at `editor.html`.
- Import/export `.nxlv` and classic `.lvl` files from the editor header.
- `P`: Toggle playtest.
- Shift-click or marquee to multi-select, drag to move. Alt-drag to clone.
- Palette previews are generated from sprites and cached in browser storage.
- Steel areas are editable with the Steel tool.
- Full Undo/Redo support.
- Level validation catches missing requirements. 

## Keybindings

Keybindings are configurable in `keybindings.json`. The in-game defaults map to the controls above.

## MIDI

- The in-game MIDI sequencer workspace is layered over `/` with transport
  setup, source browser, track routing, inspector, clip editing, and output
  status regions.
- Enable MIDI from the transport strip, then choose WebMIDI input/output
  devices and an input channel. Panic sends all-notes-off and clears queued
  notes.
- Editable state is stored only as `lemmings.midi.project.v1`. Fresh projects
  are created from the checked-in `midi-mapping.json` factory template, and
  legacy MIDI storage keys are cleared on load.
- Use the source browser to search and filter SFX events, trigger types, MIDI
  flags, system events, assigned/unassigned sources, and conflict status.
- Tracks route sources to channels and output devices with mute, solo, arm,
  velocity scale, priority, and voice budget controls.
- The inspector edits direct note/degree/chord/velocity/duration/envelope
  mappings, assigns clips, audits conflicts, and auditions the selected source
  or clip through the selected track.
- Clips support step, chord, and arp types. Step clips expose note, velocity,
  probability, hold, and tie controls, plus keyboard navigation across the grid.
- Save Template, Export, and Import move sanitized project/template JSON through
  the project validator.
- Learn captures a pending MIDI note assignment for a selected direct source.
  Record captures a short mocked or live MIDI phrase into consecutive clip
  steps.
- Full defaults and runtime mapping notes live in `midi-mapping.json` and
  `docs/midi-mapping.md`. Current UI behavior is documented in
  `docs/midi-ui.md`.

### MIDI input mapping

- Input mapping is configured in `midi-mapping.json` under `input`.
- Transport messages map to pause/resume/restart.
- Notes map to skill selection or action controls (pause/resume/restart/speed/toggles).
- CCs map to speed, BPM, intensity, accent, key/scale, view pan, repeat window, ADSR, chord defaults, and time signature.

<details>
  <summary><b>Default MIDI mapping table</b></summary>

  | Type | Control | Meaning | Range/Values | Default |
  | --- | --- | --- | --- | --- |
  | Input | Channel | Input filter | `omni` or 1-16 | `omni` |
  | Transport | Start (0xFA) | Action | restart | restart |
  | Transport | Stop (0xFC) | Action | pause | pause |
  | Transport | Continue (0xFB) | Action | resume | resume |
  | Note | Skill base | Skill select base | MIDI note | 60 |
  | Note | Skill order | Skill index order | CLIMBER, FLOATER, BOMBER, BLOCKER, BUILDER, BASHER, MINER, DIGGER | set |
  | Note | 36 | Action | pause | 36 |
  | Note | 38 | Action | resume | 38 |
  | Note | 40 | Action | restart | 40 |
  | Note | 41 | Action | speedDown | 41 |
  | Note | 43 | Action | speedUp | 43 |
  | Note | 45 | Action | speedReset | 45 |
  | Note | 47 | Action | toggleMidi | 47 |
  | Note | 49 | Action | toggleViewPan | 49 |
  | CC | 1 | Speed factor | 0.1-8 | 1 |
  | CC | 74 | Base BPM | 60-200 | 120 |
  | CC | 7 | Intensity (velocity) | 10-127 | 80 |
  | CC | 11 | Accent (density boost) | 0-1 | 0.4 |
  | CC | 16 | Key root | 0-11 | 0 |
  | CC | 17 | Scale name | chromatic-minor, major, minor, dorian, mixolydian, pentatonic, chromatic | chromatic-minor |
  | CC | 18 | X to note offset | toggle | off |
  | CC | 19 | Y to velocity | toggle | on |
  | CC | 20 | Y to timbre | toggle | on |
  | CC | 21 | View pan | toggle | off |
  | CC | 22 | Repeat max count | 0-32 | 0 |
  | CC | 23 | Repeat window (beats) | 1-8 | 4 |
  | CC | 24 | Env attack | 0-2 | 1 |
  | CC | 25 | Env decay | 0-2 | 0 |
  | CC | 26 | Env sustain | 0-1 | 1 |
  | CC | 27 | Env release | 0-2 | 1 |
  | CC | 28 | Chord type | triad, seventh, sixth, ninth, power, sus2, sus4, octave | triad |
  | CC | 29 | Chord octave | 1-8 | 4 |
  | CC | 30 | Chord degree | 0-6 | 0 |
  | CC | 31 | Duration ticks | 1-24 | 6 |

</details>

## Development and Testing

- `npm test` runs the full Mocha suite.
- `npm run test-editor` runs the editor unit tests.
- `npm run coverage-editor` enforces 100% coverage for `js/editor/**`.
- Individual groups are in [docs/TESTING.md](docs/TESTING.md).
- `npm run lint` checks ESLint rules.
- `npm run format` fixes formatting.

## Docs

- Index: [docs/README.md](docs/README.md)
- Usage: [docs/usage.md](docs/usage.md)
- Offline tools: [docs/offline-tools.md](docs/offline-tools.md)
- Exporting sprites: [docs/exporting-sprites.md](docs/exporting-sprites.md)
- Editor workflows: [docs/level-editor/workflows.md](docs/level-editor/workflows.md)
- MIDI UI: [docs/midi-ui.md](docs/midi-ui.md)
- Performance benchmarks: [docs/performance-benchmarks.md](docs/performance-benchmarks.md)
- Testing: [docs/TESTING.md](docs/TESTING.md)
- CI: [docs/ci.md](docs/ci.md)
- Config: [docs/config.md](docs/config.md)
- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)

## Progressive Web App

This repo ships with [site.webmanifest](site.webmanifest) and a service worker
(`service-worker.js`) so it can be installed as a PWA with offline caching for
core assets after the first successful load. It launches fullscreen in landscape
mode. Touch input still needs polish, so please file bugs for any issues you hit.

## Roadmap

See [docs/roadmap.md](docs/roadmap.md) for the active roadmap. Completed
phases live in git history.

## Credits

- Lemmings fans and archivists
- [Lemmings Forums](https://www.lemmingsforums.net/)
- [Camanis.net Lemmings Archives](https://www.camanis.net/lemmings/)
- [tomsoftware](https://github.com/tomsoftware)
- [oklemenz/LemmingsJS](https://github.com/oklemenz/LemmingsJS)
- The Throng (Blackmirror S7E4)
- [Mumdance](https://www.mumdance.com/)
