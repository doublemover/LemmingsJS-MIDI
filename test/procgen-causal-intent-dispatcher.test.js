import { expect } from 'chai';
import { createCausalIntentDispatcher } from '../js/app/procgen/workstation/CausalIntentDispatcher.js';
import { createCausalMusicEngine } from '../js/app/procgen/workstation/CausalMusicEngine.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';

describe('causal intent sink dispatch', () => {
  it('delivers physical updates through the owned execution and distinguishes unsupported semantic observations', () => {
    const calls = [], cause = { sourceKind: 'MotionCommitted', eventId: 'fact', evidence: 'completed-world-fact', values: { displacementPixels: { value: 4, unit: 'world-pixel' } } };
    const intent = { version: 1, kind: 'update', voiceId: 'v', intentId: 'physical', generation: 1, route: 'local', sourceEventIds: ['fact'], scoreTime: {}, expression: {}, performanceCause: cause };
    const backend = { updatePhysical(...args) { calls.push(args); return { status: 'accepted', stage: 'queued' }; } };
    const dispatcher = createCausalIntentDispatcher({ sinks: [{ id: 'a', route: 'local', backend }, { id: 'b', route: 'local', backend: {} }], toTargetFrame: () => 100 });
    const receipts = dispatcher.dispatch([intent], { generation: 1, batchId: 'batch' });
    expect(calls).to.have.length(1); expect(calls[0].slice(0, 3)).to.deep.equal(['v', cause, 100]);
    expect(receipts[0]).to.include({ stage: 'queued', status: 'accepted' }); expect(receipts[1]).to.include({ stage: 'semantic-observation', outputRequested: false });
  });
  it('retains travel-only observations without claiming or queueing a DSP application', () => {
    let calls = 0;
    const dispatcher = createCausalIntentDispatcher({ sinks: [{ id: 'local', route: 'local', backend: { update() { calls++; return { status: 'accepted', stage: 'queued' }; } } }],
      toTargetFrame: () => 100 });
    const intent = { version: 1, kind: 'update', voiceId: 'v', intentId: 'travel-phase', generation: 1, route: 'local', sourceEventIds: ['fact'], scoreTime: {},
      expression: {}, articulationState: { travelPhase01: 0.5, pathDistancePixels: 2 } };
    const [observation] = dispatcher.dispatch([intent], { generation: 1, batchId: 'batch' });
    expect(observation).to.include({ status: 'accepted', stage: 'semantic-observation', outputRequested: false }); expect(calls).to.equal(0);
    const [control] = dispatcher.dispatch([{ ...intent, intentId: 'pressure', expression: { pressure01: 0.5 } }], { generation: 1, batchId: 'batch' });
    expect(control.stage).to.equal('queued'); expect(calls).to.equal(1);
  });
  it('retains typed texture travel through begin/update sink history without calling it a pitch cycle or acoustic proof', () => {
    const observed = [], travel = Object.freeze({ schema: 'lemmings-texture-travel-receipt/v1', sourceEventId: 'motion', physicalTakeEvidence: true, acousticReceipt: false, coordinateScale: '128-world-pixels-per-internal-coordinate-unit;not-a-pitch-cycle' });
    const backend = { begin: () => ({ status: 'accepted', stage: 'queued', textureTravel: travel }), updateCanonicalTravel: () => ({ status: 'accepted', stage: 'queued', textureTravel: travel }) };
    const dispatcher = createCausalIntentDispatcher({ sinks: [{ id: 'local', route: 'local', backend }], toTargetFrame: () => 100, onReceipt: receipt => observed.push(receipt) });
    const intent = { version: 1, kind: 'begin', voiceId: 'v', intentId: 'texture-begin', generation: 1, route: 'local', sourceEventIds: ['motion'], scoreTime: {} };
    const receipt = dispatcher.dispatch([intent, { ...intent, kind: 'update', intentId: 'texture-update', articulationState: { travel: { sourceEventId: 'motion' } } }], { generation: 1, batchId: 'batch' });
    expect(receipt).to.have.length(2); for (const item of receipt) { expect(item.textureTravel).to.equal(travel); expect(item).not.to.have.property('circularTravel'); expect(item.stage).to.equal('queued'); }
    expect(observed).to.deep.equal(receipt); expect(dispatcher.diagnostics().receipts).to.deep.equal(receipt); dispatcher.dispose();
  });
  let masks;
  before(async () => { masks = await loadProcgenMasks(); });
  it('retires every execution and preserves cancellation failures across independent sinks', () => {
    const calls = [], intent = { version: 1, intentId: 'i', kind: 'begin', voiceId: 'v', generation: 1, route: 'main', sourceEventIds: [], scoreTime: {} };
    const backend = id => ({ registerExecution: () => ({ status: 'accepted', execution: { id } }),
      begin: () => ({ status: 'accepted' }), cancelGenerationWithReceipt() { calls.push(id + '-cancel'); if (id === 'bad') throw new Error('cancel failed'); },
      retireExecution() { calls.push(id + '-retire'); if (id === 'bad') throw new Error('retire failed'); } });
    const dispatcher = createCausalIntentDispatcher({ sinks: ['bad', 'good'].map(id => ({ id, route: 'main', backend: backend(id) })),
      executionEpoch: () => 'take', toTargetFrame: () => 100 });
    dispatcher.dispatch([intent], { batchId: 'batch', generation: 1 });
    const cancellation = dispatcher.cancelGeneration(1, 'take');
    expect(cancellation.outcome).to.equal('partial'); expect(calls).to.deep.equal(['bad-cancel', 'bad-retire', 'good-cancel', 'good-retire']);
    const disposed = dispatcher.dispose(); expect(disposed.outcome).to.equal('partial'); expect(calls).to.have.length(4);
    expect(dispatcher.dispose()).to.equal(disposed); expect(dispatcher.diagnostics().receiptCount).to.equal(0);
  });

  it('carries a real builder work cause through the batch, graph and sink receipt', () => {
    const world = new ProcgenLaneWorld({ masks, assists: false }), calls = [], receipts = [];
    const graph = { version: 1, revision: 1, instruments: [{ id: 'brick', sourceKind: 'TerrainWorkCommitted', operationKind: 'build',
      pitchCents: 6000, velocity01: 0.6, role: 'percussion', route: 'main' }] };
    const dispatcher = createCausalIntentDispatcher({ sinks: [{ id: 'local', route: 'main', backend: {
      begin: intent => { calls.push(intent); return { status: 'accepted', stage: 'scheduled' }; },
      end: voiceId => { calls.push(voiceId); return { status: 'accepted', stage: 'scheduled' }; }
    } }], toTargetFrame: () => 96000 });
    const engine = createCausalMusicEngine({ getGraph: () => graph, deliver: (intents, batch) => receipts.push(...dispatcher.dispatch(intents, batch)) });
    world.soundEvents.onBatch.on(batch => engine.processBatch(batch));
    const actor = world.actors[0]; actor.setAction(world.actions[State.BUILDING]); actor.frameIndex = 8;
    world.step();
    expect(calls).to.have.length(2);
    expect(receipts.map(receipt => receipt.status)).to.deep.equal(['accepted', 'accepted']);
    expect(receipts[0].sourceEventIds).to.have.length(1);
    expect(receipts[0].sourceEventIds[0]).to.equal(calls[0].sourceEventIds[0]);
    expect(receipts[1].voiceId).to.equal(calls[0].voiceId);
    world.dispose(); dispatcher.dispose();
  });

  it('fans out one immutable intent to separate sink receipts without changing its source identity', () => {
    const calls = [], observed = [];
    const local = { begin: (intent, frame, epoch) => { calls.push({ sink: 'local', intent, frame, epoch }); return { status: 'accepted', stage: 'scheduled' }; },
      end: (voiceId, release, frame) => { calls.push({ sink: 'local-end', voiceId, release, frame }); return { status: 'accepted', stage: 'scheduled' }; } };
    const hardware = { begin: (intent, frame, epoch) => { calls.push({ sink: 'hardware', intent, frame, epoch }); return { status: 'rejected', reason: 'device-disconnected' }; },
      end: () => ({ status: 'rejected', reason: 'device-disconnected' }) };
    const dispatcher = createCausalIntentDispatcher({ sinks: [{ id: 'preview', route: 'main', backend: local },
      { id: 'port', route: 'main', backend: hardware }], toTargetFrame: () => 96000, executionEpoch: () => 'run-7',
    onReceipt: receipt => observed.push(receipt) });
    const batch = { batchId: 'world:1:9:0', generation: 1 }, sourceEventIds = Object.freeze(['world:1:9:3']);
    const begin = Object.freeze({ version: 1, intentId: 'intent-1', kind: 'begin', voiceId: 'voice-1', generation: 1,
      route: 'main', scoreTime: Object.freeze({ simTick: 9, subTick: 0, precision: 'tick' }), sourceEventIds });
    const end = Object.freeze({ ...begin, intentId: 'intent-2', kind: 'end', terminationReason: 'one-shot' });
    const receipts = dispatcher.dispatch(Object.freeze([begin, end]), batch);
    expect(receipts.map(receipt => [receipt.sinkId, receipt.status])).to.deep.equal([
      ['preview', 'accepted'], ['port', 'rejected'], ['preview', 'accepted'], ['port', 'rejected']
    ]);
    expect(calls[0].intent).to.equal(begin);
    expect(calls[1].intent).to.equal(begin);
    expect(calls[0].epoch).to.equal('run-7');
    expect(calls[2].release).to.deep.equal({ mode: 'one-shot', tailSeconds: 0.08, seconds: 0.04 });
    expect(observed).to.deep.equal(receipts);
    expect(receipts.every(receipt => receipt.sourceEventIds[0] === sourceEventIds[0])).to.equal(true);
    expect(Object.isFrozen(receipts)).to.equal(true);
  });

  it('isolates sink exceptions and unavailable clocks, with bounded diagnostics', () => {
    const received = [];
    const dispatcher = createCausalIntentDispatcher({ sinks: [
      { id: 'bad', route: 'main', backend: { begin: () => { throw new Error('port failed'); } } },
      { id: 'good', route: 'main', backend: { begin: () => { received.push('begin'); return { status: 'accepted' }; } } },
      { id: 'clockless', route: 'later', backend: { begin: () => ({ status: 'accepted' }) } }
    ], toTargetFrame: (_time, _batch, _intent, sink) => sink.id === 'clockless' ? null : 1,
    historyLimit: 2, onReceipt: () => { throw new Error('display failed'); } });
    const intents = [{ version: 1, intentId: 'x', kind: 'begin', voiceId: 'v', generation: 1, route: 'main', sourceEventIds: [], scoreTime: {} },
      { version: 1, intentId: 'y', kind: 'begin', voiceId: 'w', generation: 1, route: 'missing', sourceEventIds: [], scoreTime: {} },
      { version: 1, intentId: 'z', kind: 'begin', voiceId: 'z', generation: 1, route: 'later', sourceEventIds: [], scoreTime: {} }];
    const receipts = dispatcher.dispatch(intents, { batchId: 'b', generation: 1 });
    expect(receipts.map(receipt => receipt.reason)).to.deep.equal(['sink-exception', null, 'route-unavailable', 'clock-unavailable']);
    expect(received).to.deep.equal(['begin']);
    expect(dispatcher.diagnostics().receipts).to.have.length(2);
    dispatcher.dispose();
    expect(dispatcher.dispatch(intents, { batchId: 'b', generation: 1 })).to.have.length(0);
  });

  it('does not admit an intent without an active execution epoch', () => {
    let sends = 0;
    const dispatcher = createCausalIntentDispatcher({ sinks: [{ id: 'local', route: 'main', backend: {
      begin: () => { sends++; return { status: 'accepted' }; }
    } }], toTargetFrame: () => 1, executionEpoch: () => null });
    const receipts = dispatcher.dispatch([{ version: 1, intentId: 'i', voiceId: 'v', kind: 'begin', route: 'main', sourceEventIds: [] }],
      { batchId: 'b', generation: 1 });
    expect(receipts[0]).to.include({ status: 'rejected', reason: 'execution-epoch-unavailable' });
    expect(sends).to.equal(0);
  });
});
