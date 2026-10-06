# MIDI Mapping Cheatsheet

This document summarizes the factory MIDI template in
[`../midi-mapping.json`](../midi-mapping.json). Fresh sequencer projects are
created from this file, then editable state is stored in
`lemmings.midi.project.v1`.

For UI behavior and controls, see `docs/midi-ui.md`.

## Game-event presets

The built-in Bright steps (C major), Cavern steps (A minor), and Chromatic
machinery presets use the simulation as their timing grid. Two playback modes
are available:

- **Phrase:** each spawn starts a quiet five-note descending phrase; each exit
  starts a five-note ascending phrase. Notes advance every two simulation ticks.
  Rapid arrivals replace the same voice's unsounded notes with the latest
  phrase. Its already sounding note keeps its original note-off; the replacement
  waits for it to finish. This merges crowded arrivals rather than layering an
  unlimited number of phrases.
- **Steps:** each actual spawn advances a descending arpeggio by one note; each
  actual exit advances a separate ascending arpeggio. Each landing produces a
  distinct plain note in both modes.

Spawn rate, travel, and gameplay actions determine the rhythm. Stored transport
quantize and swing fields do not shift these events. The phrase queue follows
actual game ticks, with no wall-clock note-on timer or independently running
beat grid. Pausing freezes pending phrase notes; already sounding notes finish.
Changing game speed changes subsequent tick spacing. The runtime emits only
due notes to WebMIDI, so future notes remain editable until they sound.

Pending work is bounded to 16 source/track/output/channel voices and at most
eight notes per voice (the built-in phrases use five). Every emitted note still
uses the scheduler's event, byte, and active-voice limits. Panic, reset or changed
mappings, output replacement/disconnection, and detaching a level cancel pending
notes. Timeline jumps discard old tails. Reverse events cancel forward tails
and play a single reversed-event accent; full reverse phrases are not generated.
Without an attached game-tick source a phrase produces only its first note.

Supported voices include builder steps and warnings, bashing, digging, mining,
steel hits, skill selection/assignment, hatch opening, level start, bomber
warnings/explosions, splats, drowning, falling off the level, safe landings, and
trap/fire events. There are no separate walking, climbing, or floating step events.
Timbre uses MIDI CC 74; these presets do not select a synthesizer program or
guarantee an instrument patch on external hardware.

The spawn source is SFX 24 (`lemming-spawn`), emitted once per newly added
lemming, including extra lemmings. It is distinct from the one-time hatch-open
event. It uses the existing sound-event history and reverse playback path.
It is disabled in the factory template and silent in older projects without a
spawn mapping; applying a game-event preset enables the mapping. Landing is SFX
25 (`lemming-land`), emitted on successful falling/floating contact, not fatal
splats. It is also opt-in for existing projects.

Applying a preset replaces the supported SFX mappings and the exit/drown/fire
trigger overrides, changes the global scale, and expands the note range only
as needed. It preserves device choices, enabled state, track routing, clips,
automation, transport settings, and safety limits. Existing custom trap and
MIDI-flag trigger mappings remain available and can override their SFX voices.
Steps mode uses note pools of at most four notes; phrase mode uses five-note
spawn/exit pools. Spawn phrase velocity is 42 before existing track, envelope,
density, and global velocity constraints. User limits are preserved, so a high
minimum velocity can prevent the intended quieter result. Custom global
duration/envelope settings also influence how long a sounding note takes to
finish before its replacement proceeds.

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

Project import/export JSON is sanitized through the same canonical project
model. Exported templates use the same project shape with hardware device ids
and enabled state cleared before storage or reset.

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
  modulation, import/export, user templates, and audition.
- Edit `midi-mapping.json` only to change the factory template used by fresh
  projects and reset.
- Use project `devices.inputChannel` to switch between omni and a specific MIDI
  channel.
- There is no standard MIDI CC for time signatures; the defaults use CC 80/81,
  but you can remap or disable them in `midi-mapping.json`.

## Reverse playback

- `reverse.allNotesOffOnToggle` sends all-notes-off and clears queued MIDI events
  whenever reverse playback is toggled (default: `false`).
