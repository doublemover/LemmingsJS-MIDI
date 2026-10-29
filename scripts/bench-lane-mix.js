import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createMidiProject, sanitizeMidiProject, reduceMidiProject } from '../js/midi/project/MidiProject.js';
import { createProcgenWorkstationProject } from '../js/app/procgen/workstation/ProcgenWorkstationProject.js';
import { createLaneMixState } from '../js/app/procgen/workstation/LaneMixState.js';

const iterations = Number(process.argv.find(value => value.startsWith('--iterations='))?.split('=')[1] || 1000);
if (!Number.isSafeInteger(iterations) || iterations < 10 || iterations > 100000) throw new Error('Invalid iteration count');
const summary = values => { const sorted = values.slice().sort((a, b) => a - b); return Object.fromEntries([['p50', .5], ['p95', .95], ['p99', .99]].map(([key, fraction]) => [key, sorted[Math.floor((sorted.length - 1) * fraction)]])); };
const results = [];
for (const lanes of [8, 128, 1024]) {
  let project = sanitizeMidiProject(createProcgenWorkstationProject(createMidiProject(), { lanes: Array.from({ length: lanes }, () => ({})) }));
  const indexed = createLaneMixState(), reference = createLaneMixState(); indexed.synchronize(project.procgen.lanes); reference.synchronize(project.procgen.lanes.slice());
  const samples = { authoredEdit: [], indexedMix: [], referenceMix: [] }; let before;
  for (let iteration = 0; iteration < iterations + 100; iteration++) {
    if (iteration === 100) before = indexed.diagnostics();
    const begin = performance.now();
    project = reduceMidiProject(project, { type: 'procgen/lane', laneId: 'lane-2', patch: iteration % 2 ? { name: 'Name' + iteration } : { gain: (iteration % 127) / 127, pan: iteration % 255 - 127 } });
    const edited = performance.now(); indexed.synchronize(project.procgen.lanes); const synchronized = performance.now();
    reference.synchronize(project.procgen.lanes.slice()); const referenced = performance.now();
    const actual = indexed.mix('lane-2'), expected = reference.mix('lane-2'); for (const key of ['gain', 'pan', 'muted', 'soloSuppressed']) assert.equal(actual[key], expected[key]);
    if (iteration >= 100) { samples.authoredEdit.push(edited - begin); samples.indexedMix.push(synchronized - edited); samples.referenceMix.push(referenced - synchronized); }
  }
  const after = indexed.diagnostics(); results.push({ lanes, timingsMs: Object.fromEntries(Object.entries(samples).map(([key, values]) => [key, summary(values)])),
    work: Object.fromEntries(['fullBuilds', 'incrementalBuilds', 'skippedCollections', 'stateVisits', 'stateAllocations'].map(key => [key, after[key] - before[key]])) });
}
process.stdout.write(JSON.stringify({ schema: 'lane-mix-benchmark/v1', iterations, warmup: 100, runtime: process.version,
  scope: 'Canonical single-lane reducer and lane-mix owner only; half unrelated label edits, half actual gain/pan edits. State-row allocations are counted, not every V8 allocation. No controller/view/persistence/browser latency or release-gate claim.', results }, null, 2) + '\n');
