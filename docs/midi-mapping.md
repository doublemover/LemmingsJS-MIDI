# MIDI Mapping Cheatsheet

This document summarizes the factory MIDI template in
[`../midi-mapping.json`](../midi-mapping.json). Fresh sequencer projects are
created from this file, then editable state is stored in
`lemmings.midi.project.v1`.

For UI behavior and controls, see `docs/midi-ui.md`.

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

Position routing in the runtime mapper uses explicit entries in
`position.mappings`. Legacy toggle-style flags such as `position.xToNote`,
`position.yToVelocity`, and `position.yToTimbre` may still appear in older local
data or input CC metadata, but they are ignored by the event mapper unless they
are represented as explicit mapping entries.

Fresh sequencer projects import those explicit `position.mappings` as project
automation lanes. The sequencer lowers enabled lanes back into the runtime
mapping, while global intensity, accent, envelope defaults, and view pan are
stored in the project global block.

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

- Use the in-game sequencer UI for editable mappings, clips, tracks, devices,
  modulation, and audition.
- Edit `midi-mapping.json` only to change the factory template used by fresh
  projects and reset.
- Use project `devices.inputChannel` to switch between omni and a specific MIDI
  channel.
- There is no standard MIDI CC for time signatures; the defaults use CC 80/81,
  but you can remap or disable them in `midi-mapping.json`.

## Reverse playback

- `reverse.allNotesOffOnToggle` sends all-notes-off and clears queued MIDI events
  whenever reverse playback is toggled (default: `false`).
