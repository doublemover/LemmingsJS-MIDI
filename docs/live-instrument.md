# Live level instrument

Open **MIDI Studio** on desktop. The original game canvas stays mounted in every
layout: **Split** gives game and sound controls comparable space, **Focus** widens
the sound controls, and **Overlay** places the controls over the right side of the
game. Map zoom, the selected event, and game state are independent of the layout.
Mobile continues to require the explicit `?midi=1` opt-in.

## Hear, select, change

1. Choose **Listen to game** to monitor the game with browser audio. It requires
   an audio gesture but no MIDI permission or device. This monitor switches off
   external MIDI to avoid doubling the live performance.
2. Choose **Build** in Events. Activity counts and the headunit show recent events
   without selecting them or stealing the event you are editing.
3. Choose **Event steps**. Each build event advances one note. The next-note marker
   follows the running router. **Rising phrase** and **Falling phrase** instead
   start a phrase, spaced in simulation ticks; another event replaces only the
   unsounded part of the same phrase.
4. Adjust pitch, velocity, duration, or pan using the sliders or exact values.
   Duration shows the effective project-limited ticks and milliseconds at the
   current game speed. Explicit sound pan overrides position panning for that
   sound. Local monitoring uses short triangle tones; it does not emulate a MIDI
   synthesizer's timbre or envelope CCs, and local tones are capped at eight seconds.
5. **Test event locally** auditions the sound on a separate local audio path. It
   does not advance the game, change MIDI enablement, or send the test to external
   devices. Repeated event-step tests advance an independent audition cursor.
   Position-dependent and special countdown/fire behavior is best heard in the
   running game; the isolated test has no actor position or countdown state.

Game speed changes simulation tick duration. The tick readout is the actual game
clock; stored BPM does not quantize gameplay. Release rate is a separate game
control. **Stop / Panic** pauses the game and silences monitor, audition, and MIDI
notes; **+1 tick** pauses and advances one simulation tick.

## Scope and editing

The event-to-track route is named next to the sound. **Inspect destination track**
opens that track without reassigning the event. Track selection and clip selection
are inspection operations; the explicit Assign buttons change routing. The same
sound-control DOM stays available in the Tracks & clips view.

Undo and redo cover music edits, with a slider drag treated as one gesture. They
preserve the current UI selection and MIDI connection enablement and do not touch
game time, commands, terrain, or replay. **Keep as reference** and **Revert to
reference** are scoped to that event's sound and enabled state, not its output
track. References last for the session; Save Template or Export preserves music.

File, Edit, View, and MIDI menus expose project operations, undo/redo, layouts,
and device setup. A project import replaces the project; a palette replaces only
event mappings. Malformed/unrelated and future-version project files are rejected.
Portable templates strip both project and per-track hardware output identifiers.

The instrument menus retain native disclosure semantics. Arrow Up/Down opens a
menu and moves through available actions; Left/Right switches menus, Home/End
selects an endpoint, and a letter selects an action by its label. Escape returns
focus to that menu's heading. Outside pointer actions, focus departure, window
blur, and closing Studio dismiss open menus. An action that opens/focuses another
view keeps that destination; other actions return focus from the closed popup.

Position modulation uses normalized spatial positions from 0 to 1, not beats.
Curve points interpolate between the configured min/max endpoints. Note offsets
add in lane order; other destinations use the last enabled mapping, and explicit
per-event values take precedence. Old out-of-range curve positions are ignored.

## Characters

Characters offers Classic, one selected body, or a stable random mix of the twelve
verified bodies (including the literal transparent-center donut). Mixed choice is a pure function of stable actor ID. Pool reuse,
redraw, and replay object reconstruction do not consume RNG or write appearance
fields into simulation state. Frames are shared across actors; classic mode does
not load alternate manifests. The reviewed Hydro beret/landing art is preserved and fitted to every body. All
normal donut poses and landing frames retain an enclosed transparent aperture.

Nine named native body colors and eleven named hat/prop colors are available,
alongside the original Hydro palette and custom inputs. Body/prop colors remap indexed
slots while retaining alpha, eyes, outlines, tool colors, native dimensions, and
animation timing. No additional palette has been labeled user-approved.

Alternate bodies support all eight native accessories: headphones, bow tie,
beanie, hat, beret, bulb, tuft and crown. Choose exactly one (or None); selecting
headphones or a bow removes the beret. Eyewear is separate: monocle, tall oval
frames, separate trapezoid lenses, classic sunglasses or round sunglasses.
This follows the native “Select at most one accessory” contract. The supplied
108 presets contain at most one accessory, and 33 explicitly pair it with eyewear.
Body, accessory and eyewear frame colors are independent. Lens and ear-pad
material stays separate from color controls. Extra packs load only when selected,
and Classic disables the choices without erasing saved selections.

Accessories follow the current body pose and stable actor appearance; they add
no simulation fields. The approved beret still lifts/opens/reattaches. Other
accessories remain attached while the separate floating canopy opens, then follow
the normal walking pose. Ear/donut crown adaptations are explicitly custom where
native recipes do not exist. Current decoder proofs include every body and named
color plus turn, climb and float. New accessory fits and in-game appearance still
need user visual acceptance.

## Acceptance still needed

The cloud's browser launch is blocked by socket restrictions. DOM/core tests and
recorded source checks are not a visual playthrough or listening acceptance.
The existing GitHub CI on 97128aff passed its smoke, coverage, and registry audit
(0 vulnerabilities). It did not run the new workbench visual acceptance.
`e2e/instrument-workbench.spec.js` adds focused layout/undo/mobile checks to the
source harness without expanding CI jobs. Run a browser smoke on the final branch
before merging:

- At 1600×1000 and 1024×768, open each layout repeatedly. Confirm one live canvas,
  visible top-left game area, readable values, no cropped controls, and unchanged
  zoom/selection. Close/reopen retains layout and selection.
- Play a level with Build events, turn on local listening, select Build, choose
  Event steps, and edit pitch/velocity/duration. Confirm the audible result,
  next-trigger marker, and event activity. Pause and change speed; verify the
  headunit and future phrase timing.
- With external MIDI enabled, Test event locally must produce zero hardware
  sends; gameplay should continue sending to its configured route. Use Panic and
  confirm no later queued notes restart. Physical MIDI timing remains unverified.
- Tab through menus, response choices, sliders, numeric inputs, source/track/clip
  selection. Use arrows, Escape, Undo/Redo, and import failure paths. A native
  screen-reader pass remains unrun.
- Try Classic, Hydro, each additional body, and Mixed. Rewind and reload; confirm
  stable shapes and the original game's movement, collision, and skill behavior.
- On a mobile user agent without `?midi=1`, confirm MIDI and local audio remain
  hidden/inactive without changing saved projects.

Remaining larger work is tracked only in `docs/roadmap.md`.

The Expert clip inspector explains the current note-list playback: Steps and
Chord supply simultaneous notes, while Arp advances on game events. Empty cells
do not create delays. The first playable step supplies the shared base velocity
and duration. Hold is retained in project data without a playback effect;
positive probability enables a note and zero omits it; Tie omits its step rather
than extending a previous gate. The controls and exports preserve those values.
Recording captures note data into cells without replaying timing gaps or
overlapping voices. This clarification does not implement the pending temporal
clip/recording contract.


## Editor and MCP safety repairs

The integrated branch also fixes several adjacent workflow defects:

- `skill.apply` uses the skill shortcut's existing single-application contract.
  It no longer presses Apply a second time after the last requested skill causes
  automatic selection of the next available skill. Same-skill successful
  applications are logged even when selection itself is unchanged.
- Editor dry-run skips mutation operations, including tools, selection, brush,
  palette, history, saved-level writes, UID assignment, auto-fix, and preview
  refresh. Results mark writes as skipped. It reads/validates the existing level;
  it does not simulate the proposed sequence or fully validate skipped arguments.
- Entry creation retains supplied flags, dimensions, MIDI metadata, and other
  properties with normalized names. NXLV round-trip preserves them.
- API text/saved-level loads refresh the visible header fields.
- Debug summary and selected-actor reads no longer mutate their source population.
  Asynchronous editor results and errors are awaited before serialization.
- Terrain horizontal flip now mirrors both rendered pixels and collision masks.
  Gadget horizontal flip, rotation, and one-way inspector fields remain disabled
  because the current runtime ignores them. Imported fields remain preserved in NXLV,
  with explicit runtime warnings. Steel resizing remains available.


## Voice ownership and device programs

Track inspectors accept an optional device program **0–127**. Blank keeps the
current device patch. Programs are channel-wide device choices, so tracks sharing
one channel must intentionally agree on the patch. Local triangle-wave preview
has no program bank and never sends program changes to hardware.

Future MIDI onsets/releases remain in the scheduler's cancellable host queue
until due. Panic, voice stealing and same-pitch retriggering invalidate obsolete
gates before they reach the device. A MIDI 1.0 retrigger closes the old gate for
that output/channel/pitch and the newest note owns its release. This repairs
stale note-offs and MPE bend resets; it does not claim measured hardware latency.
Browser timer jitter and physical playback still need acceptance.

The revised berets use native per-shape picker masks and placement recipes.
Eleven additional bodies use four pixels of cosmetic top padding with a matching
negative drawing offset. Original body/world anchors, action frame counts and
collision simulation remain unchanged. Hydro triangle keeps its original art.
The twelve accepted fits are pinned by SHA-256 in the source asset tools. Native
recipes do not provide berets for the two ear bodies; their reviewed custom fits
and the donut's ring-specific placement are identified explicitly.
