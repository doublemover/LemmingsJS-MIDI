# Lemmings - Lemmings / Oh no! More Lemmings

Lemmings reimplementation written in HTML5 / JavaScript. Emits MIDI events via WebMIDI instead of playing sounds (or music)

Play it in your browser: [https://doublemover.github.io/LemmingsJS-MIDI/](https://doublemover.github.io/LemmingsJS-MIDI/)

## New Features
  - Speed Management UI
    - Speed is displayed at the bottom of the Paws (Pause) button
    - `f` for faster, `-` for slower
    - Right clicking the Paws button resets the Game Speed Multiplier to 1
    - Right clicking Nuke toggles Debug Mode
    - When Debug Mode is enabled, speed can be increased up to 60x or reduced to 0.5x 
  - Levels with multiple entrances function correctly
  - Traps are deadly & animate when triggered
    - Debug mode: Red rectangles show triggers (traps & level exit)
  - The frying animation plays when lemmings step into fire pit or flamethrower triggers
  - Improved Steel terrain
    - Using magic numbers based on level pack & ground#.dat to flag steel images and calculate opaque size for precise placement
    - Debug mode: Cyan rectangles show ranges of steel
  - Arrow Walls faithful to the original implementation
    - Debug mode: Orange (left) & Green (right) show arrow triggers
  - Minimap
    - Enhanced visibility: Reads ground mask at full res, accumulates result into minimap res
    - Terrain, entrances, and exits are visible
    - Dots update with lemming locations
    - Lemming deaths are indicated by a dot that flashes 4 times
    - Viewport box
    - Precomputed terrain with invalidation, prebuilt pallete
  - Grid based Trigger Management
  - Revised lemming selection system
  - Revised timer system allows for skill selection/use while the game is paused
    - Eliminated drift for precise gameplay
  - Performance & caching 

### Fixed Bugs
  - Invisible blockers being left behind when a blocker does a different action
  - Invisible lemmings consuming actions after dying
  - Bombers retaining their triggers in weird cases
  - Bombers exploding after falling into traps
  - Explosion sprite misalignment
  - Arrow Wall animations
  - Prevent wasted actions on falling lemmings (only floater, climber, builder, and bomber can be applied)
  - Prevent redundant actions (cannot re-apply basher, blocker, digger, or miner)
  - Various crashes
  - Removed unfinished sound/music functionality
  - Untangled promises so that all errors bubble up correctly
  - Split the codebase up into modules to aid with refactoring

## Progress
  - Everything above
  - [X] Partial support for xmas91/92 and holiday93/94 level packs
    - [ ] Needs steel sprite magic numbers
    - [ ] New triggers probably
    - [ ] Pallete? whatever else, some things look off
  - [X] Click on minimap to change view position
    - [ ] Drag
  - [ ] Keyboard shortcuts
    - [ ] incl debug, speed, swap skills
  - [ ] Display selection rect around lemming nearest to cursor on hover
  - [ ] Confirmation state for nuke
  - [X] Arrow Walls
    - [ ] Are they supposed to bounce builders?
    - [ ] 2-2-19 left arrows not rendering, range shows up in debug?
    - [ ] I don't like that the arrows show up on stairs that are built
      - [ ] Add built stairs to a separate ground that does not get painted by these?
  - [X] Traps
    - [ ] Squish is missing
    - [ ] "Generic Trap" just vanishes em
    - [X] Cooldown
  - [ ] MIDI
    - [X] WebMIDI Error Display
    - [X] List Input & Output devices in select elements
    - [ ] Channel selection
    - [ ] I/O Display
    - [ ] Debug Display

## Roadmap
- [ ] Viewport Zoom (currently disabled) almost works, needs stage view offset calcs
- [ ] Bombs
  - [ ] Bombs should remove normal ground that is overlapping steel, revealing it
    - [ ] Write steel to second layer?
- [ ] Super lemmings act twice per tick

## Bugs, Things I am not sure of, and potential future enhancements
  - [ ] Still possible to apply bomb to exploding bombers, probably need to adjust the frame at which they are removed
    - [ ] Same deal with splatting, drowning, and maybe falling lemmings
  - [ ] There is not a pallete swapped frying animation for the 'ice thrower' traps, I want to make one anyways
    - [ ] 2-2-9, 1-4-30
  - [ ] Trigger.disabledUntilTick overruns after 24 days
  - [ ] Lemming.isRemoved() null/removed conflict
  - [X] Fixed double level loads
    - [ ] Previous pack still flashing, causes crash if you navigate from 1->2 and then try going past 2-4-20
      - [ ] I've managed to make the game lock up exactly once while dragging back and forth as fast as i could repeatedly and I cannot reproduce it, this might be it
      - [ ] Can't go back to version 1 by clicking back on the start of version 2, probably related
  - [ ] Building stairs off the horizontal edge of a level causes a step or two to appear on the other end of the level
  - [ ] clicking prev/next level arrows while gameover screen fadeout is playing causes double load of selected level
    - [ ] debounce/toggle

## Things I need to look at
- [ ] Source some form of level editor
or 
- [ ] Make and import a custom DAT with just image assets and a level with 8 tracks and 8 spawns
- [ ] The ability to place flags or something to trigger different midi events as they are walked by

## Play Locally

- Install [Node.js](https://nodejs.org)
- Clone: `git clone https://github.com/doublemover/LemmingsJS-MIDI`
- Terminal:
  - `npm install`
  - `npm start`
- Browser: `localhost:8080`

## Options

URL parameters are leveraged to save game state automatically (shortcut in brackets):

- `version (v)`:
  - 1: Lemmings (default)
  - 2: Oh no! More Lemmings 
- `difficulty (d)`: Difficulty 1-5 (default: 1)
- `level (l)`: Level 1-30 (default: 1)
- `speed (s)`: Control execution speed >0-100 (default: 1)
- `cheat (c)`: Enable cheat mode (99 for all actions) (default: false)
- `debug`: Enable debug mode until the page is refreshed (default: false)

## Versions

- Lemmings: https://doublemover.github.io/LemmingsJS-MIDI?version=0
- Oh no! More Lemmings: https://doublemover.github.io/LemmingsJS-MIDI?version=1

## Credits

- All of the dedicated lemmings fans, their archival and documentation efforts made this much easier to complete
- https://github.com/tomsoftware
- https://github.com/oklemenz/LemmingsJS
- The Throng (Blackmirror S7E4)
- Mumdance (inspired me to do this during a radio show) 
