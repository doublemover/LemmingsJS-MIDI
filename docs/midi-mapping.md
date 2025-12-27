# MIDI Mapping Cheatsheet

This document summarizes the default MIDI mappings in `midi-mapping.json`.
Edit that file to customize your setup.

## Input

- Channel: `omni` (listen to all channels) or 1-16.
- Transport messages:
  - Start (0xFA): restart
  - Stop (0xFC): pause
  - Continue (0xFB): resume

## Note actions

Skill selection uses a base note plus the skill order array.

| Note | Action |
| --- | --- |
| 36 | pause |
| 38 | resume |
| 40 | restart |
| 41 | speedDown |
| 43 | speedUp |
| 45 | speedReset |
| 47 | toggleMidi |
| 49 | toggleViewPan |

Default skill order:
`CLIMBER, FLOATER, BOMBER, BLOCKER, BUILDER, BASHER, MINER, DIGGER`

## CC mapping

| CC | Target | Range/Values | Default |
| --- | --- | --- | --- |
| 1 | speed | 0.1-8 | 1 |
| 74 | bpmBase | 60-200 | 120 |
| 7 | intensity | 10-127 | 80 |
| 11 | accent | 0-1 | 0.4 |
| 16 | scale.root | 0-11 | 0 |
| 17 | scale.name | chromatic-minor, major, minor, dorian, mixolydian, pentatonic, chromatic | chromatic-minor |
| 18 | position.xToNote | toggle | off |
| 19 | position.yToVelocity | toggle | on |
| 20 | position.yToTimbre | toggle | on |
| 21 | position.viewPan | toggle | off |
| 22 | repeat.maxRepeats | 0-6 | 0 |
| 23 | repeat.windowBeats | 1-8 | 4 |
| 24 | envelope.attack | 0-2 | 1 |
| 25 | envelope.decay | 0-2 | 0 |
| 26 | envelope.sustain | 0-1 | 1 |
| 27 | envelope.release | 0-2 | 1 |
| 28 | noteDefaults.chord | triad, seventh, sixth, ninth, power, sus2, sus4, octave | triad |
| 29 | noteDefaults.octave | 1-8 | 4 |
| 30 | noteDefaults.degree | 0-6 | 0 |
| 31 | durationTicks.default | 1-24 | 6 |

## Customization tips

- Edit the `input` section in `midi-mapping.json` to change note or CC mappings.
- Use `input.channel` to switch between omni and a specific MIDI channel.
- Mapping changes take effect on refresh.
