import { expect } from 'chai';
import { createAudioResourceLeases } from '../../js/app/midi-ui/AudioResourceLeases.js';
import { createLiveLaneSourceBuses, LIVE_LANE_TAP_LIMIT } from '../../js/app/midi-ui/LiveLaneSourceBuses.js';
import { createVoiceLaneMix } from '../../js/app/midi-ui/VoiceLaneMix.js';
import { OwnedSineKernel, BEGIN, WIDTH } from '../../js/app/midi-ui/worklet/OwnedSineProcessor.js';

const audioNode = () => ({ connections: new Set(), gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} },
  pan: { setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} },
  connect(target) { this.connections.add(target); }, disconnect(target) { if (target) this.connections.delete(target); else this.connections.clear(); } });
const fixture = () => {
  const context = { state: 'running', sampleRate: 48000, currentTime: 0, createGain: audioNode, createStereoPanner: audioNode }, resources = createAudioResourceLeases();
  const buses = createLiveLaneSourceBuses({ context, resources, owner: 'physical', generation: 7, isCurrent: () => true });
  return { context, resources, buses, pin: (id, tap = 'post-fader') => buses.pin({ sourceBusId: 'lane:' + id, tap, inputLayout: 'audioStereo' }) };
};

describe('live lane source routing (API ownership and production kernel)', () => {
  it('collects only the selected original native lane at independent pre/post points, without a destination connection', async () => {
    const f = fixture(), destination = audioNode(), preview = { _audioResources: f.resources, _laneSourcesFor: () => f.buses };
    f.buses.declare(['diggers', 'choir']);
    const first = createVoiceLaneMix({ preview, context: f.context, owner: 'physical', generation: 7, destination, start: 0, laneId: 'diggers', value: { gain: 0.25, pan: 0.5 } });
    const unrelated = createVoiceLaneMix({ preview, context: f.context, owner: 'physical', generation: 7, destination, start: 0, laneId: 'choir' });
    const pre = f.pin('diggers', 'pre-fader'), post = f.pin('diggers');
    expect([...first.input.connections].some(node => node.connections?.has(pre.node))).to.equal(true); expect([...unrelated.input.connections].some(node => node.connections?.has(pre.node))).to.equal(false);
    expect(pre.node).not.to.equal(post.node); expect(pre.node.connections.size).to.equal(0); expect(post.node.connections.size).to.equal(0);
    expect(post.faderScope).to.include('lane-gain-pan-mute-solo');
    first.dispose(); unrelated.dispose(); pre.release(); post.release(); await f.buses.dispose().completion;
    expect(f.resources.diagnostics().reservations).to.equal(0); await f.resources.dispose().completion;
  });
  it('shares a donor across staged graphs and invalidates each consumer before lane deletion or epoch retirement', async () => {
    const f = fixture(), events = [], producer = f.buses.registerRenderer({ attach: bus => events.push(['attach', bus.laneId]), detach: bus => events.push(['detach', bus.laneId]) });
    f.buses.declare(['donor']); const first = f.pin('donor'), second = f.pin('donor', 'pre-fader');
    first.onUnavailable(() => events.push(['missing', 'first'])); second.onUnavailable(() => events.push(['missing', 'second']));
    first.release(); expect(second.isActive()).to.equal(true); expect(events).to.deep.equal([['attach', 'donor']]);
    f.buses.declare([]); expect(second.isActive()).to.equal(false); expect(f.pin('donor')).to.equal(null);
    expect(events.findIndex(event => event[0] === 'missing')).to.be.lessThan(events.findIndex(event => event[0] === 'detach'));
    second.release(); producer(); await f.buses.dispose().completion; expect(f.resources.diagnostics().reservations).to.equal(0); await f.resources.dispose().completion;
  });
  it('admits eight distinct donor lanes and refuses another before allocating its native nodes', async () => {
    const f = fixture(), ids = Array.from({ length: LIVE_LANE_TAP_LIMIT + 1 }, (_, index) => 'lane-' + index); f.buses.declare(ids);
    const pins = ids.slice(0, -1).map(id => f.pin(id)), before = f.resources.diagnostics().reservations;
    expect(() => f.pin(ids.at(-1))).to.throw('Eight distinct'); expect(f.resources.diagnostics().reservations).to.equal(before);
    pins[0].release(); const replacement = f.pin(ids.at(-1)); expect(replacement.isActive()).to.equal(true);
    for (const pin of pins) pin.release(); replacement.release(); await f.buses.dispose().completion; await f.resources.dispose().completion;
  });
  for (const rate of [44100, 48000, 96000]) it('renders exact pre/post lane stems at ' + rate + ' Hz and rejects reused slot ancestry', () => {
    const kernel = new OwnedSineKernel(rate, 1), command = new Float64Array(WIDTH);
    command.set([1, 0, 1, BEGIN, 0, 9, 440, 0.5, 1, 0, 1, 0, 1, 100, 1.25, 0, rate, 1]); kernel.accept(command, 1, 1);
    const left = new Float32Array(128), right = new Float32Array(128), pair = () => [new Float32Array(128), new Float32Array(128)];
    const taps = { routes: new Int8Array([0]), tokens: new Uint32Array([9]), channels: [pair()], preChannels: [pair()] };
    kernel.render(left, right, 0, taps);
    for (let index = 1; index < left.length; index++) {
      expect(taps.channels[0][0][index]).to.equal(left[index]); expect(taps.channels[0][1][index]).to.equal(right[index]);
      expect(taps.preChannels[0][0][index] * 0.25).to.be.closeTo(left[index], 1e-7);
    }
    taps.tokens[0] = 8; kernel.render(left, right, 128, taps);
    expect(taps.channels[0][0].every(sample => sample === 0)).to.equal(true); expect(taps.preChannels[0][0].every(sample => sample === 0)).to.equal(true);
    expect(left.some(sample => sample !== 0)).to.equal(true);
  });
});
