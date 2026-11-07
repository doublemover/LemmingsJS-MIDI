import { performance } from 'node:perf_hooks';
import { validatePhysicalFeedback } from '../js/app/procgen/workstation/physical/PhysicalFeedbackSchema.js';
import { createPhysicalFeedbackState, evaluatePhysicalFeedback } from '../js/app/procgen/workstation/physical/PhysicalFeedback.js';
const results = [];
for (const actors of [8, 128, 1024]) {
  const graph = { feedback: validatePhysicalFeedback({ version: 1, conductors: Array.from({ length: 32 }, (_, index) => ({ id: `rule-${index}`, revision: 1, source: { kind: 'ContactResolved' }, target: { version: 1, kind: 'global' }, command: { kind: 'set-release-policy', parameters: { spawnSpreadTicks: index % 13 } }, fuel: 4, refractoryTicks: 8 })) }) };
  let state = createPhysicalFeedbackState('profile', 1), proposals = 0, maxWork = 0, refusal = null; const samples = [];
  for (let tick = 1; tick <= 120; tick++) {
    const batch = { batchId: `batch:${tick}`, generation: 1, tick, completeness: { status: 'complete' }, snapshot: { tick, actors: Array.from({ length: actors }, (_, actorId) => ({ actorId, x: actorId, y: 0 })) }, facts: Array.from({ length: actors }, (_, actorId) => ({ kind: 'ContactResolved', actorId, eventId: `root:${tick}:${actorId}`, causalSequence: tick * 2048 + actorId })) }, start = performance.now();
    try { const next = evaluatePhysicalFeedback({}, graph, batch, null, state); state = next.state; proposals += next.commands.length; maxWork = Math.max(maxWork, next.work); if (next.commands.some(command => command.applyAtTick <= tick)) throw new Error('Same-tick feedback escaped.'); } catch (error) { refusal = error.message; break; } finally { samples.push(performance.now() - start); }
  }
  samples.sort((a, b) => a - b); results.push({ actors, ticks: samples.length, proposals, maxWork, refusal, medianMs: samples[Math.floor(samples.length / 2)], p95Ms: samples[Math.floor(samples.length * 0.95)], maxMs: samples.at(-1), stateBytes: JSON.stringify(state).length * 2 });
}
console.log(JSON.stringify({ schema: 'physical-feedback-resource-profile/v1', scope: 'bounded source planning, not browser/audio qualification', results }, null, 2));
