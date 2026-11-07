import { expect } from 'chai';
import { createOwnedCueRouting } from '../../js/app/midi-ui/OwnedCueRouting.js';

function cueFixture({ failContextRemoval = false, failElementRemoval = false, failContextAdd = false, failElementAdd = null, failSourceClear = false } = {}) {
  const removals = [], nodes = [], elements = [], tracks = [], leases = [], contextListeners = new Map(), deviceListeners = new Map(), streamFailure = { value: false };
  const node = () => { const value = { connections: new Set(), connect(target) { this.connections.add(target); }, disconnect(target) { if (target) this.connections.delete(target); else this.connections.clear(); } }; nodes.push(value); return value; };
  const resources = { reserve() { const lease = { released: false, unknown: false, release() { this.released = true; }, retainUnknown() { this.unknown = true; } }; leases.push(lease); return lease; } };
  const context = { state: 'running', currentTime: 1,
    createGain: () => Object.assign(node(), { gain: { value: 1, cancelScheduledValues() {}, setValueAtTime(value) { this.value = value; } } }), createWaveShaper: node,
    createMediaStreamDestination() { const track = { stopped: false, stop() { this.stopped = true; } }; tracks.push(track); return Object.assign(node(), { stream: { getTracks() { if (streamFailure.value) throw Error('native stream inventory unavailable'); return [track]; } } }); },
    addEventListener(type, listener) { contextListeners.set(type, listener); if (failContextAdd) throw Error('partial context registration'); }, removeEventListener(type) { removals.push('context:' + type); if (failContextRemoval) throw Error('native removal refused'); contextListeners.delete(type); } };
  const mediaDevices = { selectAudioOutput: async () => ({ kind: 'audiooutput', deviceId: 'fixture-owned-output' }),
    addEventListener(type, listener) { deviceListeners.set(type, listener); }, removeEventListener(type) { removals.push('devices:' + type); deviceListeners.delete(type); } };
  const createElement = () => { const listeners = new Map(); let source = null; const element = { listeners, sinkId: '', get srcObject() { return source; }, set srcObject(value) { if (value === null && failSourceClear) throw Error('native source clear refused'); source = value; }, paused: 0, loaded: 0, sourceRemoved: 0, async setSinkId(id) { this.sinkId = id; }, async play() {}, pause() { this.paused++; }, load() { this.loaded++; }, removeAttribute() { this.sourceRemoved++; },
    addEventListener(type, listener) { listeners.set(type, listener); if (type === failElementAdd) throw Error('partial element registration'); }, removeEventListener(type) { removals.push('element:' + type); if (failElementRemoval && type === 'error') throw Error('first removal refused'); listeners.delete(type); } }; elements.push(element); return element; };
  const master = node(), route = createOwnedCueRouting({ context, masterInput: master, resources, mediaDevices, createElement });
  return { route, context, mediaDevices, removals, nodes, elements, tracks, leases, contextListeners, deviceListeners, streamFailure };
}

describe('cue routing independent retirement frontiers', () => {
  it('continues every independent cleanup frontier when silencing the fader throws', async () => {
    const f = cueFixture(); await f.route.prepare({ mode: 'separate-device' });
    f.nodes[2].gain.cancelScheduledValues = () => { throw Error('native fader refused'); };
    const receipt = f.route.dispose(); await receipt.completion;
    expect(f.contextListeners.size).to.equal(0); expect(f.deviceListeners.size).to.equal(0);
    expect(f.elements[0].paused).to.equal(1); expect(f.tracks.every(track => track.stopped)).to.equal(true);
    expect(receipt.outcome).not.to.equal('complete');
  });
  it('cleans partially registered graph listeners before publishing a failed preparation', async () => {
    const f = cueFixture({ failContextAdd: true }); let failure;
    try { await f.route.prepare({ mode: 'rehearsal' }); } catch (error) { failure = error; }
    expect(failure).to.be.instanceOf(Error); expect(f.contextListeners.size).to.equal(0);
    expect(f.nodes.every(node => node.connections.size === 0)).to.equal(true);
    expect(f.leases.every(lease => lease.released)).to.equal(true); await f.route.dispose().completion;
  });
  it('removes a partially throwing element registration as well as earlier listeners', async () => {
    const f = cueFixture({ failElementAdd: 'pause' }); let failure;
    try { await f.route.prepare({ mode: 'separate-device' }); } catch (error) { failure = error; }
    expect(failure).to.be.instanceOf(Error); expect(f.elements[0].listeners.size).to.equal(0);
    expect(f.removals).to.include('element:error').and.include('element:pause');
    expect(f.tracks.every(track => track.stopped)).to.equal(true); await f.route.dispose().completion;
  });
  it('still removes the source attribute and reloads when clearing the native stream refuses', async () => {
    const f = cueFixture({ failSourceClear: true }); await f.route.prepare({ mode: 'separate-device' });
    const receipt = f.route.dispose(); await receipt.completion;
    expect(f.elements[0].sourceRemoved).to.equal(1); expect(f.elements[0].loaded).to.equal(1);
    expect(f.elements[0].paused).to.equal(1); expect(f.tracks.every(track => track.stopped)).to.equal(true);
    expect(receipt.outcome).not.to.equal('complete'); expect(f.leases.some(lease => lease.unknown && !lease.released)).to.equal(true);
  });
  it('attempts every owner listener removal when one captured native removal refuses', async () => {
    const f = cueFixture({ failContextRemoval: true });
    await f.route.prepare({ mode: 'separate-device' });
    const receipt = f.route.dispose(); await receipt.completion;
    expect(f.removals).to.include('devices:devicechange');
    expect(f.tracks.every(track => track.stopped)).to.equal(true); expect(f.elements[0].paused).to.equal(1);
    expect(receipt.outcome).not.to.equal('complete');
    expect(f.leases.some(lease => lease.unknown && !lease.released)).to.equal(true);
  });
  it('attempts all element removals and native cleanup when the first element removal fails', async () => {
    const f = cueFixture({ failElementRemoval: true }); await f.route.prepare({ mode: 'separate-device' }); const element = f.elements[0];
    const receipt = f.route.dispose(); await receipt.completion;
    for (const type of ['error', 'pause', 'ended', 'sinkchange']) expect(f.removals).to.include('element:' + type);
    expect(element.paused).to.equal(1); expect(element.srcObject).to.equal(null); expect(f.tracks.every(track => track.stopped)).to.equal(true);
    expect(receipt.outcome).not.to.equal('complete');
  });
  it('captures removal methods when installing listeners rather than trusting mutable method slots', async () => {
    const f = cueFixture(); await f.route.prepare({ mode: 'separate-device' });
    f.context.removeEventListener = () => { throw Error('replacement must not run'); };
    f.mediaDevices.removeEventListener = () => { throw Error('replacement must not run'); };
    const receipt = f.route.dispose(); await receipt.completion;
    expect(receipt.outcome).to.equal('complete'); expect(f.contextListeners.size).to.equal(0); expect(f.deviceListeners.size).to.equal(0);
  });
  it('disconnects, pauses and clears the native source even when stream enumeration throws', async () => {
    const f = cueFixture(); await f.route.prepare({ mode: 'separate-device' });
    f.streamFailure.value = true;
    const receipt = f.route.dispose(); await receipt.completion;
    expect(f.elements[0].paused).to.equal(1); expect(f.elements[0].srcObject).to.equal(null);
    expect(f.nodes.every(node => node.connections.size === 0)).to.equal(true); expect(receipt.outcome).not.to.equal('complete');
    expect(f.leases.some(lease => lease.unknown && !lease.released)).to.equal(true);
  });
});
