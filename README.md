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
    - Steel sprite indexes are stored in `js/steelSprites.json` by game and pack
      to calculate opaque size for precise placement
  - Arrow Walls function
  - Minimap
    - Accumulates ground at full resolution for enhanced accuracy
    - Shows entrances, exits, lemmings, and lemming deaths
    - Click & Drag to reposition view
  - Zoom In & Out with Mousewheel
  - Skill selection/use while paused
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
      - Auto reduces game speed if more than 24 ticks behind, pausing in the worst cases to finish working through the delayed ticks
    - `&endless=true` disables time limit
    - `&nukeAfter=x` automatically nukes after x*10
    - `&scale=x` adjusts zoom scale (0.0125-5)
    - `&extra=x` x extra lemmings per spawn (1-1000)
      - Be careful with values larger than 100!
</details>
     
<details open>
  <summary> <b>Fixed Bugs</b> </summary>
    
  - Various crashes
  - Invisible blockers left behind when a blocker stops blocking
  - Invisible lemmings consuming actions after dying
  - Bombers retaining their triggers in weird cases
  - Bombers exploding after falling into traps
  - Explosion sprite misalignment
  - Arrow Wall animations
  - Fall height was incorrect
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
  <summary>In Progress (11)</summary>
  
  - [ ] Indicate bench speed adjustment with rect color
    - [ ] Tune speed reduction to prevent shitty computers from locking themselves up
  - [ ] Scale pixel alignment
  - [ ] I want marching ants 
  - [ ] OG Cursor
  - [ ] URL options
    - [ ] packname or vnum/difficulty name or number/level title or number nav
  - [ ] Display selection rect around lemming nearest to cursor on hover
  - [ ] Minimap
    - [X] switch to uint8
    - [ ] dots broken
    - [ ] Full vp rect
  - [X] Partial support for xmas91/92 and holiday93/94 level packs
    - [ ] Needs steel sprite magic numbers
    - [ ] New triggers probably
    - [ ] Pallete? whatever else, some things look off
  - [ ] Clicking prev/next level arrows while gameover screen fadeout is playing causes double load of selected level
    - [ ] debounce/toggle
    - [ ] html needs size set
    - [ ] better level nav buttons/pack & diff dropdowns
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
  - [X] Cooldown
- [ ] Bombs
  - [ ] I think I can do something neat with the last 20 or so frames of the sprite by using small amounts of transparency
    - [ ] And maybe nearest neighbor upscaling w/ low alpha
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
  
- [ ] Figure out what's up with jump and hoist
- [ ] Clean up logging
  - [ ] helper?
  - [ ] Shut lemmingManager up
  - [ ] perf.measure helper
- [ ] Still possible to apply bomb to exploding bombers, probably need to adjust the frame at which they are removed
  - [ ] Same deal with splatting, drowning, and maybe falling lemmings
- [ ] There is not a palette swapped frying animation for the 'ice thrower' traps, I want to make one anyways
  - [ ] 2-2-9, 1-4-30
- [ ] Trigger.disabledUntilTick overruns after 24 days
- [ ] Lemming.isRemoved() null/removed conflict
- [X] Fixed double level loads
  - [ ] Previous pack still flashing, causes crash if you navigate from 1->2 and then try going past 2-4-20
    - [ ] Can't go back to version 1 by clicking back on the start of version 2
- [ ] Building stairs off the horizontal edge of a level causes a step or two to appear on the other end of the level
- [ ] Source some form of level editor
  - [ ] Make and import a custom DAT with just image assets and a level with 8 tracks and 8 spawns
- [ ] The ability to place flags or something to trigger different midi events as they are walked by
</details>

## Play Locally

- Install [Node.js](https://nodejs.org)
- Clone: `git clone https://github.com/doublemover/LemmingsJS-MIDI`
- Terminal:
  - `npm install`
  - `npm start`
- Browser: `localhost:8080`

## Options

URL parameters (shortcut in brackets):

- `version (v)`:
  - 1: [Lemmings](https://doublemover.github.io/LemmingsJS-MIDI?version=0) (default)
  - 2: [Oh no! More Lemmings](https://doublemover.github.io/LemmingsJS-MIDI?version=1)
  - 3: [Xmas 1991](https://doublemover.github.io/LemmingsJS-MIDI?version=2)
  - 4: [Xmas 1992](https://doublemover.github.io/LemmingsJS-MIDI?version=3)
  - 5: [Holiday 1993](https://doublemover.github.io/LemmingsJS-MIDI?version=4)
  - 6: [Holiday 1994](https://doublemover.github.io/LemmingsJS-MIDI?version=5)
- `difficulty (d)`: Difficulty 1-5 (default: 1)
- `level (l)`: Level 1-30 (default: 1)
- `speed (s)`: Control speed 0-100 (default: 1)
- `cheat (c)`: Enable cheat mode (99 for all actions) (default: false)
- `debug (dbg)`: Enable debug mode until the page is refreshed (default: false)
- `bench (b)`: Enable bench mode, lemmings never stop spawning (default: false)
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
- `(Shift+)T`: Nuke (Instant)
- `Backspace`: Restart level
- `(Shift+)←↑↓→`: Move viewport (More)
 - `(Shift+)Z` / `X`: Zoom in / out in small steps with a smooth animation
- `V`: Reset zoom to 2
- `(Shift+)-` / `=`: Decrease / Increase game speed (More)
- `,` / `.`: Previous / Next level
- `Shift+,` / `Shift+.`: Previous / Next group
- `Tab`: Cycle through skills
- `\`: Toggle debug mode
  
## Credits

- All of the dedicated lemmings fans, their archival and documentation efforts made this much easier to complete
- [Lemmings Forums](https://www.lemmingsforums.net/)
- [tomsoftware](https://github.com/tomsoftware)
- [oklemenz/LemmingsJS](https://github.com/oklemenz/LemmingsJS)
- The Throng (Blackmirror S7E4)
- [Mumdance](https://www.mumdance.com/) (inspired me to do this during a radio show) 
