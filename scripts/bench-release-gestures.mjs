import { performance } from 'node:perf_hooks';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { loadProcgenMasks } from './bench-procgen-lanes.js';
const masks = await loadProcgenMasks(), results = [];
for (const laneCount of [8, 128, 1024]) {
  const world = new ProcgenLaneWorld({ masks, laneCount, cohorts: true, assists: false, maxActors: laneCount * 2, seed: 42, stallPolicy: { releaseIntervalTicks: 17, secondsWithoutProgress: 1000 } }), durations = [];
  let births = 0, missed = 0; world.soundEvents.onBatch.on(batch => { births += batch.facts.filter(f => f.kind === 'ActorBorn' && f.releaseGesture).length; missed += batch.facts.filter(f => f.kind === 'BirthAdmissionMissed' && f.gestureId === 'bench').length; });
  world.prepareIntervention({ id: 'release-bench', kind: 'set-release-gesture', origin: 'manual', target: { generation: world.generation }, parameters: { gesture: { version: 1, id: 'bench', revision: 1, nominalGapTicks: 17, spreadTicks: 12, grouping: 'cohort-spray', clockMode: 'locked', finiteBurstCount: laneCount, lanePhase: [], liveChangeBoundary: 'next-cohort' } } }).commit();
  try { for (let tick = 0; tick < 100; tick++) { const start = performance.now(); world.step(); durations.push(performance.now() - start); } if (births + missed !== laneCount) throw new Error('Finite admission outcomes were not conserved.'); durations.sort((a, b) => a - b); results.push({ laneCount, births, missed, medianMs: durations[50], p95Ms: durations[95], maxMs: durations.at(-1), releaseStateBytes: JSON.stringify(world.population.snapshot()).length * 2, pendingCommandBytes: world.interventionState.pendingBytes }); } finally { world.dispose(); }
}
console.log(JSON.stringify({ schema: 'physical-release-gesture-profile/v1', scope: 'real simulation admission; no browser/audio qualification', results }, null, 2));
