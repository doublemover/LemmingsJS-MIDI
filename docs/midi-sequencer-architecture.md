# MIDI Sequencer Architecture

The in-game MIDI surface is now project based. `midi-mapping.json` remains the
factory template, but editable state lives only in
`lemmings.midi.project.v1`.

## Project Model

`js/midi/project/MidiProject.js` owns the canonical `MidiProject` shape:

- project metadata, devices, transport, global ranges, tracks, sources, clips,
  automation, and UI selection.
- direct mappings plus clip-backed source routing for audition and gameplay
  routing.
- validation for channels, notes, velocities, durations, selected ids, clips,
  tracks, and malformed source mappings.
- sanitized project/template import and export envelopes for JSON interchange.
- conflict detection for duplicate runtime keys, missing references, muted or
  solo-hidden routes, empty mappings, output availability, and range clamping.
- deterministic reducer intents for setup, device selection, track creation,
  source assignment, direct mapping edits, clip creation, step edits,
  automation lane edits, global modulation edits, and UI selection.

Tracks carry channel, instrument label, mute, solo, arm, velocity scale,
priority, and voice budget. Sources carry a source kind/key, label, track route,
direct-or-clip mode, direct mapping, and optional clip id.

Clips currently support compact step, chord, and arp payloads. Step data stores
note, velocity, optional duration, probability, hold, and tie. The first clip
runtime adapter lowers playable steps into existing direct mapping fields:
simultaneous clip notes become `notes`, and arp clips add the existing `arp`
mapping shape.

Automation lanes are project-owned positional mappings. The factory template's
`position.mappings` entries import as automation lanes, and the adapter lowers
enabled global lanes back into explicit runtime `position.mappings`. Global
intensity, accent/density, envelope defaults, and view pan live under
`project.global`; per-track velocity scale is applied to both direct and clip
runtime mappings.

## Storage Cutover

`js/midi/project/MidiProjectStorage.js` reads and writes only
`lemmings.midi.project.v1` for the active editable project. User templates are
stored separately in `lemmings.midi.templates.v1`; they are sanitized snapshots
of a project with hardware device ids and enabled state cleared.

On load and reset the storage layer removes obsolete MIDI keys such as
`lemmings.midi.intent`, `lemmings.midi.overrides`, old device ids, tab state,
section state, schema hash, and the old audition feature flag.

Old local override data is intentionally not migrated. A missing project creates
a fresh project from the current factory template. Reset can target the factory
template or a saved user template.

## Runtime Adapter

`projectToMidiConfig(project, factoryConfig)` converts the active project back
into the existing `MidiMapping` config shape. This milestone keeps the existing
`MidiEventRouter` and `MidiScheduler`.

`detectMidiProjectConflicts(project, options)` is a pure project-domain report
used by the UI and tests. It inspects raw references before sanitizer repair,
then groups issues by source, track, and clip so the browser can badge sources
and the inspector can explain the selected route.

The adapter:

- preserves direct SFX and trigger mapping behavior.
- lowers clip-mode sources into the same SFX/trigger mapping maps by emitting
  `note`, `notes`, `velocity`, `durationTicks`, and optional `arp`.
- writes SFX sources to `config.sfx` and trigger/MIDI flag sources to
  `config.triggers`.
- applies project enabled state, input channel, transport, scale, ranges, MPE,
  limits, density/accent, envelope defaults, automation mappings, and reverse
  settings.
- maps track channel and priority into direct mappings.
- honors mute and solo by disabling mappings hidden by track state.
- applies per-track velocity scale to direct and clip mappings before routing.

Per-track output ids and voice budgets are persisted now, but the current
runtime still has one scheduler output. Full per-track output dispatch belongs
to a later scheduler/router phase.

## UI Regions

The `/` route uses `#midiSequencerWorkspace` over the game canvas:

- `#midiTransportStrip`: enable, input, output, input channel, BPM, template
  selection, reset, project import/export, panic, status, and device errors.
- `#midiSourceBrowser`: source search, category filter, assignment/conflict
  filter, and source list with conflict badges.
- `#midiTrackWorkspace`: track list, clip library, selected-source summary,
  and assignment controls.
- `#midiInspector`: selected track, source mapping, conflict summary,
  modulation controls, clip assignment, and step pattern controls.
- `#midiOutputStatus`: scheduler pressure and recent output log.

The old two-pane Events/Triggers/ADSR tabs and their storage behavior are
removed.

Learn mode is intentionally transient UI state. `MidiInputController` already
supports a note capture hook; the sequencer installs it while Learn is active,
shows the captured note/velocity/channel as pending, and commits through normal
project reducer intents. The first slice learns selected direct-source notes
only. Phrase recording remains separate because it needs timestamped note-on
and note-off capture before writing quantized clip steps.

## Validation

Focused unit coverage lives in:

- `test/midi/midi-project.test.js`
- `test/midi/midi-project-storage.test.js`
- `test/midi/midi-ui-controller.test.js`

Playwright coverage for the visible workspace lives in `e2e/midi-ui.spec.js`.
Disposable visual captures use `npm run capture:e2e:midi` and write under
`temp/e2e-captures/`.
