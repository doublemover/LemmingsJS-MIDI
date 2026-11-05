import { expect } from 'chai';
import { createAudioRuntimeTransition } from '../../js/app/midi-ui/AudioRuntimeTransition.js';
import { normalizeAudioRuntimeConfig } from '../../js/app/midi-ui/AudioRuntimeConfig.js';
const turn = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const fixture = options => {
  let config = normalizeAudioRuntimeConfig(), retired = false, stops = 0, closes = 0, commits = 0;
  const context = { state: 'running', sinkId: '', async setSinkId(id) { this.sinkId = id; } }; let current = context;
  const ports = { getConfig: () => config, getContext: () => current, isRetired: () => retired,
    quiesce: async () => { stops++; return true; }, retireContext: async () => { closes++; current = null; return true; },
    commit: next => { commits++; config = next; }, ...options };
  const owner = createAudioRuntimeTransition(ports);
  return { owner, ports, context, config: () => config, counts: () => ({ stops, closes, commits }), replace: value => { current = value; }, retire: () => { retired = true; } };
};

describe('owned main audio configuration transitions', () => {
  it('validates before stopping or requesting permission and skips an unchanged configuration', async () => {
    const f = fixture(); expect(() => f.owner.request({ preferredSampleRate: 12000 })).to.throw(TypeError);
    expect((await f.owner.request({})).status).to.equal('unchanged'); expect(f.counts()).to.deep.equal({ stops: 0, closes: 0, commits: 0 });
  });
  it('keeps preferences unchanged until native sink acknowledgment and admits only one operation', async () => {
    const native = deferred(), f = fixture(); f.context.setSinkId = async id => { await native.promise; f.context.sinkId = id; };
    const pending = f.owner.request({ sinkPreference: 'device' }); await turn();
    expect(f.owner.state()).to.include({ pending: true, phase: 'switching' }); expect(f.config().sinkPreference).to.equal('');
    expect((await f.owner.request({ latencyProfile: 'robust' })).status).to.equal('busy');
    native.resolve(); expect(await pending).to.include({ status: 'configured', requiresEnable: true, acousticReceipt: false });
    expect(f.config().sinkPreference).to.equal('device'); expect(f.counts()).to.deep.equal({ stops: 1, closes: 0, commits: 1 });
  });
  it('invokes the output chooser in the caller turn and never stops audio after a denied chooser', async () => {
    const native = deferred(), calls = [], f = fixture({ chooseOutput() { calls.push('chooser'); return native.promise; } });
    const pending = f.owner.choose(); expect(calls).to.deep.equal(['chooser']); expect(f.counts().stops).to.equal(0);
    native.reject(Object.assign(new Error('private device identifier'), { name: 'NotAllowedError' }));
    expect(await pending).to.deep.equal({ status: 'failed', errorCode: 'NotAllowedError', requiresEnable: false, acousticReceipt: false }); expect(f.counts().stops).to.equal(0);
  });
  it('contains unavailable native output APIs without opening the chooser or interrupting output', async () => {
    let chosen = 0; const f = fixture({ chooseOutput: async () => { chosen++; return 'device'; } }); delete f.context.setSinkId;
    expect((await f.owner.choose()).status).to.equal('unsupported'); expect((await f.owner.request({ sinkPreference: 'device' })).status).to.equal('unsupported');
    expect(chosen).to.equal(0); expect(f.counts().stops).to.equal(0);
  });
  for (const name of ['NotAllowedError', 'NotFoundError', 'InvalidAccessError', 'AbortError', 'InvalidStateError', 'untrusted/private-device'])
    it('retains the previous preference after a rejected native sink selection: ' + name, async () => {
      const f = fixture(); f.context.setSinkId = async () => { throw Object.assign(new Error('private device'), { name }); };
      const receipt = await f.owner.request({ sinkPreference: 'device' }); expect(receipt.status).to.equal('failed');
      expect(receipt.errorCode).to.equal(name.includes('/') ? 'AudioRuntimeError' : name); expect(JSON.stringify(receipt)).not.to.include('private'); expect(f.config().sinkPreference).to.equal('');
    });
  it('refuses a successful promise that did not confirm the selected native route', async () => {
    const f = fixture(); f.context.setSinkId = async () => {}; expect(await f.owner.request({ sinkPreference: 'device' })).to.include({ status: 'failed', errorCode: 'OutputSelectionUnconfirmed' });
    expect(f.counts().commits).to.equal(0);
  });
  for (const cancel of ['invalidate', 'dispose', 'external-retirement']) it('retains native ownership after ' + cancel + ' until an in-flight switch settles', async () => {
    const native = deferred(), f = fixture(); f.context.setSinkId = async id => { await native.promise; f.context.sinkId = id; };
    const pending = f.owner.request({ sinkPreference: 'device' }); await turn(); let disposed = false;
    if (cancel === 'dispose') f.owner.dispose().then(() => { disposed = true; }); else if (cancel === 'invalidate') f.owner.invalidate(); else f.retire();
    await turn(); expect(f.owner.isPending()).to.equal(true); expect(disposed).to.equal(false);
    native.resolve(); expect((await pending).status).to.equal('canceled'); await turn(); expect(f.counts().commits).to.equal(0);
    if (cancel === 'dispose') { expect(disposed).to.equal(true); expect((await f.owner.request({})).status).to.equal('retired'); }
  });
  it('closes the old context before publishing a new profile and never closes it for a sink-only change', async () => {
    const native = deferred(), f = fixture({ retireContext: async () => { await native.promise; f.replace(null); return true; } });
    const pending = f.owner.request({ latencyProfile: 'robust', preferredSampleRate: 96000 }); await turn();
    expect(f.owner.state().phase).to.equal('closing'); expect(f.config().latencyProfile).to.equal('performance'); native.resolve();
    expect(await pending).to.include({ status: 'rebuild-ready', requiresEnable: true }); expect(f.config()).to.include({ latencyProfile: 'robust', preferredSampleRate: 96000 });
  });
  for (const boundary of ['stop', 'close']) it('retains the old configuration after unconfirmed ' + boundary + ' retirement', async () => {
    const f = fixture(boundary === 'stop' ? { quiesce: async () => false } : { retireContext: async () => false });
    expect(await f.owner.request({ latencyProfile: 'balanced' })).to.include({ status: 'failed', errorCode: boundary === 'stop' ? 'OutputRetirementUnconfirmed' : 'ContextRetirementUnconfirmed' });
    expect(f.counts().commits).to.equal(0);
  });
  it('refuses a replacement context introduced by a reentrant retirement adapter', async () => {
    const f = fixture({ retireContext: async () => { f.replace({ state: 'running' }); return true; } });
    expect((await f.owner.request({ latencyProfile: 'robust' })).status).to.equal('canceled'); expect(f.counts().commits).to.equal(0);
  });
  it('cancels before a native side effect when a synchronous observer retires the operation', async () => {
    const f = fixture({ onChange() { f.owner.invalidate(); } });
    expect((await f.owner.request({ sinkPreference: 'device' })).status).to.equal('canceled'); expect(f.counts().stops).to.equal(0);
  });
  it('contains observer exceptions and can configure an idle owner without creating a context', async () => {
    const f = fixture({ onChange() { throw new Error('observer'); } }); f.replace(null);
    expect((await f.owner.request({ latencyProfile: 'balanced', preferredSampleRate: 44100 })).status).to.equal('configured'); expect(f.counts().closes).to.equal(0);
    expect(Object.isFrozen(f.owner.state().last)).to.equal(true); await f.owner.dispose();
  });
});
