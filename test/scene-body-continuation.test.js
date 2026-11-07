import assert from 'node:assert/strict';
import { captureSceneBodyContinuation, restoreSceneBodyContinuation } from '../js/app/procgen/workstation/SceneBodyContinuation.js';
import { createTravelEffectMotion } from '../js/app/procgen/workstation/TravelEffectMotion.js';

describe('scene body image ownership', () => {
  const mechanism = { schema: 'fixture-route/v1', id: 'body' }, context = { sampleRate: 48000 }, expected = { graphDefinitionHash: 'exact-body', ownerRouteRevision: 7 };
  const frontier = { graphDefinitionHash: 'exact-body', sourceOwnerRouteRevision: 7, ownerRouteRevision: 8 };
  it('adopts the new lease while retaining model metadata without preparing another graph', () => {
    const captured = captureSceneBodyContinuation({ mechanism, expected, context, active: true, metadata: { source: 'lane:one' } });
    const restored = restoreSceneBodyContinuation(captured, mechanism, context, frontier);
    assert.deepEqual(restored.expected, { ...expected, ownerRouteRevision: 8 });
    assert.equal(restored.metadata.source, 'lane:one'); assert.equal(restored.retainedRoute, true);
    assert.throws(() => restoreSceneBodyContinuation(captured, mechanism, context, { ...frontier, graphDefinitionHash: 'other-body' }));
    assert.throws(() => restoreSceneBodyContinuation(captured, mechanism, { sampleRate: 96000 }, frontier));
    assert.throws(() => captureSceneBodyContinuation({ mechanism, expected, context, pending: {}, active: true, metadata: null }));
  });
  it('keeps a manually replaced scene route inactive in the new owner', () => {
    const captured = captureSceneBodyContinuation({ mechanism, expected, context, active: false, metadata: null });
    assert.equal(restoreSceneBodyContinuation(captured, mechanism, context, frontier).expected.ownerRouteRevision, -1);
  });
  it('continues actual travel controls on the restored frame without replay', () => {
    const scheduled = [], control = { nodeId: 'body', parameter: 'morph01', minimum: 0, maximum: 1, travelPixels: 256 };
    const make = () => createTravelEffectMotion({ update: (...args) => { scheduled.push(args); return { graphDefinitionHash: 'exact-body' }; }, toFrame: time => time, bypass: () => {} });
    const old = make(); old.bind({ voiceId: 'voice', generation: 2, instrumentId: 'rail', control, expected });
    const intent = { kind: 'update', voiceId: 'voice', generation: 2, mappingId: 'rail', scoreTime: 100, articulationState: { signedDistancePixels: 64 }, sourceEventIds: ['motion:one'] };
    old.consume([intent], 'old');
    const saved = old.snapshot({ audioFrame: 128, sampleRate: 48000, ...expected });
    const restored = make(); restored.restore(saved, { ...frontier, audioFrame: 1024, sourceAudioFrame: 128, sampleRate: 48000, voices: [{ voiceId: 'voice', generation: 2, instrumentId: 'rail' }] });
    assert.equal(scheduled.length, 1); assert.equal(restored.state().active.lastFrame, 996);
    restored.consume([{ ...intent, scoreTime: 1040 }], 'new'); assert.equal(scheduled.length, 1);
    restored.consume([{ ...intent, scoreTime: 1050, articulationState: { signedDistancePixels: 128 } }], 'new');
    assert.equal(scheduled.length, 2); assert.equal(scheduled[1][2], 1050); assert.equal(scheduled[1][3].ownerRouteRevision, 8);
    old.dispose(); restored.dispose();
  });
});
