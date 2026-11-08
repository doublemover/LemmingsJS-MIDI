# Survey observer performance

`scripts/procgen-survey/SurveyObserverBenchmark.js` measures the production
`ProcgenLaneWorld.step()` and survey `_observe()` methods at completed physical
boundaries. It runs real actions, route planning, triggers and terminal facts.
The workload keeps a target of eight observed live actors, replacing terminated
actors before the following tick. Death animations remain physically resident;
the world also caps that resident population. A wall and full-height kill trigger
exercise ordinary assistance and route planning. A declared actor-age limit
retires actors that avoid the trigger, so retained history continues to grow.
The native cohort lifecycle performs terminal-array compaction. Automatic
cohort admission is replaced by the declared benchmark replacement policy;
physics, stall handling, actions and lifecycle finalization remain production
operations.

The benchmark drives the production world directly to continue beyond the
scored survey horizon. It does not change the survey horizon limit, return a
scored trial result or issue an exact replay receipt. It does not wait for eight
hours of wall time. At the runtime's nominal 60 ms per tick, 480,000 measured
ticks represent eight simulated hours. Node measurements do not qualify browser
rendering, audio, MIDI output or an eight-hour interactive session.

## Run

From the repository root:

```powershell
node scripts/procgen-survey/SurveyObserverBenchmark.js --name=survey --profile=smoke
node scripts/procgen-survey/SurveyObserverBenchmark.js --name=survey --profile=eight-hour --max-wall-ms=180000 --out=observer-report.json --svg=observer-report.svg
```

The Node command can emit a small standalone cost SVG without plotting
dependencies. For an export plot including end-to-end throughput with standard
Matplotlib axes, run:

```powershell
python scripts/procgen-survey/plot-observer-benchmark.py observer-report.json observer-plot.svg --name=survey
```

The Python plot requires Matplotlib and also creates its output exclusively.
`--replace` explicitly permits replacing a previously generated plot; it never
changes the JSON measurement. The committed measurement plot uses Matplotlib.

Output files use exclusive creation and never replace an existing report. The
default smoke run measures 8,192 ticks. The eight-hour profile requests 480,000
ticks; a wall deadline, cancellation or retained-record cap reports partial work
explicitly. The deadline is checked cooperatively between production ticks;
synchronous snapshot work completes before the next check. The actor-record
cap remains at most 65,536, and no historical summaries are dropped to continue
the benchmark. `--ticks`, `--live-actors`, `--window-ticks`, `--telemetry-every`,
`--checkpoint-every`, `--max-actor-age`, `--max-retained-actors` and `--seed` expose
bounded workload controls.

## Read the report

Each window records cumulative retained births, actual actor visits,
finalizations, telemetry projections, heap/RSS and end-to-end throughput.
Timing separates admissions, production physics, ordinary observation,
telemetry, full checkpoint capture/hash work and checkpoint JSON serialization.
Checkpoint work may remain proportional to exported history and is plotted
separately. Preview and telemetry projections remain bounded by active actors.
The JSON serialization measurement is a cost/size observation, not an exact
replay artifact or a new persistence format.

The report includes Node/V8/OS/CPU details, process CPU time and filesystem
source/asset hashes before and after measurement. Loaded execution identity
remains explicitly unbound. Source drift makes the regression conclusion
inconclusive. Measurements on a shared machine can include scheduler and GC
noise. Heap usage is reported as heap usage; the benchmark does not claim to
count all JavaScript allocations. Terminal-finalization and telemetry-projection
counters identify those production events only.

The declared diagnostic compares median observation time per actual actor visit
in the last third with the first steady third, excluding two warmup windows.
It requires at least six steady windows, 128 additional retained records and
no more than a 5% difference in median active visits per tick. A ratio above
1.75 requests investigation. The 75% tolerance allows timer, GC and shared-host
variation while identifying a large lifetime-dependent regression. This is a
diagnostic threshold, not a CI performance gate or release qualification. Raw
physics and checkpoint timings remain available even when observer comparison
is inconclusive.

## Measured run: 2026-10-23

The committed [JSON report](procgen-survey-observer-2026-10-23.json) and
[throughput/cost plot](procgen-survey-observer-2026-10-23.svg) record one completed
headless run on Windows 10.0.26300, Node v26.12.1 / V8 14.6.202.34-node.40, an
AMD Ryzen 7 5800X3D with 16 logical CPUs. Filesystem source/asset hashes remained
unchanged during the run, and the measured harness SHA matches its source.

| Measurement | Observed value |
| --- | ---: |
| Production ticks / equivalent simulated duration | 480,000 / 8 hours |
| Wall time, including startup | 80.819 s |
| Startup | 4.727 s |
| Overall throughput, excluding startup | 6,308 ticks/s |
| Retained births / finalized terminal records | 44,108 / 44,097 |
| Actual observer visits per 10,000-tick window | 80,000 |
| Maximum observed live / physical resident actors | 8 / 16 |
| Early / late median observer cost per actor visit | 0.450 / 0.391 µs |
| Late / early observer cost ratio | 0.869 |
| Total ordinary observation | 2.199 s |
| Total production physics | 64.612 s |
| Full checkpoint capture/hash work, 8 checkpoints | 4.577 s |
| Checkpoint JSON encoding | 0.338 s |
| Final checkpoint JSON size | 14,046,113 bytes |
| Final whole-process heap / RSS | about 307 / 692 MiB |

The declared diagnostic reported `no-observer-regression-observed`; its median
active-visit ratio was 1.0. The live target is replenished before the following
tick, so post-tick live counts can briefly dip when several actors terminate
together. Every sampled window still performed eight observer visits per tick.
The plot separates full checkpoint spikes from ordinary observer cost and
shows the complete window throughput. The wall time includes instrumentation,
route planning, event delivery and filesystem provenance reads.

Retained history and full snapshots still consume memory. The final checkpoint
alone serialized about 13.4 MiB; process heap/RSS also include source manifests,
transient capture/stringification work and garbage collection effects. This run
does not establish allocation counts, a browser memory budget, continuous
eight-hour interactive reliability or performance on another machine.
