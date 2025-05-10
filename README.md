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
  - Steel Ground is functional, cannot be destroyed, and interrupts actions with a shrug
  - Various crash fixes and performance improvements

## Progress
  - Everything above
  - [X] Added WebMIDI.js to /js/
  - [X] Clean up spelling mistakes & formatting
  - [X] Remove unfinished sound/music functionality
  - [X] Adding `&debug=true` or `&d=true` to the url will enable game's debug logs for one level
  - [X] Fixed oddfile offsets
  - [ ] Steel ranges still wrong (lvl 2-28)
  - [ ] Trap offset wrong? (lvl 4-30)
  - [ ] Left trap needs mirrored? (2-1-7)
  - [ ] Minimap
    - [X] Render level in lower right rectangle
      - [ ] Not rendering entire level
      - [ ] Fog of war is broken
      - [ ] Need to render at 2x res or something to capture smaller details
    - [ ] Viewport box not showing
    - [ ] Dots
      - [X] Entrance dots
      - [ ] Exit 
      - [ ] Lemmings display stopped updating when I moved it to gui, needs ticks and udpate
      - [ ] Indicate lemming deaths?

## Roadmap
- [ ] Traps
  - [ ] I don't think the cooldown/reactivation delay is functioning correctly on traps, I remember these closing more slowly and hoisting then turning lemmings around instead of turbo crushing 
- [ ] Panel Buttons
  - [ ] Function to render a panel of smaller buttons between nuke and the minimap frame
  - [ ] Minipanel hit test
  - [ ] Speed up/Slow down/Reset speed buttons
  - [ ] Speed indicator
  - [ ] Confirmation state for nuke (darken button, draw questionmark)
- [ ] Winning
  - [ ] Is the quota supposed to be visible?
  - [ ] Should it automatically fail when it's no longer possible to meet quota? 
  - [ ] Timer should stop when level is completed
  - [ ] Was there a score system?
  - [ ] If all lemmings have been released and the only remaining lemmings are blockers then check for pass/fail
- [ ] Bombs
  - [ ] Explosion sprite misaligned
  - [ ] Are there enough particles/are they travelling correctly? I remember seeing way more
  - [ ] I think these are supposed to kill other lemmings
  - [ ] Bombs should remove normal ground that is overlapping steel, revealing it
- [ ] Arrow Walls
  - [ ] Trying to bash/mine into an arrow wall from the opposing direction on level ground cancels the bash/mine, is that what's supposed to happen?
  - [ ] Check if it's possible for arrows to point up or down?
    - [ ] Cover dig/mining cases if it is
  - [ ] Building even one step and then bashing into an opposing arrow wall lets you go right through, is that intended?
  - [ ] If you build stairs into an opposing arrow wall are they supposed to flip and continue instead of stopping?
  - [ ] Arrow wall overlay/animations are now bugged when near a lemming or being touched by a lemming
- [ ] Various bullshit
  - [ ] LevelProperties.skills needs this.skills.fill(0); after construction
  - [ ] Trigger.disabledUntilTick overruns after 24 days
  - [ ] TriggerManager.trigger needs sweep-and-prune to avoid needlessly scanning every trigger each tick
  - [ ] Lemming.isRemoved() null/removed conflict
  - [ ] Viewport zoom is stubbed but does not seem to function
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

- Lemmings: https://lemmingsjs.oklemenz.de?version=0
- Oh no! More Lemmings: https://lemmingsjs.oklemenz.de?version=1

## Credits

- https://github.com/tomsoftware
- https://github.com/oklemenz/LemmingsJS
- The Throng (Blackmirror S7E4)
- Mumdance (inspired me to do this during a radio show) 
