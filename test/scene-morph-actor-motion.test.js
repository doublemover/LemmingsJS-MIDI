import assert from 'node:assert/strict';
import { createSceneMorphActorMotion } from '../js/app/procgen/workstation/SceneMorphActorMotion.js';

describe('actual gate actor body-control ownership', () => {
  const motion = (tick, from, to, extra = {}) => ({ kind: 'MotionCommitted', actorId: 3, causalSequence: tick * 2, eventId: 'motion:' + tick, positionBefore: { x: from, y: 72 }, positionAfter: { x: to, y: 72 }, ...extra });
  const batch = (tick, facts) => ({ worldId: 'world', generation: 2, tick, sourceTimeMs: tick * 20, tickDurationMs: 20, facts, completeness: { status: 'complete', dropped: 0 } });
  const begin = { kind: 'begin', intentId: 'gate-onset', mappingId: 'first-gate', actorId: 3, voiceId: 'gate-voice', worldId: 'world', generation: 2, scoreTime: { sourceTimeMs: 20, sourceTickDurationMs: 20, subTick: 0 }, sourceEventIds: ['crossing:one', 'motion:1'] };
  it('binds only accepted audio and follows the actor after its short gate voice ends', () => {
    const owner = createSceneMorphActorMotion({ instrumentId: 'first-gate' });
    assert.deepEqual(owner.consume(batch(1, [motion(1, 95, 97)]), [begin], new Map([[begin.intentId, 'rejected']])), []);
    assert.equal(owner.consume(batch(1, [motion(1, 95, 97)]), [begin], new Map([[begin.intentId, 'accepted']]))[0].signedDistancePixels, 0);
    const update = owner.consume(batch(2, [motion(2, 97, 101)]), [{ ...begin, kind: 'end' }]);
    assert.equal(update[0].signedDistancePixels, 4); assert.equal(update[0].kind, 'control');
    assert.equal(owner.consume(batch(3, [motion(3, 101, 99)]), [])[0].signedDistancePixels, 2);
    const restored = createSceneMorphActorMotion({ instrumentId: 'first-gate' }); restored.restore(owner.snapshot(), { worldId: 'world', generation: 2 });
    assert.deepEqual(restored.consume(batch(4, [motion(4, 99, 97)]), []), owner.consume(batch(4, [motion(4, 99, 97)]), []));
  });
  for (const condition of ['gap', 'teleport', 'termination', 'unknown-position']) it('freezes known control after ' + condition, () => {
    const owner = createSceneMorphActorMotion({ instrumentId: 'first-gate' }); owner.consume(batch(1, [motion(1, 95, 97)]), [begin]);
    const next = condition === 'gap' ? batch(3, [motion(3, 97, 100)]) : condition === 'termination' ? batch(2, [{ kind: 'ActorTerminated', actorId: 3 }]) : batch(2, [motion(2, condition === 'unknown-position' ? 500 : 97, 100, condition === 'teleport' ? { discontinuity: true } : {})]);
    assert.deepEqual(owner.consume(next, []), []); assert.equal(owner.snapshot().source.stopped, true);
    assert.deepEqual(owner.consume(batch(4, [motion(4, 100, 102)]), [begin]), []);
  });
});
