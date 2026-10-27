# ProcGen workstation

Open `procgen.html` through the local web server (`npm start`). Eight lanes share
one physical world. Each starts with its own classic tileset and visual role:
Crystal/Lead, Bubble/Arp, Dirt/Bass, Rock/Percussion, Fire/Drums, Brick/Chords,
Snow/Melody and Pillar/Texture. Sound remains off until **Listen locally**.

New projects play from committed physical facts. Builder work, ordinary wall
contacts, and the first crossing of x=40 have explicit instrument mappings;
none requires a phrase cell. The **Physical** inspector lists each mapping and
lets you change its pitch, velocity, or mute state. Changes carry a graph
revision and affect later facts. **Listen locally** enables the owned browser
audio voice session; game preview, MIDI routing, and physical voices share the
audio graph without sharing note ownership.

## Editing

Choose **Strip** or **Overlay** to position lane controls around the terrain.
Physical lanes show a live cause strip. Select a lane header to edit its
collection, role, routing, and physical mapping. Mute and Solo remain lane
controls. Global key and scale are in the transport header.

Use **Complementary pattern** only when you want an authored clocked layer.
Each such lane records its physical purpose and has four phrase slots. Draw and
Erase edit cells; double-click toggles a trigger. With pattern focus, the default
arrow keys move step selection, Delete clears a step, and Ctrl/Cmd+C, V, Z and
Shift+Z copy, paste, undo, and redo phrase edits. A fixed MIDI note overrides a step's scale degree;
leave it empty to follow the global key. Drums use General MIDI drum notes.

For a complementary lane, phrase buttons queue playback for the next bar.
Duplicate copies the selected phrase into the following slot. Step and Chord inspectors expose
velocity, gate duration, probability, conditions, repeats, tie/hold, chord
degrees, inversion and spread. Probability uses a deterministic musical stream.
Terrain/action conditions use observations from the selected lane.
Action matches include current living actors; terrain matches sample the foremost
living actor's support and nearby contacts. Unbuilt terrain is not classified as
a gap. Available matches are labeled in the inspector.

The Automation inspector edits controller curves as `position:value` points,
with beat or world-distance positioning. Mute and Solo operate on whole lanes.
Imported spatial curves retain their normalized physical-world coordinates.
The endless world's horizontal extent is very large, so use distance spans or
distance-based CC curves for changes over a short terrain run.
The physical height remains 144 pixels by default; display row sizing does not
change the world. Larger projects retain all lanes while editing controls are
virtualized.
Use the footer's lane range and paging arrows, or scroll the lane headers, to
reach offscreen lanes. Page Up/Down also changes the visible group.

## Timing and MIDI

New projects use 120 BPM and 1×. In BPM mode, music controls the linked simulation
speed. In Game speed mode the multiplier controls the simulation and linked
musical tempo. Clear **Link world** to control the two independently. The header
shows requested and measured simulation speed separately; musical time does not
slow to hide simulation overload.

The BPM field edits the base tempo in internal-clock modes; effective tempo is
shown in **Status details** alongside the world multiplier. With external clock,
the field reports the observed tempo and remains read-only.

The operational strip separates **Play/Pause world**, musical transport,
browser context and the named note destination. **Stop music** stops musical
transport; **Panic** uses the existing output safety owner. A single prioritized
reason explains silence, clock loss, unavailable output or unsaved recovery.
Open **Status details** for exact timing and independent note, clock and controller
evidence. A connected port does not establish controller liveness or audible
delivery; bridge health remains unreported unless the backend supplies evidence.

Selecting MIDI output requests no permission by itself. Choose **Discover MIDI
outputs**, review a named destination in the selector, then **Activate MIDI
output**. Discovery sends no notes or setup to an unselected destination, even
when only one device exists. Names include endpoint IDs to distinguish identical
devices. Losing the reviewed endpoint stops output; reconnecting preserves the
reviewed identity and requires explicit activation. It never selects the first
enumerated device or falls back to another endpoint. Permission denial, an empty
catalog and a lost endpoint have distinct explanations. No hidden test note is
played to manufacture a successful status.

Native dialogs include **Stop music** and **Panic** controls that use those same
output owners. Pointer activation preserves the current text draft and does not
submit its form. Output safety cancels a captured edit before release; it remains
available while a dialog makes the outside toolbar inert.

World pause status comes from the simulation runtime, including an actual hold
while music continues. A suspended browser context offers explicit Resume rather
than a generic engine-error action. Controller details retain the ingress epoch,
observation domain and observation age at the last report; that evidence remains
separate from external-clock waiting/loss and bridge health.

An isolated lesson is offered only when its installed application capability is
available. Source preview instead offers the existing physical-mapping review.
Opening the lesson explains a cause without loading its setup or sending a test
note; loading a setup remains a separate explicit action.

The MIDI inspector keeps **Last request**, **API submission** and unknown receiver
state separate for Sustain, Pitch bend and Pressure. Unknown starts blank rather
than at zero. Requests survive ordinary rerenders, tab changes and the first Save;
changing document, endpoint generation/epoch or channel invalidates the old
target. An explicit offline request remains visible as unconfirmed and is never
automatically replayed when a device reconnects. These are channel requests, not
receiver readback or proof of sound. Stage permits reading the evidence while
blocking mutation.

While the initial world prepares, output activation waits and Panic remains
reachable. An initial preparation failure has its own visible reason and offers
the existing **Start fresh session** action. A late startup error cannot replace
the state of a successfully published world.

The MIDI inspector connects devices, selects the input and a lane's note output,
assigns its channel, and chooses a separate clock output. **MIDI Thru** starts off.
Selecting external clock makes received MIDI the timing authority. Clock loss
pauses playback; synchronization must be re-established with transport messages.
Song Position Pointer changes musical position without rewinding the world.
Timing uses 24 pulses per quarter note. See the
[MIDI Association message reference](https://midi.org/about-midi-part-3midi-messages)
and [Web MIDI API](https://www.w3.org/TR/webmidi/) for protocol details.

Record captures input and accepted output. Input notes edit the selected phrase;
MIDI export saves the recorded performance as a Standard MIDI File. The inspector
also exposes bank selection, sustain, pitch bend, pressure and MIDI learn.
The recording buffer stops accepting events at its capacity while playback
continues. The Record control marks a partial take, and MIDI export names it
`procgen-performance-partial.mid`. Export includes a small MIDI text manifest
with the retained sequence/time range, first lost sequence, drop categories,
capture evidence and unmatched note counts. Unmatched Note Ons and Note Offs
are omitted from the exported window; the exporter does not invent releases.
Stopping while input or output notes remain open likewise marks the take
incomplete. A near-cap state appears on the Record control at 80% capacity.
Project and MIDI export show “Download requested” after the browser anchor
clicks. The app cannot tell whether the browser saved the file; check the
browser's downloads before relying on a local copy.
The footer's **Retry file** button requests the same prepared bytes again after
an export. On browsers with a file picker, **Save file** streams those same
bytes to the selected handle and reports when the writable stream closes. It
does not prove physical disk durability. Neither action recaptures the world
or changes the MIDI take. Preparing a
new export replaces the previous one; closing the workstation discards it.
Prepared browser exports have a 128 MiB staging limit and expire after ten
minutes. A failed download request leaves the file ready to retry.
Conflicting programs or controllers on a shared output/channel are reported.
Panic clears queued output and releases active notes.

Restored held notes resume with their remaining gates. Browser synthesis avoids
replaying their attack; external MIDI must send a new note-on to re-establish a
voice, so its attack behavior depends on the receiving instrument.

Worker wakeups supply transport timing independently of animation frames. Browser
suspension and missed scheduling deadlines stop playback and release notes; they
do not replay accumulated events. Browsers and operating systems may still
suspend background audio or timers.

For the deferred physical-device check:

1. Select a note output and a clock output, leave Thru off, and synchronize a
   receiving DAW or sequencer to ProcGen at 120 BPM. Check Start, Stop, Continue
   and several tempo changes while listening for drift or stuck notes.
2. Select the external MIDI input as clock authority and make the other device
   the master. Reposition its song and verify that musical position follows
   while the terrain and actors stay in place.
3. Disconnect or stop sending clock. Verify that playback and the linked world
   pause. Reconnect and verify that playback waits for Start/Continue rather
   than unexpectedly restarting. Finish with Panic and confirm silence.

Automated port fixtures verify message handling; they cannot establish the
latency, jitter or sound of a particular device and cable setup.

## Projects and worlds

**Save** stores a named project in this browser's IndexedDB. **Load** lists named
projects and the latest recovery checkpoint. **Export** writes a portable
`.procgen.json` file; **Import** restores one. Browser storage belongs to the
current origin, so export important projects before changing server ports or
clearing site data.

Version 1 Game/Hybrid setups are never silently interpreted as physical
projects. A previous local setup shows a conversion button with the number of
enabled phrase steps it would discard. Importing or loading a legacy session
asks for the same explicit physical conversion; the source file or saved
record is left untouched. The converted project declares schema version 2 and
contains the default physical graph. Complementary pattern lanes can then be
authored separately.

A project includes music, automation, mix, routing choices, transport, camera,
actors and current action frames, edited terrain, generation/reveal progress,
crew plans and random state. Capture occurs between completed simulation ticks.
Load validates a temporary world before replacing the open one, restores paused,
and leaves output silent until playback resumes. Timers, render caches and device
connections are rebuilt. Missing or incompatible terrain assets reject the load.
Checkpoint graph version 2 preserves signed zero and nonfinite floating values
through JSON export. Older browser checkpoints with intact numeric values remain
readable; an older JSON export that converted a typed value to `null` is rejected
because its exact simulation state cannot be recovered. The footer reports crash
recovery separately from named Save, including the last durable edit revision.
Recovery writes rotate two checksum-verified generations with an atomic head
record. Opening recovery chooses the newest valid committed generation and falls
back to the previous one if the latest payload is corrupt. Checksumming the
detached snapshot yields between bounded slices; capture of the live world graph
still runs on the main thread and can cost more than one frame for large worlds.

**New** creates a default composition and a fresh world through the same
versioned fresh-start resolver used by `?startup=fresh`. **Reroll world** keeps
the composition and changes the seed. **Replay seed** rebuilds the current seed's
starting world. Explicit seed URLs remain reproducible; ordinary visits and new
runs receive fresh seeds. Play resumes the existing world.
Automatic run resets derive a different seed from the saved run state, so a
loaded checkpoint continues through the same subsequent worlds.

Startup resolves one immutable plan before asset preparation. Shared recipes
use versioned defaults for omitted fields, including decoration, population and
worker policy; unrelated previous setup preferences cannot fill those gaps.
Explicit physical recipe fields conflict with document/recovery launch modes
and duplicate launch fields are rejected. The plan exposes presence, source and
field provenance separately from live output ownership.

`?startup=document&document=<id>&documentRevision=<revision>` opens that local
document revision; an omitted revision opens its current stored revision.
`?startup=recovery` opens a checksum-verified recovery, or reports that none is
available. Both use the existing validated load transaction and restore paused.
They reject conflicting seed/lane overrides. `?startup=previous-setup`
deliberately reuses a compatible musical setup with a new physical seed.
Document IDs address this browser's local store; they are not portable recipes.
Input selection, clock output, recording and thru are reset on document load.

Initial preference writes wait for a committed world. Later world candidates
also defer preference publication until commit or a completed rollback. An
invalid source, canceled startup or rejected recipe cannot overwrite the prior
recoverable setup while assets prepare. Startup source reads have a bounded
deadline and navigation cancellation. Added resolver/controller/browser
fixtures remain unexecuted during the frontloaded implementation pass.
An invalid startup offers an explicit **Start fresh** action. That action opens
the versioned fresh defaults and removes the failed recipe/document query;
there is no automatic fallback that could be mistaken for a restored source.

Project import parsing and export JSON encoding use registered background jobs.
Admission reserves estimated source, staging and result overlap before reading
an import or capturing an export snapshot. Jobs carry the document generation
and edit revision; an obsolete result cannot publish into a replacement
document. Computed results release their worker slot while retaining their
memory lease through load/artifact publication. Data is copied as an owned
snapshot; this path never transfers or detaches live world buffers.

The job protocol registers JSON parsing, JSON encoding, recovery checksums and
asset hashes. Worker jobs are bound to the executing build when generated
application identity exists. Without workers, only small bounded JSON jobs and
native byte hashing are admitted; a large synchronous parse is not described
as cancellable. Recovery checksumming also has a bounded cooperative fallback.
Snapshot capture itself still runs at a completed main-thread boundary.

Recovery uses the same admission owner before invoking its snapshot factory.
The checksum and atomic generation write use one private snapshot. Its revision
and completed simulation tick are captured when the admitted snapshot is taken.
Closing storage cancels owned checksum/commit work. Recovery reads inspect one
candidate generation at a time, admitting its payload before checksum work;
temporary worker or capacity failures are not reported as corrupt recovery.
Automatic recovery startup requires a checksum; legacy source records remain
available through explicit legacy loading.

FileProvider binary verification uses the same boundary before copying hash
input. It keeps WebCrypto native, retains raw-byte leases until digest work
settles and shares an immutable generation's existing hash promise. Content
coalescing across independent jobs, broader terrain decode execution and
measured live-load qualification remain follow-through work. New fixtures are
unexecuted.

Document selection and startup recovery use owned source handles. Their
checkpoint payload remains reserved through validation, asset preparation and
world publication; canceled or late reads release their own handle. Navigation
cancellation also reaches the initial world's preparation lease. Once restored,
the workstation keeps a weak session identity marker rather than a second
strong checkpoint reference. Convenience storage reads remain available for
explicit legacy consumers; primary application flows use the owned interface.
At computation completion, conservative retained-payload estimates replace
temporary worker/staging peaks. A canceled computed result remains charged until
its consumer acknowledges release; cancellation cannot free memory that a world
load still owns. Source revocation reaches the candidate world's cancellation
signal. Compute deadlines end at the computed boundary; source publication has
its own explicit lifetime.

The World inspector controls trap spacing and display row height. Playable terrain
assembles near approaching actors; camera movement does not build distant terrain.
Farther scenery is visual only and uses staggered, world-anchored dithering.
Reduced-motion preferences use static reveals. The solver rehearses bounded
build/bash/mine chains and measures follower crossings; it allows occasional
losses and does not interpret an exhausted search budget as proof of impossibility.

Implementation milestones and validation evidence live in
[the roadmap](roadmap.md#procgen-performance-workstation-october-12-2026).


Prepared physical scores support a local rehearsal before publication. First
enable browser audio and choose a route in Prelisten. **Rehearse locally** copies
the unadvanced candidate into an independently owned world, observes a short
physical phrase and renders its pinned lane sounds and static mix. It does not
advance CURRENT or NEXT. **Stop rehearsal**, source handoff, Stop and Panic retire
its playback. Loading the scene still publishes the original candidate paused.

The preview uses the selected monitor route: **Rehearsal on live output** is
included in master capture, while **Separate device** is excluded. The source
receipt identifies a new private-world rendering; it does not reconstruct a
historical performance or certify acoustic output. Initial rehearsal admission
supports up to eight local assetless lanes. Sampled and shared-body scenes need
additional complete material adapters. Independent render, listening and device
qualification remain pending.


The seed lab's **Observed travel audio → modal body** recipe requires an actual
committed local signed-axis journey mapping. Select that mapping, set original
source frames per world pixel and declare the body's tuning independently.
The physical editor can stage a suitable mapping for review and saving. Actor
motion drives the frozen source cursor; stopping motion stops new body excitation
while its existing tail decays. Direction reversal traverses the source back under
the same semantic voice. Reflection is driven by observed coordinates and is not
a background loop. Missing/discontinuous travel follows the existing end-voice
policy. The compact anatomy keeps EXCITER, BODY and PICKUP/MIX separate, and saved
patches retain exact component and traversal references. Audition uses an explicitly
labeled control fixture; actual physical rendering and listening remain unqualified.


The physical score browser offers **Learn this physical cause** for all five
installed practice setups: **One Foot, One Sound**, **Space Becomes Rhythm**,
**Work Becomes Percussion**, **Path Becomes Delay** and **Crowd Becomes Harmony**.
First load Quiet Control and explicitly Play: no actor must mean no new onset.
Load the lesson setup paused, write a prediction, observe the unchanged baseline,
then perform the displayed cause through the existing physical controls. A
changed request alone is not success. Reset loads a fresh empty control; Back
and Skip leave free exploration available. The panel sends no gameplay command
and never enables audio for you.

The work setup has a finite two-entrant bench and manual skills. Its quiet
walking baseline leads to an explicit builder/miner assignment. Two actual
changed-solid work operations must name the accepted manual command, action
instance, operation and contact phase. Appearance-only repainting, animation,
SFX and rejected skills do not satisfy this mapping. This is a small teaching
bench, not the full multi-material Builder-Miner Workshop orchestration.

The path setup begins with a direct surface and one finite entrant. In Junctions
request **stepped**, then wait for actual safe application. Release a fresh
entrant with the same entry spacing. Success requires its observed travel to
be longer and its birth-to-arrival duration to differ at the same fixed pickup.
A pending/expired/rejected switch cannot count. These are authored candidate
routes; their playability and measured traversal envelopes await runtime review.

The crowd setup uses three finite entrants and a just pentatonic field: ratios
1, 9/8, 5/4, 3/2 and 5/3, with degree zero represented by 6900 cents against a
220 Hz reference. Actual formation chooses each actor's pitch. After the first
flock leaves the field, change finite release spacing and perform another
three-entrant phrase. Birth spread, spatial spread and assigned pitches must
all differ, with actors observed together in the field. Then keep that physical
policy, change **BRIGHTNESS** through the sound controls and explicitly release
a later attack. Brightness affects later excitation; the macro creates no onset.

Physical evidence, accepted sound and your optional report of hearing are shown
separately. The sound-off path does not verify hearing. Progress is stored apart
from projects; denied storage falls back to the current session. Replaying a
lesson requires a fresh observed attempt. All five implementations have authored
fixtures; runtime, browser/accessibility/controller, listening and usability
qualification remain pending. Advanced material/memory journeys remain open.


An authored physical score can pin an optional initial terrain layout: bounded
ordered solid, air and steel rectangles, with explicit pixel colors and physical
lane dimensions. Preparation compiles and checks the actual collision and raster
source before constructing a candidate world. It uses shared worker admission;
there is no heavy UI-thread fallback or silent replacement with another floor.
The initial extent has no generated physical gadgets or growth clock. The base
terrain remains available beyond that finite extent. This source format is a
building block for the authored practice worlds and remaining larger performances;
source preparation alone does not qualify their playability.

Scored recovery retains the complete bounded source layout as well as its hash,
installed themes and lane seeds. Independent inspection/rehearsal recompiles its
own source under worker admission; it borrows no live terrain buffers. Initial
manual-assist policy and junction definitions are installed before the recovery
anchor, without inventing an applied player command.
An unavailable/future source leaves the current world available and reports a
source-profile error. Source and worker-result release wait for world/renderer
reader retirement; unresolved retirement keeps the resource reservation owned.
Runtime, visual, playability and recovery qualification for this source remains
pending with the development batch.

## Desktop commands and bindings

The minimum viewport is 1920×1080. Open **View actions → Commands…** with the
keyboard or pointer to search available actions and inspect their configured
shortcuts. Unavailable actions stay visible and disabled. A command captures the
current source and selection; reopen the search after those change. Executing a
deep editor command closes the search before opening the editor.

`keybindings.json` configures the shared registry. Existing world action names
such as `zoomIn` remain supported; `world.zoomIn` takes precedence when both are
specified. Workstation actions use command IDs: `workstation.undo`,
`workstation.redo`, `workstation.copy`, `workstation.paste`, `pattern.clearStep`,
`pattern.previousStep` and `pattern.nextStep`. For example:

```json
{"version":1,"bindings":{"zoomIn":["KeyG"],"pattern.nextStep":["KeyL"]}}
```

Use an empty array to remove a binding. Titles remain neutral while configuration
loads; Help and Commands use the active registry and platform modifier names.
Native controls own their activation and navigation keys. Text, modal dialogs and
IME composition do not dispatch world or pattern commands. Held repeatable keys
stop when their source, selection, binding revision or window focus changes.

Stage mode rejects world restart and nuke commands at the canonical owner.
`workstation.panicOutput` and `workstation.stopOutput` are separate musical output
actions with no default shortcut. An explicitly configured binding remains
available inside dialogs and Stage without nuking actors or committing a captured
edit gesture; composition and keys already consumed by a native control retain
priority.

## Editing buffers and conflicts

Inspector controls, visible lane headers, pattern cells and lane faders keep their
logical identities across ordinary renders. Text and numeric entry buffers retain
focus and caret while unrelated parameters or the desktop viewport change.
If another edit changes the same value while you are typing, your draft stays
visible. Choose **Keep my edit** to commit it against the current project or
**Use current value** to discard it. Escape restores the current value. A
conflicted draft is not committed implicitly by leaving the field.

A field removed by a schema or selection change returns focus to the selected
inspector tab and announces the reason. Replacing a view retires its subscriptions,
controls and canvas attachment before the replacement mounts. A retired field or
late callback cannot act on the replacement document or view.

Global transport fields use the same buffer and conflict rules. Enter commits a
valid entry once; Escape restores the latest accepted value. Empty and nonfinite
numeric fields are rejected, and bounded fields reject out-of-range values.
A nullable fixed MIDI note can still be cleared explicitly, and note zero remains
an ordinary valid note. A document replacement discards the previous document's
transport draft before admitting another edit.

Pending or read-only parameter controls cancel active gestures, disable mutation
actions and preserve a focusable read-only numeric value. Their two states remain
distinct in the accessibility tree. At desktop DPR 1 and 2, the rotary cap retains
a 44px interaction region; decrement, increment and Reset remain inside the
supported inspector widths.
