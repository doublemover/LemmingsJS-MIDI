import { performance } from 'node:perf_hooks';
import { createActivityWindowObserver, validateActivityWindows } from '../js/app/procgen/workstation/physical/ActivityWindows.js';
const results = [], domain = { membership: () => ({ status: 'complete', includes: true }) };
for (const population of [8, 128, 1024]) {
  const observer = createActivityWindowObserver(), definition = { id: 'activity', revision: 1, timeoutTicks: 10, physicalKinds: ['ContactResolved'] }; observer.configure(validateActivityWindows({ activityWindows: [definition] }, {}));
  const samples = []; let rests = 0, censored = 0;
  for (let tick = 1; tick <= 120; tick++) {
    const actors = Array.from({ length: population }, (_, actorId) => ({ actorId, laneId: actorId, x: actorId, y: 0 })), facts = tick % 12 === 1 ? actors.map(actor => ({ kind: 'ContactResolved', actorId: actor.actorId, laneId: actor.laneId, eventId: `e:${tick}:${actor.actorId}`, causalSequence: tick * 2048 + actor.actorId })) : [];
    const batch = { worldId: 'bench', generation: 1, tick, batchId: `b:${tick}`, completeness: { status: 'complete' }, snapshot: { actors } }, start = performance.now(), result = observer.observe(batch, facts, domain); samples.push(performance.now() - start); rests += result.facts.filter(value => value.kind === 'RestStarted').length; censored += result.completeness.status === 'censored' ? 1 : 0;
    if (result.responses.length) throw new Error('Inactivity created an unauthored cadence.');
  }
  samples.sort((a, b) => a - b); results.push({ population, boundaries: samples.length, rests, censored, medianMs: samples[60], p95Ms: samples[114], maxMs: samples.at(-1), snapshotBytes: JSON.stringify(observer.snapshot()).length * 2 });
}
console.log(JSON.stringify({ schema: 'physical-activity-planning/v1', scope: 'physical state only; no audio or browser qualification', results }, null, 2));
