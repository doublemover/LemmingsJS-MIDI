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

Position modulation uses normalized spatial positions from 0 to 1, not beats.
Curve points interpolate between the configured min/max endpoints. Note offsets
add in lane order; other destinations use the last enabled mapping, and explicit
per-event values take precedence. Old out-of-range curve positions are ignored.

## Characters

Characters offers Classic, one selected body, or a stable random mix of the eleven
verified bodies. Mixed choice is a pure function of stable actor ID. Pool reuse,
redraw, and replay object reconstruction do not consume RNG or write appearance
fields into simulation state. Frames are shared across actors; classic mode does
not load alternate manifests. The reviewed Hydro beret/landing art is preserved.

Custom palette is opt-in and user-chosen. Body/prop colors remap named indexed
slots while retaining alpha, eyes, outlines, tool colors, native dimensions, and
animation timing. No additional palette has been labeled user-approved.

## Acceptance still needed

The cloud's browser launch is blocked by socket restrictions. DOM/core tests and
recorded source checks are not a visual playthrough or listening acceptance.
Run a browser smoke on the final branch before merging:

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
- Horizontal flip, rotation, and one-way inspector fields are disabled because
  the current runtime ignores them. Imported fields remain preserved in NXLV,
  with explicit runtime warnings. Steel resizing remains available.
