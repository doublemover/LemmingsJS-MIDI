# Actor effect presentation

`ProcgenActorEffectDisplay` is a read-only presentation consumer for #1227. It
never creates a note, acknowledges a voice, runs DSP, changes a physical actor,
or treats a requested knob as an applied signal. Profiles are disabled initially.

## Audio evidence boundary

The renderer adapter `ingestAudioDisplaySample(sample, correlation)` consumes the
#1081 actorVoice shape: exact session owner, generation, execution/context epoch,
graph/route revision, stable actor/onset/voice/node IDs, applied frame, window,
sequence, quantities, processing/route state, coverage and valid-until frame.
World identity is checked explicitly when supplied, or follows the exact current
session/context/execution association established by the clock owner. Bus/output
samples are aggregate evidence and are never copied onto individual actors.

The caller supplies #972 correlation (`audioFrame`, `presentationMs`, sample rate,
execution/context epoch and uncertainty). Uncertainty above 50 ms is rejected.
The display creates no second audio clock. It rejects old revisions/sequences,
missing applied frames, incomplete coverage for motion and windows outside its
bounded timing horizon. Optional output-latency values remain an estimate, never
an acoustic receipt.

Supported authored sources include measured or kernel-owned signed modulation,
measured/admitted onset or amplitude envelopes, measured linear RMS/peak, static
applied drive/filter parameters and explicitly evidenced delay taps. Audio-rate
oscillator phase is **not** converted into a made-up slow wobble. Requested,
rejected, pending, configured, muted, bypassed, valid-zero, stale and unknown
states remain distinct. `routeState.muted: null` stays unknown: moving output
claims are suppressed while exact prebus digital values remain inspectable.
Window/tap/detector delay metadata accompanies those values. A window-peak
amplitude source is not relabeled as an instantaneous acoustic envelope.

The default freshness policy holds for 100 ms then decays for 180 ms; profiles
may specify bounded alternatives. Valid-until expiry makes evidence stale. Late
updates coalesce, missed history is not replayed after visibility returns, and
stale state reaches quiet rather than starting an autonomous oscillation.

`connectProcgenActorEffectSource({renderer,backend,identity,owner,getCorrelation,
actorIds,voiceIds,maxVoices,rateHz})` connects a demand-owned backend observer and
returns an idempotent release. It caps requests at 32 voices/30 Hz. Hidden state,
display loss, world/epoch replacement and disposal revoke that observer. The
backend retains responsibility for measurements and immutable admission identity.
Reconnection is explicit after lifecycle changes.

## Visual grammar and ownership

Version 1 `ActorEffectVisualProfile` records up to six bindings: stable effect ID,
source quantity, X/Y/scale/inner/outer/trail channel, input range, gain, curve,
inversion, priority and amplitude cap. Global defaults, patch defaults and
explicit actor overrides have that precedence. `getConfiguration` and
`restoreConfiguration` provide a bounded versioned persistence payload; the
workstation session owner must persist it. Generation-specific overrides do not
attach to reused actor numbers.

Authored presets are Pitch shimmer, Breathing body, Dub wake and Resonant shell.
They are proposed mappings, not proof that every engine produces those sources.
The selected actor's EFFECT LOOK section exposes evidence classes and values,
source/preset selection, intensity, exact gain/range/cap, invert, reset and linked
axes only when a qualified separate Y source exists. It remains explicit when
live evidence is unavailable. There is no synthetic live-sounding preview.

The `Lemming.render` begin/end action scope separates action/cosmetic art from
countdown/status art. The effect pass leaves cached shared frame pixels unchanged
and applies foot-anchored transformations per actor, with drawing state restored.
Displacement is capped at the smaller of 3 CSS pixels or 20% of displayed sprite
width; scale is clamped to 0.96–1.08. A steady true-position mark/tether remains
where displacement matters. Physical/camera/contact/picking bounds do not move.
Selection markers are drawn later at their higher-priority physical anchor.

Inner masks follow actual opaque silhouette edges and preserve transparent holes.
Outer masks are bounded rims, not unbounded bloom. Trails contain at most three
supported tap records at recorded **world** positions, so camera panning cannot
create screen-coordinate streaks. A rate knob alone cannot create tap ghosts.
Masks larger than 16,384 source pixels fall back without affecting base art.
Optional mask allocation failures cannot fail the physical tick or base draw.

Dense actors suppress displacement, scale and trails before losing their anchor.
Reduced motion removes those channels and substitutes static accents. Effects
are independently disabled through the profile and have a bounded intensity.
These constraints do not replace full-viewport flash/listening qualification.

## Bounded resources and evidence

At most 256 actor mailboxes, 12 source slots per actor and three tap records are
retained. Each mailbox conservatively reserves 64 KiB; profile storage reserves
4 KiB per global/patch/actor profile. These estimates are not retained-heap
measurements. Mask canvases share the renderer LRU/local cap and optional global
ResourceBudget. Hidden/lost views release histories/subscriptions. Accounted
profile intent survives display recovery; disposal releases it. Quiet/offscreen
mailboxes do not create perpetual decorative repainting. No actor timers,
AudioNodes or per-actor DOM trees are created.

The focused tests exercise canonical owner/context rejection, unknown output
mute, actual `Lemming.getClickDistance`, countdown isolation, same-pitch actors,
zero energy, bypassed tails, stale data, profile precedence, bounded memory,
world-position trails and untouched shared sprite data.

The checked-in [Node receipt](procgen-actor-effects-results.json) uses production
renderer code and actual MAIN.DAT sprite art, with supplied **synthetic** evidence
and mocked canvas submissions. Eight visible rows have 128 actors at both 8 and
1024 total lanes. On a shared Windows/AMD Ryzen 7 5800X3D host, 160 effect frames
measured p50/p95/p99 of 1.289/2.758/3.783 ms (8 lanes) and 1.421/2.053/3.338 ms
(1024 lanes). Off frames reused the quiet cache. Both enabled cases retained
8,388,608 estimated history bytes, skipped zero samples, rebuilt zero terrain
rasters and preserved the physical/event hash. This short CPU fixture does not
measure browser GPU, audio synchronization, heap retention or a release gate.

The production Edge fixtures use explicit synthetic samples to qualify real
source-art effect drawing at DPR 1/2 and reduced motion. They compare physical,
event, document and transport receipts and unmodified picking bounds. They do
not certify actual audio telemetry or acoustic/device timing.

The production physical playback owner now connects applied worklet measurements
through the dispatcher, routed lane backend and renderer execution leases. Both
execution layers translate their private identity; copied or retired handles
cannot open observations. Selection and up to sixteen drawn actors determine
the bounded observation set, independently of whether a visual profile has been
enabled. New routed renderers can join an existing observation. Hidden views,
stop, context replacement and disposal retire the subscriptions independently.
Native oscillator lanes supply no invented measurements; a pinned worklet lane
is required for these measured voice sources.

The clock owner correlates frames through output timestamps or a bounded
host/context sample with explicitly reported latency. Unavailable or uncertain
correlation does not animate actors. Current owner/master mute state gates the
presentation; this is application routing evidence at receipt, separate from
the measured pre-pan, pre-owner-bus voice window. Device audibility remains
unknown. Profiles survive observation-set, context and route changes within the
same actor generation. These integration changes have authored regressions;
runtime/browser verification is deferred with the rest of this branch.
Retired-graph tails, listening qualification, the full browser/motion matrix and
profile session persistence still need qualification and follow-up work.
