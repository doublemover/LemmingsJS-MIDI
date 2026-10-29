# Procgen cloud measurements, 2026-10-07

These are bounded, rendering-free Node v24.19.0 Linux runs with seed 42,
OHNO brick art, the checked-in mined recipes, and real Lemming/action/mask code.
They are measurements from one cloud machine, not browser smoothness claims.
The headless probe passes no sprite provider, so it also excludes cosmetic
appearance/transition work, sprite-frame decoding and audio synthesis.

| Lanes | Workload | Ticks | Spawned / alive | Time | Actor steps/s | Shared recipe cache | Sparse edits |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | Repeated cohorts | 5,000 | 93 / 89 | 0.20 s | 1.12 million | 1.43 MB | 0.16 MB |
| 32 | Repeated cohorts | 3,000 | 1,792 / 1,775 | 2.22 s | 1.21 million | 1.43 MB | 2.80 MB |
| 1,024 | Repeated cohorts | 600 | 11,776 / 11,776 | 2.92 s | 1.25 million | 1.43 MB | 14.15 MB |
| 1,024 | First cohort only | 5,000 | 1,024 / 1,024 | 3.56 s | 1.44 million | 1.43 MB | 9.33 MB |

A later bounded challenge-cache/empty-cascade-scan optimization reproduced the
1,024-lane/600-tick state exactly in 2.70 s (1.35 million actor steps/s), with
2,048 cached challenges. This is one rerun, not a statistically controlled speedup.

No stalls occurred in these probes. Minimum lane-frontier distances were 3,690,
2,074, 359, and 2,669 pixels respectively. Traffic runs are not casualty-free:
the one-lane case had four out-of-world deaths, and the 32-lane case had 17 unsafe
falls. The short 1,024-lane repeated-cohort probe is not long-run survival proof.
RSS ranged from about 75 MB to 175 MB across this process sequence; garbage
collection and retained resources make this different from incremental cost.

All ten available art families additionally passed 32 independent actors ×
5,000 fixed ticks at seed 42, with every actor alive, no stalls, and minimum
forward distance above 2,000 pixels. Every one of the 96 admitted recipes also
passed 5,000 real-action ticks with a single isolated actor at seed 42, all alive
and progressing. Source recipe screening is still local;
this is not a universal solvability claim for every seed, cohort or future edit.

## Policy comparison

The original AI from commit 059a4cab is preserved unchanged (apart from its import
path) in the test fixture. Both policies run on the same real Level,
LemmingManager, original action classes, pack masks and bounded geometry:

- Retired blocker: original remains blocking for 600 ticks. Revised policy makes
  one safe builder reassignment and reaches the 155-pixel goal in 382 ticks.
- Shallow-step/left-edge loop: original remains blocked for 600 ticks. Revised
  policy reaches the goal alive after reassessment.
- Pit: original repeatedly bashes before reaching the wall, then digs and dies
  at tick 166. Revised policy waits for useful proximity, bashes once, and
  reaches the goal alive at tick 182.

## Limits and reproducibility

Use the commands in [procgen.md](procgen.md). CLI default is the repeated-cohort,
real-art workload; first-cohort and analytic comparators require explicit flags.
The harness reports admitted spawns and failures instead of silently calling
removed actors survivors. The bounded renderer test verifies a 300×150 visible
buffer and two visible actors in a 1,024-lane world, but uses a mocked canvas.

Live Chromium/Playwright QA was blocked by cloud execution restrictions, and the
available cloud browser rejected loopback navigation. No restrictions were
bypassed. The updated E2E and capture targets still need a permitted preview
run; screenshots, audible listening and live frame times remain unverified.

### Completed actor publication

The shared actor projection publishes immutable scalar DTOs with separate physical
rows and musical lane membership, stable identity, numeric actions, draw bounds,
and the exact pending physical batch identity. Live render objects remain private
and may be resolved only against the current completed revision. Camera, CCTV,
observation and drawing readers use explicit leases. A retired version stays
charged until its last lease releases, including renderer disposal. Four versions,
16 readers and a 16 MiB local ceiling bound retention; admission failures are
reported as dropped publications, never as a partially updated frame.

`scripts/bench-actor-projections.js` contains deterministic 8/128/1024-lane
reference/indexed comparisons and a dirty-row candidate measurement. It reports
p50/p95/p99 and owner counters. Draw rows and the bounded wide-sprite list are
constructed in the same actor publication pass. Camera-only queries use those
immutable rows; diagnostic retained counts do not traverse all lanes. Rejected
publication after an appearance, geometry or world change cannot expose the old
frame as current. Existing leases retain their original immutable facts.

The 1,000-iteration run after 100 warmup publications visits 32 draw candidates
(33 at p99 in one sparse-dirty case) for eight visible rows at every lane count.
Draw-query p50/p95/p99 in milliseconds for the fully dirty cases is
8 lanes: 0.0026/0.0064/0.0141, 128: 0.0036/0.0058/0.0088, and
1,024: 0.0053/0.0072/0.0100. Those timings include counter reads. Draw queries
publish zero additional projection versions. Estimated retained bytes are
55,488/872,448/6,972,416, with twice those amounts during publication replacement.
These are conservative admission estimates and publication counts, not sampled
V8 allocation counts or browser frame-rate guarantees. The dirty-row candidate
remains experimental.

The grouped 61-case Node cohort passes geometry, reference leaders/actions,
lease pressure, restore, camera/CCTV and real batch/intent/checkpoint equivalence.
Six native desktop cases pass unchanged recovery/effect pixel behavior and a
live actor iterator trap during rendering and CCTV queries. Native dimensions
are at least 1920x1080. The source-bound continuation329 receipt records commands,
results and limits; acoustic behavior remains separate qualification.

Continuation330 adds non-materializing contact reads through resident/cold edits,
retained source descriptors, partial growth and authored score masks. Source
generation/restoration traps pass in actual Node worlds and the native instrument.
The follow-up also exercises a real worker round trip of a held projection and
resource-adapter failures; copied worker data cannot mutate the held source, and
failed retirement remains charged. Projection, edit retention and lane observation
reach100% scoped lines/functions. The77 distinct affected Node cases pass across
the final grouped run and one added cache-pressure regression; two native desktop
cases pass. V8 allocation profiling and browser frame-time gates remain future
performance investigations, separate from the reported publication counters.

### Authored edit propagation

Canonical commands carry non-retaining source identity and changed-lane metadata.
ID-to-position indexes survive nonstructural lane-array replacements; document
and touched-lane revisions advance independently. Scalar edits preserve pattern,
instrument and automation identity, and semantic no-ops retain the original
project. Pattern derivation updates solo state and routing only for relevant
changes; causal performance recording builds sparse lane upserts. Visible row
patching leaves unrelated controls and gestures mounted.

The plain lane-array container still copies up to 1024 references per edit. It is
not a persistent-vector implementation or a measured constant-time guarantee.
Import, structural edits, history movement and explicit full exports intentionally
retain whole-document validation. Ordinary preferences coalesce at 250 ms and
encode through admitted background jobs; one active revision and the latest
pending revision are retained. Worker structured-clone and localStorage native
write costs remain measurable boundaries, not claimed zero-cost operations.

`scripts/profile-procgen-editing.mjs` measures 8/128/1024 lanes with 64-step
patterns, 120 Hz scalar/cell input, actual MIDI ingress/capture and batched launch
acknowledgments. Reports separate latency percentiles, long tasks, heap observations,
index counters and preference durability. This harness is implemented but has not
been run; no 16 ms reference-machine qualification is asserted.

### Incremental recovery

The active world now owns a bounded input/step journal rooted in a checkpoint
captured while its unpublished candidate is quiescent. The checkpoint walker
shares the portable graph codec and yields through named assets, graph nodes and
typed-array elements; it rejects any tick, generation, terrain, command-sequence
or clock mutation across a yield. Later recovery does not walk the live world:
it pins immutable completed journal pages, the accepted authored revision and
current musical state. Accepted and canceled interventions are recorded at their
input boundary, and every step retains its actual event clock, speed and checked
physical identity frontier. Recovery replays into an isolated candidate and
rejects divergence before publishing it.

Base and completed pages encode once in admitted workers. Gzip/UTF-8 binary
chunks carry SHA-256 and declared expansion bounds; only worker-owned encoded
buffers transfer. Two manifests and all newly referenced chunks commit in one
IndexedDB transaction. Readers pin one readonly transaction, then hold decoded
source leases; replaced generation chunks retire only when neither manifest uses
them. A full journal reports an explicit pause-to-compact requirement rather than
claiming an unrecorded tick is durable. Recovery errors preserve the previous
complete generation. The shared browser storage cap may refuse large candidate
or decode peaks, and that refusal remains visible.

The compression APIs are available in workers ([CompressionStream](https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream),
[DecompressionStream](https://developer.mozilla.org/en-US/docs/Web/API/DecompressionStream)).
The implementation has a 4 ms cooperative target, not a measured hard deadline:
individual object enumeration, final component metadata, browser structured-clone,
and an isolated replay physics step are non-preemptible boundaries.
`scripts/profile-procgen-recovery.mjs` separates capture slices, encoding, commit,
reuse, scheduling lateness, heap observations and long tasks for 8/128/1024 lanes.
The new fault-injection and 1000-tick continuation fixtures are written but not
executed; no latency or replay qualification is claimed.

### Indexed physical instruments and completed ensemble evidence

`physical/PickupGates.js` compiles authored world-space segments, polylines and
rectangular bands into bounded 128-pixel cells. A sweep visits candidate cells,
not the actor × gate Cartesian product. Shared vertices have one observation;
arrival owns the boundary, departure and collinear/zero displacement are silent.
A band can enter and exit during one tick. Crossing fractions are derived endpoint
interpolation, never measured sub-tick physics. Occupancy owns an actor/gate voice
until real exit, actor loss, source reset or geometry retirement. Mapping edits
retire old ownership and default to silent membership; explicit edit retrigger
has empty physical ancestry and a named edit cause. Hysteresis, alternating
polarity, ordered crossings, local-coordinate tuning and revisions are portable.
The query and state caps fail explicitly rather than dropping arbitrary actors.

Birth cohort IDs include world, generation and the actual scheduled cohort.
Successful births, missed admission slots and bounded recent cohort records are
separate. Crew origins attach at the real admission boundary. Completed actor
snapshots carry these scalar identities and abilities. Ensemble selectors are
bounded data ASTs, not callbacks; fixed rosters retain missing historical members,
dynamic membership follows completed source coverage, and overflow/exclusive
conflict is not a first-N selection. Fixed roster restore never recaptures a new
actor that happens to reuse a numeric ID. Unknown route predicates remain unknown.

The route atlas requires observed ordered directional markers before using a
segment coordinate. Authored/trace geometry is not itself traversal proof. Shared
entry ambiguity, omitted markers, discontinuity and changed dependent terrain
invalidate comparisons. Qualified route arc pixels, elapsed lap ticks and measured
movement remain separate quantities. Coordinate and marker state is included in
causal engine checkpoints; take preflight requests physical-domain boundary data.
The implementation is bounded and source-reviewed, **not runtime-qualified**.
`bench-physical-query-plan.mjs` implements an all-gates reference comparison and
16/256/1024-gate candidate/tail profile; it has deliberately not been executed.

### Physical rhythm responses

`physical/RhythmicResponses.js` interprets observed arrivals, canonical blocker
contacts, actual work operations and flight arcs. Arrival estimators use simulation
ticks (fractional pickup interpolation is labeled), keep opposing streams apart,
and retain typed route-distance unknowns rather than substituting screen distance.
A declared density clamp suppresses arrivals without filling gaps. Local one-shot
gates can follow measured intervals; the current four-second sink contract reports
any duration truncation in the sink receipt instead of rewriting source timing.

Work facts now distinguish numeric action frame, operation phase, actual completed
cycle ordinal, attempted/changed cells, protected work and builder warnings.
Action cycles are counted at real frame wrap, not inferred from SFX count. The
three initial dig rows remain three facts; phase grouping preserves all source IDs.
Scraped work owns one action-scoped voice and coalesces unchanged intensity.
Blocker response state can alternate, mirror or apply a modulo motif, with separate
walker/blocker roles rooted in one canonical contact and no physical fan-out.

Flight state begins at the actual falling transition, carries through parachute
opening (including upward travel), and ends on safe landing, interruption or
terminal loss. It records distance proxies, not mass/energy claims. Continuous
pitch uses bounded actor-owned updates; landing strikes are separately selectable.
All estimator, motif and arc interpretation state travels with causal checkpoints.
Candidate restores validate all interpretation owners before swapping live state.
These regressions are authored but not run; acoustic, dense-scene and lifecycle
qualification remains deferred. Ratio-fold/delayed arrival modes and the deeper
performer editors are separate remaining implementation work, not claimed here.

Action voices now declare entry/motion/contact admission, same-action reentry,
release/legato/crossfade transitions, tick-based maximum hold, and bounded changed
expression mappings. Deferred admission retains the original action cause and the
actual triggering motion/contact. Legato preserves onset identity and links action
instances; crossfade lowers to owned native/sample/worklet attack and release
ramps (linear envelope transition, not an equal-loudness claim). Maximum hold is a
safety release, never a periodic retrigger. Pending admission and held expression
state participate in transactional checkpoint restore.

Canonical lane transfers support carry, revoice, release-and-attack and silent
handoff. They retain actor identity and ancestry, release the prior route before
replacement, and silence unavailable/muted destinations. Repeated crossings use a
bounded root voice identity rather than an ever-growing chain of IDs. Physical
multi-stripe movement publishes one synchronized destination, not inferred swept
stripe crossings. Native transition behavior is implemented but unqualified;
external endpoint capability negotiation and the full mix/visual controls remain
separate work.
