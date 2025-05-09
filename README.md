# Lemmings - Lemmings / Oh no! More Lemmings

Lemmings reimplementation written in HTML5 / JavaScript. Emits MIDI events via WebMIDI instead of playing sounds (or music)

## Current Progress
- [X] Added WebMIDI.js to /js
- [X] Clean up spelling mistakes & formatting
- [X] Remove unfinished sound/music functionality
- [X] See if it still runs
- [X] Speed Management
  - The button to the right of Nuke (yellow squiggle) now slows down the game by 1 (to a minimum of 1, the default speed)
  - The next button (not visible) now speeds the game up by 1 (to a maximum of 10)
  - The button after that (also not visible) resets the game speed to 1
  - The final button toggles the game's debug output to the console
- [X] Adding `&debug=true` or `&d=true` to the url will enable game's debug logs for one level
- [ ] Make the buttons visible
- [X] Fixed oddfile offsets
- [X] Levels with multiple entrances now function correctly
- [X] Traps are now deadly
- [ ] Animations on traps only play when the level starts
  - [ ] MapObject needs startTick, use it in objectManager.render
  - [ ] Animation needs Restart()
    - [ ] Call animation.restart() from new onTrigger handler in MapObject
- [ ] LevelProperties.skills needs this.skills.fill(0); after construction
- [ ] Lemmings that are blocking and then do a different action leave behind an invisible blocker
- [ ] Lemmings that die to traps or hazards seem to leave behind an invisible lemming that consumes actions
- [ ] Interrupted bombers can leave persisting triggers
- [ ] CountdownAction continues after bomber death (small memory leak)
- [ ] ParticleTable entries never reclaimed (memory leak)
- [ ] TriggerManager.remove(trigger) splices on index even if not found, can remove random triggers
- [ ] Long nukes can freeze game
- [ ] Lemmings.process fall through possible, random but rare undefined errors
- [ ] TriggerManager.removeByOwner is looping instead of running backwards once
- [ ] Trigger.disabledUntilTick overruns after 24 days
- [ ] TriggerManager.trigger needs sweep-and-prune to avoid needlessly scanning every trigger each tick
- [ ] Lemming.isRemoved() null/removed conflict
- [ ] Viewport zoom is stubbed but does not seem to function
- [ ] Implement MIDIManager
- [ ] Metal is stubbed but does not seem to properly prevent digging or resist bombers
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
