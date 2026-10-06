# MIDI UI Guide

The MIDI Studio is an opt-in sequencer workspace layered over `/`, including the
GitHub Pages entry point. Choose **MIDI Studio** at the top right to open it.
Every page load starts with the workspace hidden, even when a saved project has
MIDI enabled. Opening or closing the studio does not change routing, audio,
project settings, or the saved enabled state. Visibility is not persisted.

**Close studio** returns focus to the opener and cancels uncommitted Learn or
Record captures. Escape cancels a pending capture first; another Escape closes
the studio. Use **Panic / stop notes** when you want to stop MIDI output notes.

The transport separates device connections from musical timing. Project and
template operations, track output/performance, and project-wide conditions and
modulation use expandable sections. Direct note editing displays scientific
pitch notation (MIDI 60 = C4); durations are labelled in game ticks.

## Game layout and event palettes

Game, difficulty, level, and saved-level controls live above the play surface.
Previous/next level arrows occupy a dedicated right-hand rail with touch-sized
targets. The canvas fits the remaining measured space at its native aspect
ratio; toolbar wrapping and mobile viewport changes trigger a new fit.

The studio opens to a small event-palette panel. Detailed source routing, clips,
and mapping controls stay behind **Event wiring & detailed musical editing**.
Choose **Quiet phrases per event** for a short falling run on each spawn and a
rising run on exit, or **One note per event** to step those patterns once per
spawn/exit. Landing has a separate plain note in both styles. Major, minor,
and chromatic palettes give the other supported actions fitting voices.
Applying a palette preserves enablement, devices, tracks, clips, automation,
and transport, while replacing supported gameplay mappings and selecting its
scale. Each individual lemming emits a distinct spawn event; hatch-opening
remains separate. Only safe landings emit the landing event. Unmapped spawn
and landing events are silent, preserving existing projects.

Phrase notes follow game ticks, not a separate tempo grid. Rapid repeats replace
only that event voice's unsounded tail; already-sounding notes finish cleanly.
Pending work is bounded to 16 voices with at most 8 notes each. Pause freezes
phrase progress, while reset, panic, output changes, and rewind clear pending
forward tails. Reverse events retain a single-note accent. The selected phrase's
**Preview first note** control auditions one pitch; hear the full phrase by
letting the game run. A saved minimum-velocity limit can make a quiet palette
louder; presets preserve that user limit.

The simulation supplies event timing. Stored BPM/meter/quantize/swing fields do
not quantize gameplay events in the current runtime. Musical key and scale
arrangement remain independently editable.

## Setup

- Enable: attaches or detaches MIDI routing.
- Input and Project Output: select the WebMIDI input and default output device
  when available.
- Channel: input channel, either `omni` or 1-16.
- BPM, Beats, Unit, Key, Scale, Quant, Swing: transport tempo, meter, key/scale,
  and quantize/swing project settings exposed to the MIDI runtime config.
- Template: choose the factory template or a saved user template for reset.
- Reset: creates a fresh project from the selected template.
- Reverse Panic: enables all-notes-off when reverse playback is toggled.
- Save Template, Export, Import: save reusable project templates and move
  sanitized project JSON in or out of the sequencer.
- Panic: sends all-notes-off and clears queued MIDI notes.

## Workspace

- Sources: browse SFX, triggers, MIDI flags, system, and procgen sources with
  search, category, changed, current-level availability, assignment, conflict,
  and clean filters. Filter counts are announced as status text, and conflicted
  rows expose the first conflict message in the row label.
- Tracks: create and select tracks, set optional per-track output, channel,
  instrument label, mute, solo, arm, velocity scale, priority, and voice budget.
- Keyboard navigation: focus the Sources, Tracks, Clips, or step-pattern grid
  fields and use Arrow keys, Home, and End to move through the active region.
- Modulation: set global intensity, velocity range, note range, accent, density
  window, density duration scale, view pan range/dead zone, timbre range, X-note
  offset range, safety limits, duration defaults/range, and add, edit, or remove
  compact position lanes with axis operators for note, velocity, pan, duration,
  timbre, and envelope targets. Global envelope defaults set the baseline for
  direct mappings unless a source has an envelope override.
- Clips: create reusable step, chord, or arp clips, set arp direction and
  pattern preset, and edit compact step patterns with note, velocity, duration,
  probability, hold, tie, and rest controls.
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
- `importProjectFile(file)`
- `saveProjectTemplate({ id?, name? })`
- `getProjectTemplates()`
- `getUiMetrics()`
- `getMidiSetupState()`
- `startLearn()`
- `confirmLearn()`
- `cancelLearn()`
- `captureLearnNote(note, velocity, channel)`
- `startRecording()`
- `commitRecording()`
- `cancelRecording()`
- `captureRecordMessage(message)`
- `audition({ sourceId?, trackId?, mapping?, clipId? })`
- `panic()`

`window.__E2E__` exposes:

- `midiGetProject()`
- `midiGetRuntimeConfig()`
- `midiDispatchProjectIntent(intent)`
- `midiResetProject(templateId)`
- `midiExportProject(options)`
- `midiImportProject(payload)`
- `midiSaveProjectTemplate(options)`
- `midiGetProjectTemplates()`
- `midiGetUiMetrics()`
- `midiGetSetupState()`: first-run/device-health snapshot with selected
  input/output, selected template, scheduler pressure, recent output log, and
  reset/panic recovery availability.
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
- Hardware-free MIDI checkpoint commands:
  `npm run test-e2e -- e2e/midi-ui.spec.js`,
  `npm run capture:e2e:midi -- --viewport=desktop --json`,
  `npm run capture:e2e:midi -- --viewport=tablet --json`, and
  `npm run capture:e2e:midi -- --viewport=mobile --json`.
- `e2e/midi-ui.spec.js` covers first-run project creation, fresh-reset legacy
  cleanup, setup, transport meter, project and per-track output routing, direct
  mapping, clip creation/editing, clip assignment, import/export/template reset,
  learn capture, short recording, modulation controls, track and clip removal,
  clip duplication, audition, persistence, filters, conflict warnings, E2E
  helper metrics, and responsive overflow checks.
