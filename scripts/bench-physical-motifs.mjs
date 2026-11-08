import { performance } from 'node:perf_hooks';
import { createPhysicalMotifObserver, validatePhysicalMotifs } from '../js/app/procgen/workstation/physical/PhysicalMotifs.js';
const results = [], environment = { membership: () => ({ status: 'complete', includes: true }) };
for (const population of [8, 128, 1024]) {
  const definitions = validatePhysicalMotifs({ motifs: [{ id: 'repeat', revision: 1, roles: [{ id: 'actor' }], overlapPolicy: 'all', maximumPartials: 64, expiryTicks: 32, clauses: [{ kind: 'repeat', count: 3, role: 'actor', predicate: { kind: 'ContactResolved' } }] }] }, {});
  const observer = createPhysicalMotifObserver(); observer.configure(definitions); const samples = []; let completions = 0, censored = 0;
  for (let tick = 1; tick <= 120; tick++) {
    const actors = Array.from({ length: population }, (_, actorId) => ({ actorId, laneId: 0, x: actorId, y: 0 })), facts = actors.map(actor => ({ kind: 'ContactResolved', actorId: actor.actorId, eventId: `e:${tick}:${actor.actorId}`, causalSequence: tick * 2048 + actor.actorId }));
    const batch = { worldId: 'bench', generation: 1, tick, batchId: `b:${tick}`, terrainRevisionAfter: 0, snapshot: { actors }, completeness: { status: 'complete' } }, start = performance.now(), result = observer.observe(batch, facts, environment); samples.push(performance.now() - start); completions += result.facts.length; censored += result.completeness.status === 'censored' ? 1 : 0;
    if (observer.diagnostics().partials > 64) throw new Error('Motif partial budget exceeded.');
  }
  samples.sort((a, b) => a - b); results.push({ population, boundaries: samples.length, completions, censored, medianMs: samples[60], p95Ms: samples[114], maxMs: samples.at(-1), snapshotBytes: JSON.stringify(observer.snapshot()).length * 2 });
}
console.log(JSON.stringify({ schema: 'physical-motif-planning/v1', scope: 'bounded semantic recognition; no renderer or acoustic qualification', results }, null, 2));
