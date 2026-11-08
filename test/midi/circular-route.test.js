import { expect } from 'chai';
import { createRouteCoordinateAtlas, validateRouteDefinition } from '../../js/app/procgen/workstation/physical/RouteCoordinateAtlas.js';
import { createTravelAccumulator, validateArticulationField } from '../../js/app/procgen/workstation/TravelAccumulator.js';
import { planCircularTravel } from '../../js/midi/content/CircularSpectrum.js';
import { describeNativeInstrumentEngines } from '../../js/app/midi-ui/NativeInstrumentSchema.js';
import { renderCausalOwnedTake } from '../../js/app/midi-ui/CausalOwnedRender.js';
import { getOwnedSourceProfile } from '../../js/app/midi-ui/OwnedSourceProfiles.js';

const field = { spacingPixels: 1000000, lifetimeScope: 'actorJourney', metric: 'qualified-route-arc-pixels', orientation: 'directed-route', phaseMode: 'direction-reversing', sustain: true, routeId: 'route' };
const parameters = () => ({ ...Object.fromEntries(Object.entries(getOwnedSourceProfile('worklet-spectrum').fields).map(([id, spec]) => [id, spec[2]])), sourceMode: 2, circularControlMode: 2, circularPixelsPerCycle: 256 });
const marker = (tick, gateId = 'entry') => ({ gateId, actorId: 1, direction: 'positive', fraction: 1, observationId: 'observed-marker-' + tick, sourceEventIds: ['motion-' + tick] });
function fixture({ closed = false, tickDurationMs = 1000, path = [{ x: 0, y: 0 }, { x: 256, y: 0 }, { x: 256, y: 256 }, { x: 0, y: 256 }] } = {}) {
  if (closed) path = [...path, { x: 0, y: 0 }];
  const route = validateRouteDefinition({ id: 'route', revision: 1, branchId: 'authored-u', loop: closed, tolerancePixels: 0,
    markers: [{ gateId: 'entry' }, { gateId: closed ? 'entry' : 'exit' }], segments: [{ id: 'leg', path }] }, [{ id: 'entry' }, { id: 'exit' }]);
  const atlas = createRouteCoordinateAtlas(), travel = createTravelAccumulator(); atlas.configure([route]); let tick = 0, point = { x: -1, y: 0 };
  const step = (next, crossings = [], options = {}) => {
    tick++; const fact = { kind: 'MotionCommitted', worldId: 'world', generation: 0, actorId: 1, laneId: 0, actionInstanceId: 'walking', causalSequence: tick, eventId: 'motion-' + tick,
      positionBefore: { ...point }, positionAfter: { ...next }, physicalPayload: { pathEvidence: 'committed-coordinate-write' }, ...options.fact };
    const batch = { version: 1, worldId: 'world', generation: 0, batchId: 'batch-' + tick, tick, tickDurationMs, facts: options.stationary ? [] : [fact], completeness: { status: 'complete', dropped: 0 },
      snapshot: { actors: [{ actorId: 1, laneId: 0, action: 'walking', ...next }] } }; point = { ...next }; atlas.observe(batch, crossings);
    const coordinate = atlas.coordinate(1, 'route'), result = options.stationary ? null : travel.consume(batch, fact, 'route-sound', field, 1, coordinate);
    return { coordinate, result, fact, batch };
  };
  return { atlas, travel, route, step };
}
const intent = ({ result, fact, batch }, kind = 'update') => ({ version: 1, kind, intentId: fact.eventId + ':' + kind, voiceId: 'route-voice', onsetId: 'route-voice', worldId: batch.worldId, generation: batch.generation,
  actorId: fact.actorId, mappingId: 'route-sound', sourceEventIds: [fact.eventId], physicalSourceKind: 'MotionCommitted', laneId: 0, pitch: { cents: 6000, referenceHz: 440 }, velocity01: 0.5, expression: {}, route: 'local', role: 'route-spectrum',
  scoreTime: { sourceTimeMs: batch.tick * batch.tickDurationMs, sourceTickDurationMs: batch.tickDurationMs, simTick: batch.tick, precision: 'tick' },
  articulationState: { travel: { ...result.observation, sourceSequence: fact.causalSequence, segmentOrdinal: 0, segmentCount: 1, completedTickDurationMs: batch.tickDurationMs, timing: 'completed-tick-equal-segments-v1' } } });
describe('canonical directed-route circular coordinates (deferred qualification)', () => {
  it('advances a U-route while its signed world-X displacement returns to zero, and reverses actual arc travel', () => {
    const f = fixture(), start = f.step({ x: 0, y: 0 }, [marker(1)]); expect(start.result.distancePixels).to.equal(0);
    let last;
    for (const point of [{ x: 256, y: 0 }, { x: 256, y: 256 }, { x: 0, y: 256 }]) last = f.step(point);
    expect(last.fact.positionAfter.x).to.equal(0); expect(last.result.state.signedDistancePixels).to.equal(768); expect(last.result.crossings).to.have.length(0);
    for (const rate of [44100, 48000, 96000]) { const plan = planCircularTravel(parameters(), intent(last), 0, rate); expect(plan.from).to.equal(2); expect(plan.to).to.equal(3); expect(plan.receipt.metric).to.equal('qualified-route-arc-pixels'); expect(plan.receipt.precision).to.equal('completed-route-endpoint-projection'); }
    const reverse = f.step({ x: 256, y: 256 }), plan = planCircularTravel(parameters(), intent(reverse), 0, 48000); expect(plan.from).to.equal(3); expect(plan.to).to.equal(2);
  });
  it('unwraps a complete 1024-pixel loop from its actual ordered seam marker', () => {
    const f = fixture({ closed: true }); f.step({ x: 0, y: 0 }, [marker(1)]);
    f.step({ x: 256, y: 0 }); f.step({ x: 256, y: 256 }); f.step({ x: 0, y: 256 });
    const lap = f.step({ x: 0, y: 0 }, [marker(5)]), plan = planCircularTravel(parameters(), intent(lap), 0, 48000);
    expect(lap.coordinate.lapId).to.equal(1); expect(lap.result.state.signedDistancePixels).to.equal(1024); expect(plan.to).to.equal(4); expect(lap.coordinate.entryObservationId).to.equal('observed-marker-1');
  });
  it('holds route phase across observed stationary ticks and keeps the original endpoint reference', () => {
    const f = fixture(); f.step({ x: 0, y: 0 }, [marker(1)]); const moved = f.step({ x: 256, y: 0 }), phase = moved.result.state.signedDistancePixels;
    for (let i = 0; i < 10; i++) { const held = f.step({ x: 256, y: 0 }, [], { stationary: true }); expect(held.coordinate.status).to.equal('qualified'); }
    const next = f.step({ x: 256, y: 256 }); expect(next.result.observation.from.signedDistancePixels).to.equal(phase); expect(next.result.observation.originRouteCoordinate).to.equal(0); expect(next.result.state.signedDistancePixels).to.equal(512);
  });
  it('restores the actual route entry and canonical accumulation without crossing a missing observation', () => {
    const f = fixture(); f.step({ x: 0, y: 0 }, [marker(1)]); f.step({ x: 256, y: 0 });
    const atlas = createRouteCoordinateAtlas(), travel = createTravelAccumulator(); atlas.configure([f.route]); atlas.restore(f.atlas.snapshot()); travel.restore(f.travel.snapshot());
    const next = f.step({ x: 256, y: 256 }); atlas.observe(next.batch, []); const restored = travel.consume(next.batch, next.fact, 'route-sound', field, 1, atlas.coordinate(1, 'route'));
    expect(restored).to.deep.equal(next.result);
    const missing = { ...next.coordinate, status: 'stale' }; expect(travel.consume(next.batch, next.fact, 'route-sound', field, 1, missing).status).to.equal('unsupported');
  });
  it('revoices captured route controls through the existing source/state-cut path and declines older capture versions', async () => {
    const [descriptor] = await describeNativeInstrumentEngines([{ engineId: 'worklet-spectrum', engineVersion: 1, artifactHash: 'a'.repeat(64) }]);
    const f = fixture({ tickDurationMs: 40, path: [{ x: 0, y: 0 }, { x: 2048, y: 0 }] }); f.step({ x: 0, y: 0 }, [marker(1)]);
    const first = intent(f.step({ x: 1, y: 0 }), 'begin'), second = intent(f.step({ x: 2, y: 0 }));
    const revoice = { operation: 'sound-only-revoice', version: 1, takeId: 'take:route', takeRevision: 1, sourceCanonicalHash: 'c'.repeat(64), sourceState: 'finalized', nextSequence: null,
      sourceVersions: { physicalMusic: 11 }, coverage: { status: 'known-covered' }, boundary: { status: 'captured-initial-state', state: { voices: [], sourceTimeMs: 0 } }, finalBoundaryState: { sourceTimeMs: 500 },
      intents: [first, second, { ...second, kind: 'end', intentId: 'route:end', articulationState: null, scoreTime: { ...second.scoreTime, sourceTimeMs: 200 } }] };
    const definition = { schemaVersion: 2, id: 'route.fixture', revision: 1, name: 'Route fixture', author: 'Fixture', tags: [], engineId: 'worklet-spectrum', engineVersion: 1,
      parameters: { sourceMode: 2, circularControlMode: 2, circularPixelsPerCycle: 256, attackSeconds: 0.005, decaySeconds: 0, sustain01: 1, releaseSeconds: 0.01 }, sampleRefs: [], modulations: [], macros: [], causalBindings: [], voicePolicy: { maxVoices: 2, steal: 'reject' }, mix: { gain01: 0.7, pan01: 0 } };
    const input = { definition, descriptor, revoice, sampleRate: 48000, startSeconds: 0.09, endSeconds: 0.24, tail: { mode: 'bounded-natural', maxSeconds: 1 } };
    const a = await renderCausalOwnedTake(input, { yieldControl: async () => {} }), b = await renderCausalOwnedTake({ ...input, restorationMode: 'owned-state-cut' }, { yieldControl: async () => {} });
    expect(a.manifest.realization.circularTravel).to.include({ voices: 1, segments: 2 }); expect(a.manifest.commands.capturedBegins).to.equal(1); expect(b.files.map(file => file.manifest.pcmHash)).to.deep.equal(a.files.map(file => file.manifest.pcmHash));
    let error; try { await renderCausalOwnedTake({ ...input, revoice: { ...revoice, sourceVersions: { physicalMusic: 10 } } }); } catch (caught) { error = caught; } expect(error?.code).to.equal('circular-route-capture-unavailable');
  });
  it('declines missing entry, teleports, foreign identities and a segment-precision claim', () => {
    const f = fixture(); expect(f.step({ x: -1, y: 0 }).result.status).to.equal('unsupported');
    f.step({ x: 0, y: 0 }, [marker(2)]); const good = f.step({ x: 256, y: 0 });
    expect(() => planCircularTravel({ ...parameters(), circularRequireSegments: 1 }, intent(good), 0, 48000)).to.throw('precision');
    const wrong = intent(good); wrong.articulationState.travel = { ...wrong.articulationState.travel, branchId: 'other' }; expect(() => planCircularTravel(parameters(), wrong, 0, 48000)).to.throw();
    const jump = f.step({ x: 256, y: 256 }, [], { fact: { discontinuity: true } }); expect(jump.coordinate.status).to.equal('discontinuous'); expect(jump.result.status).to.equal('unsupported');
    expect(() => validateArticulationField({ ...field, lifetimeScope: 'actionInstance' })).to.throw(); expect(() => validateArticulationField({ ...field, sustain: false })).to.throw();
  });
});
