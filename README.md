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

## Roadmap
- [ ] Make the speedup/slowdown/reset buttons visible
- [ ] Winning
  - [ ] Win conditions seem bugged in some cases
  - [ ] Timer should stop when level is completed
  - [ ] If all lemmings have been released and the only remaining lemmings are blockers then check for pass/fail
- [ ] Bombs
  - [ ] Explosion sprite misaligned
  - [ ] I think these are supposed to kill other lemmings
  - [ ] Bombs should remove dirt & etc from steel without removing steel
- [ ] Are we supposed to be able to bash throw arrow walls?
- [ ] Arrow wall animations bugged when near/touched by lemmings
- [ ] LevelProperties.skills needs this.skills.fill(0); after construction
- [ ] Trigger.disabledUntilTick overruns after 24 days
- [ ] TriggerManager.trigger needs sweep-and-prune to avoid needlessly scanning every trigger each tick
- [ ] Lemming.isRemoved() null/removed conflict
- [ ] Viewport zoom is stubbed but does not seem to function
- [ ] Minimap
  - [ ] Render it in lower right
  - [ ] Display viewport box
  - [ ] Show dots
    - [ ] Entrance
    - [ ] Exit
    - [ ] Lemmings
    - [ ] Indicate lemming deaths?
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
