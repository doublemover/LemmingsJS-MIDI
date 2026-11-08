import { expect } from 'chai';
import { createAudioOutputWatch } from '../../js/app/midi-ui/AudioOutputWatch.js';
const turn = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const target = () => {
  const listeners = new Map(); return { listeners, addEventListener(type, listener) { listeners.set(type, listener); }, removeEventListener(type) { listeners.delete(type); }, emit(type) { listeners.get(type)?.(); } };
};
describe('owned audio output availability observations', () => {
  it('observes devices and speaker permission without enumeration, microphone or output selection', async () => {
    const mediaDevices = target(), status = Object.assign(target(), { state: 'prompt' }), changes = [], queries = [];
    for (const key of ['enumerateDevices', 'getUserMedia', 'selectAudioOutput']) Object.defineProperty(mediaDevices, key, { get() { throw new Error('Unexpected access request'); } });
    const watch = createAudioOutputWatch({ mediaDevices, permissions: { query: async descriptor => { queries.push(descriptor); return status; } }, watchPermission: true, onChange: reason => changes.push(reason) });
    await turn(); expect(queries).to.deep.equal([{ name: 'speaker-selection' }]); expect(watch.state()).to.include({ devicesListening: true, speakerPermission: 'observing', physicalRouteConfirmed: false });
    status.state = 'granted'; status.emit('change'); expect(changes).to.deep.equal([]);
    mediaDevices.emit('devicechange'); status.state = 'prompt'; status.emit('change'); status.state = 'denied'; status.emit('change');
    expect(changes).to.deep.equal(['devices-changed', 'speaker-permission-revoked', 'speaker-permission-revoked']);
    const old = mediaDevices.listeners.get('devicechange'); const receipt = watch.dispose(); expect(watch.dispose()).to.equal(receipt); await receipt.completion;
    old(); expect(changes).to.have.length(3); expect(mediaDevices.listeners.size + status.listeners.size).to.equal(0); expect(receipt.outcome).to.equal('complete');
  });
  it('cannot attach a late permission reply after retirement or start a deferred query after immediate disposal', async () => {
    let resolve, queries = 0; const status = Object.assign(target(), { state: 'granted' }), permissions = { query: () => { queries++; return new Promise(done => { resolve = done; }); } };
    const first = createAudioOutputWatch({ permissions, watchPermission: true, onChange() {} }); await turn(); await first.dispose().completion; resolve(status); await turn();
    expect(status.listeners.size).to.equal(0); expect(first.state().speakerPermission).to.equal('retired');
    const second = createAudioOutputWatch({ permissions, watchPermission: true, onChange() {} }); await second.dispose().completion; await turn(); expect(queries).to.equal(1);
  });
  it('keeps rejected/absent permission observation unavailable and preserves device monitoring', async () => {
    for (const permissions of [undefined, { query: async () => { throw new Error('Unsupported descriptor'); } }, { query: async () => ({ state: 'granted' }) }]) {
      const mediaDevices = target(), watch = createAudioOutputWatch({ permissions, mediaDevices, watchPermission: true, onChange() {} }); await turn();
      expect(watch.state()).to.include({ speakerPermission: 'unavailable', devicesListening: true }); await watch.dispose().completion;
    }
  });
  it('attempts both listener removals even when a native removal refuses and invalidates the remaining callbacks', async () => {
    const mediaDevices = target(), status = Object.assign(target(), { state: 'granted' }); let changes = 0;
    mediaDevices.removeEventListener = () => { throw new Error('Native listener removal refused'); };
    const watch = createAudioOutputWatch({ mediaDevices, permissions: { query: async () => status }, watchPermission: true, onChange: () => { changes++; } }); await turn();
    const receipt = watch.dispose(); await receipt.completion; expect(receipt.outcome).to.equal('partial'); expect(status.listeners.size).to.equal(0);
    mediaDevices.emit('devicechange'); expect(changes).to.equal(0);
  });
  it('reports an initially denied speaker grant without inferring a selected device identity', async () => {
    const changes = [], status = Object.assign(target(), { state: 'denied' });
    const watch = createAudioOutputWatch({ permissions: { query: async () => status }, watchPermission: true, onChange: reason => changes.push(reason) }); await turn();
    expect(changes).to.deep.equal(['speaker-permission-revoked']); expect(watch.state()).to.include({ physicalRouteConfirmed: false, explicitPermissionRevoked: true }); await watch.dispose().completion;
  });
});
