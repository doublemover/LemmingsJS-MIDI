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
