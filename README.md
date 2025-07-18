# Lemmings

Lemmings reimplementation written in Javascript.

The goal is to create a solid, performant port first. Then build out the sequencer features using WebMIDI.

<p align=center><b><a href="https://doublemover.github.io/LemmingsJS-MIDI/">Play it in your browser</a></b></p>

<p align=center><img src="https://github.com/user-attachments/assets/291d0c6a-ca2e-4de1-bee7-5c0cfb169ae9" width=50% height=50%></img></p>

## New Features
  - [Keyboard Shortcuts](https://github.com/doublemover/LemmingsJS-MIDI/blob/master/README.md#keyboard-shortcuts)
  - Speed is displayed at the bottom of the Paws (Pause) button
    - Click `f` for faster, `-` for slower
    - Right clicking Paws resets the Speed to 1
    - Functions as divisor of original tick speed `(60ms/GameSpeed)`
  - Right click release rate buttons for instant min or max rates 
  - Levels w/ multiple entrances function correctly
  - Traps animate, are deadly, and have cooldowns
  - Frying, Jumping, Hoisting animations
  - Improved Steel terrain
    - Steel sprite indexes are stored in `js/steelSprites.json` by game and pack to calculate opaque size for precise placement
  - Arrow Walls function
  - Minimap
    - Accumulates ground at full resolution for enhanced accuracy
    - Shows entrances, exits, lemmings, and lemming deaths
    - Click & Drag to reposition view
  - Zoom In & Out with Mousewheel
  - Skill selection/use while paused
  - Original crosshair cursor (from `MAIN.DAT` part 5). The system cursor is hidden and this sprite follows your mouse.
  - Dashed debug box highlights the lemming closest to your cursor
  - Highly optimized: Capable of >100,000 lemmings/tick at original speed, or ~5,000/tick at 30x (500 Hz).
    - [Try it at 30x speed in 'bench' mode](https://doublemover.github.io/LemmingsJS-MIDI/?version=1&difficulty=3&level=8&speed=30&cheat=false&bench=true&scale=0.8&endless=true&nukeAfter=8) 
  
<details>
  <summary> <b>Debug Features</b> </summary>
    
  - Right clicking Nuke toggles debug mode
    - Adds Blue pixel under lemmings to represent engine position
    - Red rectangles for triggers (traps, blockers, level exit)
    - Cyan rectangles show steel
    - Orange & Green show left & right arrow triggers
    - While enabled, speed can be decreased below 1 in increments of 0.1, and up to 120 in increments of 10
  - Extended URL Parameters
    - `&debug=true` enables debug mode (Console is noisy)
    - `&speed=x` sets game speed (0-120)
    - `&bench=true` enables "bench" mode, spawns lemmings endlessly at max rate
    - `&endless=true` disables time limit
    - `&nukeAfter=x` automatically nukes after x*10
    - `&scale=x` adjusts zoom scale (0.0125-5)
    - `&extra=x` x extra lemmings per spawn (1-1000)
      - Be careful with values larger than 100!
</details>
     
<details open>
  <summary> <b>Fixed Bugs</b> </summary>

  - Current automated test coverage is around **80%** of lines
  - Various crashes
  - Invisible blockers left behind when a blocker stops blocking
  - Invisible lemmings consuming actions after dying
  - Bombers retaining their triggers in weird cases
  - Bombers exploding after falling into traps
  - Explosion sprite misalignment
  - Arrow Wall animations
  - Fall height was incorrect
  - Bench entrances spawn no higher than a safe 45-pixel drop
  - Trap cooldown was missing
  - Prevent wasted actions on falling lemmings (only floater, climber, builder, and bomber can be applied)
  - Prevent redundant actions (cannot re-apply basher, blocker, digger, or miner)
</details>

<details>
  <summary> <b>Performance</b> </summary>
  
  - "Reasonably optimized" hot loops
  - Minimized reallocs, class level caching
  - Using Uint8arrays for masks, Uint32arrays for display buffers
  - Grid based trigger management 
  - Cached sprites, animations
  - Using requestAnimationFrame
    - No longer skips missed ticks
  - Untangled promises so that all errors bubble up correctly
  - Split the codebase up into modules to aid with refactoring
  - Removed unfinished sound/music functionality
  - Partial JSDoc support
</details>

<details open>
<summary>In Progress (10)</summary>
  
  - [ ] Letting LLM Agents loose on the codebase in the pursuit of:
    - [ ] 100% test coverage
      - [X] Currently at "80%", many features and tests are broken
      - [ ] Once at 'full coverage' the state will rapidly improve again
    - [X] All major features established
    - [ ] A full pack decompression-patch-compression asset pipeline
      - [ ] With compatability for as many other formats as possible
    - [X] Three different options for sprite upscaling
    - [ ] High resolution and 32 bit color sprite support
    - [X] Palette swapped animated sprites
    - [X] Marching ants, gotta have marching ants
    - [X] Scrolling with momentum
    - [ ] Full touch interaction support
    - [ ] Full support for 'glitches' per pack
    - [ ] Support for other popular pack types
    - [ ] Procedural endless level generation
  - [X] Partial support for xmas91/92 and holiday93/94 level packs
    - [ ] Documenting the shit out of everything
    - [ ] Needs steel sprite magic numbers
    - [ ] New triggers probably
    - [ ] Pallete? whatever else, some things look off
  - [ ] Tick Step
</details>

<details>
  <summary>Roadmap</summary>
  
- [X] Arrow Walls
  - [ ] Are they supposed to bounce builders?
  - [ ] 2-2-19 left arrows not rendering, range shows up in debug?
  - [ ] I don't like that the arrows show up on stairs that are built
    - [ ] Add built stairs to a separate ground that does not get painted by these?
- [X] Traps
  - [ ] Squish is missing
  - [ ] "Generic Trap" just vanishes em
- [ ] Bombs
  - [ ] Bombs should remove normal ground that is overlapping steel, revealing it
    - [ ] Write steel to second layer?
- [ ] Super lemmings act twice per tick
- [ ] MIDI
  - [X] WebMIDI Error Display
  - [X] List Input & Output devices in select elements
  - [ ] Channel selection
  - [ ] I/O Display
  - [ ] Debug Display
</details>

<details>
  <summary>Bugs & etc</summary>
  
- [ ] There is not a palette swapped frying animation 
  - [X] Palette swap functionality works!
  - [ ] 2-2-9, 1-4-30
- [ ] Previous pack still flashing, causes crash if you navigate from 1->2 and then try going past 2-4-20
  - [ ] Can't go back to version 1 by clicking back on the start of version 2
- [ ] Building stairs off the horizontal edge of a level causes a step or two to appear on the other end of the level
- [ ] Source some form of level editor
  - [ ] Make and import a custom DAT with just image assets and a level with 8 tracks and 8 spawns
- [ ] The ability to place flags or something to trigger different midi events as they are walked by
</details>

## Play Locally

- Install [Node.js 20 or later](https://nodejs.org)
- Clone: `git clone https://github.com/doublemover/LemmingsJS-MIDI`
- Terminal:
  - `npm install`
  - `npm start`

- Then open http://127.0.0.1:8080 in your browser
- If you encounter any issues [please let us know here](https://github.com/doublemover/LemmingsJS-MIDI/issues)


## Tools, Testing, Additional info

- See [docs/tools.md](docs/tools.md) for detailed usage of each script.
- See [docs/exporting-sprites.md](docs/exporting-sprites.md) for instructions on running tools for exporting sprites.
- See [docs/testing.md](docs/TESTING.md) for how to run the Mocha test suite.
- See [docs/ci.md](docs/ci.md) for gh actions workflow info.
- See [docs/config.md](docs/config.md) for configuration details.
- See [contributing.md](CONTRIBUTING.md) for contribution guidelines.

### Running tests

`npm test` runs the full Mocha suite. Individual groups are available via
dedicated scripts listed in [docs/TESTING.md](docs/TESTING.md) and
[.agentInfo/notes/test-categories.md](.agentInfo/notes/test-categories.md).


### Progressive Web App


This repo ships with [site.webmanifest](site.webmanifest) so it can be installed
as a **Progressive Web App (PWA)**. Installing adds the game to your phone's home screen
and launches it fullscreen in landscape mode. Touch input still needs
polish, so please file bugs for any issues you have!

## Options

URL parameters (shortcut in brackets):

- `version (v)`:
  - 1: [Lemmings](https://doublemover.github.io/LemmingsJS-MIDI?version=0) (default)
  - 2: [Oh no! More Lemmings](https://doublemover.github.io/LemmingsJS-MIDI?version=1)
  - 3: [Xmas 1991](https://doublemover.github.io/LemmingsJS-MIDI?version=2)
- `difficulty (d)`: Difficulty 1-5 (default: 1)
- `level (l)`: Level 1-30 (default: 1)
- `speed (s)`: Control speed 0-100 (default: 1)
- `cheat (c)`: Enable cheat mode (infinite actions) (default: false)
- `debug (dbg)`: Enable debug mode until the page is refreshed (default: false)
- `bench (b)`: Enable bench mode, lemmings never stop spawning with smooth speed modulation. The overlay fades out automatically and the timer resumes afterward. Only the pause button flashes red/green via `suspendWithColor` during adjustments (default: false)
- `benchSequence (bs)`: Automatically measure extra lemming capacity then run bench tests with 50, 25, 10 and 1 additional entrances, repeating with half and then zero extra lemmings (default: false)
  - The threshold search runs at the slowest release rate
- `endless (e)`: Disables time limit (default: false)
- `nukeAfter (na)`: Automatically nukes after x*10 (default: 0)
- `scale (sc)`: Adjusts starting zoom .0125-5 (default: 2)
- `extra (ex)`: Extra lemmings per spawn 1-1000 (default: 0)

## Keyboard Shortcuts

- `(Shift+)1`: Decrease Release Rate (Minimum)
- `(Shift+)2`: Increase Release Rate (Maximum)
- `3, 4, 5, 6`: Select Climber, Floater, Bomber, Blocker
- `Q, W, E, R`: Select Builder, Basher, Miner, Digger
- `Space`: Pause
- `[` / `]`: Step backward / forward one tick when paused
- `(Shift+)T`: Nuke (Instant)
- `Backspace`: Restart level
- `(Shift+)←↑↓→`: Move viewport (More)
- `(Shift+)Z` / `X`: Zoom in / out (More)
- `V`: Reset zoom to 2
- `(Shift+)-` / `=`: Decrease / Increase game speed (More)
- `,` / `.`: Previous / Next level
- `Shift+,` / `Shift+.`: Previous / Next group
- `Tab`: Cycle through skills
- `\`: Toggle debug mode
  
## Credits

- All of the dedicated lemmings fans, their archival and documentation efforts made this much easier to complete
- [Lemmings Forums](https://www.lemmingsforums.net/)
- [Camanis.net Lemmings Archives](https://www.camanis.net/lemmings/) 
- [tomsoftware](https://github.com/tomsoftware)
- [oklemenz/LemmingsJS](https://github.com/oklemenz/LemmingsJS)
- The Throng (Blackmirror S7E4)
- [Mumdance](https://www.mumdance.com/) (inspired me to do this during a radio show) 

<!-- .agentInfo Notes

The `.agentInfo/` directory holds short design notes and TODOs. Each file begins with a `tags:` line so agents can search by keyword.
See [`.agentInfo/index.md`](.agentInfo/index.md) for an overview of available notes. Make an effort to read and update these as much as you can.
WebMIDI docs live in [`.agentInfo/notes/webmidi-overview.md`](.agentInfo/notes/webmidi-overview.md) and the environment summary in [`.agentInfo/notes/webmidi-environments.md`](.agentInfo/notes/webmidi-environments.md).
-->
