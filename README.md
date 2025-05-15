# Lemmings - Lemmings / Oh no! More Lemmings

Lemmings reimplementation written in HTML5 / JavaScript. Emits MIDI events via WebMIDI instead of playing sounds (or music)

Play it in your browser: [https://doublemover.github.io/LemmingsJS-MIDI/](https://doublemover.github.io/LemmingsJS-MIDI/)

## New Features
  - Speed Management
    - The "button" to the right of Nuke (yellow squiggle) slows down the game by 1 (to a minimum of 1, the default speed)
    - The next button (not visible) now speeds the game up by 1 (to a maximum of 10)
    - The button after that (also not visible) resets the game speed to 1
    - The final button (still invisible) toggles the game's debug output to the console
  - Levels with multiple entrances now function correctly
  - Traps are now deadly
  - Traps now animate when triggered
  - Fixed invisible blockers being left behind when a blocker does a different action
  - Fixed invisible leftover lemmings consuming actions after dying
  - Fixed bombers retaining their triggers in weird cases
  - Fixed bombers exploding after falling into traps
  - Fixed bomber explosion sprite alignment
  - Fixed Arrow Wall Animations
  - Steel Ground should now be faithful to the original implementation
  - Added purple rectangles to display ranges of steel when debugging is enabled
  - Minimap now renders. Terrain, entrances, and exits are visible. Dots update with lemming locations every 10 ticks
  - Various crash fixes and performance improvements
  - Split the codebase up into modules to aid with refactoring

## Progress
  - Everything above
  - [X] Added WebMIDI.js to /js/
  - [X] Clean up spelling mistakes & formatting
  - [X] Remove unfinished sound/music functionality
  - [X] Adding `&debug=true` or `&d=true` to the url will enable game's debug logs for one level
  - [X] Fixed oddfile offsets
  - [ ] Minimap enhancements
    - [ ] Viewport box not showing
    - [ ] Indicate lemming deaths
  - [ ] Frying death does not have animations set up
  

## Roadmap
- [ ] Entrance animation is bugged, can briefly see frames flash in the wrong order
- [ ] Viewport Zoom (currently disabled) almost works, needs stage view offset calcs
- [ ] Traps
  - [ ] I don't think the cooldown/reactivation delay is functioning correctly on traps, I remember these closing more slowly and hoisting then turning lemmings around instead of turbo crushing
  - [ ] Traps are correctly placed but there seems to be a delay for when Lemmings are splatted on some (1-4-30)
    - [ ] Particles being left behind by trap on 2-2-1
    - [ ] Left trap needs mirrored? (2-1-7)
      - [ ] Debug function update to reflect intended orientation
- [ ] Panel Buttons
  - [ ] Function to render a panel of smaller buttons between nuke and the minimap frame
  - [ ] Minipanel hit test
  - [ ] Speed up/Slow down/Reset speed buttons
  - [ ] Speed indicator
  - [ ] Confirmation state for nuke (darken button, draw questionmark)
- [ ] Bombs
  - [ ] I think these are supposed to kill other lemmings
  - [ ] Bombs should remove normal ground that is overlapping steel, revealing it
- [ ] Arrow Walls
  - [ ] Trying to bash/mine into an arrow wall from the opposing direction on level ground cancels the bash/mine, is that what's supposed to happen?
  - [ ] Check if it's possible for arrows to point up or down?
    - [ ] Cover dig/mining cases if it is
  - [ ] Building even one step and then bashing into an opposing arrow wall lets you go right through, is that intended?
  - [ ] If you build stairs into an opposing arrow wall are they supposed to flip and continue instead of stopping?
- [ ] Various bullshit
  - [ ] Trigger.disabledUntilTick overruns after 24 days
  - [ ] TriggerManager.trigger needs sweep-and-prune to avoid needlessly scanning every trigger each tick
  - [ ] Lemming.isRemoved() null/removed conflict
- [ ] Implement MIDIManager
  - [ ] Surely someone has made a nice device/channel config drop in or something
  - [ ] Find a quick and easy midi note display for debugging 

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

## Versions

- Lemmings: https://doublemover.github.io/LemmingsJS-MIDI?version=0
- Oh no! More Lemmings: https://doublemover.github.io/LemmingsJS-MIDI?version=1

## Credits

- https://github.com/tomsoftware
- https://github.com/oklemenz/LemmingsJS
- The Throng (Blackmirror S7E4)
- Mumdance (inspired me to do this during a radio show) 
