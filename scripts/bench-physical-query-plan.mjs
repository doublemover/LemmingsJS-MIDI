import { performance } from 'node:perf_hooks';
import { validatePickupGate, createPickupQueryPlan, sweptPickupCrossings } from '../js/app/procgen/workstation/physical/PickupGates.js';
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))];
const results = [];
for (const count of [16, 256, 1024]) {
  const gates = Array.from({ length: count }, (_, index) => validatePickupGate({ id: `pickup-${index}`, geometry: { kind: 'segment', points: [{ x: index * 8 + 4, y: 0 }, { x: index * 8 + 4, y: 96 }] } }));
  const started = performance.now(), plan = createPickupQueryPlan(gates), compileMs = performance.now() - started;
  const indexed = [], reference = []; let candidates = 0, observed = 0;
  for (let tick = 0; tick < 256; tick++) {
    const segments = Array.from({ length: 128 }, (_, actor) => ({ before: { x: (actor * 37 + tick * 3) % (count * 8), y: 40 }, after: { x: (actor * 37 + tick * 3) % (count * 8) + 3, y: 40 } }));
    let start = performance.now(); const actual = [];
    for (const { before, after } of segments) { const query = plan.query(before, after, 0); if (query.status !== 'complete') throw new Error('Missing indexed query evidence.'); candidates += query.gates.length; for (const gate of query.gates) for (const hit of sweptPickupCrossings(gate, before, after)) actual.push(`${gate.id}:${hit.fraction}`); }
    indexed.push(performance.now() - start); start = performance.now(); const expected = [];
    for (const { before, after } of segments) for (const gate of gates) for (const hit of sweptPickupCrossings(gate, before, after)) expected.push(`${gate.id}:${hit.fraction}`);
    reference.push(performance.now() - start); if (actual.sort().join('|') !== expected.sort().join('|')) throw new Error('Indexed pickup observations diverged from all-gates reference.'); observed += actual.length;
  }
  if (!observed) throw new Error('Physical query workload produced no crossings.');
  results.push({ count, actors: 128, ticks: 256, compileMs, candidates, observed, index: plan.stats(), indexedMs: { p50: percentile(indexed, 0.5), p95: percentile(indexed, 0.95), p99: percentile(indexed, 0.99) }, referenceMs: { p50: percentile(reference, 0.5), p95: percentile(reference, 0.95), p99: percentile(reference, 0.99) } });
}
process.stdout.write(JSON.stringify({ schema: 'physical-query-profile/v1', source: process.env.GIT_COMMIT || null, platform: process.platform, node: process.version, results }, null, 2) + '\n');
