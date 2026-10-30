import { performance } from 'node:perf_hooks';
import { createPhraseCargoObserver, validatePhraseCargoStations } from '../js/app/procgen/workstation/physical/PhraseCargo.js';
const results = [];
for (const population of [8, 128, 1024]) {
  const cargo = createPhraseCargoObserver(); cargo.configure(validatePhraseCargoStations([{ id: 'capture', kind: 'capture', source: { kind: 'pickup', id: 'in' }, payload: { version: 1, kind: 'pitch', cents: 6000 }, expiryTicks: 60 }, { id: 'deliver', kind: 'delivery', source: { kind: 'pickup', id: 'out' } }], { pickups: [{ id: 'in' }, { id: 'out' }] }));
  const actors = Array.from({ length: population }, (_, actorId) => ({ actorId, laneId: actorId, x: 0, y: 0 })), times = []; let attacks = 0, peakBytes = 0, peakTokens = 0, censored = 0;
  for (let tick = 1; tick <= 240; tick++) {
    const phase = tick % 20, facts = [1, 11].includes(phase) ? actors.map(actor => ({ kind: 'PickupCrossing', ...actor, gateId: phase === 1 ? 'in' : 'out', pitchCents: 6000, eventId: `e:${tick}:${actor.actorId}`, observationId: `o:${tick}:${actor.actorId}`, causalSequence: tick * 2048 + actor.actorId, fraction: 1 })) : [], batch = { worldId: 'profile', generation: 1, tick, batchId: `b:${tick}`, completeness: { status: 'complete' }, snapshot: { tick, actors } }, start = performance.now(), result = cargo.observe(batch, facts); times.push(performance.now() - start); attacks += result.responses.length; if (result.completeness.status !== 'complete') censored++; const state = cargo.diagnostics(); peakBytes = Math.max(peakBytes, state.ownedBytes); peakTokens = Math.max(peakTokens, state.tokens.length);
    if (![11].includes(phase) && result.responses.length) throw new Error('Cargo emitted an attack without delivery.');
  }
  times.sort((a, b) => a - b); results.push({ population, attacks, peakTokens, peakBytes, censored, medianMs: times[120], p95Ms: times[228], maxMs: times.at(-1), finalTokens: cargo.snapshot().tokens.length });
}
console.log(JSON.stringify({ schema: 'physical-phrase-cargo-profile/v1', scope: 'bounded ownership and delivery processing; no DSP/browser qualification', results }, null, 2));
