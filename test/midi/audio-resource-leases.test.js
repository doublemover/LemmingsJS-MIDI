import { expect } from 'chai';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';
import { createAudioResourceLeases, KERNEL_TYPED_BYTES, WORKLET_HOST_ESTIMATE } from '../../js/app/midi-ui/AudioResourceLeases.js';

describe('Audio resource admission', () => {
  it('reserves exact PCM upper bounds before decoding and exposes native costs as estimates', () => {
    const budget = createResourceBudget({ limitBytes: 2 * 1024 * 1024 }), audio = createAudioResourceLeases({ resourceBudget: budget });
    const buffer = audio.reserveDecodedBuffer({ frames: 48000, channels: 2, sampleRate: 48000, owner: 'game' });
    expect(budget.diagnostics().residentBytes).to.equal(384000);
    expect(buffer.receipt).to.include({ exactBytes: 384000, estimatedBytes: 0 });
    expect(buffer.validate({ length: 48000, numberOfChannels: 2, sampleRate: 48000 })).to.equal(true);
    expect(() => buffer.validate({ length: 48001, numberOfChannels: 2, sampleRate: 48000 })).to.throw(RangeError);
    const voice = audio.reserveNativeVoice('game', 1);
    expect(voice.receipt.estimatedBytes).to.equal(16384); expect(voice.receipt.exactBytes).to.equal(0);
    voice.release(); buffer.release(); expect(buffer.release()).to.equal(false);
    expect(() => buffer.validate({ length: 1, numberOfChannels: 1, sampleRate: 48000 })).to.throw('no longer active');
    expect(budget.diagnostics().accountedBytes).to.equal(0);
  });

  it('denies the worklet before construction and releases only its own reservation tokens', () => {
    const budget = createResourceBudget({ limitBytes: 1024 * 1024 }), rendererToken = {};
    budget.reserve({ token: rendererToken, owner: 'renderer', category: 'canvas', bytes: 600000 });
    const audio = createAudioResourceLeases({ resourceBudget: budget });
    expect(() => audio.reserveWorkletRuntime('game')).to.throw('available');
    expect(audio.diagnostics().denials).to.equal(1);
    audio.dispose(); expect(budget.diagnostics().residentBytes).to.equal(600000);
    budget.release({ token: rendererToken, owner: 'renderer' });
  });

  it('separates known fixed kernel bytes from host estimates and revokes the correct owner', () => {
    const budget = createResourceBudget({ limitBytes: 2 * 1024 * 1024 }), audio = createAudioResourceLeases({ resourceBudget: budget });
    const runtime = audio.reserveWorkletRuntime('game', 2), cue = audio.reserveWorkletVoice('cue', 3);
    expect(runtime.receipt).to.include({ exactBytes: KERNEL_TYPED_BYTES, estimatedBytes: WORKLET_HOST_ESTIMATE });
    expect(audio.releaseOwner('game')).to.equal(1); expect(cue.isActive()).to.equal(true);
    expect(audio.diagnostics().reservations).to.equal(1);
    audio.dispose(); expect(budget.diagnostics().accountedBytes).to.equal(0);
  });

  it('rejects an excessive decoder declaration without reserving or allocating it', () => {
    const budget = createResourceBudget(), audio = createAudioResourceLeases({ resourceBudget: budget });
    expect(() => audio.reserveDecodedBuffer({ frames: 2 ** 31, channels: 2 })).to.throw(RangeError);
    expect(budget.diagnostics().reservations).to.equal(0);
  });
});
