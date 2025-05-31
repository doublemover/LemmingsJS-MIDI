# Lemmings - Lemmings / Oh no! More Lemmings

Lemmings reimplementation written in HTML5 / JavaScript. 

Plan is to emit MIDI events via WebMIDI instead of playing sounds (or music). I'm really adamant about it being a well made port before I turn it into a sequencer 

Play it in your browser: [https://doublemover.github.io/LemmingsJS-MIDI/](https://doublemover.github.io/LemmingsJS-MIDI/)

## New Features
  - Speed Management UI
    - Speed is displayed at the bottom of the Paws (Pause) button
      - Click `f` for faster, `-` for slower
      - Right clicking the Paws button resets the Game Speed Multiplier to 1
    - Right clicking Nuke toggles Debug Mode
      - When Debug Mode is enabled, speed can be increased up to 60x or reduced to 0.5x 
  - Levels with multiple entrances function correctly
  - Traps are deadly & animate when triggered
    - Debug mode: Red rectangles show triggers (traps & level exit)
  - Frying & Jumping animations now function
  - Improved Steel terrain
    - Using magic numbers based on level pack & ground#.dat to flag steel images and calculate opaque size for precise placement
    - Debug mode: Cyan rectangles show ranges of steel
  - Arrow Walls faithful to the original implementation
    - Debug mode: Orange (left) & Green (right) show arrow triggers
  - Minimap
    - Click / Drag to reposition view
  - The mousewheel zooms the view in and out
  - Grid based Trigger Management
  - Revised lemming selection system
  - Revised timer system allows for skill selection/use while the game is paused
    - Eliminated drift for precise gameplay
  - Performance & caching
    - Try [setting speed to 100 in the URL](https://doublemover.github.io/LemmingsJS-MIDI/?version=1&difficulty=4&level=26&speed=100&cheat=false) :)
    - Working towards adopting `performance.measure` extensively, soon the whole gamestate will be visible in the performance inspector  

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
  - [ ] Toggle Pause on Focus Loss
  - [ ] OG Cursor
  - [ ] URL options
    - [ ] extra/unlimited spawn control
    - [ ] never end
    - [ ] scale
    - [ ] nukeAfter
    - [ ] packname or vnum/difficulty name or number/level title or number nav
  - [ ] Display selection rect around lemming nearest to cursor on hover
  - [ ] Minimap
    - [ ] dots broken
    - [X] unscale/recenter zoom on level change
    - [ ] Push floor to panel
    - [ ] Full vp rect
  - [X] Partial support for xmas91/92 and holiday93/94 level packs
    - [ ] Needs steel sprite magic numbers
    - [ ] New triggers probably
    - [ ] Pallete? whatever else, some things look off
  - [ ] Clicking prev/next level arrows while gameover screen fadeout is playing causes double load of selected level
    - [ ] debounce/toggle
    - [ ] html needs size set
    - [ ] better level nav buttons/pack & diff dropdowns
  - [ ] Keyboard shortcuts
    - [ ] Decrease Release Rate
    - [ ] Min Release Rate
    - [ ] Increase Release Rate
    - [ ] Max Release Rate
    - [ ] Climb/Float/Bomb/Block/Build/Bash/Mine/Dig
    - [ ] Pause
    - [ ] Nuke
    - [ ] Reset Speed
    - [ ] Increase Speed
    - [ ] Decrease Speed
    - [ ] Restart
    - [ ] Debug
    - [ ] Skill/Lem Cycle
    - [ ] Viewport Movement, Zoom, Reset, Focus Lem/D
  - [ ] Tick Step
  - [ ] MIDI
    - [X] WebMIDI Error Display
    - [X] List Input & Output devices in select elements
    - [ ] Channel selection
    - [ ] I/O Display
    - [ ] Debug Display

## Roadmap
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
  - [X] Nuke Confirmation State
    - [X] Just a red border for now
    - [ ] I want marching ants 

## Bugs, Things I am not sure of, and potential future enhancements
  - [ ] Still possible to apply bomb to exploding bombers, probably need to adjust the frame at which they are removed
    - [ ] Same deal with splatting, drowning, and maybe falling lemmings
  - [ ] There is not a pallete swapped frying animation for the 'ice thrower' traps, I want to make one anyways
    - [ ] 2-2-9, 1-4-30
  - [ ] Trigger.disabledUntilTick overruns after 24 days
  - [ ] Lemming.isRemoved() null/removed conflict
  - [X] Fixed double level loads
    - [ ] Previous pack still flashing, causes crash if you navigate from 1->2 and then try going past 2-4-20
      - [ ] Can't go back to version 1 by clicking back on the start of version 2
  - [ ] Building stairs off the horizontal edge of a level causes a step or two to appear on the other end of the level

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
  - 1: [Lemmings](https://doublemover.github.io/LemmingsJS-MIDI?version=0) (default)
  - 2: [Oh no! More Lemmings](https://doublemover.github.io/LemmingsJS-MIDI?version=1)
  - 3: [Xmas 1991](https://doublemover.github.io/LemmingsJS-MIDI?version=2)
  - 4: [Xmas 1992](https://doublemover.github.io/LemmingsJS-MIDI?version=3)
  - 5: [Holiday 1993](https://doublemover.github.io/LemmingsJS-MIDI?version=4)
  - 6: [Holiday 1994](https://doublemover.github.io/LemmingsJS-MIDI?version=5)
- `difficulty (d)`: Difficulty 1-5 (default: 1)
- `level (l)`: Level 1-30 (default: 1)
- `speed (s)`: Control execution speed >0-100 (default: 1)
- `cheat (c)`: Enable cheat mode (99 for all actions) (default: false)
- `debug`: Enable debug mode until the page is refreshed (default: false)
- `bench`: Enabled 'bench' mode (lemmings never stop spawning, time doesn't run out)

## Credits

- All of the dedicated lemmings fans, their archival and documentation efforts made this much easier to complete
- https://github.com/tomsoftware
- https://github.com/oklemenz/LemmingsJS
- The Throng (Blackmirror S7E4)
- Mumdance (inspired me to do this during a radio show) 
