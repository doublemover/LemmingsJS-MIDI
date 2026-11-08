import { expect } from 'chai';
import { modalAmplitudeAt, planNativeModalSource, createNativeModalSourceOwner } from '../../js/app/midi-ui/NativeModalSource.js';
import { NATIVE_MODAL_PARAMETERS } from '../../js/app/midi-ui/NativeInstrumentSchema.js';

const parameters = overrides => ({ ...Object.fromEntries(Object.entries(NATIVE_MODAL_PARAMETERS).map(([id, spec]) => [id, spec.default])), ...overrides });
const fixture = () => {
  const sources = [], gains = []; let failed = null;
  const param = () => ({ events: [], setValueAtTime(value, at) { this.events.push(['set', value, at]); },
    exponentialRampToValueAtTime(value, at) { this.events.push(['exponential', value, at]); }, linearRampToValueAtTime(value, at) { this.events.push(['linear', value, at]); }, cancelScheduledValues() {} });
  const node = () => ({ targets: [], disconnects: 0, connect(target) { this.targets.push(target); }, disconnect() { this.disconnects++; if (this === failed) throw new Error('Unknown native disconnection'); this.targets.length = 0; } });
  const context = { createOscillator() { const source = Object.assign(node(), { frequency: param(), detune: param(), starts: [], stops: [], start(at) { this.starts.push(at); }, stop(at) { this.stops.push(at); } }); sources.push(source); return source; },
    createGain() { const gain = Object.assign(node(), { gain: param() }); gains.push(gain); return gain; } };
  return { context, sources, gains, fail: source => { failed = source; } };
};
describe('owned authored modal sine bank', () => {
  it('defines amplitude T60 in seconds without a frequency or 2π factor', () => {
    for (const t60 of [0.08, 0.32, 1.8, 2.5]) { expect(modalAmplitudeAt(t60, t60)).to.be.closeTo(0.001, 1e-15); expect(modalAmplitudeAt(t60 * 2, t60)).to.be.closeTo(0.000001, 1e-18); }
    expect(() => modalAmplitudeAt(1, 0)).to.throw('positive T60');
  });
  it('plans bounded modes with fixed onset gain normalization and rate-aware omissions', () => {
    const p = parameters({ modeCount: 8, mode4GainA: 0.2, mode5GainA: 0.1, mode6GainA: 0.1, mode7GainA: 0.1 });
    const plan = planNativeModalSource({ fundamentalHz: 440, sampleRate: 48000, parameters: p });
    expect(plan.sourceCost).to.equal(8); expect(plan.modes.reduce((sum, mode) => sum + mode.gain01, 0)).to.be.closeTo(1, 1e-12);
    const high = planNativeModalSource({ fundamentalHz: 4000, sampleRate: 44100, parameters: p }); expect(high.sourceCost).to.be.lessThan(8); expect(high.omittedModes.length).to.be.greaterThan(0);
    expect(high.modes.every(mode => mode.frequencyHz * 2 ** (200 / 1200) < 44100 * 0.4)).to.equal(true);
    expect(plan.quality).to.equal('native-sine-bank-register-taper-not-render-qualified');
  });
  it('owns every child, schedules exact exponential decay and retires all children after a failure', () => {
    const f = fixture(), plan = planNativeModalSource({ fundamentalHz: 440, sampleRate: 48000, parameters: parameters() });
    const owner = createNativeModalSourceOwner(f.context, plan, 1); expect(f.sources).to.have.length(0); owner.prepare();
    expect(f.sources).to.have.length(4); const mode = plan.modes[0]; expect(f.gains[1].gain.events).to.deep.equal([
      ['set', mode.gain01, 1], ['exponential', mode.gain01 * 0.000001, 1 + mode.modeT60Seconds * 2] ]);
    owner.detune.linearRampToValueAtTime(100, 2); owner.start(1); owner.stop(4); owner.stop(5);
    expect(f.sources.every(source => source.starts[0] === 1 && source.stops.join(',') === '4,5')).to.equal(true);
    f.fail(f.sources[1]); expect(() => owner.disconnect()).to.throw('unresolved'); expect(f.sources.every(source => source.disconnects === 1)).to.equal(true);
    expect(f.gains.every(gain => gain.disconnects === 1)).to.equal(true); expect(() => owner.disconnect()).to.throw('unresolved'); expect(f.sources[1].disconnects).to.equal(1);
  });
});
