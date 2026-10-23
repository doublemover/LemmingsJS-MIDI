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
kernel's fixed storage is 189,536 bytes; its host allowance is a separate
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
