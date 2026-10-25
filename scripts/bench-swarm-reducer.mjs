import { performance } from 'node:perf_hooks';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createSwarmReducer } from '../js/app/procgen/workstation/physical/SwarmReducer.js';
const ticks = Number(process.env.SWARM_PROFILE_TICKS || 1200);
if (!Number.isSafeInteger(ticks) || ticks < 60 || ticks > 36000) throw new Error('SWARM_PROFILE_TICKS must be 60..36000.');
const actors = Array.from({ length: 4096 }, (_, actorId) => ({ actorId, laneId: actorId % 1024, x: actorId % 128, y: 0, action: 'walking', birthCohortId: `cohort:${actorId % 128}` }));
const results = [];
for (const representation of ['individual', 'centroidChord', 'densityCloud', 'representativeStrikes']) {
  const reducer = createSwarmReducer(); reducer.configure({ version: 1, representation, windowInSimTime: 54, groupBy: ['cohort'], maxVoices: 64 });
  const times = [], heapBefore = process.memoryUsage().heapUsed; let requested = 0, represented = 0, emitted = 0, peakGroups = 0, peakBuckets = 0, capacityFallbacks = 0;
  for (let tick = 1; tick <= ticks + 60; tick++) {
    const intents = tick > ticks ? [] : actors.flatMap(actor => { const start = { version: 1, intentId: `i:${tick}:${actor.actorId}`, voiceId: `v:${actor.actorId}`, onsetId: `v:${actor.actorId}`, worldId: 'profile', generation: 1, batchId: `b:${tick}`, kind: 'begin', actorId: actor.actorId, laneId: actor.laneId, route: 'local', mappingId: 'strike', role: 'texture', sourceEventIds: [`e:${tick}:${actor.actorId}`], physicalSourceKind: 'ContactResolved', scoreTime: { simTick: tick, subTick: 0 }, pitch: { cents: 4800 + actor.actorId % 24 * 100, referenceHz: 440 }, velocity01: 0.5, expression: {} }; return [start, { ...start, intentId: `${start.intentId}:end`, kind: 'end', terminationReason: 'one-shot' }]; }), batch = { worldId: 'profile', generation: 1, tick, batchId: `b:${tick}`, snapshot: { actors }, completeness: { status: 'complete' } };
    const start = performance.now(), result = reducer.reduce(batch, intents), elapsed = performance.now() - start; if (tick <= ticks) times.push(elapsed);
    requested += result.summary.requestedEventCount; represented += result.summary.representedEventCount; emitted += result.summary.emittedVoices; peakGroups = Math.max(peakGroups, result.summary.retainedGroups); peakBuckets = Math.max(peakBuckets, result.summary.retainedBuckets); if (result.summary.fallbackReasons.length) capacityFallbacks++;
    if (result.summary.emittedVoices > 64 || batch.snapshot.actors !== actors || result.summary.rawFactsModified) throw new Error('Semantic budget or source isolation violated.');
  }
  const final = reducer.snapshot(); if (final.held.length || final.audible.length || final.groups.length) throw new Error('Reducer state failed to retire after the source window.'); times.sort((a, b) => a - b);
  results.push({ representation, requested, represented, emitted, peakGroups, peakBuckets, capacityFallbacks, retainedHeapDeltaBytes: process.memoryUsage().heapUsed - heapBefore, finalSnapshotBytes: Buffer.byteLength(JSON.stringify(final)), medianMs: times[Math.floor(times.length / 2)], p95Ms: times[Math.floor(times.length * 0.95)], maxMs: times.at(-1) });
}
console.log(JSON.stringify({ schema: 'semantic-swarm-profile/v1', sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model, logicalCPUs: os.cpus().length }, ticks, sourceCount: 4096, lanes: 1024, semanticVoiceBudget: 64, scope: 'reducer only, allocation-inclusive timing; retained heap delta is not per-event allocation or DSP/acoustic qualification', results }, null, 2));
