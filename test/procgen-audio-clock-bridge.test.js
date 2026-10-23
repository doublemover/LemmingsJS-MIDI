import { expect } from 'chai';
import { createAudioClockBridge } from '../js/app/procgen/workstation/AudioClockBridge.js';
import { createCausalIntentDispatcher, createStrictLiveFramePolicy } from '../js/app/procgen/workstation/CausalIntentDispatcher.js';

describe('physical intent audio clock bridge', () => {
  it('keeps target frames stable through a delayed wake and rejects retired epochs', () => {
    let hostMs = 1000;
    const context = { state: 'running', currentTime: 2, sampleRate: 48000 };
    const bridge = createAudioClockBridge({ getContext: () => context, nowMs: () => hostMs, presentationDelayMs: 20 });
    bridge.rebase({ executionEpoch: 'play-1', scoreEpoch: 'scene:1:0', beat: 0, hostMs, bpm: 120 });
    const tick10 = { epoch: 'scene:1:0', beat: 1.2 }, tick12 = { epoch: 'scene:1:0', beat: 1.44 };
    const first = bridge.toTargetFrame(tick10, 'play-1');
    hostMs += 200; context.currentTime += 0.2;
    expect(bridge.toTargetFrame(tick10, 'play-1')).to.equal(first);
    expect(bridge.toTargetFrame(tick12, 'play-1') - first).to.equal(5760);
    expect(bridge.toTargetFrame(tick10, 'play-0')).to.equal(null);
    context.state = 'suspended'; expect(bridge.toTargetFrame(tick10, 'play-1')).to.equal(null);
    context.state = 'running'; context.sampleRate = 96000;
    expect(bridge.toTargetFrame(tick10, 'play-1')).to.equal(null);
    bridge.rebase({ executionEpoch: 'play-2', scoreEpoch: 'scene:2:1', beat: 0, hostMs, bpm: 120, reason: 'resume' });
    expect(bridge.toTargetFrame({ epoch: 'scene:2:1', beat: 0 }, 'play-2')).to.be.a('number');
  });

  it('drops late attacks while still forwarding a late release with an explicit repair receipt', () => {
    const calls = [], backend = { begin: (_intent, frame) => { calls.push(['begin', frame]); return { status: 'accepted' }; },
      end: (_id, _release, frame) => { calls.push(['end', frame]); return { status: 'accepted' }; } };
    let currentFrame = 100;
    const dispatcher = createCausalIntentDispatcher({ sinks: [{ id: 'local', route: 'main', backend }],
      toTargetFrame: intentTime => intentTime.frame,
      latePolicy: createStrictLiveFramePolicy({ nowFrame: () => currentFrame }) });
    const base = { version: 1, voiceId: 'voice', generation: 1, route: 'main', sourceEventIds: ['event'] };
    const first = dispatcher.dispatch([{ ...base, intentId: 'old', kind: 'begin', scoreTime: { frame: 90 } }],
      { batchId: 'batch-1', generation: 1 });
    expect(first[0]).to.include({ status: 'rejected', reason: 'late-attack', sourceTargetFrame: 90 });
    expect(calls).to.deep.equal([]);
    const second = dispatcher.dispatch([{ ...base, intentId: 'new', kind: 'begin', scoreTime: { frame: 120 } }],
      { batchId: 'batch-2', generation: 1 });
    expect(second[0]).to.include({ status: 'accepted', targetFrame: 120 });
    currentFrame = 130;
    const third = dispatcher.dispatch([{ ...base, intentId: 'end', kind: 'end', scoreTime: { frame: 125 } }],
      { batchId: 'batch-3', generation: 1 });
    expect(third[0]).to.include({ status: 'accepted', sourceTargetFrame: 125, targetFrame: 130, repair: 'late-release' });
    expect(calls).to.deep.equal([['begin', 120], ['end', 130]]);
  });
});
