import { performance } from 'node:perf_hooks';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { loadProcgenMasks } from './bench-procgen-lanes.js';
import { planTerrainCommand } from '../js/app/procgen/TerrainAuthoringAdapter.js';
const masks = await loadProcgenMasks(), rows = [];
for (const laneCount of [8, 128, 1024]) {
  const world = new ProcgenLaneWorld({ masks, laneCount, assists: false }), times = [], before = world.editChunks.snapshot();
  for (let index = 0; index < 100; index++) {
    const start = performance.now(); const plan = planTerrainCommand({ operation: 'addSolid', generation: world.generation, transactionId: `profile:${index}`,
      spans: Array.from({ length: 32 }, (_, y) => ({ x1: 1024, x2: 1280, y: y + 8 })), materialId: 'authored:clay', tag: 'clay' }, world);
    times.push(performance.now() - start); if (plan.status !== 'prepared') throw new Error(plan.reason);
  }
  times.sort((a, b) => a - b); if (JSON.stringify(before) !== JSON.stringify(world.editChunks.snapshot())) throw new Error('Preview changed patch ownership.');
  rows.push({ laneCount, cells: 8192, p50Ms: times[50], p95Ms: times[95], p99Ms: times[99], patchStorage: before }); world.dispose();
}
process.stdout.write(JSON.stringify({ qualification: 'readonly-preview-only', rows }, null, 2) + '\n');
