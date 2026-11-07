export const sampleTraversalBinding = (extra = {}) => ({ schema: 'lemmings-sample-traversal/v1', revision: 1, mappingId: 'texture', lifetimeScope: 'actorJourney',
  metric: 'axis-projection', orientation: 'signedX', mode: 'tape-footpath', originPixels: 0, framesPerWorldPixel: 20,
  requiredPrecision: 'endpoint-chord', discontinuityPolicy: 'end-voice', timing: 'completed-tick-equal-segments-v1', ...extra });
export const sampleTravelGraph = (extra = {}) => ({ version: 1, revision: 1, instruments: [{ id: 'texture', sourceKind: 'MotionCommitted',
  articulation: { spacingPixels: 1000000, metric: 'axis-projection', orientation: 'signedX', lifetimeScope: 'actorJourney', phaseMode: 'direction-reversing', sustain: true, ...extra },
  pitchCents: 6000, velocity01: 0.7, role: 'texture', route: 'local' }] });
export const sampleMotionBatch = (tick, from, to, extra = {}) => ({ version: 1, worldId: 'world', generation: 1, tick, batchId: 'motion-batch:' + tick, sourceTimeMs: (tick - 1) * 60, tickDurationMs: 60,
  completeness: { status: 'complete', dropped: 0 }, facts: [{ kind: 'MotionCommitted', eventId: 'motion:' + tick, causalSequence: tick * 10,
    actorId: 1, laneId: 0, actionInstanceId: 'action:' + tick, action: 'walking', positionBefore: { x: from, y: 10 }, positionAfter: { x: to, y: 10 },
    precision: 'endpoint', physicalPayload: { pathEvidence: 'endpoint-chord', contactObserved: false }, ...extra }] });
