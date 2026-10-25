import { expect } from 'chai';
import { createOwnedCueRouting } from '../../js/app/midi-ui/OwnedCueRouting.js';
import { createAudioResourceLeases } from '../../js/app/midi-ui/AudioResourceLeases.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';

function fixture({ play = async () => {}, setSink = async function (id) { this.sinkId = id; } } = {}) {
  const nodes = [], tracks = [], elements = [], deviceListeners = new Map(), budget = createResourceBudget();
  const node = () => { const value = { connections: new Set(), connect(target) { this.connections.add(target); },
    disconnect(target) { if (target) this.connections.delete(target); else this.connections.clear(); } }; nodes.push(value); return value; };
  const context = { state: 'running', currentTime: 1,
    createGain: () => Object.assign(node(), { gain: { value: 1, cancelScheduledValues() {}, setValueAtTime(value) { this.value = value; } } }),
    createWaveShaper: node, createMediaStreamDestination() { const track = { stopped: false, stop() { this.stopped = true; } }; tracks.push(track);
      return Object.assign(node(), { stream: { getTracks: () => [track] } }); }, addEventListener() {}, removeEventListener() {} };
  const mediaDevices = { selectAudioOutput: async () => ({ kind: 'audiooutput', deviceId: 'private-fixture-id' }),
    addEventListener: (type, listener) => deviceListeners.set(type, listener), removeEventListener: type => deviceListeners.delete(type) };
  const createElement = () => { const listeners = new Map(); const element = { sinkId: '', srcObject: null, setSinkId: setSink, play, pause() {}, load() {},
    addEventListener(type, listener) { listeners.set(type, listener); }, removeEventListener(type) { listeners.delete(type); },
    emit(type) { listeners.get(type)?.(); }, removeAttribute() {} }; elements.push(element); return element; };
  const master = node(), resources = createAudioResourceLeases({ resourceBudget: budget });
  return { route: createOwnedCueRouting({ context, masterInput: master, resources, mediaDevices, createElement }), context, nodes, elements, tracks, master, budget, deviceListeners };
}

describe('owned nondefault prelisten routing', () => {
  it('keeps separate-device cue digitally disconnected from master and omits private device data', async () => {
    const f = fixture(), receipt = await f.route.prepare({ mode: 'separate-device' });
    expect(receipt).to.include({ state: 'ready', mode: 'separate-device', cueIncludedInMasterCapture: false });
    const ceiling = f.nodes[3]; expect(ceiling.connections.has(f.master)).to.equal(false); expect(ceiling.connections.size).to.equal(1);
    expect(f.route.state().muted).to.equal(true); f.route.activate(); expect(f.route.state().muted).to.equal(false);
    expect(JSON.stringify(f.route.state())).not.to.include('private-fixture-id');
    f.deviceListeners.get('devicechange')(); expect(f.route.state()).to.include({ muted: true, state: 'requires-revalidation' });
    const retired = f.route.dispose(); await retired.completion; expect(retired.outcome).to.equal('complete');
    expect(f.tracks.every(track => track.stopped)).to.equal(true); expect(f.budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('rejects failed native playback without falling back to room output', async () => {
    const f = fixture({ play: async () => { throw new Error('permission denied for private-fixture-id'); } });
    try { await f.route.prepare({ mode: 'separate-device' }); expect.fail('native play must reject'); } catch (error) { expect(error.message).to.include('Selected cue output failed'); expect(String(error)).not.to.include('private-fixture-id'); }
    expect(JSON.stringify(f.route.state())).not.to.include('private-fixture-id');
    expect(f.route.state().muted).to.equal(true); expect(f.nodes.every(node => !node.connections.has(f.master))).to.equal(true);
    expect(f.tracks.every(track => track.stopped)).to.equal(true); await f.route.dispose().completion;
    expect(f.budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('retires a superseded accepted sink promise after actual settlement', async () => {
    let settle; const f = fixture({ setSink: function (id) { return new Promise(resolve => { settle = () => { this.sinkId = id; resolve(); }; }); } });
    const first = f.route.prepare({ mode: 'separate-device' }); first.catch(() => {});
    await Promise.resolve(); await Promise.resolve();
    const second = await f.route.prepare({ mode: 'rehearsal' }); expect(second.mode).to.equal('rehearsal');
    expect(f.route.state().pendingNativeOperations).to.equal(1); settle();
    try { await first; expect.fail('superseded route must reject'); } catch (error) { expect(error.message).to.include('changed'); }
    expect(f.route.state()).to.include({ mode: 'rehearsal', state: 'ready', muted: true });
    expect(f.tracks.every(track => track.stopped)).to.equal(true); await f.route.dispose().completion;
  });
});


describe('accepted cue route event identity', () => {
  for (const event of ['error', 'pause', 'ended', 'sinkchange']) it('revokes the accepted route on ' + event, async () => {
    const f = fixture(); await f.route.prepare({ mode: 'separate-device' }); f.route.activate();
    const revision = f.route.state().revision; f.elements[0].emit(event);
    expect(f.route.state()).to.include({ muted: true, state: 'requires-revalidation', revision: revision + 1 });
    expect(() => f.route.activate()).to.throw('not ready'); await f.route.dispose().completion;
  });
  it('ignores events from an explicitly retired earlier element', async () => {
    const f = fixture(); await f.route.prepare({ mode: 'separate-device' }); const previous = f.elements[0];
    await f.route.prepare({ mode: 'rehearsal' }); f.route.activate(); previous.emit('pause');
    expect(f.route.state()).to.include({ muted: false, state: 'playing-route', mode: 'rehearsal' }); await f.route.dispose().completion;
  });
});
