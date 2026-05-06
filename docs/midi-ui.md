# MIDI UI Guide

The MIDI UI is an in-game sequencer workspace layered over `/`. It replaces the
old two-pane Events/Triggers/ADSR configuration UI.

## Setup

- Enable: attaches or detaches MIDI routing.
- Input and Project Output: select the WebMIDI input and default output device
  when available.
- Channel: input channel, either `omni` or 1-16.
- BPM, Beats, Unit, Key, Scale, Quant, Swing: transport tempo, meter, key/scale,
  and quantize/swing project settings exposed to the MIDI runtime config.
- Template: choose the factory template or a saved user template for reset.
- Reset: creates a fresh project from the selected template.
- Save Template, Export, Import: save reusable project templates and move
  sanitized project JSON in or out of the sequencer.
- Panic: sends all-notes-off and clears queued MIDI notes.

## Workspace

- Sources: browse SFX, triggers, MIDI flags, system, and procgen sources with
  search, category, changed, current-level availability, assignment, conflict,
  and clean filters.
- Tracks: create and select tracks, set optional per-track output, channel,
  instrument label, mute, solo, arm, velocity scale, priority, and voice budget.
- Keyboard navigation: focus the Sources, Tracks, Clips, or step-pattern grid
  fields and use Arrow keys, Home, and End to move through the active region.
- Modulation: set global intensity, velocity range, note range, accent, density
  window, density duration scale, view pan range/dead zone, timbre range, safety
  limits, duration defaults/range, and add, edit, or remove compact position
  lanes with axis operators for note, velocity, pan, duration, timbre, and
  envelope targets. Global envelope defaults set the baseline for direct mappings
  unless a source has an envelope override.
- Clips: create reusable step, chord, or arp clips, set arp direction and
  pattern preset, and edit compact step patterns with note, velocity, duration,
  probability, hold, and tie controls.
- Assignment: route the selected source to a selected track, or switch it from
  direct mode to clip mode and assign a selected clip.
- Inspector: edit the selected source direct mapping with note, degree, octave,
  chord type/inversion, arp direction, velocity, duration, pan, timbre, pitch
  bend, envelope override, clip, audition controls, and conflict warnings for
  the selected route.
  Changed sources can be reverted to the factory template mapping, or to the
  project default for sources not present in the factory template.
- Learn: arm a selected direct source, capture the next MIDI note-on as a
  pending note/velocity/channel assignment, then commit or cancel it.
- Record: capture a short mocked or live MIDI phrase into consecutive steps of
  the selected step clip, then commit or cancel the transient recording.
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

User templates are stored separately in `lemmings.midi.templates.v1`. Imported
projects and saved templates are sanitized through the same project validator as
factory projects.

## E2E Hooks

`window.__LEMMINGS_MIDI_UI__` exposes project-oriented methods:

- `getProject()`
- `dispatchProjectIntent(intent)`
- `setProject(project)`
- `resetProject(templateId?)`
- `exportProject({ asTemplate?, download? })`
- `importProject(payload)`
- `saveProjectTemplate({ id?, name? })`
- `getProjectTemplates()`
- `startLearn()`
- `confirmLearn()`
- `cancelLearn()`
- `startRecording()`
- `commitRecording()`
- `cancelRecording()`
- `audition({ sourceId?, trackId?, mapping?, clipId? })`
- `panic()`

`window.__E2E__` exposes:

- `midiGetProject()`
- `midiDispatchProjectIntent(intent)`
- `midiResetProject(templateId)`
- `midiExportProject(options)`
- `midiImportProject(payload)`
- `midiSaveProjectTemplate(options)`
- `midiGetProjectTemplates()`
- `midiStartLearn()`
- `midiConfirmLearn()`
- `midiCancelLearn()`
- `midiCaptureLearnNote(note, velocity, channel)`
- `midiStartRecording()`
- `midiCommitRecording()`
- `midiCancelRecording()`
- `midiCaptureRecordMessage(message)`
- `midiAudition(request)`

## Visual and E2E Coverage

- `npm run capture:e2e:midi` captures the sequencer regions under
  `temp/e2e-captures/`.
- `e2e/midi-ui.spec.js` covers first-run project creation, fresh-reset legacy
  cleanup, setup, transport meter, project and per-track output routing, direct
  mapping, clip creation/editing, clip assignment, import/export/template reset,
  learn capture, short recording, modulation controls, audition, persistence,
  filters, conflict warnings, and responsive overflow checks.
