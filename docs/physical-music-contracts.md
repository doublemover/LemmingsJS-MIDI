# Physical music contracts

The ProcGen project schema is version 2 with `playModel: "physical-v1"`.
`physicalGraph` contains versioned causal instruments. New projects contain a
builder work instrument, ordinary wall percussion and a positive crossing at
world x=40. Physical lanes contain no pattern cells. A complementary pattern
lane must declare `mode: "pattern"` and a nonempty `patternPurpose`.

Version 1 and unversioned saved projects require explicit conversion.
`convertLegacyProcgenWorkstationProject(project, {strategy: "physical-default"})`
returns a candidate project and a report of removed enabled steps and changed
musical behavior. It does not mutate or save the original. A current project
missing its graph is invalid; import never silently reconstructs that graph.

## Committed source facts

`ProcgenSoundEventBus` stages facts while the sequential simulation runs. After
actor processing, lane counts, manual/stall action changes, terrain bookkeeping
and support observations complete, it publishes one immutable batch and its
matching observation snapshot. `causalSequence` records mutation order. Callback
arrival time and interpolated crossing positions cannot change that order.

`getCompletedPhysicalSnapshot()` returns the same frozen view attached to the
batch. `retainCompletedPhysicalSnapshots()` requests this view when no musical
batch listener exists and returns an idempotent release function. Actor rows
contain primitive historical identity, action instance, position, direction,
spawn metadata and terminal reason; they hold no live actor references. An old
view remains readable after the next commit. Renderer visibility indexes remain
independent. This view does not advertise renderer bounds, a spatial query API,
or an asynchronous buffer lease.

Batch listeners that throw are quarantined until deregistered. Peers still see
the batch and later ticks. Output callbacks cannot reenter `step`, change an
action, remove/reset/disable an actor or call the terrain mutation methods during
delivery. They may enqueue a future intervention. Direct arbitrary writes to
public actor fields are outside this command contract. A throwing physical
processor aborts publication and blocks further stepping until checkpoint
recovery; no rollback or completed tick is invented.

Actor action resets receive new action-instance IDs, including same-action
resets. Work facts preserve attempted/no-change/protected outcomes, actual edit
counts and sequential revisions. Wall reversal without displacement remains a
contact and a direction change. Blocker participant records share one contact
root. Lifecycle ends are captured before removal clears actor identity. Overflow
marks source coverage incomplete and the causal engine releases held voices.

## Observed support spans

`ContactSpanBegan`, `ContactSpanUpdated` and `ContactSpanEnded` describe qualified
support-cell observations for walking, blocking, building, bashing, digging,
mining and shrugging. They are sampled against completed terrain. A span carries
its actor/action identity, world-pixel anchor, observed tick and surface revision.
Consecutive observations establish discrete continuity; pressure, normal and
terrain component identity remain unknown.

A stationary supported blocker can hold a mapped damper while producing no new
strike. Action reset, actor termination, support loss, missing observation
coverage and removal of the previous anchor end the span. Invalidated anchors
may begin a new explicitly identified span on supported terrain. Unsupported
climbing/wall/flight contact mechanics never inherit a held touch from their last
strike. Contact sound generation and release smoothing belong to the backend.

## Travel articulation

`TravelAccumulator` is the single travel state owner for an instrument. Its key
contains world, generation, actor, instrument, lifetime scope and scope instance.
`actorJourney` continues across ordinary action changes; `actionInstance` resets
at an action exit; `contactSpan` requires explicitly qualified contact coverage.
Action instance remains provenance in every scope.

The graph's optional `articulation` descriptor declares:

- `spacingPixels` from 0.25 to 1,000,000;
- `metric`: `endpoint-chord`, `segment-path`, or `axis-projection`;
- `orientation`: `unsigned`, `signedX`, or `signedY`;
- `phaseMode`: `cumulative`, `direction-reversing`, or `contact-stroke`;
- `lifetimeScope`, and optional `sustain` for a held phase voice.

Unsigned length and signed axis projection are stored separately. Facing right
does not give vertical travel an invented sign. Exact segment-path requirements
are refused when the captured source only contains endpoints. Builder step-up
publishes its accepted coordinate writes separately: (40,80)→(40,79)→(41,79)→
(42,79) has three pixels of algorithmic path evidence, distinct from the endpoint
chord of √5. Other uninstrumented action movement retains endpoint-chord evidence.
Neither representation claims continuous collision geometry.

Distance thresholds produce bounded causal attacks. Eight pixels at spacing four
produce two attacks; idle ticks produce none. Crossing positions and fractions
use declared linear segment interpolation, while source onset time remains tick
precise. No fractional simulation time is fabricated for coordinate writes with
unknown sub-tick timing. Held phase voices receive high-resolution distance and
phase expression updates. A teleport, restored discontinuity or unexpected
position gap advances a discontinuity epoch and produces no catch-up attacks.
Near-zero spacing and excessive crossing fanout are rejected before changing
accumulated state. Mapping revision changes deliberately reset accumulation.

Accumulator checkpoints preserve scope, origin, previous position, path/signed/
contact distance, direction/discontinuity epochs and ordinal. Contact travel is
currently admitted only when a motion fact itself carries `contactSpanId` and
qualified `contactObserved` coverage. A support span alone does not prove that
all movement in the tick stayed in contact.

## Keyed probability

`CausalRandom` version `fnv1a32-avalanche-v1` hashes a canonical JSON tuple of
seed, algorithm, namespace, mapping, generation, stable cause and draw purpose.
Version 1 hashes UTF-16 code units, then performs the declared 32-bit avalanche.
There is no shared mutable random cursor. Terrain, population, physical-route
and musical-response namespaces are distinct.

Each physical instrument may declare `probability01`. Its decision cites a real
source event, and optional travel attacks include their crossing ordinal. Muting
another instrument or changing output delivery cannot consume these draws.
Bounded diagnostics retain threshold, exact draw identity and outcome. Explicit
physical interventions use the physical-route namespace and still run ordinary
eligibility checks. The uniformity fixture is a deterministic smoke bound, not a
claim about musical quality or security randomness.

## Intervention boundaries

`world.enqueueIntervention(command)` admits versioned inputs with stable command
IDs, generation/actor targets, requested time, apply tick, origin, optional
expected state revision and transaction ID. Supported commands are
`assign-worker`, `place-blocker`, `release-blocker` and whole-world
`set-release-policy`. Arbitrary terrain edits, pickup movement, abilities and
mixed-adapter atomic transactions are not exposed by this adapter.

Commands apply before actor advancement. The versioned ordering is apply tick,
origin priority, then lexicographic stable command ID. Manual and live-controller
origins have equal priority; layer/ensemble precede conductor, then auto-assist
requests. Accepted commands claim an actor or release-policy resource for that
boundary. Receipts identify conflicts, stale targets/revisions, rejections and
keyed probability decisions. A stale actor never selects a nearby replacement.
Existing automatic assistance executes after queued commands through its existing
eligibility checks; migrating every automatic proposal into the queue remains
separate work.

Worker claim preparation does not acquire the claim. The real action must accept
before claim insertion and success statistics. An adapter that rejects or throws
without mutation leaves no new claim or success. An adapter that mutates then
rejects aborts the physical tick instead of advertising a safe rollback. Successful
action and later work facts carry command ancestry; committed command facts list
the event IDs produced by application.

Optional `coalesceKey` on release-policy samples admits same-boundary last-value
semantics. Adjacent samples with matching target, transaction, apply tick, origin
and expected revision coalesce; each replaced command gets an explicit
`superseded` receipt. The declared error at simulation boundaries is zero. A
discrete command or different boundary breaks coalescing. This is not a promise
to reconstruct unobserved sub-tick knob curves. Pending inputs, bounded receipts
and identity counters use the existing world checkpoint graph. Cancellation,
generation reset and disposal cancel pending requests.

## Action voice naming and restored output

ActionVoicePolicy uses canonical names such as `walking`, `hoisting`, `jumping`,
`shrug`, `ohno` and `splatting`. Shared action producers retain their original
`walk`, `hoist`, `jump`, `shrugging`, `oh-no` and `splatter` facts. Matching
normalizes those names at the policy boundary, including motion/contact admission
and same-action transitions; it never rewrites the recorded physical source.
Aliased duplicates are rejected. Countdown remains an overlay, not a voice entry.

Restoring a causal checkpoint continues semantic ownership without replaying a
historical begin into a fresh output backend. That backend remains silent until
a future physical entry admits a new voice. This is not a restored DSP or receiver
state claim. A committed end may remain scheduled until its declared presentation
frontier; zero-owner assertions must observe that frontier or explicit retirement.

The real-action qualification covers a1000-tick blocker, natural fall→float→walk
under release/legato/crossfade, same-pitch expressive climbers and peer removal,
failed assignment, motion admission, held restore, actual shared Lemming object
reuse, completed cohort reset, countdown and same-action reentry. MIDI uses the
production scheduler with virtual adapters and controlled time; physical receiver
and local DSP qualification remain separate.

## Integration and remaining capture boundaries

The workstation observes committed batches with `PhysicalScoreClock.observe`,
then `CausalMusicEngine.processBatch`. The engine fans immutable begins, updates
and ends to `CausalIntentDispatcher`; sinks own clocks, admission, precision loss
and delivery evidence. Old SFX remain available for presentation but never
advance physical-play pattern cells. Engine checkpoints include active voices
and travel state; the physical score clock persists its piecewise timeline.

The command receipt buffer, causal trace and output diagnostics remain bounded
inspection state. Durable takes use the separate canonical journal described in
[causal-take-journal.md](causal-take-journal.md). A take records committed physical
batches, canonical intents and actual sink receipts; none of those receipts is
acoustic evidence. Reinterpretation preflight names missing source descriptors
and state explicitly. Support/phase capture cannot certify mechanics it did not
observe, and a seek plan still requires qualified re-performance by its caller.

## Explicit physical MIDI timing

`exportPhysicalProcgenMidi(events, sourceTime, options)` returns SMF bytes and a
timing report. The existing `exportProcgenMidi` also accepts `options.sourceTime`
and returns the same bytes. Declare source version1/domain `simulation-tick`,
a captured `ProcgenPhysicalScoreClock` checkpoint, and explicit `origin`/`end`
positions with the same epoch. Every projected MIDI event retains its world,
nondecreasing canonical causalSequence and scoreTime. The caller owns the physical
intent-to-protocol projection and note lifecycle. This timing boundary never
invents a missing onset or release.

The exporter maps through the recorded piecewise speed/tempo history, subtracts
the artifact origin and writes captured tempo changes. A current transport BPM
cannot retime it. Missing or uncovered clocks, foreign epochs/worlds, reversed
causality, stale beats and out-of-range events fail explicitly. Select each epoch
separately; reset score origins are never implicitly concatenated. Crop callers
must select a valid complete message range rather than rely on silent omission.

The embedded `physicalTiming` manifest reports nearest-tick beat error, maximum
encoded timing error at messages/tempo boundaries/crop end, distinct physical
event times collapsed at one tick, and collapsed tempo changes. Timing error
includes accumulated rounded SMF microseconds per quarter. Canonical event order
survives quantized ties, and End of Track retains trailing selected silence.
Unrepresentable four-byte deltas fail without compressing silence. This is source
score export; live delivery repair and API-accepted output reproduction remain
separate. Submitted-output worker columns reject physical-source options.

The integrated workstation take-to-MIDI projection and the full external-clock/
suspension export matrix remain open under #986/#1093. This API does not qualify
those product paths, receiver timing, listening or archived exact execution.

## Work-cycle material selection

A `WorkResponse` with `response.type: 'workCycle'` follows completed physical
operations, action-phase groups, sustained scrape lifetimes or actual cycle
completion. Its optional `workChangePolicy` selects `solid` occupancy changes,
`appearance` changes, or `either` (the existing default). Use `solid` with
`mode: 'successful-mutation'` for added/removed material. Repainting an already
solid brick can change appearance while adding zero occupied pixels.

`includeZeroWork` and `includeObstruction` opt into attempted or protected work.
Material articulation, including `last-bricks` and `steel`, selects the response
to the same work fact; legacy sound effects do not add another strike. Grouping
three synchronous initial dig rows into one action-phase attack preserves all
three source event IDs and their individual source-edit revisions in the raw
facts. It does not assign invented sub-tick times or replace a topology binding's
selected revision. Intensity is a normalized count under the selected policy,
with `intensityMeaning: 'normalized-changed-cell-count-not-energy'`.

The shared `test/helpers/actualWorkCycles.js` corpus exercises production action
processors over explicitly authored scored terrain. The Playwright case uses
the immutable application, real mask decoding, real source-compilation workers,
sprites and the production 1920x1080 canvas renderer. Its 0/15/120 paint cadences
are scheduled per simulated source second to compare canonical facts/intents;
they are not measurements of wall-clock FPS or acoustic timing.

## Flight and landing provenance

`FlightArc` responses follow actual `FlightArcStarted/Updated/Ended` facts. One
arc survives falling-to-floating action changes, including the float table's
phase-four upward pixel. Contour and elapsed-time gestures advance only at
physical boundaries; landing-height interpretation uses actual displacement.
The descriptors remain game-derived distance proxies.

Safe fall/float `lemming-land` facts include `flightArc` provenance when an arc
is observed: its ID, start tick/position, source, peak, travel, displacement and
landing phase/contact. The action includes its final displacement before the
world's post-step observer; it does not advance or close the physical arc.
Fatal and out-of-world outcomes release the same continuous voice without
inventing a safe LAND fact.

Optional `landingGesture` and bounded `terminalGestures` select named
articulations for the existing landing/terminal strike. For example,
`terminalGestures: { 'unsafe-fall': 'fatal-fall', 'out-of-world': 'lost-flight' }`
distinguishes those physical outcomes when `terminalStrike: true`. The response
descriptor retains the actual termination reason and shared arc ID. These names
do not add another attack or imply a measured force, gravity or acoustic model.

## Blocker encounter ownership

One authoritative blocker turn carries the walker `actionInstanceId` and the
blocker `otherActionInstanceId` on its shared `ContactResolved` fact. The two
legacy sound effects remain observations of that encounter. Ricochet responses
select walker/blocker roles independently and retain the selected participant's
action ownership, source event ID and shared contact ID.

Alternating/call-answer select the first two authored intervals; modulo and
mirrored modes use the complete interval list. `motifTag` names the interval
actually selected. Musical counters belong to a particular blocker action:
release/re-entry clears the old counter, while other blockers retain theirs.
Actor termination invalidates its histories, and malformed restored action
ownership is rejected before changing any live counter.

The actual ricochet corpus exercises opposite-side encounters, a repeated
two-blocker route, explicit queued release/replacement, complete world/engine
restore, fresh actor identities and 100 coincident physical turns. Semantic
begin admission may thin dual-role attacks, but every actual contact and held
resonance end retains its own boundary. The browser fixture paints the production
desktop canvas; it does not qualify acoustic rendering or receiver behavior.

## Route time, history and period comparisons

Route entry/return time uses the same source position as pickups:
`batch.tick - 1 + crossing.fraction`. Ordered markers establish traversal and
lap identity. Arc distance excludes zero-displacement wall-turn ticks; elapsed
lap time includes them. Re-entry after unknown/discontinuous coverage starts
fresh observation history rather than retaining the old pose or return clock.

Checkpoint restore checks the authored route revision and branch, world epoch,
segment/lap identity, coordinate arithmetic, marker/source history, completed
lap ancestry and observation times before changing live route state. Unknown
coverage remains unknown; an invalidated segment cannot resume as qualified.
An endpoint pose without the required observed history is insufficient.

`CausalMusicEngine.routePeriods()` returns an on-demand bounded view of completed
laps with their source observation IDs. It separates period ratios from inverse
frequency ratios, reports current requested periods and signed errors, and
labels the integer period LCM as a coincidence window rather than a phase reset.
Fractional measurements remain fractional, and unsafe integer coincidence
values remain unavailable. An over-cap view reports `capped` without choosing
an undisclosed subset. This query does not advance actors or musical phase.

Optional `requestedPeriodTicks` is annotation on a route definition. Updating
that request preserves observed traversal and changes only its comparison with
completed evidence. A request does not retime physics. In the two-wall reference
fixture, a one-pixel walker has period `2*(rightWall-leftWall-1)`, including both
turn ticks. Odd periods are unsupported under those particular constraints;
this is not a claim about every skill or route geometry.

## Marker-bound route history and neighbors

Route checkpoint version 2 binds each definition to its ordered physical pickup
markers: world geometry, lane/ensemble scope, trigger, direction, hysteresis and
bypass. Moving a marker invalidates only dependent routes. Pitch, pickup metadata
revision and requested-period annotation preserve physical traversal phase.
Only validated definitions carry the private binding; copying or inventing a
public signature cannot prepare an atlas. Observed version-1 history refuses
restore because it lacks that binding. Empty version-1 history can upgrade without
inferring coordinates from endpoint poses.

`routeNeighbors(routeId, { maxGapPixels })` optionally limits adjacent links by a
declared route-arc radius. It keeps the measured gap explicit and sorts groups and
equal-coordinate actor IDs deterministically. Opposing directions and branches
remain separate. A missing coordinate is never a zero gap or an x-distance fallback.

The actual U-corridor corpus places actors 41 Euclidean pixels apart but
104.12310562561765 route pixels apart, excluding their neighbor link at a declared
48-pixel radius. Actual opposite walkers at the same geometric point retain their
different entry-qualified branches; two compatible shared-entry routes remain
ambiguous. Permuting complete actor projections preserves history without
reordering authoritative physical mutations.

## Crowd arrival and response timing

Crowd instruments default to `literal-arrival`: an attack belongs to an actual
qualified pickup arrival. Arrival intervals use simulation ticks, gaps use the
selected Euclidean or qualified route pixels, and gap derivatives use pixels per
simulation tick. Opposing directions retain independent history. A missing route
coordinate stays unknown. Density thinning selects actual arrivals and preserves
their timing; it does not fill gaps or move actors.

Optional `delayed-response` adds an authored `delayTicks` (default 8). Optional
`ratio-folded` folds each positive observed interval by powers of two into
`[foldReferenceTicks, 2*foldReferenceTicks)` (default reference 6), starting with
`delayTicks` of lookahead (default 32). Coincident arrivals retain zero intervals.
A response is scheduled only after its physical arrival has occurred. An arrival
that is too late for the folded schedule clamps to its actual arrival, and a
response more than 4096 ticks ahead clamps to that bound. `presentationClamped`
discloses either case; no retroactive source attack or filler is invented.

The descriptor retains literal arrival, folded interval, presentation time,
delay, original batch and original source-clock time. Intent score time describes
the explicitly selected musical response; source event IDs and performance cause
still name the original physical crossing. Gate duration follows the selected
interval and authored maximum. BPM and painting do not advance this queue.

Pending responses are bounded to 4096 records, 8 MiB of serialized fact estimates
and 32 KiB per fact. Exhaustion reports incomplete interpretation. Checkpoint
version 2 saves pending causes and estimator phase; restore validates ownership,
byte counts, presentation ranges and the physical source boundary before changing
live state. Instrument edits retire their own pending work, and epoch changes
clear the queue. Legacy delayed ownership is refused rather than silently lost.

Terrain rendering reads edit values through their observational lookup. It must
not promote cold edits or update the world's last-lookup key while painting a
paused source. The actual crowd desktop fixture covers the first paint of an
unpainted checkpoint as well as subsequent camera and paint-cadence changes.
