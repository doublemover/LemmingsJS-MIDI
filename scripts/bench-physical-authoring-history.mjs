import { performance } from 'node:perf_hooks';
import { createPhysicalAuthoringHistory } from '../js/app/procgen/workstation/PhysicalAuthoringHistory.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { loadProcgenMasks } from './bench-procgen-lanes.js';
const masks = await loadProcgenMasks(), results = [];
for (const laneCount of [8, 128, 1024]) {
  const world = new ProcgenLaneWorld({ masks, laneCount, assists: false }), history = createPhysicalAuthoringHistory(), start = performance.now();
  try { const capsule = await history.capture(world, {}, checkpoint => ({ world: checkpoint }), { isCurrent: () => true }); results.push({ laneCount, status: 'captured', elapsedMs: performance.now() - start, reservedBytes: capsule.bytes }); capsule.discard(); }
  catch (error) { results.push({ laneCount, status: 'not-admitted', reason: error.message, elapsedMs: performance.now() - start }); }
  finally { await history.dispose(); world.dispose(); }
}
console.log(JSON.stringify({ schema: 'physical-authoring-history-profile/v1', results, boundsAreNotPerformanceQualification: true }, null, 2));
