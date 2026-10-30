import { createCausalMusicEngine } from '../../js/app/procgen/workstation/CausalMusicEngine.js';
import { expect } from 'chai';
import { BoundedDelayKernel } from '../../js/app/midi-ui/worklet/BoundedDelayProcessor.js';
import { createTravelColorationRecipe, travelColorationValue } from '../../js/midi/content/TravelColorationRecipes.js';
import { createTravelEffectMotion } from '../../js/app/procgen/workstation/TravelEffectMotion.js';

const delay = options => new BoundedDelayKernel({ sampleRate: 48000, maxDelayFrames: 512, delayFrames: 40.5, feedback: 0, feedbackMaximum: 0.35,
  interpolation: 'lagrange3', wet: 1, ...options });
describe('bounded fractional travel effects', () => {
  for (const rate of [44100, 48000, 96000]) it('preserves the cubic interpolation impulse weights and explicit minimum at ' + rate + ' Hz', () => {
    const kernel = delay({ sampleRate: rate, delayFrames: 4.5 }), output = [];
    for (let frame = 0; frame < 12; frame++) { kernel.sample(frame === 0 ? 1 : 0, 0); output.push(kernel.leftSample); }
    expect(output.slice(3, 7)).to.deep.equal([-1 / 16, 9 / 16, 9 / 16, -1 / 16]);
    expect(kernel.setDelay(1.9)).to.equal(false); expect(kernel.setDelay(2)).to.equal(true); expect(kernel.setDelay(512)).to.equal(true);
    expect(kernel.diagnostics()).to.include({ minimumDelayFrames: 2, interpolationOrder: 3, interpolationMaximumL1: 1.25, processingLatencyFrames: 0 });
  });
  it('keeps two taps and only the latest pending jump, including cancellation back to its current target', () => {
    const kernel = delay({ mode: 'jump', transitionFrames: 4, jumpPolicy: 'coalesce-latest' });
    kernel.setDelay(80); kernel.setDelay(120); kernel.setDelay(100); expect(kernel.pendingDelay).to.equal(100);
    kernel.setDelay(80); expect(kernel.pendingDelay).to.equal(0); kernel.setDelay(90);
    for (let frame = 0; frame < 4; frame++) kernel.sample(0, 0);
    expect(kernel.targetDelay).to.equal(90); expect(kernel.transition).to.equal(4);
    for (let frame = 0; frame < 4; frame++) kernel.sample(0, 0);
    expect(kernel.delay).to.equal(90); expect(kernel.transition).to.equal(0); expect(kernel.faults).to.equal(0);
  });
  it('restores a partially completed cubic jump and its pending target exactly', () => {
    const first = delay({ mode: 'jump', transitionFrames: 64, jumpPolicy: 'coalesce-latest' }), second = delay({ mode: 'jump', transitionFrames: 64, jumpPolicy: 'coalesce-latest' });
    for (let frame = 0; frame < 100; frame++) first.sample(Math.sin(frame / 11) * 0.2, 0);
    first.setDelay(80.25); first.sample(0.1, 0); first.setDelay(120.5);
    const bytes = new Uint8Array(first.stateByteLength()); first.snapshotInto(bytes); second.restoreFrom(bytes);
    for (let frame = 0; frame < 512; frame++) { first.sample(Math.sin(frame / 11) * 0.2, 0); second.sample(Math.sin(frame / 11) * 0.2, 0); expect(second.leftSample).to.equal(first.leftSample); }
  });
  it('maps signed reversal and wrap without adding a private clock or a discontinuous control step', () => {
    const { control } = createTravelColorationRecipe();
    expect(travelColorationValue(control, 0)).to.equal(travelColorationValue(control, 256));
    expect(travelColorationValue(control, -64)).to.equal(travelColorationValue(control, 64));
    expect(Math.abs(travelColorationValue(control, 255.999) - travelColorationValue(control, 256.001))).to.be.lessThan(1e-12);
    expect(() => travelColorationValue(control, NaN)).to.throw();
  });
  it('consumes the real causal engine mapping IDs and shared travel state without adding musical begins', () => {
    const graph = { version: 1, revision: 1, instruments: [{ id: 'texture', sourceKind: 'MotionCommitted',
      articulation: { spacingPixels: 4, metric: 'endpoint-chord', orientation: 'signedX', lifetimeScope: 'actorJourney', phaseMode: 'direction-reversing', sustain: true },
      pitchCents: 6000, velocity01: 0.75, role: 'texture', route: 'local' }] };
    const engine = createCausalMusicEngine({ getGraph: () => graph }), calls = [], { control } = createTravelColorationRecipe();
    const motion = createTravelEffectMotion({ update: (...args) => { calls.push(args); return { graphDefinitionHash: 'graph' }; }, bypass() {}, toFrame: () => 100 });
    const batch = (tick, from, to) => ({ version: 1, worldId: 'world', generation: 1, tick, batchId: `world:1:${tick}:0`, completeness: { status: 'complete', dropped: 0 },
      facts: [{ kind: 'MotionCommitted', eventId: `motion:${tick}`, causalSequence: tick, actorId: 7, actionInstanceId: '7:action:1', action: 'walk', laneId: 0,
        positionBefore: { x: from, y: 10 }, positionAfter: { x: to, y: 10 }, precision: 'endpoint' }] });
    try {
      const first = engine.processBatch(batch(1, 0, 1)), source = first.find(intent => intent.kind === 'begin');
      motion.bind({ voiceId: source.voiceId, generation: 1, instrumentId: source.mappingId, control, expected: { graphDefinitionHash: 'graph', ownerRouteRevision: 1 } });
      const all = [...first]; motion.consume(first, 'epoch');
      for (const [tick, from, to] of [[2, 1, 2], [3, 2, 2], [4, 2, 1]]) { const intents = engine.processBatch(batch(tick, from, to)); all.push(...intents); motion.consume(intents, 'epoch'); }
      expect(calls).to.have.length(3); expect(all.filter(intent => intent.kind === 'begin')).to.have.length(1);
      expect(engine.snapshot().travel.entries[0]).to.include({ signedDistancePixels: 1, pathDistancePixels: 3 });
    } finally { motion.dispose(); engine.dispose(); }
  });
  it('uses only the selected committed articulation voice, deduplicates rest and leaves later graph ownership intact', () => {
    const calls = [], bypasses = [], receipts = [], expected = { graphDefinitionHash: 'graph-one', ownerRouteRevision: 3 }, { control } = createTravelColorationRecipe();
    const motion = createTravelEffectMotion({ update: (node, values, frame, route) => { calls.push({ node, values, frame, route }); return { graphDefinitionHash: 'graph-one' }; },
      bypass: (...args) => bypasses.push(args), toFrame: score => score.frame, onReceipt: receipt => receipts.push(receipt) });
    motion.bind({ voiceId: 'actual-voice', generation: 1, instrumentId: 'travel', control, expected });
    const intent = (distance, extra = {}) => ({ voiceId: 'actual-voice', generation: 1, mappingId: 'travel', kind: 'update',
      intentId: 'intent-' + distance, sourceEventIds: ['motion-' + distance], articulationState: { signedDistancePixels: distance }, scoreTime: { frame: 100 + distance }, ...extra });
    motion.consume([intent(0), intent(0), intent(32, { voiceId: 'other-voice' }), intent(64)], 'epoch');
    expect(calls).to.have.length(2); expect(calls[1].frame).to.equal(164); expect(calls[1].route).to.deep.equal(expected);
    motion.consume([intent(64, { kind: 'end' })], 'epoch'); expect(motion.state().active).to.equal(null); expect(bypasses).to.have.length(0);
    expect(receipts.filter(receipt => receipt.stage === 'effect-control-native-api-scheduled')).to.have.length(2); motion.dispose();
  });
});
