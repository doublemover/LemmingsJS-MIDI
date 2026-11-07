import { performance } from 'node:perf_hooks';
import { loadProcgenMasks } from './bench-procgen-lanes.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { prepareProjectJunctions } from '../js/app/procgen/workstation/PhysicalJunctionProject.js';
const masks = await loadProcgenMasks(), rows = [];
const junction = { id: 'switch', revision: 1, safetyVersion: 1, control: { x1: 300, x2: 302, y1: 10, y2: 12 }, influence: { x1: 290, x2: 314, y1: 0, y2: 64 },
  ports: [{ id: 'entry', role: 'inlet', position: { x: 292, y: 30 }, direction: 'right' }, { id: 'exit', role: 'outlet', position: { x: 312, y: 30 }, direction: 'right' }],
  configurations: [false, true].map(solid => ({ id: solid ? 'wall' : 'opening', outletIds: ['exit'], spans: [10, 11].map(y => ({ y, x1: 300, x2: 302, solid })) })) };
for (const laneCount of [8, 128, 1024]) {
  const world = new ProcgenLaneWorld({ masks, laneCount, assists: false }), admissionMs = [], tickMs = [];
  prepareProjectJunctions(world, [junction]).commit(); world.step();
  for (let iteration = 0; iteration < 20; iteration++) {
    const start = performance.now(), id = `profile:${iteration}`;
    const outcome = world.enqueueIntervention({ id, transactionId: id, kind: 'junction-request', origin: 'manual', target: { generation: world.generation },
      parameters: { request: { junctionId: junction.id, authoringRevision: 1, configurationId: iteration % 2 ? 'opening' : 'wall', policy: 'rejectIfBusy', expiryTick: world.tickIndex + 2 } } });
    admissionMs.push(performance.now() - start); if (outcome.status !== 'queued') throw new Error(outcome.reason);
    const tick = performance.now(); world.step(); tickMs.push(performance.now() - tick);
    if (world.interventionState.receipts.at(-1).status !== 'accepted') throw new Error(world.interventionState.receipts.at(-1).reason);
  }
  admissionMs.sort((a, b) => a - b); tickMs.sort((a, b) => a - b);
  rows.push({ laneCount, switches: 20, admissionP50Ms: admissionMs[10], admissionP95Ms: admissionMs[19], wholeWorldTickP50Ms: tickMs[10], wholeWorldTickP95Ms: tickMs[19], geometry: world.editChunks.snapshot(), traversalQualification: 'not-measured-by-this-controller-profile' }); world.dispose();
}
process.stdout.write(JSON.stringify({ scope: 'command-admission-and-whole-world-ticks', rows }, null, 2) + '\n');
