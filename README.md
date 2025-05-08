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
- Clone: `https://github.com/oklemenz/LemmingsJS.git`
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
