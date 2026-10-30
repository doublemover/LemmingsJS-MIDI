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
double the audible master. Processor and host protocol fixtures exercise exact
frame ownership and finite-prefix finalization in `OwnedMasterCapture`; they do
not establish actual browser-tap or device qualification.

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
a full WAV copy; a full artifact digest is explicitly omitted. Capture is
memory-backed and cannot promise recovery
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

### Finite physical motif monitors

`PhysicalMotifs` validates sequence/conjunction, finite repeated events and
anchored absence clauses with tick/pixel units. Actor/cohort roles, distinct
participants, action-instance constraints, spatial limits and per-clause windows
are explicit. Conjunction can start with any clause; each observation fills at
most one compatible unfilled clause in declaration order. This declared greedy
monitor is not an unbounded backtracking grammar. First/last/all policies choose
which physical anchors remain eligible; expiry and generation changes retire them.

The owner admits at most 32 definitions, 32 expanded clauses each, 64 partials per
definition and a shared configurable partial/work cap. The default 8 MiB state
profile conservatively budgets 128 KiB per admitted partial (64 globally), including
bounded root/observation identities and role data. Censoring is visible, not a
successful near-match. Unknown relationship coverage cannot prove absence; an
absence requires a previously bound physical role and a contiguous complete
simulation interval. No wall-clock timer advances a motif while paused.

Completions carry exact roots, matched observation IDs, role bindings, any proven
absence intervals and the **recognition boundary**. Explicit accent/harmony/response
mappings create bounded rooted responses only there, never backdated notes. Physical
analysis exposes these facts for next-tick conductor composition; that feedback
owner remains separate. Checkpoints copy partial state, reject impossible progress,
and invalidate affected rule/ensemble dependencies. Fragment closure/remapping and
capture-profile v6 include motif definitions and state. Regression and workload
profiles are implemented but unexecuted; no recognition/performance qualification
is inferred from source or syntax checks.

### Physical activity, rests and crew cadences

`ActivityWindows` counts declared physical facts, authored held actions and owned
semantic voices against simulation-tick deadlines. Empty/static unvoiced scopes
never manufacture an initial rest trigger or background notes. A rest begins once
a complete, previously active interval reaches its timeout; the next actual cause
ends it without catch-up attacks. Current mute/solo/output availability and the
latest sink outcome are separate diagnostic fields—not inputs to physical timing.
A rejected output cannot manufacture absence. Unknown route/ensemble/topology or
source coverage invalidates the absence proof; explicit instrument policies may
release held voices on rest/unknown instead of silently resuming them.

Crew projects now publish canonical open, connect, individual arrival, completion
and failure facts. A bounded world-owned evidence table joins the exact admitted
opening/connection/arrival identities. Source gaps or owner-table exhaustion make
completion coverage incomplete, never a successful cadence. The final observer
also checks the completed living cohort and actual unchanged-route receipt before
emitting a finite authored cadence. Deduplicated completion ownership survives
checkpoint restore. This observation table is excluded from the physics projection,
validated on restoration and reset across generations. Producer refusal now returns
no staged identity, preventing dropped prerequisites from masquerading as admitted.

Activity state and prerequisite facts are in capture-profile v7; the physical-music
algorithm identity advances to v3 rather than silently claiming older execution
compatibility. Fragment closure/remapping includes scopes and cadence references,
while motif monitors can consume proven rest transitions. The authoring inspector
exposes physical silence and recent causes without probing audio. Lane availability
uses the existing indexed mix owner, and a refused mix publication remains retryable
when the audio clock becomes valid rather than caching an unsent revision.

Written regressions cover empty/static/held worlds, exact gaps, pause-by-no-ticks,
unknown-source cases, muted/rejected output, cadence deduplication and actual crew
owner failure/success joins. Planning profiles and all tests remain **unrun**;
no browser, PCM, real-time or acoustic acceptance is claimed.

### Physical release gestures

The Release surface edits a versioned recipe separately from performing it. Its
canonical `set-release-gesture` intervention enters the existing population owner
at the **next cohort**, never a second note scheduler. Integer tick gaps, explicit
lane phases, deterministic cohort spray, phase shift and one-shot squeeze support
finite attempted-birth budgets. Admitted cohort phases stay immutable. Locked
clock timing ignores adaptive load; adaptive mode exposes the realized interval.
Requests, committed schedules, actual `ActorBorn` facts and capacity misses are
separate records. Missing capacity consumes the scheduled slot; no later catch-up
birth or note is invented. Finite runs are discarded at generation change.

Save/Undo changes the recipe only. Perform and Pause are future-boundary commands;
cancel only removes queued commands. Loading never performs a saved recipe. The
editor is document-generation fenced; lane deletion explicitly remaps saved phase
indices and versions the recipe. Checkpoints retain the budget and admission
frontier, and command-tape replay uses the same owner. The release profile and
regressions cover real-world births, downstream moving-actor gate attacks,
capacity misses, continuation and renderer-time independence; they are written
but **not run**, and no audio/latency qualification is implied.

### Explicit physical feedback and intervention layers

Authored `physicalGraph.feedback` conductors and gate/motif-anchored layers read
committed facts, not sink receipts or renderer time. Bounded count/density windows,
hysteresis, occurrence selection and cooldowns produce canonical commands for
**tick + 1 or later**. Commands retain exact counted roots, rule revision, epoch,
feedback root and an eight-hop cycle-checked rule path. Manual commands win the
existing actor/resource arbitration; physical worker inventory and approved
junction geometry remain authoritative. An eligibility wait keeps the original
actor and expires; it never chooses a replacement or creates a fake action.

Dry-run suggestions never enter the world. Explicit Arm starts a new epoch;
loading does not arm, Stop/Panic disarms and cancels only owned pending commands.
Layer mute leaves already-built terrain/skills intact and consumes no missed
anchors on unmute. Bounded retained human command receipts can be captured with
an **explicit** gate/motif anchor and actor/cohort/motif-role binding. The editor
shows a definition/resource plan separately from actual accepted outcomes.
Fragment transplant remaps gate/motif/ensemble/route references and disables
transplanted rules; stable live actor targets cannot be copied into fragments.

Publication runs synchronously after a committed simulation boundary, with
reentrant stepping forbidden. A single journal input contains the prepared
canonical command batch and feedback state before publication; exact replay
applies that input without evaluating rules again. Incremental recovery records
the same command/state owners. A physical branch may explicitly regenerate under
a new epoch; event-tape inspection remains nonphysical. Capture refusal disarms
feedback and pauses the workstation rather than publishing an unrecorded effect.

Bounds are 64 rules, 16 proposals/boundary, 32 proposals/54 ticks, 1,024 proposals
per epoch, 16 per actor, 256 trace entries, 4,096 non-evicting occurrence identities,
2,048 recent root-ancestry entries, 262,144 predicate visits and 512 KiB of state.
Rule fuel is consumed by an attempted rejection; command-batch admission is
all-or-none. Unknown/censored ancestry, unresolved references and exhausted
budgets fail closed. These are implemented bounds, not measured performance.
Regressions and the 8/128/1,024-actor planning profile are written but **unrun**.

### Actor-borne phrase cargo

`cargoStations` attach capture, transform, exchange and delivery to actual pickup,
contact or qualified two-actor encounter facts. Typed payloads are a pitch,
rational pitch or at most eight physically captured/authored intervals. Cargo is
actor-owned data, not an audio voice. No elapsed time, transport beat or payload
step can emit an attack: only a delivery crossing creates `CargoDelivery` intents,
as one item or an explicitly declared simultaneous chord. Role-tagged payloads
can select authored delivery instruments without changing output routes implicitly.

Four slots per actor share a 1,024-token ceiling. Copying consumes a nonrefundable
family copy budget; every copy shares the family's finite delivery allowance.
Move/swap publishes both ownership changes atomically. Exact capture, transformation,
encounter and delivery roots remain attached; root/lineage overflow rejects the
operation rather than truncating its causal proof. Same-boundary station ordering
uses explicit priority then stable ID. Expiry and actor/generation removal dispose
cargo, ordinary lane transfer preserves it, and checkpoint frontiers prevent a
repeated boundary from delivering twice. Incomplete recent physical history cannot
be promoted into a complete interval phrase.

Token/history byte admission precedes publication (32 KiB per item, 2 MiB total
state including reserved metadata); family indexes avoid pairwise scans and ensure
that retiring one copy does not refund duplication fuel. Shared process-wide
resource reservations remain tracked separately. The Physical scene editor stages
a real courier-chord graph, validates and saves canonical revisions, and inspects
actual tokens, roots and family budgets. Fragment remapping and causal capture v10
include the cargo domain. Written regressions use real walking/blocker actions to
vary delivery time, plus copy/swap, checkpoint, expiry, gap and no-delivery fixtures.
Those regressions and the cargo profile remain **unrun**.

### Semantic swarm reduction before output budgets

`physicalGraph.swarm` is a versioned, backend-independent interpretation policy:
`representation` is `individual`, `centroidChord`, `densityCloud`, or
`representativeStrikes`; `groupBy` selects onset neighborhood/action/cohort,
lane, mapping, and/or role. Routes never coalesce. `windowInSimTime` is an
integer simulation-tick window (1–600), not a wall-clock timer. Authored
`priorityRules` match source kind, role, mapping, action, or lane; ties use
stable identities and least-recently-served groups. The scene editor stages a
64-voice density policy with explicit cadence/route/contact salience, and its
inspection reports requested versus represented events, raw coverage, owners,
rolling state and capacity fallbacks. JSON editing uses the existing canonical
revision/Undo boundary rather than an independent live configuration.

The engine admits up to 4096 raw physical begins before this semantic policy;
its default legacy source cap remains unchanged when reduction is absent.
Individual mode selects exact source voices. Centroid mode allocates a mean,
minimum, maximum and bounded intermediate chord; density mode represents a
group's actual activity with a bounded mean-pitch texture; representative mode
selects an authored-salience physical source. Each intent carries source count,
actor/cohort/root set references, covered source time, extrema *as metadata*,
and explicit detail loss. Bounded sampled references are not claimed complete
root lists or cryptographic identities: the unchanged physical journal is the
source of truth. Aggregate textures are never described as exact replay.

Held physical owners and audible aggregate owners are separate. A policy
handover first ends previous audible identities, then explicitly revoices
still-held physical sources at the handover boundary; it is not a new physical
strike. Every physical end is consumed, and the last aggregate member ends its
owned voice. Omitted held voices do not autonomously restart when capacity
opens. No rolling-window timer creates an attack, and no backend receipt,
transport, mute, or DSP admission participates in reduction decisions.

Bounds are 4096 held sources (4 MiB), 512 retained groups, 4096 tick buckets,
512 audible voices (2 MiB), 4 MiB transient source records, and an 8 MiB serialized
continuation. Neighborhood/action/cohort bindings are fixed at the physical
onset rather than silently retriggering moving actors. Group/window/source
capacity selects declared representative-strike fallback with bounded rotating
priority-band coverage; owner-byte refusal further reduces to one explicitly
lossy bounded representative strike. Window state retires with simulation time,
not total session duration. Full reducer continuation, including a pending
policy handover, is included in physical capture profile v11 and engine replay
identity v5. Raw journal thinning remains a separate coverage outcome.

`test/procgen-swarm-reducer.test.js` covers the 4096-strike/1024-lane/64-voice
case, order/backend independence, priority/fairness, held handovers and terminal
ownership, restore, quiet-state retirement and raw-fact isolation.
`scripts/bench-swarm-reducer.mjs` profiles these four modes independently of DSP,
records environment/source identity, p95/max timing, retained heap delta and
retirement. Both are implemented but **not run**; no timing, allocation,
browser or acoustic qualification is asserted.

### Scoped keyed probability and physical alternatives

Instrument `probability` is a versioned policy with cause/actor/cohort/encounter
identity, generation or stable reseeding, an optional owner seed, a clamped
threshold, a purpose, and at most eight local descriptor conditions. Crowd
means an explicitly defined 64-pixel cell count—not inferred global density.
Work/motion descriptors use actual committed payloads; unknown evidence fails
closed with an inspectable reason. Stable reseeding omits only the generation
salt: a genuinely different cohort or encounter identity still gets a different
draw. Probabilities never manufacture a source event or a musical clock.

The graph's `randomSeeds` explicitly overrides only `musical-response` and
`physical-route`; changing either does not rebuild terrain or alter population.
Terrain/population seeds belong to a newly generated world, not a covert live
mapping edit. All four namespaces share the fixed UTF-16 keyed algorithm and
checked-in cross-namespace/Unicode vectors. Default release ranks, scout cadence
and ability choices, and terrain challenge schedule/shape selection now use
separate named purposes rather than a shared or order-consumed random cursor.
Scout choices retain the one-in-N cadence; source facts and challenge descriptors
carry their actual decisions. Runtime source identity is generator v2 / physical
music v6; this is an explicit source-version change, not a promise that an old
terrain seed produces the old geometry under new code.

Conditional physical branches are restricted to worker, blocker/release and
approved junction commands. Current crowd/action/support descriptors are read
at the actual command boundary; the existing inventory, geometry, target,
manual-priority and transaction checks still decide whether a selected command
can execute. A selected but impossible alternative remains `CommandRejected`.
Feedback encounter policies retain the verified source occurrence and root
ancestry, while exact tape replay applies recorded commands rather than running
feedback twice. Human-captured layers preserve the probability policy.

Positive decisions travel with begin intents; negative decisions are available
in `engine.probabilityAnalysis()` and the musical journal companion. Per-boundary
records cap at 8192 decisions / 1 MiB, explicitly count omitted diagnostics, and
do not relabel unchanged physical-source coverage. Exact re-performance compares
recorded decision companions as well as resulting intents. Diagnostic traces
have an explicit capacity (at most 8192); no infinite random history is retained.
The scene editor can stage a cohort probability policy through canonical Undo.

Additional scope/reseed, namespace, local-descriptor, order/mute/backend,
negative-evidence and impossible-worker fixtures are written in
`test/procgen-causal-probability-policy.test.js`; existing 10,000-cause endpoint
and declared ±3-percentage-point uniformity-smoke fixtures remain **unrun**.
The new stored vector fixture was authored with an independent UTF-16 reference
calculation, not generated by executing the application under test. No
statistical, physical-runtime or musical-quality qualification is asserted.

### Independent lane sound/world identities and rollback

Lane sessions now preserve `worldThemeId`, `instrumentPatchId`,
`performanceRecipeId`, optional `linkedThemePresetId`, and an explicit
`soundChangePolicy`. Family-only lanes migrate to the equivalent legacy IDs;
palette edits no longer rebuild terrain or overwrite external program,
percussion, channel, key or route settings. **Apply matching world** is the
separate safe-restart operation. Sound Undo/Redo does not restore a physical
checkpoint. The live adapter declares `new-notes-only`; unsupported held
crossfade is rejected with that named fallback rather than silently retheming.

Prepared instrument publication retains the prior renderer until acceptance.
Cancellation or unpublished project failure restores its assignment
synchronously, guarded by a monotonically increasing assignment receipt: even
a newer selection of the same renderer key cannot be overwritten by a stale
rollback. Held voices keep their onset renderer and its tail ownership. An
unacknowledged rollback keeps its old renderer pinned and blocks further
preparation instead of pretending cleanup succeeded. Sound/control conflicts
reject a stale prepare; unrelated mix/routing edits are preserved.

The existing sound library now owns **Hold to preview incoming events** for
pointer/Space/Enter gestures. Release, cancel, lost capture, blur, window blur,
close, history/world replacement and disposal retire the preview; **Apply**
publishes one musical edit. Preview references are ephemeral lane overlays,
never saved project fields. Accepted unrelated mix/routing changes survive;
conflicting sound/control changes cancel. Old held voices retain their onset
renderer under the declared new-notes policy, including after preview release.

`NativeSoundCollections` is independent of terrain: six native collections and
27 concrete recipe IDs retain all 160 legacy family/role/variant IDs as explicit
aliases, not bit-identical GM emulation promises. The existing selectors compile
immutable source recipes through bounded background owners, pin the exact
engine/definition hashes, and publish only after renderer preparation. Source
preview without a bound renderer artifact refuses preparation. Worklet sources
need an available local AudioContext; failure preserves the previous selection
and offers the named **Soft triangle** fallback as a separate explicit action.
No automatic fallback rebuilds terrain or rewrites external program/channel
mapping. Shared-channel program/bank/percussion conflicts are reported.

Both native source preparation and the sound transaction cap concurrent owners
at two, charge retained definitions and compilation representations, and keep
charges on unknown worker/renderer retirement. Rights metadata is unchanged;
local recipe selection grants no redistribution permission.

Authored regressions include same-checkpoint physical hashes, six patches over
1000 real-world ticks with the pattern path disabled, causal order equality,
slow/fast/cancel/control/document races, rollback, one-edit Undo, imported legacy
IDs, explicit matching-world action, hardware conflict warnings and a real
immutable-browser keyboard-preview journey. They are **not run**. Neither the
silent host fixture nor static checks claim PCM, browser or acoustic qualification.

### Macro performer leases

The SOUND inspector now uses the shared typed knob for admitted **onset-only**
macros, with per-control momentary return and pen/touch pressure. Pressure is
normalized model input, never a measured force. Authored bipolar controls map
negative pressure below the saved baseline; positive pressure maps above it.
Saved defaults and user overrides remain distinct. Preview overlays are limited
to four active gestures, affect only future causal onsets, do not create notes,
and do not mutate the project, terrain, simulation RNG or undo history. A latch
commits once; momentary release/cancel returns to the accepted baseline.

Macro Learn binds an observed CC, bend or channel-pressure message to the exact
selected endpoint and connection epoch. Absolute controllers use crossing pickup;
pressure is momentary. Disconnect commits the final accepted latching value once
(or visibly reports rejection), rather than substituting zero. Mappings are
session-owned, bounded to 32 and invalidated by document/patch replacement; they
are not persisted as fictitious portable device bindings. Relative controllers
and device-side value readback remain separate unfinished owners.

Causal takes sample effective macro overlays at committed physical boundaries,
not at UI event cadence. Interleaved canonical gain/pan changes retain active
macro values in the sparse performance journal; return-to-baseline is recorded
before the next physical batch. Patch selection waits for performed macros to be
committed or returned. Pickup display updates cannot overwrite a drag's draft,
and rejected canonical knob publication restores its accepted displayed value.

The oscillator recipes now declare four independent edge/body/rise/tail controls;
FM adds a release-tail control and declares bipolar hardness. Concrete changed
recipes receive new immutable revisions; the unsupported held-sine recipe does
not acquire decorative macros. Native and owned renderers still advertise their
actual onset/continuous capabilities. Endpoint/grid PCM qualification and the
broader qualification/listening package are not yet implemented in this increment;
no audible result, safe continuum, sensitivity study or completed #971 is claimed.

### Source-bound sound qualification implementation (not executed)

`SoundQualificationPlan` compiles an exact patch/build/fixture plan for MIDI
36/60/84, velocities 24/64/110, short/held gates, repeat/Panic/unsupported-control
and over-budget cases. Every macro has 0/0.5/1 note/real-event samples; every pair
has a finite 5×5 grid. Missing sparse/medium/dense real captures remain explicit
coverage gaps. The separate fixture-capture command runs the real shared walking
world and causal engine, preserving checkpoint/fact/intent/source hashes; authored
isolated notes are never mislabeled as recorded physical takes.

The runner uses the existing native OfflineAudioContext driver or owned source
kernel render path, with explicit target controls rather than rewriting immutable
patch defaults. Shared native onset submission now retains those admitted controls.
An owned Panic opcode and quantum-aligned native source teardown are measured as
separate offline stop probes; **live worklet-port/Panic-button conformance remains
separate**, not inferred from these probes. Source metadata preserves effective
render inputs, semantic voice counts, backend admission and actual PCM as separate
receipts; source subevents never become composition onsets.

The measurement pass records peak/RMS/DC, nonfinite/full-scale samples, silence,
attack slope, censored decay, channel-energy spectra and onset/body/decay slices.
Anti-phase stereo does not disappear into a mono sum. Pair comparisons normalize
spectral power, RMS envelope and declared pitch reference; similarity flags a human
review candidate, never musical quality. Reports retain failed inputs, missing
physical controls, omitted modes, exact per-engine/rate repeat tolerances, velocity
plateaus and partial/cancelled/budget-limited coverage. The runner serializes work,
reserves bounded analysis/report/repeat storage and emits every completed case
before moving on. Unknown renderer retirement blocks subsequent work.

`qualify-sound-content.mjs` snapshots and serves only its complete local module
closure, binds actual engine artifact hashes, and writes private WAV/case/plan/report
artifacts under a new `temp/` directory. No runtime bundle receives generated audio.
`create-sound-listening-set.mjs` creates identity-neutral, pair-relative level-matched
A/B files and a keyboard-accessible browser review form; exact sources and intended
differences stay in the separate private key. Review imports hash-bind each version,
retain reviewer aliases and headphone/small-speaker plus quiet/dense conditions,
and leave skipped/incomplete reviews pending. A listening-accepted record does not
by itself accept the patch.

Still-development work for the full #1002 contract includes the complete imported
fork/derived scene/instrument-journey matrix, modeled/decomposed material reference
corpus and tier-specific conformance linkage. The default CLI does not install
sample assets: required assets must be supplied through the shared renderer's owned
asset adapter; otherwise the exact case is degraded, never replaced by silent or
unrelated audio. Sensitivity-study/domain-map integration for physical or nonlinear
controls is also unfinished. All newly authored qualification code and fixtures are
unrun; no PCM, listening, corpus capture, benchmark or browser result is claimed.

### Revision-safe pressure and overlapping survey preparation

Resource replacement revalidates the exact target entry after **every** eviction
callback, not just its owner or byte size: transfer-back, release/recreate and
same-sized nested replacement cannot publish a stale admission. Generations move
only through explicit transfer; optional revision-qualified release rejects an old
lease. Evictors run by declared priority then least-recently-served order, retaining
bounded per-owner failure/miss/reclaimed-byte telemetry. Category peaks and measured
admission time are separate from synchronous queue wait (zero); clock failures do
not change authority. Unknown native/GPU overhead remains an estimate.

Verified survey loading now shares one aggregate 64 MiB stream admission across
four readers, before each owned copy. Its preparation reservation covers raw storage,
copy/digest overlap and reader slab headroom, then shrinks to verified retained raw
bytes. Content-Length is only an early rejection hint. Aborting the caller does not
release storage while a platform producer still owns a pending read: the retirement
receipt remains pending/unknown until its actual settlement, and late bytes cannot
publish into the canceled source map.

Before classic decoding, bounded container metadata and ground dimensions admit
mask/palette/fingerprint expansion separately from the candidate-world estimate.
Temporary BinaryReaders and FileContainers retire explicitly. A live trial pins
raw, decoded and candidate owners; browser disposal retires physics and drops the
trial's world/actor/terrain references before returning capacity. The world exposed
by a trial is borrowed only until disposal; results must be captured beforehand.
Physical-observer shared-budget integration remains development, not a consequence
of these local owner repairs. The added concurrency/lying-header/ABA/decoder tests
have not been run; no peak-memory or combined-scene qualification is claimed.

### Shared physical interpreter ownership

Live playback and isolated causal re-performance now pass their shared budget to
one interpreter owner before allocating observers. Its declared profile separates
core/trace/swarm, spatial/tonal/rhythmic/action, encounter/motif/activity and cargo
estimates. Enabling a feature admits its high-water profile **before** changing
observer configuration; disabling it cannot pretend still-retained continuation
state has disappeared. Snapshot/restore stages reserve old-plus-new overlap, and
unchanged boundary snapshots reuse their immutable projection rather than copying
all observers for every display/save consumer. The trace also has a byte ceiling,
with omission diagnostics, independently of its row limit.

Restore staging now inventories validated input bytes/nodes without encoding a
second copy, admits a bounded input-scaled temporary estimate, and constructs a
normalized immutable snapshot before publishing the new owners. Nested imported
voice data is copied independently. Reading that unchanged restored boundary
reuses its projection without another full-capacity staging lease. Retained
high-water capacity and hard local/global limits still apply; these are declared
estimates, not measured browser heap. Replay failure receipts identify the
preparation stage so allocation refusals can be attributed.

The retained snapshot is borrowed until the next engine mutation/disposal; any
longer-lived checkpoint/archive owner must account its own retained copy. Profiles
are explicitly estimates over local bounded state, not browser heap measurements.
Failed staging retirement blocks further use rather than granting a new lease.
Playback construction unwinds earlier audio owners on interpreter admission failure;
processing faults stop audio ownership without changing authoritative physics.
Re-performance waits for processing quiescence and world retirement before dropping
observer storage. Feedback controllers separately admit their bounded state, plans,
capture history and staging and expose retirement receipts. Disabled swarm reduction
can no longer create an audible-owner list larger than its continuation schema.

Broad combined-scene estimate qualification is deferred. Pre-admitting *all* observer
profile growth as part of the upstream canonical authoring transaction, rather than
at interpretation of the newly accepted graph, remains development work; the graph
is not automatically rewritten or physics thinned when that admission is refused.

### Prepublication graph resource transactions

Physical graph admission now participates in canonical authoring rather than
waiting for the first interpreted batch. A world-scoped, nonserialized owner
registry stages every interpreter's capacity before an immediate mapping is
journaled or its topology/graph is published. Atomic terrain+graph commands admit
at their commit boundary before the first terrain write. Owner replacement,
generation changes and disposal invalidate a prepared proposal. Another owner's
refusal cancels earlier uncommitted growth; cancellation preserves independently
committed high-water capacity. The proposal set is bounded and does not enter
checkpoints as executable state.

Live playback initially admits its complete graph and unregisters on disposal;
isolated re-performance binds its own registry entry. Failed/canceled project edits
cannot consume Undo history or advance the physical graph merely to discover
insufficient interpreter capacity later. Physical history also treats a false or
asynchronous release as unacknowledged, retaining the capsule and pressure instead
of dropping its sole recoverable state. New real-world/controller and stale-owner
regressions are authored but unrun. Shared profile estimates and combined allocation
qualification remain explicitly separate from these source-level contracts.

### Durable recovery versus resource retirement

Recovery now records storage durability and resource retirement as independent
outcomes. Once IndexedDB commits a generation, a cancellation racing its completion
callback cannot relabel it unsaved. Worker-result cleanup must expose a released or
canceled owner receipt; false, asynchronous or unknown release stays visible. A
completed generation with unresolved cleanup is reported as durably saved with a
capacity warning, not silently accepted cleanup and not a fabricated failed write.
Owned read sources repeat their unresolved retirement outcome instead of hiding it
behind an already-released boolean.

Replacing a recovery base cannot free the newly published base when retirement of
the previous generation fails. World disposal still retires independent physics
resources and then preserves that error for repeat callers. Cold renderer pressure
now reclaims only the accounted deficit, with a finite eviction-work bound, ahead
of the more expensive decoded-asset caches; active surfaces remain pinned. These
are deterministic ownership contracts with authored fault-injection coverage, not
executed browser/IndexedDB or resident-memory qualification.

### Recovery source generations and cross-storage retention

Recovery database version 6 commits two small source-provenance records in the
same IndexedDB transaction as each rotating recovery manifest. They identify the
saved session's bound deployment/build, not the code currently writing an imported
session. Explicitly unbound sessions make no historical-source claim. Legacy slots
are migrated using existence counts only; unknown provenance conservatively blocks
cache retirement until both slots have been superseded with known provenance.

CacheStorage deletion and the final recovery write transaction share an
origin-scoped exclusive Web Locks name. Encoding and checkpoint capture occur
outside that lock. This closes the read-pins/commit/delete race between independent
storage systems; atomic IndexedDB records alone would not suffice. Recovery remains
available where Web Locks are absent, but source trimming is then deferred. A busy
lock or unresolved pin read also defers trimming, never steals a lock or deletes
recordings. The worker inspects only two metadata records, bounds their read wait,
and includes live worker clients as well as windows when retaining generations.
Pins retain already-installed source packages; they do not manufacture missing
historical code, guarantee storage against browser eviction, or attest that an
unbound imported session was executed by its current writer.

The source-pin, interrupted-transaction, deferred-retirement and lock-exclusion
regressions are written but unrun. Browser cross-context behavior and persistence
qualification remain deferred, as do combined-scene/recovery timing measurements.

### Combined resource/recovery evidence producer

`profile-resource-recovery.mjs` builds a new immutable local application namespace
and serves only its hashed inventory plus eight original deterministic PCM memory
fixtures. Six required cases cover 8/128/1024 lanes at DPR 1/2. They exercise real
64-step complementary patterns, an 8192-cell canonical terrain command, 30.72 MB
of pinned native-decoded AudioBuffers, eight real CCTV rasters, quiescent checkpoint
capture, incremental worker recovery, aspect-ratio resize, pressure refusal and
candidate replacement while the earlier performance remains owned. Fixtures are
not field recordings and this is not acoustic qualification.

Receipts separate synchronous session-envelope capture, cooperative full capture,
worker queue wait, encode elapsed time and IndexedDB commit time. The checkpoint
cooperator targets 3 ms to leave headroom beneath the declared 4 ms measurement
limit; the producer reports actual overruns rather than treating the target as a
measurement. Actual trusted browser clicks measure event-to-next-frame delay;
separate driver round trips include automation overhead. Raw scheduling/frame
and interaction tails are retained, with explicit overflow and unsupported
long-task observation. Memory receipts report category peaks, bounded owner
snapshots with omitted cost, eviction/reload counters and native overhead estimates.
Synthetic context-loss events exercise lifecycle handling, not driver-loss proof.

The evaluator rejects missing tiers, missing active ticks, partial combined
workloads, unknown cleanup, unobserved overlap and lost timing tails. A capacity
refusal is distinct from a successful replacement and must preserve the current
world. Browser contexts and reports are private/new; the tool neither publishes nor
reuses a user's browser. All scenarios and expanded fault fixtures remain unrun.
Large background worker input still uses whole-object structured cloning at this
checkpoint and is explicitly remaining development, not hidden behind the harness.

### Bounded worker input transport

Background protocol v2 no longer posts a complete recovery/project/terrain input
object. A cooperative value-copy iterator emits at most 256 operations and 64 KiB
per packet, preserving numeric values, UTF-16 strings and supported binary view
types. Binary payloads are copied into fresh 32 KiB slabs and only those slabs are
transferred; live terrain, native AudioBuffer data and pinned checkpoints are never
detached. Input remains the caller's stable, privately owned snapshot until its
retirement acknowledgment. Aliasing is not a semantic input to these pure kernels.

There is one unacknowledged packet per worker. Job/epoch/revision/build, sequence,
shape, depth, cumulative footprint and allowed property checks precede reconstruction.
A crash or cancellation rejects the pending acknowledgment and joins the producer
before releasing input ownership; uncertain worker termination retains its charge.
Each worker job reserves a further 128 KiB for bounded transport overlap before
input preparation. The producer targets 3 ms, uses feature-detected background
`postTask` with a macrotask fallback, and reports enumeration plus synchronous
postMessage cost separately from acknowledgment wait. Those are observed receipts,
not a hard realtime assertion.

The impulse analysis worker path also now derives source-byte/node inventory from
its actual validated PCM and descriptor instead of referencing metadata before
initialization. Large nonbinary **result** messages still need the symmetric paged
path; recovery's encoded byte buffers already use explicit transfer. Protocol,
producer-cancellation, stale-stream, source-buffer and kernel regressions remain
unrun, and no browser/performance qualification has been executed.

### Symmetric worker result ownership

Protocol v3 streams object results back through the same bounded value grammar,
with one result packet awaiting acknowledgment and cooperative main-thread
reconstruction. The host checks executing build and owner identity before creating
a result receiver and exposes no value until its final sequence is complete.
Cancellation drops the partial graph and waits for any in-progress host slice
before acknowledging resource retirement. Observed retained representation cost
must fit admission; it is no longer silently clamped to the requested estimate.

An explicit allowlist of up to 32 **complete, worker-owned** output buffers retains
zero-copy transfer for PCM and encoded recovery/export bytes. These buffers can be
larger than the 64 KiB cloned-metadata packet bound, but remain constrained by the
admitted output footprint and are reported separately as owned-transferred bytes.
Aliased ownership is rejected rather than detaching a later reference silently.
Other binary views use bounded copied slabs. Strings are assembled incrementally,
not joined in one final main-thread traversal; engine-specific rope flattening and
native transfer costs still require the deferred browser measurements.

Result-slice timing joins the resource/recovery harness. Stale, partial, canceled,
corrupt and duplicate-ownership streams have authored regression coverage, still
unrun. The remaining recovery algorithm work is separate: its manifest still
re-encodes the complete authored project instead of reusing immutable lane pages,
and transaction scheduling needs bounded chunk publication.

### Immutable authored recovery pages

Recovery manifest v2 separates authored lane pages, other project component pages,
and pattern/physical continuation from the small session envelope. Workstation
publication verifies and seals plain-data descendants; its private verified-node
set skips already sealed subtrees on structural edits. Only those verified nodes
qualify for identity-based durable reuse. A shallow freeze or unchanged mutable
object identity cannot preserve a stale encoding. Initial publication sealing is
not claimed to be free or to meet the recovery slice budget.

A one-lane edit replaces that lane's page and the manifest, rather than serializing
all 1024 lanes again. Large authored fields have independent bounded pages; mutable
continuation snapshots are freshly encoded. Legacy v1 manifests remain readable.
The reader verifies unique complete reachability, component checksums and exact
aggregate stored length before exposing a session. All decoded source leases stay
owned until the reader releases them.

IndexedDB publication and reads chain one request from the preceding success
callback, keeping the transaction active without queuing thousands of requests in
one synchronous loop. Both recovery slots and source-generation pins retain their
single atomic commit. Transaction submission slice receipts join the qualification
harness; they are measured, not assumed. Large individual encoded records still
need physical fragmentation to bound their structured-clone cost. Regression
fixtures cover incremental reuse, mutable callers, v1 migration, malformed
references and every expanded write boundary; none have been executed.

### Physical storage fragmentation

Large encoded pages now use logical metadata plus independently owned physical
slabs of at most 64 KiB. A slab is sliced only as its transactional request is
issued; a view into the full backing buffer would not provide the same
structured-clone bound. The existing atomic transaction includes every part,
manifest, head and source pin. A separate admitted staging lease covers bounded
slab overlap and reachability metadata before they are materialized.

The reader checks each part's owner, index and exact expected length, retaining
all source leases. It sends the parts through the admitted worker transport; full
encoded concatenation, checksum and decompression happen in the decoder, not in
a final main-thread join. New-write payload and observed transaction-slice maxima
are explicit harness gates. Legacy unfragmented records remain readable and their
read payload maximum is reported separately. Missing/corrupt/reordered parts and
termination/quota failure at every physical-write boundary have authored fixtures.
No fixtures or browser measurements have been run. Continuation snapshot capture
and initial project publication costs remain distinct from bounded storage I/O.

### Shared content retirement barriers

Shared pure computations retain their identity until the last consumer and the
backend have acknowledged retirement. Pending cancellation is not an available
cache slot. False/asynchronous cleanup acknowledgments, unknown worker teardown,
and failed duplicate-input cleanup remain quarantined and visible in bounded
registry diagnostics. One consumer's cancellation does not cancel another;
backend disposal does invalidate all delivered views without pretending their
retained ownership has already been released.

The explicit pure-kind registry now includes deterministic encoders, verified
source decoders, content compilation and inspectors. Identity includes declared
content/decoder versions, limits, budget scope, deadline and priority. The caller
must supply the complete immutable input identity and treat borrowed shared data
as read-only; membership in this registry alone is not a producer integration or
publication authority. Ground decoding uses the acknowledged lease contract and
clears its hydrated wrapper on release. Other producer integrations and the full
concurrent import/export/terrain qualification workload remain development.

Original procedural biome/tactile/impulse generation now uses the service-scoped
shared registry in the real material provider. Its key pins the exact expected
byte hash and original generator/id version; separate provider Blob loans remain
independently owned. Canceling one provider does not cancel a surviving generation
consumer. This adds a concrete producer integration beyond terrain decoding,
without describing procedural assets as field recordings. The cross-provider
cancellation fixture is authored and unrun; import/export and native PCM sharing
still require their own source/result ownership integration.


Spectral freeze window evidence is now a separate processor acknowledgment in
captured effect history. Revision `owned-radix2-stft-freeze-v2-window-evidence`
retains the actual observed hold-request frame, exclusive capture end, complete
N-frame input window, serial, profile/grid identity and attenuation metadata.
The native graph, owner route and session preserve that packet under the existing
source-intent audio-clock anchor. It is digital processing evidence; it neither
identifies all contributing actors nor proves acoustic output. Metadata credits
bound the worklet to four outstanding acknowledgments; overload quarantines that
owned graph rather than growing a message queue. The admitted profile includes
a conservative 128 KiB transport/metadata allowance. Device cost is unmeasured.

Newly published graphs identify this evidence policy. Captured revoice validates
serial coverage, discrete held intervals, source rate, exact analysis-grid origin
and full window coverage before rendering. Same-frame control replacement uses
the final value. An acknowledged capture is staged on its exact original window;
the new owned graph must confirm that complete window at its end. A lost capture,
missing earlier input, changed rate/grid, foreign clock owner or unavailable new
source fails explicitly. A request canceled before the next possible analysis hop
creates no invented capture. Original request metadata remains distinct from the
new realization's late staged request, which preserves the window frontier.

The revoice analyzes newly rendered material from cleared memory. It does not
restore the original live spectrum, input PCM, processor transport queue or entire
host state. Original silence/peak/normalization remain source evidence; new input
may produce a different spectrum. Older command-only histories retain their
explicitly limited request-replay description. General multi-graph/lifecycle
reconstruction and arbitrary live DSP restoration remain open. New numerical,
state-cut, credit, history and grouped window-replay fixtures are authored but
unrun; browser/PCM/listening/cost qualification is still pending.


The original friction foundation defines Hairline, Glass Drag and Rosin Grain
modal bodies with a sealed relative-velocity force port. It uses positive damped
implicit midpoint modes and a smoothed Stribeck/Coulomb curve. If contact velocity
is `a + Y*F`, the source solves `F = friction(vBow - a - Y*F)` in a fixed bracket
with sixteen bisections. A conservative bound keeps `Y*maximumNegativeSlope < 0.5`,
so the root is unique in the declared rate/control domain. The force has the same
sign as relative velocity; a numerical sign projection removes a force that
would violate this condition. This is an original bounded model specification,
not an empirically qualified violin or a physical force measurement.

For midpoint modal energy, the discrete identity is
`deltaE + linearLoss + F*(vBow-vContact)*dt = F*vBow*dt`.
The kernel checks its positive numerical defect before emitting output. At rest
`vBow=0`; changes in contact pressure can dissipate existing energy but supply no
bow work. Positive mode loss retains the declared tail. Digital frequency/T60
poles are converted to positive midpoint coefficients at onset. Output reads two
signed velocity observations through a common reference and a 20 Hz DC blocker.
Rosin's positive roughness field is attached to four-pixel spatial cells; its
20–80 ms interpretation applies only at observed speeds of 50–200 pixels/s.

Background references: [Russo, Ducceschi and Bilbao on modal bowed-string energy
balance](https://mdphys.org/PDF/dafx_2022.pdf) and the [Faust physical-model
inventory](https://faustlibraries.grame.fr/libs/physmodels/). The new source code
specifies its own bounded scalar solver, parameters and observations. The
`worklet-friction` engine integrates the existing two-slot owned voice/gate,
canonical signed-axis motion, typed patch/content, control-render and physical-take
revoice paths. Exact kernel cuts retain modal/contact/filter state, source token,
epoch/generation, motion frontier and queued core commands; restore independently
validates coefficients, positive losses and accumulated energy before mutation.
This API does not certify an arbitrary live host checkpoint.

The library stages three ordinary recipes with DRAG, PRESS, EDGE and BODY controls
for new voices. Real playback requires committed microsegment coordinates and
explicit actor, journey/contact/action scope and source-event ancestry. The
78-pixel/650-ms control audition is labeled as authored control movement, not a
physical take. Pitch selects the body at onset; live pitch bend is rejected.
Source iteration/mode/slot policies are bounded but unmeasured capacity, not
automatic qualified quality tiers. `scripts/qualify-friction-source.mjs` authors
the grouped sixty-second speed/pressure/rest/reversal and numerical/cost evidence
run at all three rates. It and the new integration/state-cut fixtures are unrun.
Stability-region, spectral/alias/tone, physical Bow Orchard playback, device cost
and matched-level listening qualification remain pending.


The original wind foundation uses a bounded **saturating negative-resistance
modal port**, rather than claiming a measured clarinet/flute implementation. The
force is `F = cap*tanh((a + Y*F + filteredBreath)/velocityScale)` with positive
modal midpoint losses. Its conservative slope product stays below 0.25, making
the scalar residual strictly increasing; twenty bisections bound work per sample.
The exact discrete energy identity is `deltaE + positiveLoss = F*vContact*dt`.
Pressure supplies that port's work. Zero pressure removes it; existing positive
body loss can ring. The kernel checks energy balance and finite output before
emission, with independently owned fixed arrays and containment on invalid state.

Hollow Reed uses an odd modal family, Air Pipe an open-pipe harmonic family.
LENGTH is a relative acoustic size (`actual base Hz = onset Hz / LENGTH`), with
admission checking the published root domain. It never changes terrain. AIR,
BITE, LEAK and bell opening are normalized authored controls. Seeded breath is
filtered at 900 Hz highpass/6 kHz lowpass with a maximum -26 dB reference scale;
its noise draws create no semantic attacks. The experimental Overblown Branch
arms below 0.32 and rises above 0.42 normalized effective pressure, allowing at
most one octave change per held source. The coordinate change preserves modal
energy; it does not allocate another voice. This is an authored register policy,
not an empirically found stable region or calibrated reed mechanism.

Background references are [Smith's woodwind negative-resistance discussion](https://dsprelated.com/freebooks/pasp/Woodwinds.html)
and the [Faust physical-model inventory](https://faustlibraries.grame.fr/libs/physmodels/).
The new kernel specifies its own curve, modal coefficients and register policy;
no third-party implementation is copied. `worklet-wind` now integrates the owned
voice/pressure/lifecycle, typed patch/content, explicit held-pressure control
audition and offline/revoice paths. Exact kernel cuts retain nonlinear/modal,
noise/filter, register, gate/identity and future command state. Restore validates
coefficients, energy, hysteresis and the deterministic noise age with a bounded
logarithmic jump; it does not replay a long audio prefix on the control thread.
The new ordinary recipes expose AIR/BITE/LENGTH/LEAK at onset and existing held
channel pressure for active bodies. Unsupported live pitch bending is rejected.

`scripts/qualify-wind-source.mjs` authors the three-rate pressure/pitch/bite grid
and sixty-second sustains with finite/DC/energy/register/pitch/cost observations.
It and the new integration/cut/forged-state fixtures are unrun. Continuous
stability regions, dropout/unwanted-register review, spectral/alias/pitch/device
cost, Breathing Stairwell and levelmatched listening remain pending. This
selectable experimental model is not a qualified wind emulation.


Captured native-API command revoice now admits **single-graph** mute, tail,
neutral and Panic for ordinary owned effect graphs. The new realization projects
the captured API frontier, preserves the existing 20-ms input/dry envelopes,
continues processing behind mute, clears on neutral/Panic, and retains a tail
through its declared transition-plus-maximum-tail deadline. Controls remain valid
while muted; later commands after detachment fail. A missed lifecycle frame fails
before graph traversal. Shared return taps are explicitly internal node outputs
before the owner's lifecycle output gate, so a muted internal tap is not claimed
to be the audible master return. This replays the declared API operation into new
memory, not observed device timing, original PCM or timer-delayed retirement.

Processor-owned membrane/network/spectral lifecycle, body-only message-port Panic,
owner-stop without tail disposition, multiple graph replacement and native
convolution command scheduling remain unsupported. Their missing lifecycle facts
are not inferred from host calls. Grouped supported-rate/mode fixtures compare
the owned driver against the actual owner host's recorded gain automation; control,
invalid/late and processor-boundary fixtures are authored but unrun. Browser PCM,
actual device application and listening remain pending.

Queued controls accepted before a detach keep their original submission ancestry:
neutral/Panic cancel them; tail retains those inside its declared deadline.
Commands actually submitted after detach still fail. The prepared replay records
canceled/retained sequence IDs and never mutates the captured history. These
additional scheduling fixtures are authored but unrun.


The paired resonator primitive retains one private complex state per reviewed
named slot, with at most eight slots in its initial profile. Frequency and
amplitude T60 follow exact positive log curves; signed injection/observations use
the common raised-cosine reference. Changing frequency rotates retained synthetic
coordinates and positive damping contracts them. It is not a mechanical
coordinate projection. Unmatched modes retain prepared private state behind their
explicit injection/observation windows. MORPH alone injects no body work or
semantic onset. Coefficients cache when MORPH is unchanged; moving-control device
cost is unmeasured. Normalized finite force uses an authored scale, not Newtons.

The discrete norm balance separates impulse work and positive modal loss, with
finite/energy/output containment. Exact private-kernel cuts bind endpoint/map,
algorithm and rate identity and validate CRC, poles, signed weights, energy,
current control versus prior readout frontier, and DC state before mutation.
Next-onset maps cannot change a ringing body; a reviewed paired-held policy is
required explicitly. Dual-body blends and more than eight slots need their own
admitted renderer. This kernel cut is not an arbitrary host restore guarantee.

The worker-only `render-resonator-morph-reference` produces a six-second stereo
Float32 WAV and PCM-hash manifest for explicit endpoint or out-and-back control
programs. Two finite four-ms Hann forces are labeled control excitation, separate
from any physical take or semantic intent replay. Existing PCM cue inspection
can verify its layout. New rate/energy/reversal/cut/forged-state/Panic/control WAV
fixtures are authored but unrun. Actual graph/route integration, moving-control
worklet cost, PCM cuts, alias/decay and levelmatched listening remain pending.

Capture provenance retains at most 48 host observations, with a 64 KiB retained
text allowance charged to the capture's existing metadata reservation. Each
observation records monitor-route revision, live owner graph/effect identities
and the owner's score-clock anchor where available. Separate cue owners are
excluded. The manifest explicitly permits unscored master auditions and does not
invent a universal score position for a mix of independent owners.

The segment map uses actual captured source-frame bounds in one context/rate
domain. Graph and route observations carry `appliedFrame: null`: a sampled host
clock does not establish the render frame when a graph change became audible.
Score anchors retain their host/audio correlation, uncertainty and presentation
delay. Graph history is referenced by the segment's owner-scoped score mapping;
route observations do not split PCM or imply sample-accurate graph boundaries.
Metadata exhaustion stops capture as `provenance-unavailable`, preserves partial
PCM and marks provenance incomplete. Context or rate replacement finalizes only
the known original-clock prefix; it never appends a different rate to the WAV.


### Regional topology invalidation

Topology tracks committed collision changes against each declared ROI and read
halo. Direct work and committed authoring spans invalidate intersecting regions;
source reveal also invalidates affected coverage. Appearance and annotation-only
changes preserve geometry. Pending jobs for invalidated regions retire immediately.
Lost revision history and legacy state conservatively require full bounded analysis.

A clean region carries its qualified immutable cell runs into a new source revision
with unchanged component lineage and explicit zero new analysis cells/neighbor
visits plus `reusedFromRevision`. A dirty region uses the reference flood fill;
this optimization works at region granularity, without claiming local component
repair. The 262144-cell phase budget and four-result local history still apply.

Qualified complete geometry survives eviction of a source mask buffer because
its original source/definition remains bound. Partial coverage must be invalidated
when a source mask materializes, including at the same numeric terrain revision.
Checkpoint validation preserves the revision and dirty flags; malformed ownership
refuses before publication. Geometry completion alone never creates an attack.


### Authored cavity scores and shared body admission

`initialCavityBody` binds a saved score to one validated `CavitySoundMap`, its
complete free-space region and declared anchor selection. Clay maps64/256square
world pixels to220/110Hz using the explicit square-root area proxy, clamped to
80–1760Hz. Crumbled chimes normalizes perimeter/area against declared reference
units for upper-mode weight. Throat duet retains two anchor identities and220/330Hz
while its connecting cross-section enables a bounded edge in the existing modal
network. Only the first selected component receives direct excitation; the second
duet body responds through the declared coupling. These are compositions, without
3D volume, measured material or acoustic claims.

A wall contact retains the solid cell actually covered by the failed column probe,
just above the feet, independently of the backed-out actor position. Instruments
may name `topologyAnchorId` to select among physically adjacent components. The
default still refuses ambiguity; an anchor cannot select a distant component.
Geometry completion and parameter preparation never add semantic attacks.

The score reuses the owned sympathetic/modal runtime. Active and retiring graphs
count separately: scene peak bounds are two bodies for clay/chimes or four for
the duet. The existing two-graph host admits overlap and retains tails on the
audio clock. Cavity preparation waits for a retiring graph before allocating
another candidate. A shared-body resolver checks the current graph hash, owner
route revision, map/body identity and selected topology revision before allowing
the pinned exciter through the ordinary instrument router. Existing patch-owned
body and macro checks remain the default. Excitation receipts preserve the source
intent/events, original target frame and exact prepared body identity.

Preparation may retain at most64source begins and ordered ends, within an8MiB
declared high-water estimate and a maximum50ms wall wait. A source uses its
original audio frame; expiration, changed geometry/execution/context or unavailable
body refuses it without retiming or catch-up. Valid unchanged regional revisions
share a bounded four-revision qualification. Deferred completion/cancellation uses
the canonical sink admission owner. Source copies stay charged through actual
begin/end producer settlement; unknown cancellation poisons reuse and retains
accounting. These estimates do not measure physical browser heap.

Native scene controls queue ordinary atomic terrain commands. Size edits restore
the enclosing wall and close the throat; the next physical tick reports the
applied or refused result. Occupied/stale edits cannot partially carve a chamber.
Scene loading and geometry inspection leave output disarmed. Native audio,
canonical takes, private rehearsal/export and listening have separate evidence;
the private rehearsal profile admits a complete invariant initial cavity; changing-body graph history requires its separate captured render path.


### Cavity route observation and edits

`getPhysicalOutputDiagnostics({ requestHealth: true })` requests the existing owned processor health and returns its current graph, retained graph count and per-body modeled audio-state energy. A material cache is not an active route: replacing the exact graph makes cavity output unavailable. These observations do not establish speaker output or listening quality.

A cavity control request prepares only its bounded, already completed source chunks, then uses the workstation intervention proposal. An active take must admit that exact command before it is queued. Unknown growth, protection, occupancy and source-revision checks remain authoritative. Merely preparing a cold mask does not edit terrain or increment its source revision.

When the owner already retains a previous body tail, the next geometry waits without allocating another preparation workspace. Actual owner retirement notifications resume preparation of the latest geometry, including while physical pumping is paused independently. Stop/Panic still retires the owner; it is not a request to retain its tails. Geometry preparation creates no semantic onset and never resubmits an earlier strike.

Topology configuration, analysis admission and result publication compare the normalized definition signature. Durable JSON key order cannot change a region identity. Dirty analysis is qualified after both ordinary checkpoint continuation and a canonical-key restore; bounded replay mismatch diagnostics identify the first differing field and any actual analysis failure without retaining the full source payload.


### Private initial-cavity preview

The existing scene rehearsal owner observes a new private physical prefix. For a cavity it retains one complete initial topology plus a bounded ledger of observed source revisions. The profile covers at most4096square pixels,512ticks and the existing six-second source window. Every actual work/contact onset must belong to the selected adjacent component, its exact map/mapping revision, its observed source tick and its mapped pitch/reference. A geometry change, unknown coverage or missing ancestry refuses the preview. No synthetic strike is inserted.

The existing admitted renderer compiles that observed shape through CavitySoundMap and the shared modal kernel, then renders the complete declared body tail. Its receipt separates the active body count from the scene's larger active/retained bound. CURRENT and NEXT remain unadvanced; explicit adoption after preview still starts the prepared finite entry at tick zero. Preview follows the selected Prelisten route and keeps its existing master-capture inclusion policy. It is a new private phrase, with level/listening review separate from the live graph-history take.

Private preparation owns an additional16MiB estimate for geometry/key/compile metadata through actual producer retirement. The worker snapshot bound covers the existing16MiB result allowance as well as the admitted input; a small semantic source cannot incorrectly cap its larger PCM result. The128MiB computation estimate,16MiB result validation and shared resource admission remain in force. Cancel joins checkpoint/world/material/worker/cue ownership before releasing this storage; unresolved retirement prevents reuse.

A finite source beyond the ROI's one-cell adjacency band is outside that instrument. It makes no onset or rejected-begin count when complete geometry establishes the spatial exclusion. Unknown geometry, in-region ambiguity and unavailable selected components retain their existing refusal path. Preview failures are reported on their owning scene loader.

### Closed physical MIDI crops

Physical take MIDI1 can select inclusive start/end ticks inside one captured clock epoch. The selected take must retain its complete, covered semantic history and empty initial/final voice boundaries. The exporter validates that full history, replays note ownership before the crop, and refuses a voice crossing either cut. It includes complete lifetimes in canonical intent order, preserves selected leading/trailing silence and reports crop exclusions separately from excluded clock epochs. It never creates a pickup or release at the cut. An empty closed interval produces a timed silent file.

The desktop Project menu exposes an explicit crop checkbox and both integer ticks. Blank, invalid, uncovered or reversed bounds fail before replacing the prior prepared artifact. Program, clock epoch and crop are captured with the admitted source; the dedicated worker checks them against the verified journal revision. The filename identifies the selected epoch and tick range. Export remains a new MIDI1 revoice with its embedded lowering/timing report, not a submitted-output recording.

Captured piecewise tempo and effective tick duration drive the file. Paused nominal Step, speed/tempo changes, controlled catch-up wakes and external-clock stop/Continue retain their original committed score times. A suspended host gap or lost external clock halts physical pumping; unadvanced wall time is absent from source-score export. Native desktop qualification separately labels controlled main-thread stalls and stub MIDI input, and independently parses SMF note order, tempo changes, end placement and elapsed-time error. These checks do not qualify OS sleep, a physical receiver or audible playback.
