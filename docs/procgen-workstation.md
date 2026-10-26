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
Erase edit cells; double-click toggles a trigger. Arrow keys move step
selection, Delete clears a step, and Ctrl/Cmd+C, V, Z and Shift+Z copy, paste,
undo, and redo phrase edits. A fixed MIDI note overrides a step's scale degree;
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


The physical score browser offers **Learn this physical cause** for **One Foot,
One Sound** and **Space Becomes Rhythm** when their exact pinned setup and Quiet
Control scenes are installed. First load the empty control and explicitly Play:
no actor must mean no new onset. Load the lesson setup paused, write a prediction,
observe the unchanged baseline, then change the displayed physical cause using
Physical authoring or Release gestures. A changed request alone is not success.
The spacing lesson compares actual birth and arrival intervals at completed-tick
precision. Use Reset for a fresh empty control, Back or Skip for free exploration.
The panel never moves an actor or enables audio for you.

Physical evidence, accepted sound and your optional report of hearing are shown
separately. With audio unavailable, use the visual evidence path; it does not
verify hearing. Progress is stored separately from musical projects, can survive
reopening, and remains session-only when browser storage is denied. Replaying a
lesson starts a fresh observed attempt. Work/path/harmony lessons and advanced
material/memory journeys are still awaiting their actual setup scenes and
qualification; two available practice lessons do not imply that full acceptance.
