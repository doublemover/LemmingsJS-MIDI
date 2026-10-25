import { performance } from 'node:perf_hooks';
import { createEncounterObserver, validateEncounterDomain } from '../js/app/procgen/workstation/physical/Encounters.js';
const results = [], domain = { ensembles: [], routes: [], pickups: [] }, environment = { membership: () => ({ status: 'complete', includes: true }) };
for (const population of [8, 128, 512, 1024]) for (const dense of [false, true]) {
  const observer = createEncounterObserver(); observer.configure(validateEncounterDomain({ encounters: [{ id: 'bench', revision: 1, region: { x1: -100, y1: -100, x2: 100000, y2: 1000 } }] }, domain));
  const samples = []; let begins = 0, voices = 0, aggregatePairs = 0, censored = 0;
  for (let tick = 1; tick <= 120; tick++) {
    const actors = Array.from({ length: population }, (_, actorId) => ({ actorId, laneId: 0, x: dense ? 1 : actorId * 10 + tick / 10, y: 0 }));
    const facts = actors.map(actor => ({ kind: 'MotionCommitted', actorId: actor.actorId, eventId: `e:${tick}:${actor.actorId}`, causalSequence: tick * 2048 + actor.actorId, positionBefore: { x: actor.x - 0.1, y: 0 }, positionAfter: actor }));
    const batch = { worldId: 'bench', generation: 1, tick, batchId: `b:${tick}`, completeness: { status: 'complete' }, snapshot: { actors, revision: tick } };
    const start = performance.now(), result = observer.observe(batch, facts, environment); samples.push(performance.now() - start);
    begins += result.facts.filter(fact => fact.kind === 'EncounterBegan').length; voices += result.responses.length; aggregatePairs += result.facts.reduce((sum, fact) => sum + (fact.exactContainedPairs || 0), 0); censored += result.completeness.status === 'censored' ? 1 : 0;
  }
  if (dense && (begins !== 1 && population > 32 || voices > 8)) throw new Error('Dense encounter ownership or representative budget failed.');
  samples.sort((a, b) => a - b); results.push({ population, dense, boundaries: samples.length, begins, voices, aggregatePairs, censored, medianMs: samples[60], p95Ms: samples[114], maxMs: samples.at(-1), checkpointBytes: JSON.stringify(observer.snapshot()).length * 2 });
}
console.log(JSON.stringify({ schema: 'physical-encounter-planning/v1', scope: 'bounded semantic relationships; not audio or browser qualification', results }, null, 2));
