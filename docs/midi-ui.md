# Game sound editor

Pitch labels use C4 for MIDI note 60; MIDI note 74 is D5.

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
Fire resolves the frying trigger voice. A walker turning at a blocker produces
paired walker/blocker notes; bomber numbers produce five descending notes.
Frequent fire events climb through eight pitches, then alternate the highest two;
a quiet gap resets the run. These follow actual game ticks without quantization.
Opening a custom chord, scale-degree or clip mapping never rewrites it. Its
unsupported simple fields are disabled with an explicit Custom label; use
**Edit detailed wiring** to retain and edit the full mapping.

The **Palette** drawer beside **Listen to game** and local master volume contains
candidate starting palettes and the explicit Apply action. Choosing a candidate
is not applying it. **Project** retains save/import/export and template tools. **Devices**
contains optional hardware connection and routing; **Expert** retains detailed
source/track/clip/modulation editing. Stored BPM, meter, quantize and swing are
expert metadata and do not shift gameplay event onsets.

## Local audio and MIDI safety

**Position pan** in Sounds selects Off, Viewport, or Whole level. Whole level maps
the level's left/right edges to full left/right and clamps off-level events.
Viewport uses the camera position when each event happens, so camera movement
affects new notes. Existing voices retain their pan. Local listening requests
48 kHz and pans each voice separately, even on a shared channel. Spatial pan on
external MIDI uses per-note MPE channels; it is suppressed on shared non-MPE
channels to avoid moving unrelated sounding notes. Explicit static channel pan
remains available in Expert.

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

The local instrument is a triangle-tone preview with pitch, note length,
velocity, pan and pitch bend. It is not a recreation of an external synthesizer's
programs or timbre. Voices and queued notes are bounded, with a maximum note
lifetime as a safety cutoff. Existing game-clock phrase replacement, pause,
rewind and panic contracts remain in effect for live listening.

The existing local master control ranges from mute to 400%. Values through 100%
retain their previous gain, including the 70% default and saved preferences.
Choosing 400% adds up to 12 dB relative to 100%; a local output ceiling controls
dense polyphony. This boost never changes external MIDI velocities or CC values.
Legacy saved levels retain their previous effective gain.

Expert **Send MIDI test** controls are explicitly hardware tests, distinct from
local **Listen here**. MIDI device selectors show a disabled connection prompt
until access is available instead of rendering empty dropdowns.

The game speed slider and +/- shortcuts use tenths below 1x, integers from 1x
through 10x, and tens above 10x through 120x. The slider follows the effective
game timer speed, including benchmark slowdown. Its arrows remain range controls;
Help and game shortcuts continue working while it is focused. The adjacent number
field retains ordinary text editing and permits an exact multiplier. Clicking the
canvas releases focused range controls.

## Event palettes

Major, minor and chromatic palettes support five-note spawn descents and
exit ascents, or one arpeggio note per event. Land is a separate plain note.
Rapid events replace only the matching voice's unsounded tail; sounding notes
retain their note-offs. Pending phrases are bounded to 16 voices with at most
8 notes each. The simulation remains the timing authority. Applying a starting palette uses stronger note and phrase velocities, while
saved project velocity limits and track scales remain unchanged. Opening an
existing project does not reapply a palette or change its notes or levels.

Event cards show stored direct pitches and hide only skill events known to be
impossible from the level inventory. Consuming the last skill does not remove
rows for actions already underway. Cheats restore these rows immediately, and
hiding a card never changes its saved mapping. Nuke warning/explosion and unrelated
events remain visible. Unknown inventory leaves skill rows available.

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

Audible row notes follow successfully dispatched local triangle voices, showing actual pitches moving left to right through their attack, held level and release fade. Cancelled future notes create no marker; Panic removes active markers. The local triangle has an 8 ms attack, no separate decay and a 40 ms release. Project envelope controls still scale MIDI velocity/duration; they do not imply synth ADSR timing. Focus/Split/Overlay move the same editor with compositor transforms, retaining focus and playback without resizing the canvas every animation frame.

Event note cells extend reusable clips. Create a clip explicitly from an event, then enter C4/F#4, MIDI numbers or rest, or paint and drag the 8/16-cell grid. One drag is one Undo. Per-cell velocity/duration are parameter locks; chance is deterministic for the same event/pass order. Event advance consumes one cell on each trigger, including rests, and loops after the last cell. A pass is a complete traversal. Game-tick phrase advance starts the cells on each trigger and retains silent-cell spacing. Saved clips default to started-phrase passes. New event clips use completed-phrase passes; the selector makes this explicit. Completion means the final cell was consumed, including silent cells, while sounding notes may still release. Retriggering an unfinished phrase discards its tail without completing a pass. Pause freezes unsounded cells; speed changes affect subsequent spacing. Retriggers replace the unsounded tail and Panic/rewind clear it. Overlapping pitches use the scheduler's existing owned-gate rules.

Existing clips retain their saved chord/event-arp behavior until a temporal mode is explicitly selected. Event mode leaves Hold stored and treats Tie as a rest; phrase mode holds until the next played cell or the bounded phrase end, and ties extend the preceding note. New temporal playback is bounded to 16 cells; longer legacy clips remain stored and editable in detailed wiring. Reduce the length explicitly before selecting temporal playback. Events, pattern passes and trigger bars are distinct. Bar position is one-based level simulation time at the project BPM/time signature (60 ms per base game tick), sampled once when an event advances a cell or starts a phrase. Pause freezes it; speed/benchmark slowdown changes its wall-time rate. Editing BPM/signature recomputes position, and level rewind/restart resets clip counters. Conditions select counter modulo N = phase; phase 0 means N, 2N, and phase 1 means 1, N+1. Chance and conditions also gate Tie extensions. A pitch layer adds transpose, octave and a cyclic interval ramp selected by event/pass/trigger-bar counter before the existing project scale/range mapping. Entered grid notes stay editable; moving playback notes show the dispatched result. Local tests have independent event/pass counters and sample the same level bar; an interrupted local test does not complete a pass. No independent transport or MIDI 2.0 implementation was introduced.

Skill-specific Blocker/Builder/Basher/Miner/Digger cards use the same event buttons in a footer beneath their real canvas selector slots. Stage scale and GUI offsets determine placement; narrow canvases use five readable groups. The game still owns selection/assignment inside the original 800×480 canvas. Canvas fitting reserves the footer and shares the HUD's bottom margin on resize, without per-frame layout changes. Unavailable rows remain mapped, and cheats restore them synchronously. Shared nuke/explosion, generic assignment/selection and non-skill events remain in the event browser, also reachable on narrow layouts. Arrow navigation starts from the focused card and crosses both regions.

The game HUD reserves one glyph before OUT and keeps Increase/Decrease labels complete at long tick counts. Minimap hover uses the existing click/drag destination calculation, draws a lighter marching-ants outline without moving the camera, reuses unchanged frames, and clears on leaving the GUI/canvas. Hover changes request the existing GUI redraw so preview cleanup also works while paused.

Record placement is explicit. Compact notes preserves legacy note-off ordering and approximate 120 ms duration conversion. Keep gaps supports the bounded 8/16-cell grid, snapshots the effective game tick duration and clip spacing at Record, and rounds note-on offsets from the first onset to the nearest cell. It replaces the entire grid with notes/rests and clears prior cell modifiers; no leading silence is stored. The latest onset wins each monophonic cell (last received note-on breaks simultaneous ties), even when note-offs arrive in a different order. Duration uses the snapshot, so overlapping lengths remain; held notes close on Commit in the same timestamp domain. Playback uses game-tick phrase mode at the current game speed. Commit reports replaced same-cell notes and omitted notes beyond the clip. Cancel leaves the project unchanged. Full polyphonic/chord capture and overdubbing remain future work.

The existing scheduler owns one shared physical output budget. Lane reservations include expanded notes and controller/off-message cost, so simulation speed does not create a fresh allowance. Busy lanes receive fair shares; idle shares can be borrowed, and oversized atomic phrases rotate through the least-served lanes. Late note starts are discarded rather than forming a delayed burst. Note-off, sustain release and Panic retain their safety paths. A compact Thinned indicator appears while the budget is dropping sound output; simulation and visual events continue.

Fresh main-game projects and new procgen sessions offer Iron ensemble in D dorian: stable bass, rhythm, melody and percussion roles use ordinary channels 2/3/4/10. Existing stored projects are retained, and switching MIDI on never reapplies a palette. Palette explicitly applies or resets the ensemble. The existing track inspector edits program, channel and voice budget plus role register, pan and duration, with optional per-lemming/lane assignments. Explicit event-track choices override automatic roles. The local preview uses bounded bass/guitar/lead/drum profiles under the existing master ceiling; earlier unspecified previews retain triangle timbre. External MIDI uses the selected device's ordinary programs and channels.
