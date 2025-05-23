# Lemmings - Lemmings / Oh no! More Lemmings

Lemmings reimplementation written in HTML5 / JavaScript. Emits MIDI events via WebMIDI instead of playing sounds (or music)

Play it in your browser: [https://doublemover.github.io/LemmingsJS-MIDI/](https://doublemover.github.io/LemmingsJS-MIDI/)

## New Features
  - Speed Management & Debug toggle
    - The "button" to the right of Nuke (not visible) slows down the game by 1 (to a minimum of 1, the default speed)
    - The next button (not visible) speeds the game up by 1 (to a maximum of 10)
    - The button after that (also not visible) resets the game speed to 1
    - The final button (still invisible) toggles the game's debug output (noisy console, red dots denoting lemming position, boxes denoting triggers and steel)
  - Levels with multiple entrances function correctly
  - Traps are deadly & animate when triggered
  - The frying animation plays when lemmings step into fire pit or flamethrower triggers
  - Steel Ground faithful (?) to the original implementation
    - Added purple rectangles to display ranges of steel when debugging is enabled
  - Arrow Walls faithful (?) to the original implementation
    - Added orange (left) and green (right) rectangles to display arrow triggers when debugging is enabled
  - Minimap
    - Enhanced visibility: Reads ground mask at full res, accumulates result into minimap res
    - Terrain, entrances, and exits are visible
    - Dots update with lemming locations
    - Lemming deaths are indicated by a dot that flashes 4 times
    - Viewport box
    - Precomputed terrain with invalidation, prebuilt pallete, flattened uint8array to eliminate loop allocations ~(6.4x speedup)
  - Adding `&debug=true` or `&d=true` to the url will enable game's debug mode until the page is refreshed

### Fixed Bugs
  - Invisible blockers being left behind when a blocker does a different action
  - Invisible lemmings consuming actions after dying
  - Bombers retaining their triggers in weird cases
  - Bombers exploding after falling into traps
  - Explosion sprite misalignment
  - Arrow Wall animations
  - Prevent wasted actions on falling lemmings (only floater, climber, builder, and bomber can be applied)
  - Prevent redundant actions (cannot re-apply basher, blocker, digger, or miner)
  - Various crashes and performance issues
  - Removed unfinished sound/music functionality
  - Split the codebase up into modules to aid with refactoring

## Progress
  - Everything above
  - [ ] Super lemmings act twice per tick
  - [X] Arrow Walls
    - [X] Left & Right Arrows function correctly
    - [X] Utilizing similar logic as steel to generate masks and store them packed 
    - [X] Basher/Miner treat it as steel
    - [ ] Are they supposed to bounce builders?
  - [X] Traps
    - [ ] Squish is missing
    - [ ] "Generic Trap" just vanishes em
    - [ ] Cooldown
  - [ ] MIDI
    - [X] WebMIDI Error Display
    - [X] List Input & Output devices in select elements
    - [ ] Channel selection
    - [ ] I/O Display
    - [ ] Debug Display

## Roadmap
- [ ] Display selection rect around lemming nearest to cursor
- [ ] Keyboard shortcuts
- [ ] Click on minimap to change view position
- [ ] Minimap viewport freezes on pause
- [ ] TriggerManager seems like it's doing a lot of extra work for no reason
- [ ] Viewport Zoom (currently disabled) almost works, needs stage view offset calcs
- [ ] Panel Buttons
  - [ ] Function to render a panel of smaller buttons between nuke and the minimap frame
  - [X] Add y to gui events 
  - [ ] Visual Speed up/Slow down/Reset speed buttons
  - [ ] Speed indicator
  - [ ] Confirmation state for nuke (darken button, draw questionmark)
- [ ] Bombs
  - [X] Bombers do not harm other lemmings
  - [X] Added a function in lemmingManager that returns all lemmings within the offset bounds of a given mask at x,y anyways
      - [ ] Actually check the mask 
  - [ ] Bombs should remove normal ground that is overlapping steel, revealing it
    - [ ] Write steel to second backgroundLayer?

## Bugs, Things I am not sure of, and potential future enhancements
  - [ ] Do down arrows exist anywhere in these levels? If it does it might not be displaying
    - [ ] Down opposes from either side
  - [ ] I don't know if steel is wrong or not but I want to make it perfectly aligned with the graphics
  - [ ] I don't like that the arrows show up on stairs that are built
      - [ ] Add built stairs to a separate ground mask that does not get painted by these?
  - [ ] There is not a pallete swapped frying animation for the 'ice thrower' traps, I want to make one anyways
    - [ ] 2-2-9, 1-4-30
  - [ ] It seems like some traps might not be mirroring horizontally, if they're even supposed to
    - [ ] 2-1-7
    - [ ] Add orientation indication to debug rects
  - [X] The water randomly off to the side on 1-1-12 is supposed to be there,
  - [ ] Trigger.disabledUntilTick overruns after 24 days
  - [ ] TriggerManager.trigger needs sweep-and-prune to avoid needlessly scanning every trigger each tick
  - [ ] Lemming.isRemoved() null/removed conflict
  - [ ] If you go through enough levels at some point it starts flashing other levels underneath it, it's probably doing everything twice
  - [ ] I've managed to make the game lock up exactly once while dragging back and forth as fast as i could repeatedly and I cannot reproduce it
  - [ ] Can't go back to version 1 by clicking back on the start of version 2
  - [ ] Can apply actions on splatting lemmings?
  - [ ] Building stairs off the horizontal edge of a level causes a step or two to appear on the other end of the level
  - [ ] clicking prev/next level arrows while gameover screen fadeout is playing causes double load of selected level

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
- `speed (s)`: Control execution speed >0-10 (default: 1)
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
