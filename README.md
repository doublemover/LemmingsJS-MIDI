# Lemmings - Lemmings / Oh no! More Lemmings

Lemmings reimplementation written in HTML5 / JavaScript. Emits MIDI events via WebMIDI instead of playing sounds (or music)

## Current Progress
- [X] Added WebMIDI.js to /js
- [X] Comb Lemmings.js for spelling mistakes
  - [ ] Double check 
- [X] Remove unfinished sound/music functionality
- [X] Commented out a lot of console log calls  
- [ ] See if it still runs
- [ ] Implement MIDIManager

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
