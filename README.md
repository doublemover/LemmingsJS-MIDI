# LemmingsJS-MIDI
![Coverage](https://img.shields.io/badge/coverage-99.98%25-brightgreen)

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
- Open http://127.0.0.1:8080/editor.html for the standalone level editor.
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
- Editor preview mode with `.nxlv` load/save/import/export (localStorage + file download/upload) and `.lvl` import/export
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
- `Shift+``: Toggle editor mode (preview only)

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
- Use the Input/Output selects to choose devices. Input channel defaults to `Omni` and can be set to a specific 1-16 channel.
- Use `MIDI reset` to stop all notes and clear the queued events.
- Base BPM is the sequencing anchor; current BPM shows the live value (Base BPM * game speed).
- Sequencing section:
  - Position mappings: add X/Y/X+Y mappings with min/max ranges to target note offset, intensity (velocity), timbre, pan, duration, pitch bend, or ADSR.
  - Intensity and Accent adjust default velocity and density scaling.
  - Repeat controls apply a beat window and a max repeat count to scale velocity/duration on rapid repeats.
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
- CCs map to speed, BPM, intensity, accent, key/scale, view pan, repeat window, ADSR, and chord defaults.

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
  | CC | 22 | Repeat max count | 0-6 | 0 |
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
  - 1: [Lemmings](https://doublemover.github.io/LemmingsJS-MIDI?version=0) (default)
  - 2: [Oh no! More Lemmings](https://doublemover.github.io/LemmingsJS-MIDI?version=1)
  - 3: [Xmas 1991](https://doublemover.github.io/LemmingsJS-MIDI?version=2)
- `difficulty (d)`: 1-5 (default: 1)
- `level (l)`: 1-30 (default: 1)
- `speed (s)`: 0-100 (default: 1)
- `cheat (c)`: true/false (default: false)
- `debug (dbg)`: true/false (default: false)
- `bench (b)`: Bench mode (endless spawning with speed modulation)
- `bench2 (b2)`: Bench mode with catchup slowdown (bench2)
- `benchReverse (bR)`: Bench mode with reverse-playback flag enabled
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

This repo ships with [site.webmanifest](site.webmanifest) so it can be installed
as a PWA. It launches fullscreen in landscape mode. Touch input still needs
polish, so please file bugs for any issues you hit.

<details open>
  <summary><b>In Progress</b></summary>

  - Editor tools (palette, placement, selection, brush, triggers)
  - Pack decompression/patch/compression pipeline
  - High resolution and 32-bit color sprite support
  - Full touch interaction support
  - Full support for pack-specific glitches
  - Support for other popular pack types
  - Procedural endless level generation
  - Improved documentation
  - Xmas 91/92 and Holiday 93/94 polish (steel sprite data, triggers, palette)
</details>

<details>
  <summary><b>Roadmap</b></summary>

  - Arrow walls (partial; trigger ranges parsed + debug overlay only) [feature]
    - Confirm builder bounce behavior [verify]
    - Fix 2-2-19 left arrows not rendering [verify]
    - Consider built-stairs handling [feature]
  - Traps [feature]
    - Squish missing [feature]
    - "Generic trap" uses splat death instead of trap animation [bug]
  - Bombs [verify]
    - Remove ground overlapping steel to reveal it [bug]
  - Super lemmings act twice per tick [feature]
  - MIDI
    - Debug display [feature]
  - Performance
    - Investigate using GameTimer catchup slowdown as a failsafe for perf spikes [feature]
</details>

<details>
  <summary><b>Bugs and Misc</b></summary>

  - [bug] No palette-swapped frying animation (2-2-9, 1-4-30)
  - [verify] Previous pack flashing, crash if navigating 1 -> 2 then past 2-4-20
  - [verify] Cannot go back to version 1 from version 2
  - [bug] Building stairs off the horizontal edge causes wraparound steps
  - [feature] Ability to place flags to trigger MIDI events
</details>

## Credits

- Lemmings fans and archivists
- [Lemmings Forums](https://www.lemmingsforums.net/)
- [Camanis.net Lemmings Archives](https://www.camanis.net/lemmings/)
- [tomsoftware](https://github.com/tomsoftware)
- [oklemenz/LemmingsJS](https://github.com/oklemenz/LemmingsJS)
- The Throng (Blackmirror S7E4)
- [Mumdance](https://www.mumdance.com/)
