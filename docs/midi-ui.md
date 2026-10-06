# Game sound editor

Choose **MIDI Studio** in the game toolbar. It starts hidden on every page load;
opening it does not enable audio or request device access. On wide screens the
editor docks beside the game instead of covering terrain. Smaller screens use
a bottom editor; short landscape screens switch to an editing view, and Close
returns to the full game. Game controls stay above the play surface and level
arrows stay in the right rail.

## Mobile opt-in

On phones and tablets the entire MIDI Studio, launcher, MIDI device initialization,
and local note preview are unavailable by default. Saved MIDI projects are left
untouched and cannot activate MIDI on these visits. Ordinary game audio is unchanged.

To make MIDI Studio available on mobile, open
[the mobile opt-in link](https://doublemover.github.io/LemmingsJS-MIDI/?midi=1).
Use `&midi=1` when the URL already has query parameters. Exactly one `midi=1` is
required: absent, empty, false, malformed, or duplicate values do not opt in.
The flag exposes the normal controls; it does not grant device permission or
unlock browser audio. Use the listening or device controls to do that.

The gate uses mobile browser/device identity (including desktop-mode iPads),
not the CSS width breakpoint. Rotating a phone does not expose MIDI, and making
a desktop window narrow does not remove it. Change the URL and reload to opt in.
Desktop behavior is unchanged. Mobile device detection is necessarily browser-reported;
a browser that fully disguises itself as a desktop cannot be distinguished.

## Make one sound

1. In **Sounds**, select a readable event such as Spawn, Land, Exit, Build or Dig.
2. Choose one note, a falling/rising phrase, or one pattern note per event.
3. Edit base pitch, phrase spacing where applicable, and level. The contour and
   note names describe the mapping. The active project key is shown separately.
4. **Listen here** auditions that sound using browser tones. **Listen to game**
   follows the real simulation's events and game-clock phrases locally.

Exit and Drown resolve their effective trigger overrides, so the simple editor
changes the voice actually heard rather than an SFX alias hidden by precedence.
Opening a custom chord, scale-degree or clip mapping never rewrites it. Its
unsupported simple fields are disabled with an explicit Custom label; use
**Edit detailed wiring** to retain and edit the full mapping.

**Project** contains the active key/scale, candidate starting palettes, and
save/import/export tools. Choosing a candidate is not applying it. **Devices**
contains optional hardware connection and routing; **Expert** retains detailed
source/track/clip/modulation editing. Stored BPM, meter, quantize and swing are
expert metadata and do not shift gameplay event onsets.

## Local audio and MIDI safety

Local listening owns a separate Web Audio context and local-only output adapter.
It never requests WebMIDI permission or falls back to a hardware output. Entering
local listening turns external output off; any already-owned hardware notes
receive their normal cleanup note-offs, then no new hardware notes are emitted.
External output is not automatically restored afterward. Choosing hardware
output stops local playback. The header reports the current destination once.

Audio unlock happens only in response to Listen. Unsupported audio, denied or
interrupted resume, rapid repeated clicks, cancellation while resume is pending,
level changes and disposal are handled without leaving sounding notes behind.
Stop listening cancels both live and one-shot local audio. Closing the editor
keeps live listening running; reopen it to stop.

The local instrument is a quiet triangle-tone preview with pitch, note length,
velocity, pan and pitch bend. It is not a recreation of an external synthesizer's
programs or timbre. Voices and queued notes are bounded, with a maximum note
lifetime as a safety cutoff. Existing game-clock phrase replacement, pause,
rewind and panic contracts remain in effect for live listening.

Expert **Send MIDI test** controls are explicitly hardware tests, distinct from
local **Listen here**. MIDI device selectors show a disabled connection prompt
until access is available instead of rendering empty dropdowns.

## Event palettes

Major, minor and chromatic palettes support quiet five-note spawn descents and
exit ascents, or one arpeggio note per event. Land is a separate plain note.
Rapid events replace only the matching voice's unsounded tail; sounding notes
retain their note-offs. Pending phrases are bounded to 16 voices with at most
8 notes each. The simulation remains the timing authority. Explicit saved
velocity limits can make a quiet palette louder and are preserved.

## Setup

- Send to MIDI devices: explicitly attaches or detaches external MIDI routing.
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

## Expert workspace

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
