# LemmingsJS-MIDI
![Coverage](https://img.shields.io/badge/coverage-99.71%25-brightgreen)

High-performance JavaScript port of Lemmings with WebMIDI sequencing support.

<p align=center><b><a href="https://doublemover.github.io/LemmingsJS-MIDI/">Play it in your browser</a></b></p>

<p align=center><img src="https://github.com/user-attachments/assets/291d0c6a-ca2e-4de1-bee7-5c0cfb169ae9" width=50% height=50%></img></p>

## Highlights

- Accurate, fast Lemmings engine focused on performance first.
- Smooth zoom, minimap, and precise trigger handling.
- Bench mode for stress testing with live T/TPS/Active/Spawned stats.
- WebMIDI routing, input mapping, and sequencing controls.

## Quick Start

- Install [Node.js 20+](https://nodejs.org)
- Clone: `git clone https://github.com/doublemover/LemmingsJS-MIDI`
- Install and run:
  - `npm install`
  - `npm start`
- Open http://127.0.0.1:8080
- Open http://127.0.0.1:8080/editor.html for the standalone level editor.
- This repo is intended for local development and offline tooling, not npm distribution.

If you hit an issue, please open one: https://github.com/doublemover/LemmingsJS-MIDI/issues

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

## Performance

- Highly optimized: Capable of >100,000 lemmings/tick at original speed, or ~5,000/tick at 30x (500 Hz).
- Try it at 30x speed in bench mode:
  https://doublemover.github.io/LemmingsJS-MIDI/?version=1&difficulty=3&level=8&speed=30&cheat=false&bench=true&scale=0.8&endless=true&nukeAfter=8

## Features

- Multiple entrances work correctly
- Traps animate, are deadly, and have cooldowns
- Frying, Jumping, Hoisting animations
- Steel terrain improvements using `js/steelSprites.json`
- Minimap
  - Accumulates ground at full resolution
  - Shows entrances, exits, lemmings, and deaths
  - Click and drag to reposition view
- Zoom in and out with mouse wheel
- Skill selection while paused
- Original crosshair cursor (from `MAIN.DAT` part 5)
- Dashed debug box for nearest lemming
- Speed display on the Paws (Pause) button
  - Click left/right side of Paws to slow down or speed up
  - Use `-` / `=` (Shift for faster steps) to adjust speed
  - Right click Paws resets speed to 1
  - Speed is a divisor of original tick speed `(60ms / gameSpeed)`
- Right click release rate buttons for instant min or max

## Controls

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

### Editor

- Standalone editor page at `editor.html`.
- Import/export `.nxlv` and classic `.lvl` files from the editor header.
- `P`: Toggle playtest (configurable in `keybindings.json`).
- Shift-click or marquee to multi-select; drag to move; resize handles adjust size.
- Palette previews are generated from sprites and cached in browser storage.
- Steel rectangles are editable with the Steel tool.
- Copy/paste/duplicate, nudge, and snap actions are configurable in `keybindings.json`.
- Alt-drag duplicates the current selection; entrance/exit placement is capped at 4 each.

## Keybindings

Keybindings are configurable in `keybindings.json`. The in-game defaults map to the controls above, and the editor toggle uses `Shift+Backquote` by default.

## MIDI

- Enable MIDI from the left control panel (toggle persists). When disabled, WebMIDI is not enabled and the MIDI router is detached.
- Use the I/O section for Input/Output, Input channel, and `MIDI reset`. Input channel defaults to `Omni` and can be set to a specific 1-16 channel.
- Use `reset all` to clear stored MIDI overrides and UI state.
- `reverse.allNotesOffOnToggle` in `midi-mapping.json` can auto-reset MIDI when toggling reverse playback.
- Base BPM is the sequencing anchor; current BPM shows `speed x base`, plus ticks per second/beat/measure.
- Global FX tab:
  - Intensity and Accent adjust default velocity and density scaling.
  - Positional Modifiers add X/Y mappings (with optional operators) and per-target min/max ranges.
  - Global Repeat applies a beat window, max count, target, and amount to scale parameters on rapid repeats.
- Events/Triggers tabs:
  - Configure each SFX event or trigger with mode (note/degree/chord), key+octave, or scale degree + octave.
  - Chords support triad, seventh, sixth, ninth, power, sus2, sus4, and octave.
  - Arps support up/down/updown; triggers can optionally run independent arps per source.
- ADSR tab lets you target Global, a specific SFX, or a trigger to override envelope values.
- UI state is stored in localStorage. Defaults come from `midi-mapping.json` and apply only on first run or when a value is missing.
- Full defaults and customization notes live in `midi-mapping.json` and `docs/midi-mapping.md`.

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

## Options

URL parameters (shortcuts in brackets):

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
- `bench (b)`: Bench mode (endless spawning with speed modulation)
- `bench2 (b2)`: Bench mode with catchup slowdown (bench2)
- `benchReverse (bR)`: Bench mode with reverse-playback flag enabled
- `benchSequence (bs)`: Auto-run bench series (50/25/10/1 entrances + extras)   
- `preserveHistory (ph)`: Preserve future history when resuming after reverse playback
- `endless (e)`: Disable time limit
- `nukeAfter (na)`: Auto-nuke after x*10 seconds
- `scale (sc)`: Starting zoom .0125-8 (default: 2)
- `extra (ex)`: Extra lemmings per spawn 1-1000 (default: 0)
- `performanceAPI (pa)`: Enable Performance API instrumentation
- `shortcut`/`_`: Prefer short query keys when updating the URL

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
- `npm run test-editor` runs the editor unit tests.
- `npm run coverage-editor` enforces 100% coverage for `js/editor/**`.
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

This repo ships with [site.webmanifest](site.webmanifest) and a service worker
(`service-worker.js`) so it can be installed as a PWA with offline caching for
core assets after the first successful load. It launches fullscreen in landscape
mode. Touch input still needs polish, so please file bugs for any issues you hit.

## Roadmap

See [docs/roadmap.md](docs/roadmap.md) for the consolidated roadmap and phases.

## Credits

- Lemmings fans and archivists
- [Lemmings Forums](https://www.lemmingsforums.net/)
- [Camanis.net Lemmings Archives](https://www.camanis.net/lemmings/)
- [tomsoftware](https://github.com/tomsoftware)
- [oklemenz/LemmingsJS](https://github.com/oklemenz/LemmingsJS)
- The Throng (Blackmirror S7E4)
- [Mumdance](https://www.mumdance.com/)
