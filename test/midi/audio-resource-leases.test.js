import { expect } from 'chai';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';
import { createAudioResourceLeases, releaseAudioResourceAfterRetirement, KERNEL_TYPED_BYTES, WORKLET_HOST_ESTIMATE } from '../../js/app/midi-ui/AudioResourceLeases.js';
import { createProcgenRetirementScope } from '../../js/app/procgen/ProcgenRetirement.js';

describe('Audio resource admission', () => {
  it('releases zero-byte declarations after their empty budget reservation is reconciled away', async () => {
    const budget = createResourceBudget(), audio = createAudioResourceLeases({ resourceBudget: budget });
    const empty = audio.reserve({ kind: 'empty-source-declaration', owner: 'offline', consumerOwned: true });
    expect(budget.diagnostics().accountedBytes).to.equal(0);
    expect(empty.release()).to.equal(true); expect(empty.release()).to.equal(false);
    expect(audio.diagnostics().reservations).to.equal(0); await audio.dispose().completion;
  });
  it('joins consumer-owned buffers during bulk teardown and keeps them charged until actual release', async () => {
    const audio = createAudioResourceLeases(), lease = audio.reserve({ kind: 'pcm-copy', owner: 'game', bytes: 64, consumerOwned: true });
    const owner = audio.retireOwner('game'), all = audio.dispose(); expect(owner.outcome).not.to.equal('complete'); expect(all.outcome).not.to.equal('complete');
    expect(audio.diagnostics()).to.include({ exactBytes: 64, consumerOwnedReservations: 1 }); expect(lease.release()).to.equal(true);
    await owner.completion; await all.completion; expect(owner.outcome).to.equal('complete'); expect(all.outcome).to.equal('complete'); expect(audio.diagnostics().reservations).to.equal(0);
  });
  it('preserves a failed consumer release without turning bulk disposal into another native attempt', async () => {
    let attempts = 0; const audio = createAudioResourceLeases({ resourceBudget: { reserve: () => ({}), release: () => { attempts++; throw new Error('unknown'); } } }),
      lease = audio.reserve({ kind: 'pcm-copy', bytes: 64, consumerOwned: true }), retirement = audio.dispose();
    expect(() => lease.release()).to.throw('unknown'); await retirement.completion;
    expect(retirement.outcome).to.equal('partial'); expect(attempts).to.equal(1); expect(audio.diagnostics().exactBytes).to.equal(64);
  });
  it('holds uncertain native retirement through owner disposal until the closed context acknowledges it', () => {
    const budget = createResourceBudget(), audio = createAudioResourceLeases({ resourceBudget: budget });
    const voice = audio.reserveNativeVoice('game'), cue = audio.reserveNativeVoice('cue');
    const retirement = createProcgenRetirementScope().retire([{ name: 'native-disconnect', run() { throw new Error('disconnect failed'); } }]);
    expect(() => releaseAudioResourceAfterRetirement(voice, retirement)).to.throw('incomplete');
    expect(voice.releaseState()).to.equal('failed-or-unknown'); expect(voice.isActive()).to.equal(false);
    expect(audio.retireOwner('game').outcome).to.equal('partial'); expect(cue.isActive()).to.equal(true);
    expect(budget.diagnostics().unreleasedEstimatedBytes).to.be.greaterThan(0);
    cue.release(); expect(audio.confirmClosedContext().outcome).to.equal('complete');
    expect(audio.diagnostics().reservations).to.equal(0); expect(budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('retains failed adapter accounting while releasing every independent reservation exactly once', async () => {
    const ledger = new Map(); let attempts = 0;
    const adapter = { reserve(record) { ledger.set(record.token, record); return { accountedBytes: record.bytes }; },
      release({ token }) { attempts++; if (ledger.get(token)?.kind === 'channel-graph') throw new Error('release refused'); ledger.delete(token); return true; } };
    const audio = createAudioResourceLeases({ resourceBudget: adapter });
    const channel = audio.reserve({ kind: 'channel-graph', owner: 'game', estimateBytes: 8192 });
    const pcm = audio.reserveDecodedBuffer({ frames: 48000, channels: 2, owner: 'game' });
    const cue = audio.reserveDecodedBuffer({ frames: 48000, channels: 1, owner: 'cue' });
    const receipt = audio.retireOwner('game'); await receipt.completion;
    expect(receipt.outcome).to.equal('partial'); expect(pcm.isActive()).to.equal(false); expect(cue.isActive()).to.equal(true);
    expect(channel.releaseState()).to.equal('failed-or-unknown'); expect(channel.isActive()).to.equal(false);
    expect(audio.diagnostics()).to.include({ reservations: 2, exactBytes: 192000, estimatedBytes: 8192, unreconciledReservations: 1 });
    expect(attempts).to.equal(2); expect(() => channel.release()).to.throw('release refused'); expect(attempts).to.equal(2);
    const disposed = audio.dispose(); expect(audio.dispose()).to.equal(disposed); await disposed.completion;
    expect(disposed.outcome).to.equal('partial'); expect(attempts).to.equal(3);
    expect(ledger.size).to.equal(1); expect(audio.diagnostics()).to.include({ reservations: 1, estimatedBytes: 8192, exactBytes: 0 });
  });
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

  it('shrinks an admitted PCM upper bound to the actual backing without a second allocation lease', () => {
    const budget = createResourceBudget(), audio = createAudioResourceLeases({ resourceBudget: budget });
    const pin = audio.reserveDecodedBuffer({ frames: 48001, channels: 2, sampleRate: 48000 });
    expect(pin.reconcile({ length: 48000, numberOfChannels: 2, sampleRate: 48000 })).to.equal(true);
    expect(pin.receipt.exactBytes).to.equal(384000); expect(audio.diagnostics().exactBytes).to.equal(384000);
    expect(budget.diagnostics().residentBytes).to.equal(384000); expect(budget.diagnostics().categories.audio.entries).to.equal(1);
    expect(() => pin.shrink(384008)).to.throw(RangeError);
    pin.release(); expect(budget.diagnostics().residentBytes).to.equal(0);
  });
});
