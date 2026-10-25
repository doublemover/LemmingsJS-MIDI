# Browser audio engine

`BrowserNotePreview` owns the AudioContext, global voice budget, owner sessions,
master gain, compressor and final sample ceiling. The native semantic backend
uses this graph and keeps playback execution epoch plus historical voice ID as
its live identity. Two executions can replay the same historical voice IDs.

## Native semantic voices

Create a backend with `session.createInstrumentBackend(options)`. Prepare a
resolved `native-oscillator@1` patch and parameter receipt before admitting
voices. Preparation preserves the previous ready patch on failure, takes a
snapshot of patch values, and cancels if Stop or a newer preparation intervenes.
AudioContext activation remains a separate synchronous user gesture operation.
Each admitted voice retains its patch revision through its release tail.

`begin(intent, targetFrame, executionEpoch)`,
`update(voiceId, expression, targetFrame, executionEpoch)` and
`end(voiceId, release, targetFrame, executionEpoch)` consume audio sample frames.
The score/audio bridge performs the time mapping before these calls. Fractional
pitch, normalized pressure and pan stay floating point throughout this path.
Semantic voices have their own owner bus so MIDI compatibility channel controls
cannot overwrite their per-voice pitch or gain.

Pressure uses a separate GainNode after the amplitude envelope. Pressure changes
preserve the attack, decay, sustain and release curve. Pitch, pressure and pan
use a causal linear slew, defaulting to 8 ms at every sample rate. The slew
starts at the supplied frame and reaches its endpoint after the declared
smoothing duration. Future controls are sorted by time; equal-time controls use
submission order. Interrupted slews hold the modeled current value, including
on browsers without `cancelAndHoldAtTime`. Continuous controls have a bounded
queue; an overflowing multi-parameter update is rejected before applying any
part. End and cancellation bypass that optional control budget.

The lightweight backend reports unsupported timbre, sustain pedal, sostenuto
and release velocity. A patch with samples or unsupported modulation graphs is
rejected. Native source scheduling provides scheduling receipts; the backend
does not receive render-kernel acknowledgments.

## Owned sustained gates

The default `gateMode: 'bounded'` keeps the existing maximum note duration.
An explicitly sustained owner can select `gateMode: 'owned'` and provide
authoritative execution liveness:

```js
const backend = session.createInstrumentBackend({ gateMode: 'owned' });
await backend.prepare(resolution);
await session.enable();
backend.renewExecutionLease(generation, executionEpoch, validUntilFrame);
backend.begin(intent, targetFrame, executionEpoch);
```

A lease can cover up to 120 seconds ahead. Its renewal comes from the
authoritative owner/execution lifecycle; a stationary held voice requires no
expression updates. Renew before the safety release starts. A missing or expired
lease produces an explicit sink outcome. It does not invent a physical contact
end. Stop, disposal, context replacement and generation cancellation invalidate
the corresponding execution ownership. Reopening a closed AudioContext creates
a new context epoch on the next explicit enable and requires new gate leases.

The existing finite oscillator cap and shared budget also apply to sustained
voices. Pedal articulation, authored choke groups, layered parents, and restored
hidden DSP state require additional backend/content contracts.

## Capture observer ownership

`session.setCapture(capture, context)` installs that session's observer lease.
Another session cannot replace its recipient or document context. Context
functions are sampled at admission, so a later document selection does not
relabel an old voice's end. `session.observeCapture(capture, context)` returns an
unsubscribe function. Disposal revokes the owner's leases, including pending
callbacks. An explicit `preview.observeMix(capture, context)` observes the shared
mix and returns its own unsubscribe function. `preview.setCapture` retains the
existing single mix-observer API. Attaching the same capture object at both
scopes emits one record per event.

Context projection retains at most 64 scalar fields or bounded scalar arrays,
32 entries per array, and 1024 characters per string. Omitted/truncated context
fields are identified separately from overwritten records. This bounded
diagnostic projection is not the canonical performance journal. The post
protection waveform inspection is labeled `digital-pcm-window` with an aggregate
output tap; an owner capture does not turn that mix measurement into per-actor
PCM evidence.

`renderDiagnostics({ includeVoices, includeTraces })` provides bounded native
voice and scheduling traces. Each trace distinguishes historical voice identity,
execution epoch, generation and patch revision. The default trace limit is 128;
`traceLimit: 0` disables detailed trace retention. Truncation counts, queue
rejections and explicit cancellation outcomes remain visible. A native
cancellation receipt says `scheduled-cancellation-requested`, provides the
requested frame frontier, and leaves `appliedFrame` and already-rendered status
unknown. PCM or device-buffered sound cannot be retracted by changing a receipt.

## Reproducible evidence

Run the portable digital PCM fixtures after installing the selected Playwright
browser with `npx playwright install chromium` (or `firefox`/`webkit`):

```text
node scripts/measure-native-semantic-audio.js
node scripts/measure-shared-local-audio.js
node scripts/measure-native-semantic-audio.js --browser=firefox
node scripts/measure-native-semantic-audio.js --browser=webkit
node scripts/measure-native-semantic-audio.js --channel=msedge
node scripts/measure-native-semantic-audio.js --executable=C:/path/to/chrome.exe
```

`--sample-rates=44100,48000,96000` selects native fixture rates and `--out-dir`
selects the generated report directory. Source hashes, actual sample rates,
browser version, capability flags, measurement scope and failing cases are
written as JSON. Required capability, lifecycle, nonfinite-sample, output-ceiling
or permutation failures make the command fail. Chromium launches with its
sandbox enabled. These commands require neither MIDI hardware nor microphone
permission.

Measured on 2026-10-23 using Chromium 156.0.8078.4 on Windows:

| Evidence | Result |
| --- | --- |
| Native digital offline fixtures | 13 passed at 44.1/48/96 kHz |
| Chronological versus shuffled controls | Maximum PCM difference 0, tolerance 1e-6 |
| Coherent crowds | 16/32/64 admitted voices at each rate; finite protected PCM |
| Same-pitch independent releases | B silent after release while A remains audible |
| Static owned contact | Audible at 60 seconds without expression updates |
| Native and shared-owner Panic | Post-Panic measured peak 0 |
| Existing shared-owner PCM | 24 voices passed at master 100% and 400% |
| Firefox / WebKit | Not qualified in this run; cached Firefox had a Playwright protocol mismatch |
| Realtime deadlines, audible listening, physical loopback | Not run |

The installed Playwright revision expected a browser absent from this machine,
so the measured Chromium run used an explicit cached executable. Generated JSON
and PCM stay under ignored `temp/`; reports identify the actual browser used.
Offline rendering establishes digital behavior and does not qualify realtime
capacity, acoustic latency, or musical listening quality.

## Optional owned sine worklet

`await session.createWorkletInstrumentBackend(options)` explicitly selects the
first-party `worklet-sine@1` engine. Its module loads lazily. Activate the session
from the user gesture before awaiting module/patch preparation, then call
`backend.prepare(resolution)` with a patch for that exact engine. A missing
worklet or failed preparation returns an actionable rejection. Selecting a
different engine requires an explicit new backend and matching patch revision.

The ready handshake verifies build ID, runtime ABI, protocol, sample rate,
command width and voice capacity before connecting the node to the owned mix.
Stop cancels pending asset/module/handshake waits without admitting an onset.
Each context initializes its own module and kernel. A processor fault stops and
disconnects that backend, releases its owner voices, and permits preparation of
a new kernel. Old-node callbacks cannot change its replacement.

The sine reference engine has 64 fixed slots and a 512-command priority queue.
Sixty-four command entries are reserved for End and generation cancellation.
Commands use a fixed 18-field Float64 payload and stable frame/sequence ordering.
One microtask collects a source batch into a transferable message. One timer
pumps already-known commands within the default 250 ms lead window; the window
can be configured between 10 ms and 2 seconds. A newly observed physical event
still requires a future target frame or an explicitly declared late policy.
Queue lead does not predict physical contacts or prove lower device latency.

The render loop uses preallocated command, voice, smoothing and receipt storage,
a bounded heap, and the actual output block length. It applies commands at
sample offsets and preserves each parameter's independent smoothing endpoint.
There is no intentional JS buffer/array/object allocation in the render loop.
The bounded MessagePort receipt batches still incur browser serialization cost;
that cost needs realtime qualification. Shared memory and WASM are not used.

Kernel-applied receipts provide the actual applied frame. Scheduled, applied,
ended, canceled-before-submission, canceled-pending-onset and faulted outcomes
remain distinct. A Panic received by the kernel purges future commands and
finishes its controlled mute within one actual render block. Producer delay,
the graph's compressor lookahead and device-buffered audio remain separate.
New admissions wait for the owned Stop acknowledgment. Repeated Stop/restart
cannot leak reserved slots or pending acknowledgments.

Run the actual AudioWorklet PCM fixtures through a whitelisted loopback HTTP
server with correct JavaScript MIME:

```text
node scripts/measure-worklet-audio.js
node scripts/measure-worklet-audio.js --browser=firefox
node scripts/measure-worklet-audio.js --executable=C:/path/to/chrome.exe
```

The fixture requires kernel admission before starting its offline render and
checks kernel rejections as failures. It covers two owners, same-pitch opposing
controls, chronological/shuffled delivery, queued future starts, isolated cue
Stop, Panic, and 16/32/64-voice crowds at 44.1/48/96 kHz. Kernel unit fixtures also
cover arbitrary split-block equivalence, overload, late commands, stale slots,
nonfinite voice isolation and a static 60-second lease. These establish digital
offline and fake-control evidence. Realtime deadline/stall qualification,
worker-to-worklet producers, full engine comparison, spectral residual gates,
and immutable offline runtime asset packaging remain open.

## Shared resource admission

`new BrowserNotePreview({ resourceBudget })` accepts the application's synchronous
`ResourceBudget` service. Audio reservations use category `audio` and immutable
owner tokens. They occur before allocating the context/mix graph, owner channel,
native voice nodes, deterministic percussion PCM, worklet runtime, or worklet
voice host record. A denied replacement does not steal the current playing
voice. Failed construction, processor faults, owner disposal and context
replacement release the relevant tokens. Disposing audio preserves reservations
owned by the renderer or other application subsystems.

Accounting separates known typed-array/Float32 bytes from estimates. The worklet
kernel and processor's fixed storage is 208,224 bytes; its host allowance is a separate
128 KiB estimate. Native voices have a 16 KiB node/host estimate, and browser
graph overhead has its own declared allowance. The shared service applies its
configured audio overhead factor. These are admission costs, not a measurement
of browser process residency or immediate garbage collection. `getState()`
returns the adapter's own reservation/denial counters and labels resident bytes
unknown.

Future decoders can acquire a bound before decoding through the owner session:

```js
const lease = session.reserveDecodedBuffer({ frames: declaredMaximumFrames,
  channels: declaredMaximumChannels, sampleRate: expectedSampleRate });
try {
  const decoded = await decodeWithinDeclaredBounds();
  lease.validate(decoded);
  // Retain the lease for as long as this owner retains the decoded PCM.
} catch (error) {
  lease.release();
  throw error;
}
```

The reservation uses `frames * channels * 4` for Float32 PCM, validates finite
format/frame limits, and rejects excessive declarations before decoding starts.
The decoder must enforce that declared upper bound; discovering an oversized
buffer afterward is a validation failure and does not retroactively admit its
allocation. Encoded bytes, decoder workspace and optional resampled variants
need their own bounds at their owning loader. Buffer leases remain valid while
output is disarmed and are revoked when the owner is disposed. Native node
estimates and the worklet host allowance require device/browser calibration.

## Content-addressed samples and impulse responses

`createAudioAssetLoader` in `AudioAssetLoader.js` accepts `getContext`, either
`resolveAssetUrl(ref)` or `fetchAsset(ref, { signal })`, optional `rawStore`, and
the shared `resourceBudget`. Its first codec profile is complete RIFF/WAVE PCM
(8/16/24/32-bit integer or 32-bit float), one or two channels. Other codecs fail
explicitly. Asset references carry a SHA-256 `contentHash`, encoded `bytes`,
`mime`, `channels`, `sourceSampleRate`, source `frames`, `decodeVersion`
(`web-audio-wav-v1`), relative pack `path`, `licenseId`, and `attribution`.
Optional `kind: 'impulse-response'` has a separate 30-second limit; samples have
a 180-second limit. Loop markers use source frames and are validated before
decoding. Relative pack paths remain identities; object URLs are not persisted.

Raw content and decoded PCM have separate bounded LRU caches. Decoded keys are
the hash, actual context sample rate, and decoder version. Default limits are
16 MiB per encoded asset, 32 MiB raw cache, 32 MiB per decoded asset, 64 MiB
decoded cache, 128 entries, and two concurrent fetches and decodes. RIFF sizes,
source format and frame counts are checked against the hashed bytes before the
browser decoder runs. Stream reads enforce the declared byte count, and finite
decoded samples and the resampled frame bound are checked before readiness.

The loader reserves encoded storage, a bounded input copy and workspace
estimate, and an upper bound for Float32 PCM before allocation. It reconciles
the PCM reservation down to the actual backing. Browser decoder internals have
an estimated workspace allowance; their process residency is not observable.
The initial codec restriction permits a verified decoded upper bound before
calling the native decoder. Admitting arbitrary compressed formats without a
verified expansion bound remains unsupported.

```js
const loader = createAudioAssetLoader({
  getContext: () => preview.getAudioContext(),
  resolveAssetUrl: ref => packBaseUrl + ref.path,
  resourceBudget,
  rawStore: createAudioAssetStore()
});
const assets = createAudioAssetSet({ loader, owner: 'instrument-1' });
await assets.replace(requiredRefs, { generation, signal });
const preparedPins = assets.snapshot();
const renderPin = preparedPins[0].retain({ owner: 'render-job', generation });
// Pass renderPin.buffer to the renderer; release it after its final child ends.
renderPin.release();
assets.dispose();
loader.dispose();
```

Preparation swaps only after every asset is ready. Failed, canceled and stale
preparations release their staged pins and retain the old set. Multiple owners
share one fetch/decode; canceling one subscriber does not cancel another. An
in-flight native decode cannot be aborted by Web Audio, so its reservation stays
held until it returns and the result is dropped. Existing render pins survive
loader disposal and prevent cache eviction until their final release. A caller
cannot retain new pins after loader disposal.

`downloadPack`, `inspectPack`, and `removePack` provide progress, exact-byte
totals, missing/offline state, shared-pack retention and an explicit
`referenced-by-project` removal consequence. `createAudioAssetStore` uses only
the app-owned `lemmings-audio-assets-v1` CacheStorage namespace. Reads reverify
hashes; an offline-ready inventory reports `integrity: 'verified-on-read'`.
Canceled/quota-failed downloads never publish a replacement pack manifest;
already completed hash entries may remain reusable. Recording storage is never
enumerated or removed. Pack controls in the patch browser, persisted installed
pack manifests, external asset resolvers, and redistribution-reviewed content
still require application integration. Asset bytes are never evaluated as code.

Focused loader fixtures cover shared cancellation, native decode cancellation,
disposal with live pins, queued retry, context sample-rate changes, malformed
containers/loops, hash mismatch, offline/quota, finite PCM, interrupted pack
replacement, and a 100-patch LRU soak. These are control-plane fixtures; browser
decoder and rendered sample-loop PCM qualification are separate evidence.

## Owned native sample regions

The optional `native-sample@1` renderer uses the same preview context, owner
session, shared mix, execution leases and Begin/Update/End contract as the native
oscillator. Enable the session and prepare exact decoded asset pins first:

```js
const backend = await session.createSampleInstrumentBackend({
  gateMode: 'owned',
  resolveRegion: (intent, patchReceipt) => resolvedRegions.get(intent.voiceId)
});
await backend.prepare(samplePatchResolution, decodedPins);
backend.renewExecutionLease(generation, executionEpoch, validUntilOutputFrame);
backend.begin(intent, targetOutputFrame, executionEpoch);
backend.update(intent.voiceId, { pitchOffsetCents: 12.5, pressure01: 0.6 },
  nextOutputFrame, executionEpoch);
backend.end(intent.voiceId, { seconds: 0.04, velocity01: 0.3 },
  endOutputFrame, executionEpoch);
```

`resolveRegion` is called once for each otherwise valid Begin attempt. The
content-map owner decides whether selection advances on semantic strike or on
accepted playback. The renderer does no alternate selection and never calls
the resolver on release, parameter updates, lease renewal, or diagnostics. A
region supplied by the future #1133 content map must have:

```js
{
  domain: 'source-frames', assetHash: sha256,
  rootCents: 6000, onsetFrame: 4410, endFrame: 30870,
  gain01: 1, tuningCents: 0, selectionSeed: 123,
  pitchRange: { minCents: 5400, maxCents: 6600 },
  loop: { mode: 'sustain', startFrame: 8820, endFrame: 17640,
    crossfadeFrames: 0 },
  releaseRegion: { domain: 'source-frames', assetHash: releaseSha256,
    rootCents: 6000, onsetFrame: 0, endFrame: 8820, gain01: 0.3 },
  chokeGroup: 'hat', chokeScope: 'kit-instance-1'
}
```

The domain, hash, root pitch, and source region boundaries are required; other
fields shown are optional. Boundaries are integers in the original asset's
source frame domain. They convert to buffer seconds using `sourceSampleRate`,
so browser resampling does not reinterpret source frames as output frames.
Targets, lease caps and receipt times are output frames at the current context
rate. The renderer snapshots nested region data, preserves the selected seed,
and retains its own decoded pins. A prepared patch can be replaced or its loader
disposed while existing voices keep their original PCM and patch revision.
Failed or stale preparation retains the previous patch.

The native profile supports one-shot forward regions and forward/sustain loops.
Held loops continue during the controlled release fade; a separately authored
release region supplies a post-loop tail. The profile does not implement
scheduled loop-exit playback of an arbitrary buffer suffix. Pitch is continuous
playback-rate transposition on the existing source, with a default 8 ms causal
linear rate slew. It preserves phase and changes duration. The native parameter
is k-rate, so output-frame scheduling is not a sample-rate playback-rate promise.
An authored `pitchRange` rejects out-of-range requests, including reference-Hz
offsets; the native rate ratio is additionally bounded to 1/16 through 16.

Each logical voice admits one source and, if authored, a second release source
before constructing either. Both decoded pins and native cost reservations stay
held until the final child ends. Potential release layers count against the
shared render limit across MIDI-compatible, semantic oscillator, worklet and
sample backends. Thus 64 admitted source layers permit 32 release-enabled sample
parents. Sample admission conservatively counts scheduled parents, rejects
overflow, and leaves current parents intact. Other native backends may steal an
entire sample parent according to their existing shared priority policy.

The release child is preallocated but starts only on the owned End intent. Its
gain includes release velocity, region trim and patch gain, followed by the
parent's independent pressure/pan graph. It has a 5 ms attack/fade and a maximum
four-second bounded region tail, limited by the execution lease. Earlier
expression arriving after a future End rebuilds its scheduled rate and envelope
without starting the child twice. Release before onset, generation cancellation,
steal, choke, owner Stop and Panic suppress or remove every child. A one-shot
main with an untriggered release child remains owned until End or lease expiry;
one bounded housekeeping timer retires silent expired pins, with at most a
one-second control-plane cleanup interval. Native source stops remain scheduled
at the actual cap.

Choke groups and scopes belong to one backend instance. Their bounded schedule
is derived from live owned onsets and original semantic releases, including
future onsets received out of order. Equal-frame collisions use voice ID order.
Canceling a future strike rebuilds older parents' pending stop/envelope plans,
so it cannot leave a phantom choke. A choke whose onset has already passed is
terminal. Cross-owner and separate backend instances remain isolated.

Crossfade seams, reverse playback, arbitrary cursor/position-driven playback,
scrub/reflect/clamp boundaries and independent time stretching return explicit
unsupported receipts. No worklet sample renderer, content-map catalog, selected
sample checkpoint/resume, distributable proof pack, or patch-browser activation
is included in this profile. `renderDiagnostics({ includeVoices: true })`
reports the actual selected asset/region/root/seed and modeled rate; playhead and
native applied-frame acknowledgment remain unavailable rather than inferred.

```text
node scripts/measure-sample-audio.js --executable=C:/path/to/chrome.exe
```

The actual Chromium 156 offline decoder/render fixture covers 44.1/48/96 kHz,
same-pitch opposite pitch/pressure, future End before earlier expression,
continuous phase/loop seams, release-child velocity, cue Stop, future
cancellation and Panic, and 16/32 parents reserving up to 64 source layers. A
mid-render cancellation of a future choke must restore PCM identical to a take
without that strike. Unit fixtures cover transactional pins, lease renewal,
before-onset End, construction/quota rollback, canceled choke chains, duplicate
owners, and original-release restoration. This establishes digital offline and
control-plane evidence. Realtime deadlines, spectral quality on arbitrary
authored seams, other browsers, listening and physical loopback remain unrun.

## Worklet-owned display telemetry

`worklet-sine@1`, build `owned-sine-v2-display`, has a demand-leased observation
path. It measures each selected voice before stereo panning and before the
owner bus or shared protection graph. It never divides shared output energy
among actors. The native oscillator/sample paths continue to report their
scheduling/model evidence; they do not produce these measured actor windows.

```js
backend.setDisplayContext({ worldId, graphRevision, routeRevision });
// The context above is frozen into future Begin admissions. Existing voices
// retain their original world/graph/route identity through their release tails.
const release = backend.observeDisplaySamples(sample => {
  const correlation = currentFrameToPresentationCorrelation(); // #972 owner
  display.ingestAudioDisplaySample(sample, correlation);
}, {
  identity: { worldId, generation, executionEpoch,
    contextEpoch: preview.getState().contextEpoch, graphRevision, routeRevision },
  actorIds: visibleActorIds, maxVoices: 16, rateHz: 20
});
// Hidden, disconnected, replaced and disposed views must revoke their lease.
release(); // Idempotent; releasing one observer preserves other observers.
```

The callback receives one frozen `AudioDisplaySample` at a time, including the
exact session `owner`, world/context/execution identity, actor/onset/voice/node
IDs, patch revision, last kernel-applied command frame, measurement window and
sequence. Actor IDs must be nonnegative integers and onset IDs must be present
at admission. Missing identity leaves the voice playable and increments the
`identityUnavailable` diagnostic counter. `getDisplaySamples()` returns at most
32 latest records for inspection; timestamps still determine their validity.

Windows use half-open output frame intervals. Their RMS and peak reduce actual
mono Float64 DSP samples before summing/panning. `amplitude-envelope` is the same
measured window peak normalized to unity full scale; it is not a newly invented
oscillator or an envelope-follower simulation. Detector metadata declares the
tap, one channel, sampled frame count, normalization and up to one window of
response delay (`responseDelayFrames`/`detectorDelayFrames`). Frequency, pressure
and pan carry `applied-parameter` evidence. Radian oscillator phase carries
`kernel-state` evidence and is omitted after end/fault. No low-frequency wobble,
filter/drive quantity, shared return or delay ghost is fabricated.

The applied frame is the last command/state transition actually processed by
the kernel. It may precede the measured window. It is neither the original
requested target nor a device/acoustic acknowledgment. `effectiveFrame` is the
last measured output frame; validity ends after another half-second. Future
queued onsets produce no measured samples. Terminal zero, a fault and absent
phase have separate fields. The processing flags describe this sine voice.
Output mute lies beyond its pre-bus detector, so `routeState.muted` is `null`
with unknown evidence. The renderer preserves this uncertainty and suppresses
moving audible claims while retaining inspectable digital measurements.

Each backend permits eight observer leases, 16 selected voices by default,
32 maximum, and 4–30 Hz. Exact execution/graph/route filters and stable actor/voice
ordering bound crowd selection. Per-window coverage stays complete for the
actual selected tap; selection omissions and overwritten windows have separate
counters. Old/recycled slots require the exact slot token, epoch and generation.
Stale/context-replaced callbacks are discarded. Observer exceptions, malformed
display packets and display transport failure do not fault musical commands.

DSP reductions and both feature packet buffers are fixed at construction and
included in the 208,224-byte runtime reservation. With no observers, no meter
reductions or recurring feature messages run. An active display admits another
512 exact host selector bytes and a 192 KiB host/object estimate before feature
allocation, released on the final unsubscribe. There are no per-block rich JS
trace allocations in the processor. MessagePort structured cloning still has a
browser allocation/serialization cost. At most one feature packet is in flight;
new windows overwrite the unsent mailbox until acknowledgment. Musical
admission/applied receipts use their separate existing path. An explicit
`kernel-stop-queued` receipt has `appliedFrame: null`; kernel-applied Stop remains
a separate render outcome.

Focused fixtures qualify applied-vs-future state, actual per-voice window RMS,
terminal zero, phase absence, observer/resource ownership, stale and recycled
identities, malformed packets, fixed detector storage, stable 32-of-64 LOD and
one-packet backpressure. The Chromium 156 offline worklet fixture has 18 cases
at 44.1/48/96 kHz including observer-enabled/disabled identical PCM, two owners
with the same voice token/pitch, and 64-voice demand. Its asynchronous Stop
transport is admitted before offline resume. This is a deterministic digital
fixture, not a realtime scheduling/deadline or acoustic-latency measurement.
Application source hookup and #972 correlation remain with the workstation;
native/bus/effect feature producers, playback-path underrun observation, visible
“why silent?” integration and privacy-minimized repro bundles remain open in
#1081. Telemetry is a bounded diagnostic projection, not the lossless journal.

Session activation installs its promise lease before any status callback or
AudioContext operation. Reentrant enable calls share that lease; Stop invalidates
it and resolves cancellation without waiting for a pending context resume.
The physical player separately guards activation before calling the session and
keeps a stopped owner disarmed until a new playing physical batch requests it.
Context creation and resume still begin in the original gesture call. Regression
fixtures for synchronous notification and stop-during-enable are added; execution
is deferred with the current backlog implementation pass.

## Execution ownership and retirement

All three owned instrument backends expose `registerExecution({ executionEpoch,
generation })`, returning an opaque `execution` handle. Pass that handle to
begin/update/end, lease renewal and generation cancellation. A handle belongs to
one backend and one generation. Copying its fields does not copy its authority.
`retireExecution(handle)` closes producer admission immediately and requests
cancellation; it is idempotent. Its state remains `retiring` until producer work,
submitted work, release tails and acknowledgments have settled. Retired handles
remain invalid through weak ownership records, without occupying the live map.
There are at most 64 simultaneous active/retiring registered executions. Numeric
kernel identities increase monotonically and are never recycled. Faulted kernel
connections are terminally disconnected before their identities are released.
Stop and context/owner replacement invalidate handles independently of display
subscriptions. The dispatcher registers and retires handles at physical playback
generation, stop/restart, disposal and backend-incarnation boundaries.

Diagnostics expose current active/retiring identities, their peak, completed
retirements and the incarnation. Capacity pressure reports
`execution-identity-capacity`; unrelated voice-budget rejection does not consume
a kernel identity. Callers should retire finished executions and wait for their
tail acknowledgment before retrying capacity admission.

Legacy string calls remain supported for bounded external fixtures. Arbitrary
strings cannot safely renew their authority after cancellation, so that path
retains bounded tombstones and reports `execution-registration-required` when
its history fills. It cannot block registered executions. New sustained playback
must use opaque handles. The internal epoch namespace is rejected at the public
boundary, including strings copied from old receipts. Added lifecycle regression
fixtures remain unexecuted during the backlog development pass.

Audio reservation release now changes local counters only after a synchronous
adapter acknowledgment. A throwing or explicitly refusing adapter leaves a
bounded failed-or-unknown reservation in accounting and revokes its usable
authority. Repeated release reports the retained failure without calling that
adapter again. Owner retirement attempts all independent reservations, so one
failed channel release cannot strand unrelated PCM leases. Nested retirement
receipts propagate partial/unknown outcomes to the enclosing owner; repeated
retirement retains the same evidence. New adapter-failure fixtures are deferred.

Session and root disposal now install their shared terminal receipt before
cleanup callbacks run. Backend stops/disposal, voices, sample source components
and pins, channel nodes, capture observers, resource reservations and context
closure are independent retirement leaves. A failing leaf does not skip later
leaves. Session disposal preserves another enabled owner's graph. Failed voice
cleanup retains the voice record and blocks that owner's further admission;
failed channel cleanup retains its channel record. A context close rejection
retains an explicit unclosed-context reference. Public disposal promises resolve
to the same complete/partial receipt on repeat calls. Newly added fault fixtures
cover the reported channel-budget failure and disconnect/backend/observer/close
failures; runtime execution is still deferred.

Native disconnect/stop failure now retains the related audio reservation through
owner disposal. A confirmed closed context acknowledges native retirement;
bookkeeping failures remain charged and are not blindly retried. Sample source
components retain their decoded pins when native teardown is unknown, then
release those withheld pins once after context closure. Backend-owned sample
nodes have one teardown owner, avoiding duplicate disconnects in the preview.
Construction rollback follows the same independent-leaf and reservation rules.

Prepared sample and asset-set replacements keep an admitted new selection
intact when an old pin fails to retire. Receipts expose the partial cleanup,
further replacements stop at that ownership fault, and independent pins still
retire. Cache entries with failed release remain inventoried and charged rather
than disappearing before accounting acknowledges retirement. Causal dispatch
also retains independent cancellation/execution receipts across sinks. These
failure-path fixtures are implemented and unexecuted.

## Bounded PCM capture processor

`OwnedPcmCaptureProcessor` provides a stereo Float32 capture primitive with two
preallocated transfer buffers, exact source-frame intervals and a bounded gap
index. Buffer pressure records missing frames rather than allocating a growing
queue. Mono input is duplicated; a valid disconnected input records digital
silence. Nonfinite input, clock discontinuities and unsupported layouts stop the
capture with a finite prefix. Its output is zero so a pull connection cannot
double the audible master. Processor fixtures are authored and unexecuted; host
ownership and artifact finalization are implemented in `OwnedMasterCapture`.

The host reserves its full duration and sample rate before allocating PCM. It
captures the post-protection shared master, including auditions currently routed
through that master. It opens neither microphones nor MIDI devices. WAV export
uses stereo float samples at the original rate, without resampling, normalization
or an acoustic claim. The inaudible pull branch outputs zeros. A bounded manifest
records source frames, interruptions and gaps; zeros substituted for missing
frames are explicitly placeholders, never measured silence. A missing terminal
receipt preserves only the received prefix and retains the uncertain processor
reservation until confirmed context closure. Accepted module loading remains
owned across cancellation. Finalized PCM remains pinned until artifact expiry or
discard and settlement of its delivery reader. Streaming delivery avoids making
a full WAV copy; a full artifact digest is explicitly omitted. These host fixtures
are authored and unexecuted. Capture is memory-backed and cannot promise recovery
after browser termination. The workstation's **Record audio…** dialog starts and
stops capture independently of causal recording, shows actual source/received
frame counts, and saves the retained WAV through the existing owned file writer.
Canceling or retrying delivery leaves PCM intact. Capture needs browser audio
already enabled; streaming file saves require `showSaveFilePicker`. Closing the
dialog stops recording and keeps its artifact; discard is a separate action.

## Prelisten routing and workload

The cue graph owns a separate gain and safety ceiling. It starts muted and needs
an explicit route selection. Separate-device routing uses a selected nondefault
media-element sink; it never changes the context's destination or asks for a
microphone. Its buffering is asynchronous, and physical socket isolation remains
unverified. Device-change notification mutes cue and requires revalidation.
Rehearsal on the live output is a separate deliberate mode and enters master
capture. There is no automatic speaker fallback after denied selection/playback.
Accepted native selection/sink/play promises remain owned until they settle.

The workstation profile reserves four cue voices in addition to its existing
32 live voices, within the authored 64-voice aggregate ceiling. Other callers
default to zero cue capacity and must request an explicit quota. Live and cue
capacity are counted separately across native, sample and worklet renderers;
legacy stealing stays inside its workload. The native typed renderer now also
honors its declared reject policy at shared capacity. Cue graphs and simultaneous
prepared instances still require shared memory admission. The quota is a declared
resource policy; real-device CPU/concurrency qualification remains deferred.
One cue session can own output at a time; global Panic reaches live and cue,
whereas cue Stop preserves live owners. Routing and ownership fixtures are
authored and unexecuted.

The shared PRELISTEN rail shows the exact source/revision, preparation/playing/
stopping state, route, gain, capture inclusion and declared live/cue quotas. The
same rail moves into the sound library while that dialog is open, then returns
to the workstation footer. Showing the source returns to its existing tool.
Route selection, Start audition and Apply remain separate explicit actions.
No meter is drawn without measured cue samples.

`ForegroundAuditionOwner` admits one foreground source and at most one pending
handoff. A successor cannot become ready until prior source retirement has
completed; superseded preparation loses authority immediately. Stop callbacks
request cancellation synchronously; the source separately closes its opaque
lease with its actual retirement receipt. Failed/unknown ownership prevents new
auditions. Sound-library control auditions use this owner and the cue workload.

### Display update ownership

The workstation and PRELISTEN share one admitted `InstrumentDisplayScheduler`.
Each registered surface retains one latest frozen publication or one dirty pull
request. The scheduler batches layout reads before writes, bounds timing history,
and stops scheduling when clean, document-hidden or offscreen. Returning to the
foreground refreshes current state once. It never queues missed display frames
or changes the audio/simulation clocks. Errors remain latched separately from
ordinary coalesced samples until explicitly cleared.

Playheads use a stable lane-ID index per lane-array revision. Renderer resizing
is skipped when geometry and renderer ownership are unchanged. ResizeObserver,
visibility observers, callbacks and reservations retire with the view, and a
failed native display-source teardown retains its accounting. Interactive DOM
control changes can still provide immediate local feedback.

`getDisplayDiagnostics()` reports bounded rolling UI cost distributions plus
registered, dirty, coalesced, skipped and failed surfaces. The workstation profile
script now authors 8/64/1024-lane scenarios with source revision and browser/device
context, keeping visible rows bounded. Its rolling distribution is labeled as
such. These paths and fixtures have not yet been executed in this implementation
pass; they are not a claim that the proposed p95 target or idle-soak gates pass.

### Owned sine state cuts

The sine kernel can write/restore a fixed 186,592-byte little-endian state into
caller-owned exclusive storage at a completed render boundary. The cut includes
the voice phases/envelopes, interrupted parameter ramps, release progress, owner
lease deadlines, future command heap, pending receipts, packet/frame frontiers,
panic state and counters. Engine artifact hash, patch definition hash, graph
revision, sample rate, maximum voices and state ABI must all match.

Restore validates the complete cut before mutating a staged destination. Mutable
buffers are copied; display subscriptions are cleared and require a new observer.
Native AudioNodes are not serialized. This low-level path does not yet expose a
live seek/scrub control or transplant execution identities into a running graph.
The caller must admit source, destination and transfer overlap before allocation.
Authored continuity/corruption fixtures cover attack, held, release and interrupted
ramps at 44.1/48/96 kHz; they remain unexecuted. Same-artifact state equivalence is
a contract awaiting those gates, not a cross-browser bit-identity qualification.

### Causal take sine revoice files

`CausalTakeAudioRender` owns preparation from a covered immutable intent snapshot
through a dedicated fixed worker to retained export artifacts. It checks take
revision/hash, selected definition/engine, application build, rate, range, frame
count and each requested stem before publication. Source loans, input overlap,
computation and files have separate retirement. A failed replacement preserves
the previous prepared files. Canceling delivery does not rerun a valid render.

This first adapter is explicitly a new asset-free sine realization of captured
intent, with the original cause/voice/pitch/source times retained. It does not
reconstruct live admission choices, native/hardware timbre or the protected live
master. New capture boundaries include the actual simulation source clock. Older
takes without that clock or with initially held voices need qualified history;
the adapter refuses them rather than inventing attacks. Fractional-tick timing
uses an actual captured tick duration or a qualified captured source timeline;
duration/score-time disagreements are refused. Histories are limited to 8,192 intent records,
32,768 intents and a bounded source snapshot; no continuation is silently omitted.

The worker reconstructs silently from capture zero before emitting a crop. Exact
crop, capped natural tails and explicitly derived boundary releases are separate
choices. The entire sine graph renders once; optional dry lane files tap it
simultaneously with aligned frame zero. No shared return exists in this graph;
the protected nonlinear master is excluded. Complete dry stems recombine within
float32 rounding. Stereo float WAVs preserve headroom, include exact frame counts,
PCM hashes and bounded manifests, and use the common export-delivery owner.
Output is capped at 120 seconds of history and 64 MiB across master/stems, with
source/PCM/encoding/transfer overlap admitted first. Runtime, decoder and listening
qualification remain deferred. These capabilities do not qualify other engines,
general shared-effect stems or a real-time print path.

The saved-take Physical inspector exposes **Render sine WAV…**. Its dialog reads
owned metadata, shows exact capture duration and refuses missing clocks/held
ancestry before enabling preparation. Range, rate, tail policy and all captured
dry lanes are explicit controls. Progress uses the shared display scheduler.
Download requests and acknowledged file-handle saves have distinct status; Close
cancels active preparation/delivery while retaining valid prepared files. Reopen
can retry a file without rendering again. Browser coverage for a real physical
phrase through an immutable worker is authored and remains unexecuted.

New intents retain the actual source tick duration. The render timing adapter
checks captured timeline epochs and score beats across tempo/rate changes, rounds
only at the selected output sample rate, and subtracts the source origin before
adding fractional time. It never substitutes one current BPM for the take's
history. Voice-capacity planning orders the complete captured onset set by its
actual frame with stable source-order ties, independently of actor traversal.
Timing provenance and the captured timeline hash accompany the render. Numeric,
rate-change and fractional-order regression fixtures remain unexecuted.

### Native FM engine adapter

The versioned `native-fm` adapter uses the existing preview context, sessions,
mix/protection, interval admission and opaque execution handles. One logical
voice owns a two-operator pair or two mixed pairs, plus an optional bounded pitch
settle source. All children start/stop together, lease extensions reschedule every
source, and teardown attempts all nodes even after a child fails. Child generator
counts enter interval and memory admission before allocation. Failed preparation
preserves the previous pinned instrument.

Modulation index is dimensionless; `fmIndexToDeviation` converts it to Hz using
the modulator frequency. Amplitude and modulation envelopes are independent.
All pitched operators share the owned detune curve. The native compound
frequency/detune ordering follows the
[Web Audio OscillatorNode contract](https://www.w3.org/TR/webaudio-1.0/#OscillatorNode).
The graph has no feedback path. Two/four-operator topology, ratios, index envelope,
second-pair mix, pitch settling and the declared bend range are immutable patch
data; unsupported controls remain explicit.

A per-onset register calculation limits index over the declared bend/settle range
and refuses out-of-register ratios. This is a conservative sideband estimate,
not measured alias suppression. Diagnostics expose requested/effective indices,
ratios, source units and the exact quality limitation. This native adapter does
not advertise exact snapshots, measured render acknowledgment or product offline
rendering. Numeric, same-pitch isolation, cost and child-retirement fixtures are
authored and unexecuted; spectral/PCM/real-time/listening qualification and authored
FM content remain pending.
Global stop fences reentrant enable requests and requests source cancellation;
source/backend ownership remains visible until actual retirement. Master capture
excludes the separate cue bus and explicitly includes live-output rehearsal.
The rail and handoff fixtures remain unexecuted with the deferred validation pass.

The separate sink API and its permission/scope constraints follow
[media-element setSinkId](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/setSinkId)
and [selectAudioOutput](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/selectAudioOutput).
No multichannel socket mapping is claimed from channel-count capability alone.

## Committed interval admission

Onsets check the complete requested interval against already committed native,
sample and worklet voice records. A future voice inside a newly submitted earlier
note now participates in admission. The shared fixed-storage sweep groups equal
time boundaries, charges actual sample-layer counts, and checks semantic patch
limits independently. Its storage is reserved before allocation with the graph.
Logical gates and rendered release tails have separate bounds. Live and cue each
retain a source-reservation quota, so queued cue sources and tails cannot occupy
the live owner's prepared-source headroom. Workstation defaults are 32 live
gates/64 live source reservations and 4 cue gates/8 cue source reservations.

Lease renewal preflights all affected intervals before changing deadlines or
native automation. Worklet lease commands enter the host queue as a complete
batch, preserving terminal capacity. Worklet End cannot silently extend its
admitted lifetime; receipts report requested/effective release frames and any
bounded deadline. Legacy fairness now scopes lane counts by owner. A permitted
legacy steal must fit the remaining interval and tail bounds and stays inside
its workload; it cannot revoke an incompatible backend's source implicitly.

These are committed-submission admission rules, not a claim that every arbitrary
ordering of online requests produces identical accepted musical material.
Permutation fixtures qualify peak accounting separately. Exact request-set
canonicalization, graph-specific measured cost profiles and device p95/p99
qualification remain acceptance work. New interval, queue and reproduced
future-overlap fixtures are authored and unexecuted.

### Render-owned lease cutoff and numerical evidence admission

Owned worklet renewals use **per-voice**, not all-or-nothing kernel admission.
The host atomically reserves/queues the batch, but each renderer decides at its
actual application frame. A lease cannot extend a voice at or after
`effectiveEndFrame - releaseFrames`, nor after any explicit release has begun.
The exact cutoff is terminal even when the producer submitted before it. A new
attack needs a new onset/voice; renewal never restarts a release envelope.

Queued extension intervals reserve capacity but are not render acknowledgments.
Renewal receipts identify each bounded voice/command; diagnostics retain requested,
pending and effective end frames. Applied receipts commit effective bounds; rejected
or cancelled leases roll reservations back to the last effective interval (or a
still-pending extension). A generation lease can remain registered for subsequent
new voices even when an existing voice misses its cutoff. Owner stop and generation
cancellation remain terminal. This does not turn semantic owner liveness into an
acoustic receipt.

The shared, native-semantic, worklet and sample offline producers now use the same
pure numerical admission module. Every retained channel over the entire rendered
interval is required finite, including both masters, diagnostic taps, shuffled
runs, telemetry controls and choke-restoration controls. Window counts must be
positive, and RMS/peak/DC/delta/pitch/comparison metrics must be finite. Comparisons
validate both arrays before subtraction and reject overflow. Optional comparisons
carry measured/not-applicable status; absent pitch evidence fails the required
fixture rather than becoming JSON null. Evidence source hashes include the helper.

These implementation changes and authored regression controls are not validation
results: browser/PCM execution, realtime deadlines, acoustic listening, the complete
product journey and performance qualification remain deferred.

### World-anchored tonal interpretation

Physical graphs may declare versioned `harmonicFields` and `formations` and opt
in per instrument with `harmonicFields: true` or `formationId`. Tuning retains
rational numerator/denominator declarations, reference identity and cents; it is
not rounded through MIDI1. Bands use a bounded spatial index, stable priority/ID
overlap ordering, hysteretic membership or a declared cents morph width. Coordinate
maps distinguish degree quantization from continuous bending. Material selectors
without authoritative material evidence are explicitly unknown, not inferred from
artwork. The terrain-score material owner and graphical authoring remain separate
integration work.

Formation descriptors consume the shared complete ensemble/route owners. They
include followers, centroid/dispersion and selected neighbor relations, with stable
representatives and explicit aggregation above 32 voices. An exact bounded Hungarian
assignment minimizes pitch motion; no cubic work runs over the full crowd. Freeze
and follow modes are explicit. Unqualified route coordinates never fall back to
straight-line proximity. Registers and non-octave tuning periods are validated.

Neither descriptor recomputation nor field authoring attacks a silent actor.
Retuning updates existing physically rooted voices; explicit rearticulation preserves
the original physical cause plus applied field-edit identity/revision. Deletion has
retain/release/rebind policy. Independent actor pitch state, hysteresis and assignments
are checkpointed and captured as required interpretation state. Source gaps retire
voices rather than asserting exact continuation. Per-event slew passes through routed
execution to native oscillator, sample and worklet automation, retaining independent
future event durations under reordered submission. Hardware rendering capability,
performer overlays/editors, material coupling and all runtime qualification remain
unqualified; this is not an acoustic or complete UI acceptance claim.

### Live lane mix ownership

Physical playback now lowers stable lane gain, stereo balance, mute and solo
suppression independently of instrument pressure/expression. Native/sample parents
own a separately reserved gain/balance pair, including their release children;
owned worklets retain independent bounded mix state and ramp commands. Mix does
not rewrite actor pitch, velocity, physical controls or onset identity. Carried
voices keep their original renderer but adopt the actual destination lane mix.
Muted/suppressed/zero-gain new onsets are explicitly rejected; existing held voices
can become silent without ending their physical ownership. Failed mix delivery
requests a controlled terminal release rather than leaving stale audible gain
unreported. Mute failure is not a confirmed acoustic silence receipt.

Worklet mix ramp state is included in the new incompatible DSP snapshot ABI and
resource inventory. Earlier snapshots require the earlier artifact; they are not
silently interpreted with new offsets. Lane mix changes join sparse causal
performance observations, and re-performance uses captured destination eligibility.
Sound-only offline rendering of historical lane-mix gestures remains separate
integration work and must not claim exact historical gain reconstruction yet.

Visible lane headers expose transactional vertical level controls with unity detent,
finite gain/dB conversion, readable negative infinity, keyboard/numeric/click
alternatives and a separate effective-request marker. Virtualization retires control
owners; shared keyboard/wheel arbitration prevents parameter changes from scrolling
the lane selection. Clear-all-solos has explicit scope and one history transaction.
The bounded lane view distinguishes self-mute, solo suppression, zero gain,
disconnection and source activity. **Activity is semantic events, not measured
loudness**: local peak/RMS are unavailable until the lane-sum meter owner is attached.
No signal, clipping or acoustic evidence is invented from note velocity or traffic.
Interactive layout, measured meters, full offline mix reconstruction and all runtime
regressions are still unvalidated or outstanding as recorded in the issue ledger.

### Atomic authored terrain and material ancestry

The shared intervention queue now accepts bounded `terrain-edit` commands. Its
read-only planner canonicalizes integer spans and checks materialized collision,
steel, source objects/triggers, live body/support/next-step envelopes and retained
crew claims. Unknown source tiles are not generated by preview. A maximum 8,192
cells / 128 edit chunks, bounded spatial protection index and query-work ceiling
bound admission; rejection is all-or-nothing. Preview revisions and semantic score
identity are rechecked before the next actor step. Detached patch compression and
copy-on-write provenance preparation precede publication; there are no source or
user callbacks in the publication section. Retained route readers see changed tile
identities. Annotation advances semantic history without marking successful
physical work or changing collision-tile dependency identities.

Actual worker mutations now accumulate one canonical before/after span transaction
per work operation, independent of sound subscribers. Author commands have separate
ancestry, never a counterfeit worker strike. Stable world/generation/edit identities,
local source revisions, explicit material/tag declarations and expiration accompany
contacts and completed actor projections. Material-selective harmonic fields consume
that captured evidence rather than palette colors or later live-world queries.
Provenance retains at most 512 chunks / 16,384 cells / four versions per cell and
256 transactions / 16,384 spans. Retired or uncovered history becomes explicitly
unknown, not a reused edit identity. Source materials without declarations remain
untagged. Checkpoints and incremental recovery include pending author commands and
the semantic owner. The authoring brush UI and explicit history-branch transaction
wiring remain outstanding; these are not implied by the low-level adapter.

Integer/no-op, cold-patch, occupancy/stale/protected, allocation-failure, checkpoint,
ancestry and retention regression coverage and an 8/128/1024-lane preview profile
are written. They have not been executed; no performance or interactive qualification
is claimed.

### Collision topology as an authored instrument descriptor

A topology profile declares integer ROI/halo, free/solid space, 4/8 connectivity,
anchors, binding policy and an explicit existing patch/body identity. The reference
flood fill computes area in square world pixels, cardinal boundary length,
centroids, opening spans and one-cell-separated adjacency. Anchor/overlap matching
preserves identities through unchanged components, splits and merges; vanished
identities have explicit retirement. Unknown coverage, excessive component count
or exhausted computation budget is unavailable, not a sealed chamber.

Up to eight regions / 262,144 total ROI cells are admitted, each at most 65,536 cells
and 256 components. Separate 262,144-cell post-transaction and completed-boundary
budgets reserve the final observation. Four revision-qualified descriptor versions
per region support bounded exact-local binding. Analysis jobs fence world,
generation, mapping/ROI epoch and terrain revision at publication. Late results are
discarded; unavailable old excitations are never replayed as a catch-up burst.
`endOfTick` explicitly preserves the original work/contact revision alongside the
completed topology revision; `postTransaction` refuses absent exact local evidence.

Successful worker/contact facts—not topology analysis—excite authored pitch and
onset damping-macro mappings. The routed owner requires the declared prepared body
and macro; there is no parallel resonator implementation. Held contacts retain onset
pitch, retune stable components, or release on change according to policy, and
split/merge/removal cannot silently leak a prior component voice. Damping remains
onset-only. Checkpoints retain topology history; physical-state projections exclude
this observational owner. Capture profile v4 records descriptor coverage and ROI
identities so a different or missing chamber cannot be claimed reinterpretable.

Reference fixtures cover sealed area, open/unknown boundaries, diagonal connectivity,
merge/split identity, two worker revisions, held retirement, stale publication and
checkpoint restore. A bounded analysis-only profile separates CPU descriptors from
DSP cost. UI cavity overlays, authoring interactions, source-builder and acoustic
qualification remain outstanding; no fixture/profile has been run.

### Safe physical junction requests

Canonical projects can now contain bounded two/three-state junction definitions,
real inlet/outlet contracts, explicit binary collision footprints and a conservative
influence hull. Definitions themselves are future-boundary commands, so project
Undo/Redo rebases authoring revisions and supersedes only uncommitted definitions.
The Junctions panel edits validated definitions and separates desired/waiting state
from the last applied configuration and stale geometry. It uses the shared display
scheduler, bounded DOM, focus-restoring modal lifetime and no preview MIDI output.

Requests use the same intervention queue as manual workers and terrain strokes.
They recheck source assets, region revisions, whole influence occupancy, support/
head/next-step envelopes, source objects and work claims. Waiting holds no worker
or terrain reservation; it is bounded by 64 requests and an explicit deadline.
Original requested-boundary order prevents new same-priority inputs from starving
older waiting requests. Coalescing records supersession and never rewrites a
committed result. Cancellation, expiry and rejection emit no fake worker/contact
success. Applied geometry invalidates route dependencies; earlier travel facts and
unrelated voice tails are not reset. An identical already-realized configuration is
an explicit no-op application rather than a fictional collision change.

Mixed add/remove patches publish atomically through the terrain adapter. Current
configuration receipts contain actual tile revision identities, not a future route
guarantee. A bounded qualification adapter checks actual configured geometry, port
support and real crew state before invoking the independent shared-action route
qualifier; its report covers only tested inputs and retains actual replay results,
never assumed width/timing ratios. Project/session checkpoints, incremental recovery
and causal-take cancellation replay carry pending inputs and outcomes. Mapping
replay also restores topology profile changes rather than observing stale ROIs.

Queued safety, stale/cancel/expiry, supersession, twenty-switch replay, checkpoint,
port compatibility and mixed-patch fixtures are written, as is an 8/128/1024-lane
controller/whole-world-tick profile. No fixtures, timing qualification, profiles or
browser interaction checks have been executed. Reusable fragment remapping and
source-qualified authored short/long branch content remain explicit follow-on work.

### Portable physical score fragments

Canonical projects can retain bounded, immutable fragment definitions and pinned
instance ancestry. Capture reads materialized collision and revision-qualified
annotations without copying actors, voices, ensemble rosters, junction requests,
reservations or occurrence state. A fragment owns at most 8,192 cells, 128 spans,
256 musical/physical objects and 512 KiB; libraries own at most 32 definitions and
8 MiB. Nested containment is explicitly unsupported (depth zero), so recursion
cannot enter through a copied instance.

Local pickup/ensemble/route/field/formation/topology/instrument/junction/port
identities receive a fresh instance namespace. Every lane, crew/cohort, material,
sink route, sample kit and body/macro dependency is an explicit external binding;
missing required bindings block admission, while missing optional sound choices
mute the copied instruments rather than accidentally resolving same-named objects.
Typed numeric parameters bind only enumerated authoring fields and carry units.
Library updates require newer revisions and never rewrite placed instances;
detachment retains ordinary objects and immutable source ancestry.

Dry runs check source hashes, destination identity conflicts, actual occupancy,
protected terrain, finite port declarations and the merged causal graph. Per-span
material annotations and binary collision now share one terrain transaction;
annotation-only replacement does not invalidate collision tile identities. Integer
translation is supported without claiming timing preservation. Horizontal
reflection requires pinned real-runtime qualification, and signed-X articulation
or discrete X-degree mappings currently require separately authored policies.
Scaling/vertical reflection/rotation are rejected. Qualification candidates are
explicitly unadmitted, never a placement shortcut.

The real-adapter comparison producer retains original and realized route evidence,
observed crew inputs and timing deltas. A separate shared-action circuit fixture
measures translation/reflection and a separately authored doubled geometry instead
of assuming a doubled period. Neither producer nor the 8/128/1024-lane authoring
profile has been run. Graph/terrain instance publication, checkpoint-backed
physical authoring history and the fragment editing surface are separate remaining
integration work; this increment does not claim completed fragment workflows.

### Atomic physical authoring owner

`physical-authoring` is a canonical intervention, not a second edit scheduler.
It stages collision/provenance allocations, the validated musical graph, junction
definitions, topology profiles and pinned fragment ancestry before publishing any
of them at the requested simulation boundary. Source hashes, generation, graph
content, authoring/junction revisions and actual terrain/occupancy are rechecked.
The same completed batch sees both the changed geometry and its effective graph;
no synthetic work strike, actor birth or admission is emitted. Post-publication
exceptions fail the physical tick instead of falsely reporting an unmutated
rejection. No-op collision can accompany a meaningful graph transaction.

The world checkpoint owns the effective authoring graph; project presentation
adopts the applied receipt, rather than exposing a candidate graph before terrain
admission. Ordinary mapping changes remain outside the physics hash projection,
but their explicit recovery records reconstruct the authoring owner. Physical
re-performance and branch mapping use the same owner and topology configuration.
Commands are capped at 512 KiB, the pending queue has an 8 MiB serialized admission
budget, and recovery records allow up to 1 MiB under the existing total journal
budget. Larger ordinary graphs may be retained up to 4 MiB but can require paused
recovery compaction instead of an incremental mapping record.

Regression coverage for same-batch publication, stale/occupied rejection,
cancellation and independent checkpoint/recovery continuation is written, not run.
The public placement-command builder is connected to this owner; the bounded
editing surface and checkpoint-backed physical Undo integration are still being
implemented and are not claimed by the atomic-owner increment alone.

### Paused terrain/fragment editing and physical Undo

The workstation's **Physical authoring** surface now exposes a finite world-space
cell brush, keyboard cell selection, semantic material annotation, protected/unknown
cell preview, spatial dependency capture, versioned fragment library, explicit
placement bindings/ports/parameters and detachment. The shared pointer arbiter
owns one physical contact; a replaced world/project/region cancels its draft.
A shared display surface redraws changed source/selection identities only, under
a reserved canvas budget. Closing or suspending cancels pending preparation and
never starts audio or hardware preview.

Apply requires paused transport, no active take and no older pending physical
request. It first captures a cooperative whole-world checkpoint under an exclusive
source/project/document lease, then queues and advances **one actual physics
boundary**, remaining paused. Failure to reserve/capture history refuses the edit.
A rejected candidate may still have advanced that real boundary; it is not called
an unchanged simulation. Recorded-performance edits use the existing isolated
physical branch instead of overwriting a take's history.

Physical Undo/Redo restore the checkpoint plus project, command queue, actor
identity, terrain/provenance, effective graph, musical interpretation and clock;
they never pretend an inverse pixel stroke reconstructs past actors. Restores are
paused and preserve the document destination while fencing old asynchronous work.
Historical graph/region revisions are restored as captured, rather than spuriously
rebased like a live mapping edit. Checkpoint producers keep their reservation until
cancellation acknowledgement; unknown retirement remains accounted and visible.

History has a finite byte budget and reserves half for a destination snapshot, so
retained physical checkpoints cannot consume Undo/Redo's required capture headroom.
The default 32 MiB history limit can reject large-world captures; the new profile
reports admission/refusal for 8/128/1024 lanes rather than asserting they fit.
The explicit discard action removes physical checkpoints and older crossing
history without touching the current world. Cooperative capture still contains
nonpreemptible native allocations/key enumeration; responsiveness is unqualified.
Controller, ownership and whole-world restoration regressions plus the history
profile are written but unrun. Browser interaction, large-world admission and
source-qualified fragment traversal remain deferred validation.

Nested authoring/work receipts now have an explicit 4,096-node/128 KiB copy
envelope with depth eight; ordinary facts retain their smaller node/byte bound.
This repairs a source-inspected mismatch where valid terrain spans could exceed
the older depth-four copier and silently mark an applied command's batch partial.
The bus additionally bounds copied ordinary fact data to 8 MiB per boundary and
reserves 512 KiB plus terminal event credits for lifecycle facts. These are copy
accounting estimates, not measured heap peaks. Exhaustion remains explicit
incomplete coverage; no receipt or acoustic success is fabricated. The extended
receipt and aggregate-byte/terminal-reserve regressions are written but unrun.

### Completed-position encounters and rendezvous

`physical/Encounters.js` adds authored, revisioned encounter regions, distinct from
blocker contacts. Relative endpoint chords detect between-tick meetings; lane-X
and qualified-route distance never silently fall back to Euclidean distance.
Sorted stable actor pairs own hysteretic episodes, cooldowns and bounded nearest
neighbors. Opposing-crossing admission uses actual displacement, not sprite facing.
A continuing episode is not reattacked merely because actors stop moving.

Spatial bins cap swept memberships and candidates. Crowds above 32 actors in one
half-radius cell use an explicit density episode: exact contained-pair count,
stable representative voices, bounded root references and **censored cross-cell
pair detail**, not an assertion that every pair was individually observed.
Unknown membership/route coverage cannot generate a new pair. All responses retain
actual physical roots; interval exchange requires prior physical pickup pitches
and declares whether those memories swap or are only mirrored. No actor moves.

Rendezvous groups actual pickup arrivals within the authored simulation-tick
window, retaining each source time and recognizing only at the completed boundary.
Late arrivals start another window. Checkpoints copy open groups before freezing,
validate bounded nested arrivals on restore, and retain episode ownership across
recovery; world/generation changes cannot inherit it. Capture requirements include
relationship state and physical sources, and physical branches now preserve all
physical/rhythmic/action/tonal boundary components. Fragments remap encounter,
ensemble, pickup and route references and translate the region geometry. The
physical authoring preview shows those regions and exposes their grouping contract.

Regression and 8/128/512/1024-actor planning profiles are written but **not run**.
Browser interaction, sound quality, tail latency and memory qualification remain
deferred; semantic aggregation is not a DSP/render or acoustic receipt.
