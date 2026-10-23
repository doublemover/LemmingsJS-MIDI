# ProcGen workstation

Open `procgen.html` through the local web server (`npm start`). Eight lanes share
one physical world. Each starts with its own classic tileset and musical role:
Crystal/Lead, Bubble/Arp, Dirt/Bass, Rock/Percussion, Fire/Drums, Brick/Chords,
Snow/Melody and Pillar/Texture. Sound remains off until **Listen locally**.

## Editing

Choose **Strip** to place the steps below the terrain, or **Overlay** to place
translucent steps over it. Both edit the same project. Select a lane header or
step to open its inspector. Double-click toggles a trigger; Draw and Erase apply
their respective tools. Arrow keys move step selection, Delete clears a step,
and Ctrl/Cmd+C, V, Z and Shift+Z copy, paste, undo and redo musical edits.

The lane inspector selects collection, role, patch, Game/Pattern/Hybrid mode,
pattern length, playback rate, level, pan and game accents. Every collection
contains all eight roles. Global key and scale are in the transport header and
remain independent of sound selection. A fixed MIDI note overrides a step's
scale degree; leave it empty to follow the global key. Drums use General MIDI
drum note numbers.

Four phrase buttons select and queue phrases for the next bar. Duplicate copies
the selected phrase into the following slot. Step and Chord inspectors expose
velocity, gate duration, probability, conditions, repeats, tie/hold, chord
degrees, inversion and spread. Probability uses a deterministic musical stream.
Terrain/action conditions use observations from the selected lane.
Action matches include current living actors; terrain matches sample the foremost
living actor's support and nearby contacts. Unbuilt terrain is not classified as
a gap. Available matches are labeled in the inspector.

The Automation inspector edits controller curves as `position:value` points,
with beat or world-distance positioning. Mute and Solo operate on whole lanes;
Hybrid mode combines the clocked pattern with separately adjustable game accents.
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

**New** creates a default composition and a fresh world. **Reroll world** keeps
the composition and changes the seed. **Replay seed** rebuilds the current seed's
starting world. Explicit seed URLs remain reproducible; ordinary visits and new
runs receive fresh seeds. Play resumes the existing world.
Automatic run resets derive a different seed from the saved run state, so a
loaded checkpoint continues through the same subsequent worlds.

The World inspector controls trap spacing and display row height. Playable terrain
assembles near approaching actors; camera movement does not build distant terrain.
Farther scenery is visual only and uses staggered, world-anchored dithering.
Reduced-motion preferences use static reveals. The solver rehearses bounded
build/bash/mine chains and measures follower crossings; it allows occasional
losses and does not interpret an exhausted search budget as proof of impossibility.

Implementation milestones and validation evidence live in
[the roadmap](roadmap.md#procgen-performance-workstation-october-12-2026).
