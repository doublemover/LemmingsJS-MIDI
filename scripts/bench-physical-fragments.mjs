import { performance } from 'node:perf_hooks';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { loadProcgenMasks } from './bench-procgen-lanes.js';
import { capturePhysicalScoreFragment, planPhysicalScoreFragment } from '../js/app/procgen/workstation/PhysicalScoreFragment.js';
const masks = await loadProcgenMasks(), results = [];
for (const laneCount of [8, 128, 1024]) {
  const world = new ProcgenLaneWorld({ masks, laneCount, assists: false });
  try { const graph = { version: 1, revision: 1, instruments: [] }, project = { procgen: { physicalGraph: graph } }, times = [];
    for (let index = 0; index < 20; index++) { const start = performance.now(), fragment = capturePhysicalScoreFragment(world, { id: 'region', source: { revision: 'benchmark-source:1' }, bounds: { x1: 300, x2: 364, y1: 0, y2: 64 }, graph });
      const plan = planPhysicalScoreFragment(world, project, fragment, { namespace: `instance-${index}`, x: 400, y: 0 }); if (plan.status !== 'prepared') throw new Error('Unexpected fragment admission: ' + JSON.stringify(plan.issues)); times.push(performance.now() - start); }
    times.sort((a, b) => a - b); results.push({ laneCount, captureAndPlanMs: { p50: times[10], p95: times[19] }, cells: 4096, mutationsApplied: 0 });
  } finally { world.dispose(); }
}
console.log(JSON.stringify({ schema: 'physical-fragment-authoring-profile/v1', results, qualifiesTraversalOrAudio: false }, null, 2));
