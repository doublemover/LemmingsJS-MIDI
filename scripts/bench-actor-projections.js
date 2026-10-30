import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { ProcgenActorVisibility } from '../js/app/procgen/ProcgenActorVisibility.js';

const iterations = Number(process.argv.find(value => value.startsWith('--iterations='))?.split('=')[1] || 1000);
if (!Number.isSafeInteger(iterations) || iterations < 10 || iterations > 100000) throw new Error('Invalid iteration count');
const percentile = (values, p) => values.slice().sort((a, b) => a - b)[Math.floor((values.length - 1) * p)];
const summary = values => ({ p50: percentile(values, .5), p95: percentile(values, .95), p99: percentile(values, .99) });
const better = (a, b) => !a || b.x > a.x || b.x === a.x && b.id < a.id;
const results = [];
for (const lanes of [8, 128, 1024]) for (const dirtyFraction of [1, .1]) {
  const actors = Array.from({ length: lanes * 4 }, (_, id) => ({ id, x: id % 17, y: Math.floor(id / 4) * 96 + 60, laneIndex: Math.floor(id / 4), action: {} }));
  const world = { actors, actions: {}, laneCount: lanes, laneHeight: 96, generation: 1, tickIndex: 0 }, index = new ProcgenActorVisibility(world);
  const dirtyBuckets = Array.from({ length: lanes }, () => new Map()), oldRows = new Map();
  const timings = { publication: [], indexedQuery: [], drawQuery: [], referenceQuery: [], dirtyCandidate: [] };
  const drawVisits = [], queryAllocations = [];
  for (const actor of actors) { dirtyBuckets[Math.floor(actor.y / 96)].set(actor.id, { ...actor }); oldRows.set(actor.id, Math.floor(actor.y / 96)); }
  for (let tick = 0; tick < iterations + 100; tick++) {
    world.tickIndex++; const dirty = [];
    for (let id = dirtyFraction === 1 ? 0 : tick % 10; id < actors.length; id += dirtyFraction === 1 ? 1 : 10) {
      const actor = actors[id]; actor.x = (actor.x + 13) % 997; actor.y = ((Math.floor(id / 4) + tick % 3) % lanes) * 96 + 60; dirty.push(actor);
    }
    const begin = performance.now(); index.publish(); const published = performance.now();
    const actual = index.physicalLeader(0, 8); const queried = performance.now();
    const beforeDraw = index.getStats(), visible = index.query(0, 8 * 96 - 1), afterDraw = index.getStats(), drawn = performance.now();
    let expected = null;
    for (const actor of actors) if (Math.floor(actor.y / 96) < 8 && better(expected, actor)) expected = actor;
    const referenced = performance.now();
    // Experimental dirty-row copy-on-write candidate, not a production selection.
    const changedRows = new Set();
    for (const actor of dirty) {
      const old = oldRows.get(actor.id), row = Math.floor(actor.y / 96);
      changedRows.add(old); changedRows.add(row); dirtyBuckets[old].delete(actor.id); dirtyBuckets[row].set(actor.id, Object.freeze({ ...actor })); oldRows.set(actor.id, row);
    }
    const frozenRows = new Map([...changedRows].map(row => [row, Object.freeze([...dirtyBuckets[row].values()])]));
    const dirtyDone = performance.now();
    assert.equal(actual?.id, expected?.id); assert.ok(frozenRows.size <= lanes);
    assert.equal(visible.length, actors.filter(actor => Math.floor(actor.y / 96) < 8).length);
    assert.equal(afterDraw.drawScans, 0); assert.equal(afterDraw.actorScans, beforeDraw.actorScans);
    if (tick >= 100) {
      timings.publication.push(published - begin); timings.indexedQuery.push(queried - published);
      timings.drawQuery.push(drawn - queried); timings.referenceQuery.push(referenced - drawn); timings.dirtyCandidate.push(dirtyDone - referenced);
      drawVisits.push(afterDraw.queryVisits - beforeDraw.queryVisits); queryAllocations.push(afterDraw.projection.allocations - beforeDraw.projection.allocations);
    }
  }
  results.push({ lanes, actors: actors.length, visibleRows: 8, dirtyFraction, timingsMs: Object.fromEntries(Object.entries(timings).map(([key, values]) => [key, summary(values)])),
    drawCandidateVisits: summary(drawVisits), drawProjectionAllocations: summary(queryAllocations), counters: index.getStats() });
  index.dispose();
}
process.stdout.write(JSON.stringify({ schema: 'actor-projection-benchmark/v2', iterations, warmup: 100, runtime: process.version,
  allocationScope: 'Projection version publications are counted; retained/peak bytes are conservative admission estimates, not sampled V8 heap or counts of every JavaScript allocation.',
  qualification: 'mechanical-projection-only; no browser, pixels, physical-event equivalence, or production dirty-index selection', results }, null, 2) + '\n');
