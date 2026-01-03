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
| 22 | repeat.maxRepeats | 0-32 | 0 |
| 23 | repeat.windowBeats | 1-8 | 4 |
| 24 | envelope.attack | 0-2 | 1 |
| 25 | envelope.decay | 0-2 | 0 |
| 26 | envelope.sustain | 0-1 | 1 |
| 27 | envelope.release | 0-2 | 1 |
| 28 | noteDefaults.chord | triad, seventh, sixth, ninth, power, sus2, sus4, octave | triad |
| 29 | noteDefaults.octave | 1-8 | 4 |
| 30 | noteDefaults.degree | 0-6 | 0 |
| 31 | durationTicks.default | 1-24 | 6 |
| 80 | timing.timeSignature.beats | 1-12 | 4 |
| 81 | timing.timeSignature.unit | 1, 2, 4, 8, 16 | 4 |

## Target ranges

These ranges are used by positional modifiers and defaults when min/max values
are omitted. Values outside the ranges are clamped.

| Target | Range |
| --- | --- |
| Note offset | -12 to 12 (from `position.xNoteRange`) |
| Intensity (velocity) | 20 to 110 (from `velocityRange`) |
| Timbre | 20 to 110 (from `position.timbreRange`) |
| Pan | -127 to 127 (from `position.panRange`) |
| Duration | 2 to 24 (from `durationTicks`) |
| Pitch bend | -1 to 1 |
| Attack/Decay/Release | 0 to 2 |
| Sustain | 0.25 to 2 |

## Customization tips

- Edit the `input` section in `midi-mapping.json` to change note or CC mappings.
- Use `input.channel` to switch between omni and a specific MIDI channel.       
- Mapping changes take effect on refresh.
- There is no standard MIDI CC for time signatures; the defaults use CC 80/81,
  but you can remap or disable them in `midi-mapping.json`.

## Reverse playback

- `reverse.allNotesOffOnToggle` sends all-notes-off and clears queued MIDI events
  whenever reverse playback is toggled (default: `false`).
