# Game sound editor

Pitch labels use C4 for MIDI note 60; MIDI note 74 is D5.

Choose **MIDI Studio** in the game toolbar. It starts hidden on every page load;
opening it does not enable audio or request device access. On wide screens the
editor docks beside the game instead of covering terrain. Smaller screens use
a bottom editor; short landscape screens switch to an editing view, and Close
returns to the full game. Game controls stay above the play surface and level
arrows stay in the right rail.

## MIDI opt-in

On the normal game page, MIDI Studio, its launcher, MIDI device initialization
and local note preview require an explicit URL opt-in on every browser. Saved
projects stay untouched and cannot activate these routes without it. Ordinary
game audio keeps its separate setting.

To expose MIDI Studio, open
[the MIDI opt-in link](https://doublemover.github.io/LemmingsJS-MIDI/?midi=1).
Use `&midi=1` when the URL already has query parameters. Exactly one `midi=1` is
required: absent, empty, false, malformed, or duplicate values do not opt in.
The flag exposes the normal controls; it does not grant device permission or
unlock browser audio. Use the listening or device controls to do that.

The gate checks the URL rather than device identity or viewport width. Resizing
or rotating a window does not opt in. Change the URL and reload. Procgen has
its own local listening controls; these also require a user action to unlock audio.

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
keeps live listening running; reopen it to stop. Live procgen lane-count, seed
and game replacements release the old router's notes and reconnect the already
unlocked local graph. They do not require another Listen action. Explicit Stop
or Panic cancels that resume intent; browser audio interruption reports an error
instead of silently unlocking again.

The local preview supports pitch, note length, velocity, per-voice pan and pitch
bend. Unspecified legacy previews retain a triangle tone. Ensemble roles use
bounded bass, guitar, lead and percussion profiles built from oscillators or
shared noise, with profile-specific envelopes. These approximate local tones
do not reproduce an external synthesizer's programs. A named `soundFont` URL
request is retained separately from palettes and output selection; sample-bank
loading is unavailable. Voices and queued notes are bounded, with a maximum note
lifetime as a safety cutoff. Existing game-clock phrase replacement, pause,
rewind and panic contracts remain in effect for live listening.

Local cell auditions retain their original spacing beyond the audio scheduling horizon. A bounded queue schedules the next notes incrementally; Stop, Panic, replacement and disposal cancel the remaining tail. Fully elapsed notes after a delayed timer are discarded instead of sounding together on resume.

The existing local master control ranges from mute to 400%; the 70% default and
explicit saved control values remain unchanged. Local output no longer divides
every note by the square root of the configured voice capacity. Compared with
the previous 16-voice preview default, this removes 12 dB of attenuation that
also affected solo notes; the current gate budget is 32.
Choosing 400% still adds 12 dB relative to 100%. These gains affect only local
Web Audio; external MIDI velocities and CC values stay within their existing limits.

One shared signal-driven compressor precedes the existing output ceiling. It uses
a -9 dB threshold, 6 dB knee, ratio 12, 1 ms attack and 80 ms release. A fixed 0.647
output compensation cancels measured low-level compressor makeup independently of
voice capacity. Unsupported compressor contexts retain the ceiling-only fallback.
The Web Audio compressor has [6 ms lookahead](https://www.w3.org/TR/webaudio-1.1/#dynamicscompressor-processing);
source/API timestamps remain distinct from audible output onset.

Local gates are independently owned, including repeated pitches; hardware MIDI
retains its channel/note ownership rules. The default simultaneous local budget
is 32, matching the existing scheduler/project policy. It is not a Web Audio or
MIDI-channel limit. Explicit preview configurations allow at most 64 simultaneous
voices and 96 scheduled sources including release tails; defaults remain 32/64.
Each note uses one oscillator or shared-buffer noise source. Priority and lane
occupancy choose overflow victims; quiet spawn events cannot steal a full set of
higher-priority performance gates. Panic clears voices, gates and queued notes.

Run `node scripts/measure-local-audio.js --url=http://127.0.0.1:8096/procgen.html?e2e=1 --label=review`
against a local review server for 19 bounded compressed/bypass comparisons. Muted
Edge OfflineAudioContext renders measured coherent 32-voice maximum-velocity output
below 0.7 before the ceiling and exact silence after mid-sustain Panic. This is
digital PCM evidence; render cost includes measurement taps and JavaScript callbacks,
and does not establish real-time performance, acoustic quality or physical MIDI receipt.
Compressor behavior may vary across browser engines.

Expert **Output capture** records an existing output session for at most two minutes
and retains the latest 4,096 records. It does not enable listening or request a
MIDI device. Stop capture leaves playback running. Inspect builds a piano roll
and objective summary on demand; JSONL, CSV and the standalone HTML report can
be saved locally. The observer is detached while capture is off.

Evidence separates event requests, accepted API calls, intended/scheduled host
times, local synth scheduling and actual end callbacks. Beat positions use level
simulation ticks and stored base BPM, independently of wall-clock speed. Each
note retains its actual origin, route, pitch, velocity, selected scale and owned
lifecycle where available. Bounded settings references and changed-context
markers identify seed, generation, backend, tempo, local master gain and routing context. Ring
truncation and incomplete lifecycles are explicit.

Inspect can sample the existing local output waveform on demand; RMS and peak
are rendered signal measurements. They do not verify speakers, external MIDI
receipt or acoustic playback. The summary reports density, scheduled polyphony,
register, scale membership, intervals, repetition, API dispatch timing, lane
admission, controller coalescing and open gates; it does not score musical quality
or change notes. A deterministic fake-output fixture is available with
`node scripts/midi-capture-fixture.js`; `--input=PATH` inspects a saved JSONL file.
See [the capture specification](midi-output-capture.md) for the record schema and bounds.
The bounded muted native check in `scripts/midi-capture-native.js` uses an existing
local server and installed Edge, with a 16-cell audition and cancellation check.

Expert **Send MIDI test** controls are explicitly hardware tests, distinct from
local **Listen here**. MIDI device selectors show a disabled connection prompt
until access is available instead of rendering empty dropdowns.

The authored main-game speed slider and +/- shortcuts use tenths below 1x,
integers from 1x through 10x, and tens above 10x through 120x. The slider follows the effective
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

Event cards show stored direct pitches and all temporal cell voices; accessible labels retain cell order and rests. Moving markers show actual dispatched pitches after transforms and routing. Cards hide only skill events known to be
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
- Record: capture MIDI note input into the selected step clip, explicitly choose
  Mono/Poly, Compact/Keep gaps and Replace/Overdub, then Commit or Cancel. These
  controls do not create a second transport or activate an output.
- Output Status: shows recent audition/output activity and scheduler pressure.

## Modifier inventory and counters

The existing owners compose these changes on event notes or bounded clip cells.
They do not run independent note or controller streams.

| Owner | Editable behavior | Timing and limits |
| --- | --- | --- |
| Source mapping | Direct pitch or scale degree/octave; chords and inversion; event arpeggio direction and custom up/down/hold pattern; velocity, duration, pan, timbre and pitch bend | One real event supplies the origin. Legacy chord/arp clips keep their saved semantics until temporal playback is selected. |
| Temporal cell | Rest, deterministic chance, condition, Hold/Tie, pitch, velocity and duration; independent voices | At most 16 cells and 8 voices per cell. Phrase mode retains rests and extends owned voices; event mode treats Tie as a rest. |
| Cell pitch transform | Transpose, octave and cyclic interval ramp | The selected event/bar/pass counter chooses the ramp position. |
| Ordered cell layers | Pitch transforms and repeat layers, with individual bypass and conditions; Earlier/Later reorders them | At most 4 layers. Repeats include the original; count 1-8, spacing 1-8 game ticks and per-repeat transpose. Expansion caps are 16 outputs per cell and 256 per phrase. |
| Spatial modulation | Axis curves and operators for pitch, velocity, duration, pan, timbre and envelope values | Applies to the original event position; these curves remain separate from optional musical spans. |
| Musical spans | Beat/distance intervals, lane/global/group plus optional track scope, constant/ramp, repeat, source filters and target priority | At most 64 spans. Each dispatched phrase cell samples current base-clock beat or completed actor distance. |
| Intensity and envelope modifiers | Global/event intensity, density velocity boost and duration scaling; attack/decay velocity factors, sustain duration factor and release velocity factor | Values stay within the existing ordinary MIDI ranges. These are mapping factors, not programmable local synth ADSR times. |
| Musical tension | Observed population collapse/recovery thins eligible ensemble layers toward a real survivor | Completed simulation observations only; no new notes or changed instrument assignments. |

Counters have distinct meanings:

| Counter | What advances or determines it |
| --- | --- |
| Clip event | Each origin that advances a temporal cell or starts its phrase. Rest/chance/condition suppression still consumes that origin. |
| Clip pass | One event-cell traversal, or the explicitly selected started/completed phrase count. A completed phrase means its final cell was consumed, including rests; note releases can continue. |
| Clip trigger bar | One-based simulation time at base BPM/meter, sampled when the origin advances/starts the clip. Queued repeats keep that origin's bar for cell/layer conditions. |
| Span matching event | Origins that match that span's lane, track, sound and physical-trigger filters. Queued cells retain their origin count. |
| Span musical bar | One-based bar from the current generation-relative base tick position; main levels use tick zero. It is sampled again at queued dispatch. |
| Span loop pass | The interval traversal index at the current beat/world X. It is separate from both clip passes and accepted note calls. |
| Rolling crowd pass | A newly started finite lane/role reply. Repeated collisions coalesce without advancing or replacing that reply. |

Conditions select counter modulo N = phase. Phase 0 selects N, 2N and so on; phase 1
selects 1, N+1 and so on. Cell/layer cadence is bounded to 64; span cadence to 1,024.
Pitch layers run in their saved order before project scale/range mapping. Active
spans then choose one winner per target, followed by eligible tension admission
and the existing scheduler's priority/lane/rate checks. No counter establishes
that speakers or external hardware received a note.

These controls take conceptual inspiration from teenage engineering's
[OP-Z step components](https://teenage.engineering/guides/op-z/step-components),
which combine multiple behaviors on one step; its
[track controls](https://teenage.engineering/guides/op-z/track), which distinguish
note length, playback style and trigger-driven advancement; and
[general operation](https://teenage.engineering/guides/op-z/general-operation),
which separates parameter locks, recording and note cleanup. This implementation
uses its own bounded game-event model. It does not claim OP-Z file compatibility,
all hardware components, external clock synchronization or MIDI 2.0.

For a varied construction clip, keep rests in an eight-cell phrase, add two or
three independent pitches to selected cells, and use one Repeat layer with count 2,
spacing 3 ticks and an every-second-completed-pass condition. A separate Pitch layer
can use a four-event interval cycle. The existing chance, parameter locks and
Tool dialogue spans can then shape different actual action events without turning
every collision into the same pulse. The output caps and project scale/range
still apply; dispatched markers show the result rather than changing entered notes.

## Conflict Checks

The sequencer marks actionable source conflicts in the browser and explains the
selected source in the inspector. Current checks cover duplicate runtime source
keys, missing track or clip references, muted or solo-hidden routes, empty
direct/clip mappings, unavailable output ids when device data is supplied, and
notes that clamp outside the project range.

## Persistence

Main-editor project state is stored in `lemmings.midi.project.v1`.
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

Row notes follow successfully dispatched local voices, showing actual pitches moving left to right through their attack, held level and release fade. Cancelled future notes create no marker; Panic removes active markers. The legacy local triangle has an 8 ms attack, no separate decay and a 40 ms release; ensemble profiles retain their own envelopes. Project envelope controls still scale MIDI velocity/duration; they do not imply synth ADSR timing. Focus/Split/Overlay move the same editor with compositor transforms, retaining focus and playback without resizing the canvas every animation frame.

Event note cells extend reusable clips. Create a clip explicitly from an event, then enter C4/F#4, MIDI numbers or rest, or paint and drag the 8/16-cell grid. One drag is one Undo. Per-cell velocity/duration are parameter locks; chance is deterministic for the same event/pass order. Event advance consumes one cell on each trigger, including rests, and loops after the last cell. A pass is a complete traversal. Game-tick phrase advance starts the cells on each trigger and retains silent-cell spacing. Saved clips default to started-phrase passes. New event clips use completed-phrase passes; the selector makes this explicit. Completion means the final cell was consumed, including silent cells, while sounding notes may still release. Retriggering an unfinished phrase discards its tail without completing a pass. Pause freezes unsounded cells; speed changes affect subsequent spacing. Retriggers replace the unsounded tail and Panic/rewind clear it. Overlapping pitches use the scheduler's existing owned-gate rules.

Existing clips retain their saved chord/event-arp behavior until a temporal mode is explicitly selected. Event mode leaves Hold stored and treats Tie as a rest; phrase mode holds until the next played cell or the bounded phrase end, and ties extend the preceding note. New temporal playback is bounded to 16 cells; longer legacy clips remain stored and editable in detailed wiring. Reduce the length explicitly before selecting temporal playback. Events, pattern passes and trigger bars are distinct. Bar position is one-based level simulation time at the project BPM/time signature (60 ms per base game tick), sampled once when an event advances a cell or starts a phrase. Pause freezes it; speed/benchmark slowdown changes its wall-time rate. Editing BPM/signature recomputes position, and level rewind/restart resets clip counters. Conditions select counter modulo N = phase; phase 0 means N, 2N, and phase 1 means 1, N+1. Chance and conditions also gate Tie extensions. The saved base pitch transform adds transpose, octave and a cyclic interval ramp selected by event/pass/trigger-bar counter. Up to four ordered pitch/repeat layers then run before the existing project scale/range mapping. Each layer has its own event/pass/trigger-bar condition and bypass; Earlier/Later changes the order. Repeat count includes the original, spacing uses game ticks, and each repeat may transpose. Event mode advances one cell per trigger while its deferred repeats use the existing game-tick phrase queue; a retrigger replaces that cell's unsounded repeats. There is no extra clock. Entered grid notes stay editable; moving playback notes show the dispatched result. Local tests have independent event/pass counters and sample the same level bar; an interrupted local test does not complete a pass. No independent transport or MIDI 2.0 implementation was introduced.

Skill-specific Blocker/Builder/Basher/Miner/Digger cards use the same event buttons in a footer beneath their real canvas selector slots. Stage scale and GUI offsets determine placement; narrow canvases use five readable groups. The game still owns selection/assignment inside the original 800×480 canvas. Canvas fitting reserves the footer and shares the HUD's bottom margin on resize, without per-frame layout changes. Unavailable rows remain mapped, and cheats restore them synchronously. Shared nuke/explosion, generic assignment/selection and non-skill events remain in the event browser, also reachable on narrow layouts. Arrow navigation starts from the focused card and crosses both regions.

The game HUD reserves one glyph before OUT and keeps Increase/Decrease labels complete at long tick counts. Minimap hover uses the existing click/drag destination calculation, draws a lighter marching-ants outline without moving the camera, reuses unchanged frames, and clears on leaving the GUI/canvas. Hover changes request the existing GUI redraw so preview cleanup also works while paused.

The compact selected-cell inspector includes Hold and Tie checkboxes. Compact and Expert help follows the selected playback mode; switching modes preserves the saved flags. Editing automation, voice or layer fields retains the matching field focus and supported text caret.

Each temporal cell can hold up to eight independent voices with their own pitch, velocity and duration. The existing grid shows every entered pitch, and the cell inspector adds, edits or removes each voice. Blank dynamics inherit the cell/project defaults. Scalar detailed controls edit the first voice; Rest erases the entire cell. Phrase Hold/Tie extends all voices, including deferred repeats, within the bounded phrase. Actual dispatched row markers retain separate voice gates and pitches. Optional voices/layers survive project import/export; existing scalar clips retain their saved playback behavior.

The grid lights the matching source and clip cell when a note is admitted to output. Its badge shows the resulting pitches after transforms and scale/range mapping, including independent voices and repeats. Another source sharing that clip does not borrow these indicators. Rests, skipped cells and refused notes stay quiet. Replacing the project or pressing Panic clears the indicators.

Record placement, Voices and Write are explicit. Mono + Replace remains the default. Compact notes retains saved note-off ordering and approximate 120 ms duration conversion. Keep gaps snapshots the effective game tick duration and clip spacing at Record, rounds note-on offsets from the first onset to the nearest 8/16-cell position, and omits leading silence. Mono keeps the latest onset in each cell; Poly retains independent pitches and gates up to the eight-voice limit and selects Keep gaps. Note-off order does not change onset placement. Held notes close on Commit in the same timestamp domain. Keep-gaps playback follows game ticks at the current speed.

Keep-gaps Replace rebuilds the entire grid, including rests, and clears old cell modifiers. Overdub changes captured cells only, preserving untouched notes, chance, conditions, Hold/Tie and transforms; a captured pitch already in a cell replaces that pitch's velocity/duration, otherwise it appends within the voice limit. Compact Overdub uses consecutive note-off placements. Capture admits at most 1,024 notes including open gates; it stops admitting more until Commit or Cancel. Commit reports collisions, out-of-grid notes and omitted voices with an actionable status. Cancel leaves the project unchanged.

Expansion retains at most 16 outputs per cell and 256 per phrase; local one-shot tests retain 64 notes. Truncation appears in audition status or existing output pressure. The shared scheduler still applies its owned-gate, priority, lane, rate and Panic policies; the local simultaneous gate budget remains 32. Expanded repeats use the existing game clock and queue, so pause, rewind, retrigger and Panic keep their established cleanup behavior.

The existing scheduler owns one shared physical output budget. Lane reservations include expanded notes and controller/off-message cost, so simulation speed does not create a fresh allowance. Busy lanes receive fair shares; idle shares can be borrowed, and oversized atomic phrases rotate through the least-served lanes. Late note starts are discarded rather than forming a delayed burst. Note-off, sustain release and Panic retain their safety paths. A compact Thinned indicator appears while the budget is dropping sound output; simulation and visual events continue.

Fresh main-game projects and new procgen sessions offer Iron ensemble in D dorian: stable bass, rhythm, melody and percussion roles use ordinary channels 2/3/4/10. Existing stored projects are retained, and switching MIDI on never reapplies a palette. Palette explicitly applies or resets the ensemble. The existing track inspector edits program, channel and voice budget plus role register, pan and duration, with optional per-lemming/lane assignments. Explicit event-track choices override automatic roles. The local preview uses bounded bass/guitar/lead/drum profiles under the existing master ceiling; earlier unspecified previews retain triangle timbre. External MIDI uses the selected device's ordinary programs and channels.

## Procgen musical presets and rolling replies

Procgen retains all original game palettes and adds three starting choices:

| Preset | Fresh musical defaults |
| --- | --- |
| Crowd relay - Dorian bass | Compact bass-register event hooks, two-tick quiet landings and a two-bar crowd reply evolving by 2 semitones before scale mapping. |
| Airy arrivals - Lydian | Spacious modal actions, five-tick quiet landings and a four-bar crowd reply evolving by 4 semitones. |
| Clockwork crowd - harmonic minor | Angular construction, three-tick quiet landings and a three-bar crowd reply evolving by -2 semitones. |

Fresh spawn velocity is 24 with priority 0. Safe landings use four higher arriving
pitches in descending game-tick order, velocity 32 and family-specific duration.
Role register folding and selected scales still apply. Crowd turn/contact defaults
use velocity 18 and priority 0. Explicit existing event velocity, priority, pan,
timbre, pitch bend and envelope edits survive palette application. Initial refresh, re-enable and phrase-mode
edits preserve rolling settings. A deliberate procgen palette selection also
applies that palette's rolling bars/evolution; the helper exposes this solely as
`replaceRollingDefaults: true` (default false). Saved edits can therefore differ
from the fresh-default table. Global velocity minima and track/envelope scales
still affect the final values; a deliberate high minimum is not silently lowered.

Turn/contact collisions start one finite eight-note reply per lane/role, aligned
to the next simulation musical beat and spread over its configured 2-8 bars.
While that reply is pending, further collisions coalesce instead of emitting or
restarting collision notes. A later real collision starts the next evolving reply.
Evolution cycles three offsets instead of accumulating transposition indefinitely.
There is no endless accompaniment when collisions stop. At most 1,024 rolling
entries plus 16 ordinary phrase entries are retained, and no more than 16 rolling
dispatch attempts run per completed tick. Expired cells are dropped rather than
replayed in a burst. The existing shared real-time budget can thin further.

Pause freezes pending cells. Speed changes affect subsequent wall-time spacing;
the actual sent budget history remains shared. Rewind, Panic and a new generation
clear pending replies and their pass state. Generation cleanup releases only old
phrase-owned gates; unrelated direct notes retain their normal ownership. Lane
transfers update current metadata without replaying notes or moving historical
budget charges.

Local lane pan adds a modest default spread to the selected role's pan at each
new note. A single lane remains centered relative to its role. Explicit source,
Viewport/Whole-level, spatial-curve and active span pan take precedence. Existing
voices keep their pan. This uses the local adapter's per-note option and adds no
external channel-wide stereo CC. Shared-channel external spatial pan stays
suppressed by the existing safety rule.

The procgen birth schedule receives fractional beat spacing from base BPM and the
60 ms simulation tick, independent of effective speed. Its seeded lane offsets fit
within the chosen spawn spread and are rounded after quarter-beat subdivision.
Spread 0 remains simultaneous; equal integer offsets are valid when many lanes
share a short spread. Spawn event metadata carries actual birth ticks and nominal phases.

## Span combinations

Start with a named combination in the main Modulation controls or procgen Details,
then Apply. Each choice adds three ordinary editable spans with one saved project
change. Existing spatial curves and spans are retained. The entire addition is
refused when three slots are unavailable; output is never activated by Apply.
Choose simulation beats or world distance before applying. Distance bundles use
512-pixel intervals; beat defaults are shown below.

| Combination | Three simultaneous targets |
| --- | --- |
| Relay - intensity, length and stereo | Eight-beat velocity 40-80 ramp, constant three-tick duration, pan -48 to 48 on every second musical bar. |
| Open air - pitch, length and release | Sixteen-beat scale-safe pitch offset 0-12, duration 3-10 and release-velocity factor 0.7-1.4. |
| Tool dialogue - bash, mine and construction | Eight-beat basher velocity 44-88, miner duration 2-5 and builder pan -42 to 42, with real sound-event filters. |

For a quiet airy arrangement, pair Airy arrivals with Open air. Clockwork crowd
with Tool dialogue separates construction, bashing and mining responses without
raising spawn velocity. Relay intensity applies globally until you select a Sound
event, Physical trigger, lane/group or track filter; restrict it to an action if
you want to retain the quiet spawn default. These are editable starting points,
not measured acoustic-quality claims. Target, range, timing and repeat appear first;
source/cadence/priority refinements remain in the existing advanced editor.

Applying another combination appends its rows. Highest priority wins per target;
later rows win ties, so remove, bypass or raise priority deliberately when
combining overlapping targets. Sound event and Physical trigger selectors show
readable meanings such as Safe landing, Basher clears terrain and Exit trigger;
unrecognized saved IDs remain visible without changing their stored value.

## Musical tension

Iron ensemble offers a saved Musical tension policy in the existing track inspector; procgen Details edits the same policy and displays the selected lane's observed state. New Iron palettes enable it, while older saved ensembles without a policy retain bypass. Thinning amount, healthy crew, fade, establishment, collapse/recovery thresholds and breakthrough distance/hold are editable. Times use base game seconds (60 ms per tick), so pause freezes them and effective game speed changes their wall-time rate.

Procgen and authored main levels supply completed-tick population and frontier observations. The main game publishes one lane after its existing simulation work, using actual spawned, active, saved, exiting and failed actors. Successful exits reduce the established baseline separately from deaths, including the exit animation before the rescue tally updates. A crew must first establish a healthy baseline. Sustained decline then smoothly thins supporting notes and lowers their velocities toward the lowest surviving actor's existing voice. Real recovery or a new frontier/personal-best breakthrough restores the layers. The policy adds no notes, instruments or independent transport. Existing scale/range mapping, explicit assignments, owned gates, MPE/channel safeguards and shared output budgeting remain in force. Fully thinned held layers are cleaned once at the transition. Pause preserves completed observations; level/timer changes and history restores invalidate them until fresh simulation work completes.


## Musical automation spans

Conditions / modulation can turn an existing automation entry into a musical span. The same editor appears in procgen Details, where Add span or Draw on lanes creates an interval for one lane, a lane group or all lanes. Start, length, repeat, constant/ramp shape, track, priority and optional SFX/trigger filters are explicit. Start value and End value use the existing velocity, pitch-offset, pan, duration and timbre targets. The interval strip supports move/resize/draw with one project change on pointer release; canceled drags leave the saved project intact. Hiding drawing or replacing the procgen runtime cancels the draft and releases its canvas pointer capture. Procgen span edits persist through regeneration and reload without enabling listening.

Beat spans use generation-relative base game ticks and the project BPM, with a 16-beat screen timeline in procgen. Distance spans use event world X; queued phrase cells in both main and procgen games use the actor's latest completed-tick position when available, otherwise the status labels the event-origin fallback. Main-game position lookups are constant time and reuse up to 4,096 live-actor records; removed, dying, exiting or uncached actors retain the labeled fallback. Population observations still count the complete active crew. These domains remain distinct. Pause freezes their simulation position. Matching events, one-based project bars and repeated span passes are separate condition counters. Phase 0 means every Nth count. Phrase tails retain their origin event count, while each dispatched cell samples the current beat/distance. Editing values, intervals or cadence keeps matching-event history; changing the matched source resets that span's history. Restart/rewind clears it.

At each actual note dispatch, the highest-priority active span wins per target; later entries win equal priorities. Outside the interval or on bypass, normal mapping resumes. Scale/register clamps, owned notes, channel safeguards and the existing shared output budget still apply. Pan/timbre changes use the existing coalesced controller path on actual notes. No timer, independent transport, autonomous controller stream or MIDI 2.0 implementation is added. Panic cancels pending phrase cells and span-owned voices without advancing counters.

The editor status holds the last resolved value and phase from a matching event or phrase cell; it does not slide that result forward as the transport moves. Last resolved identifies the winning span value, Gated means its condition did not match, and Superseded shows the overlapping winner and its value. Bypassed, outside-interval and waiting states remain explicit. Procgen shows a dim transport preview and a brighter held marker for the resolved winner in the displayed lane. Distance status distinguishes completed actor positions from the event-origin fallback. These labels describe modulation evaluation, not output admission or device receipt. The separate matching-event, musical-bar and span-loop-pass counters continue to use the existing game clock. Panic clears resolved feedback. Up to 64 active spans and 2,048 inspection states are retained; drawing uses bounded rectangles in the existing renderer. Dense loops show one dashed repeated area labeled with the interval length; the editor strip retains exact interval sizing. Draw on lanes explicitly claims the main scene's pointer input, leaving CCTV controls available. Turning it off, hiding rectangles or pressing Escape restores camera input.

Game listening and standalone audition share one bounded browser mix and master gain. Each owns its controls, gates and cancellation; stopping an audition leaves game listening active, while Panic stops both. The preview role picker and explicit actor context reuse the existing ensemble/instrument mapping. A standalone preview labels unavailable live tension, spatial span and rolling-context evaluation.

Main Studio and procgen span checkboxes select several rows; modifier-clicking a name adds it to selection. Previously opened editors on the same page stay open. Rename each span in its own Name field. The selected toolbar changes a common target, values, same-domain interval or bypass state in one project transaction, so one Undo restores the entire common edit. Input identity and text caret survive rendering. Main Studio keeps spatial curves in their existing rows; both views use the same span controls and saved project model. Applying a bundle selects and opens all three new spans, without enabling output. Projects with more than 64 saved spans retain every entry; Previous/Next spans pages render at most 64 rows while the selection remains capped at 64. Existing bypassed entries stay bypassed.
