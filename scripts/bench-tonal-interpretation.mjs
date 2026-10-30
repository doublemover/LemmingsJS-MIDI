import { performance } from 'node:perf_hooks';
import { createCausalMusicEngine } from '../js/app/procgen/workstation/CausalMusicEngine.js';

// Descriptor/semantic planning only: not a renderer, PCM or realtime qualification.
const tuning = { version: 1, id: 'bench-just', kind: 'ratios', values: [[1, 1], [5, 4], [3, 2]], referenceCents: 4800 };
const results = [];
for (const population of [8, 128, 1024]) {
  const graph = { version: 1, revision: 1, instruments: [{ id: 'held', sourceKind: 'ActionEntered', action: 'blocking', pitchCents: 4800, velocity01: 0.5, route: 'local', role: 'held', formationId: 'formation' }],
    ensembles: [{ id: 'all', membershipMode: 'dynamic', maximumMembers: 16384, selector: { kind: 'lane', laneId: 0 } }],
    formations: [{ id: 'formation', revision: 1, ensembleId: 'all', metric: 'laneX', maximumVoices: 32, tuning, spacingPixels: 16 }] };
  const engine = createCausalMusicEngine({ getGraph: () => graph, traceLimit: 0 }), samples = []; let emitted = 0;
  for (let tick = 1; tick <= 120; tick++) {
    const actors = Array.from({ length: population }, (_, actorId) => ({ actorId, laneId: 0, action: 'blocking', x: actorId * (1 + tick / 120), y: 0 }));
    const facts = actors.map((actor, index) => ({ actorId: actor.actorId, laneId: 0, eventId: `event:${tick}:${index}`, causalSequence: tick * 2048 + index,
      ...(tick === 1 ? { kind: 'ActionEntered', action: 'blocking', actionInstanceId: `block:${actor.actorId}` } : { kind: 'MotionCommitted', positionBefore: { x: actor.actorId * (1 + (tick - 1) / 120), y: 0 }, positionAfter: { x: actor.x, y: 0 } }) }));
    const batch = { version: 1, worldId: 'benchmark', generation: 1, tick, batchId: `batch:${tick}`, completeness: { status: 'complete', dropped: 0 }, facts, snapshot: { generation: 1, tick, revision: tick, actors } };
    const before = performance.now(); emitted += engine.processBatch(batch).length; samples.push(performance.now() - before);
  }
  const view = engine.diagnostics().tonal.formations.views[0];
  if (view?.status !== 'complete' || view.memberCount !== population || view.representativeCount > 32 || engine.diagnostics().activeVoices > 32) throw new Error('Missing or invalid formation workload evidence.');
  samples.sort((a, b) => a - b); results.push({ population, processedBoundaries: samples.length, emitted, representativeCount: view.representativeCount, aggregated: view.aggregated,
    medianMs: samples[Math.floor(samples.length / 2)], p95Ms: samples[Math.floor(samples.length * 0.95)], maximumMs: samples.at(-1) });
}
console.log(JSON.stringify({ schema: 'tonal-planning-benchmark/v1', scope: 'completed-projection-semantic-planning', renderQualification: 'not-run', results }, null, 2));
