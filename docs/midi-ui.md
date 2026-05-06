# MIDI UI Guide

The MIDI UI is an in-game sequencer workspace layered over `/`. It replaces the
old two-pane Events/Triggers/ADSR configuration UI.

## Setup

- Enable: attaches or detaches MIDI routing.
- Input and Output: select WebMIDI devices when available.
- Channel: input channel, either `omni` or 1-16.
- BPM: base transport tempo used by the MIDI runtime.
- Reset: creates a fresh project from `midi-mapping.json`.
- Panic: sends all-notes-off and clears queued MIDI notes.

## Workspace

- Sources: browse SFX, triggers, MIDI flags, system, and procgen sources with
  search, category, assignment, conflict, and clean filters.
- Tracks: create and select tracks, set channel, instrument label, mute, solo,
  arm, velocity scale, priority, and voice budget.
- Modulation: set global intensity, accent, view pan, and compact position
  lanes for note, velocity, pan, duration, timbre, and envelope targets.
- Clips: create reusable step, chord, or arp clips and edit compact step
  patterns with note, velocity, probability, hold, and tie controls.
- Assignment: route the selected source to a selected track, or switch it from
  direct mode to clip mode and assign a selected clip.
- Inspector: edit the selected source direct mapping with note, degree, octave,
  chord, velocity, duration, envelope override, clip, audition controls, and
  conflict warnings for the selected route.
- Output Status: shows recent audition/output activity and scheduler pressure.

## Conflict Checks

The sequencer marks actionable source conflicts in the browser and explains the
selected source in the inspector. Current checks cover duplicate runtime source
keys, missing track or clip references, muted or solo-hidden routes, empty
direct/clip mappings, unavailable output ids when device data is supplied, and
notes that clamp outside the project range.

## Persistence

Editable MIDI state is stored only in `lemmings.midi.project.v1`.
`midi-mapping.json` is the factory template source for fresh projects and reset.
Legacy localStorage keys from the old UI are deleted on load and are not
migrated into the project.

## E2E Hooks

`window.__LEMMINGS_MIDI_UI__` exposes project-oriented methods:

- `getProject()`
- `dispatchProjectIntent(intent)`
- `setProject(project)`
- `resetProject(templateId?)`
- `audition({ sourceId?, trackId?, mapping?, clipId? })`
- `panic()`

`window.__E2E__` exposes:

- `midiGetProject()`
- `midiDispatchProjectIntent(intent)`
- `midiAudition(request)`

## Visual and E2E Coverage

- `npm run capture:e2e:midi` captures the sequencer regions under
  `temp/e2e-captures/`.
- `e2e/midi-ui.spec.js` covers first-run project creation, fresh-reset legacy
  cleanup, setup, track routing, direct mapping, clip creation/editing,
  clip assignment, modulation controls, audition, persistence, filters,
  conflict warnings, and responsive overflow checks.
