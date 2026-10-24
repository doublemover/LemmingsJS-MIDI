import { expect } from 'chai';
import { fmIndexToDeviation, planNativeFmSource, createNativeFmSourceOwner } from '../../js/app/midi-ui/NativeFmSource.js';
import { NATIVE_FM_PARAMETERS } from '../../js/app/midi-ui/NativeInstrumentSchema.js';
import { compileInstrumentPerformance } from '../../js/midi/content/InstrumentPerformance.js';

const parameters = overrides => ({ ...Object.fromEntries(Object.entries(NATIVE_FM_PARAMETERS).map(([id, spec]) => [id, spec.default])), ...overrides });
const contextFixture = () => {
  const sources = [], gains = []; let fault = null;
  const param = () => ({ events: [], setValueAtTime(value, time) { this.events.push(['set', value, time]); },
    linearRampToValueAtTime(value, time) { this.events.push(['ramp', value, time]); }, cancelScheduledValues(time) { this.events.push(['cancel', time]); } });
  const node = () => ({ targets: [], disconnects: 0, connect(target) { this.targets.push(target); }, disconnect() { this.disconnects++; if (fault === this) throw new Error('unknown child disconnection'); this.targets.length = 0; } });
  const source = () => Object.assign(node(), { frequency: param(), detune: param(), offset: param(), starts: [], stops: [], start(time) { this.starts.push(time); }, stop(time) { this.stops.push(time); } });
  const context = { createOscillator() { const value = source(); sources.push(value); return value; }, createConstantSource() { const value = source(); sources.push(value); return value; },
    createGain() { const value = Object.assign(node(), { gain: param() }); gains.push(value); return value; } };
  return { context, sources, gains, refuse: value => { fault = value; } };
};

describe('owned native two/four-operator FM source', () => {
  it('applies typed onset hardness to the actual child deviation AudioParam', () => {
    const performance = compileInstrumentPerformance({ parameters: parameters(), macros: [{ id: 'hardness', name: 'Hardness', mode: 'onset-only', default01: 0.5,
      smoothingMs: 0, perceptualDirection: 'Increase initial modulation depth.', targets: [{ parameter: 'indexStart', unit: 'dimensionless', minimum: 0, maximum: 4,
        curve: 'linear', composition: 'replace', clamp: true }] }] }, Object.values(NATIVE_FM_PARAMETERS));
    for (const amount of [0, 0.5, 1]) {
      const effective = performance.resolve({ macros: { hardness: amount } }, 48000), f = contextFixture();
      const plan = planNativeFmSource({ fundamentalHz: 440, sampleRate: 48000, parameters: effective.values });
      const source = createNativeFmSourceOwner(f.context, plan, 1); source.prepare();
      expect(f.gains[1].gain.events[0]).to.deep.equal(['set', amount * 4 * 880, 1]); source.disconnect();
    }
  });
  it('converts dimensionless index to Hz deviation and retains transposed index meaning', () => {
    expect(fmIndexToDeviation(3.5, 440 * 2.71)).to.be.closeTo(4173.4, 1e-9);
    const a = planNativeFmSource({ fundamentalHz: 440, sampleRate: 48000, parameters: parameters({ modulatorRatio: 2.71, indexStart: 3.5 }) });
    const b = planNativeFmSource({ fundamentalHz: 880, sampleRate: 48000, parameters: parameters({ modulatorRatio: 2.71, indexStart: 3.5 }) });
    expect(a.pairs[0].deviationStartHz / a.pairs[0].modulatorHz).to.equal(3.5); expect(b.pairs[0].deviationStartHz / a.pairs[0].deviationStartHz).to.equal(2);
    expect(() => fmIndexToDeviation(NaN, 440)).to.throw('bounds');
  });
  it('declares register-dependent index reduction without claiming measured alias rejection', () => {
    const plan = planNativeFmSource({ fundamentalHz: 2400, sampleRate: 44100, parameters: parameters({ indexStart: 8, indexEnd: 8, modulatorRatio: 2.71 }) });
    expect(plan.indexLimited).to.equal(true); expect(plan.quality).to.equal('conservative-sideband-estimate-not-spectral-qualified');
    expect(plan.pairs[0].indexStart).to.be.lessThan(8); expect(() => planNativeFmSource({ fundamentalHz: 16000, sampleRate: 44100, parameters: parameters() })).to.throw('register');
  });
  it('owns and reschedules every pair and pitch-settle source without creating another logical voice', () => {
    const f = contextFixture(), plan = planNativeFmSource({ fundamentalHz: 440, sampleRate: 48000,
      parameters: parameters({ dualPair: 1, secondaryMix01: 0.7, pitchSettleCents: 700 }) });
    const source = createNativeFmSourceOwner(f.context, plan, 1); expect(f.sources).to.have.length(0); source.prepare();
    expect(f.sources).to.have.length(5); expect(plan.sourceCost).to.equal(5);
    source.detune.setValueAtTime(100, 1); source.detune.linearRampToValueAtTime(-100, 1.5);
    expect(f.sources.slice(0, 4).every(node => node.detune.events.some(event => event[0] === 'ramp' && event[1] === -100))).to.equal(true);
    source.start(1); source.stop(5); source.stop(7); expect(f.sources.every(node => node.starts.length === 1 && node.stops.join(',') === '5,7')).to.equal(true);
    source.disconnect(); expect(f.sources.every(node => node.targets.length === 0)).to.equal(true); expect(f.gains.every(node => node.targets.length === 0)).to.equal(true);
  });
  it('attempts every child disconnection and caches unknown retirement without blindly retrying', () => {
    const f = contextFixture(), source = createNativeFmSourceOwner(f.context, planNativeFmSource({ fundamentalHz: 440, sampleRate: 48000, parameters: parameters({ dualPair: 1, secondaryMix01: 0.5 }) }), 0);
    source.prepare(); f.refuse(f.sources[1]); expect(() => source.disconnect()).to.throw('unresolved');
    expect(f.sources.every(node => node.disconnects === 1)).to.equal(true); expect(f.gains.every(node => node.disconnects === 1)).to.equal(true);
    expect(() => source.disconnect()).to.throw('unresolved'); expect(f.sources[1].disconnects).to.equal(1);
  });
});
