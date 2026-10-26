import { expect } from 'chai';
import { WindModalKernel, WIND_STATE as S } from '../../js/app/midi-ui/worklet/WindModalKernel.js';
import { prepareWindModel, WIND_MODEL_KINDS, WIND_MODEL_LIMITS as L } from '../../js/midi/content/WindModel.js';

const create = (rate, kind = 0, extra = {}) => { const p = prepareWindModel({ kind: WIND_MODEL_KINDS[kind], ...extra }, rate), source = new WindModalKernel(rate); expect(source.begin(kind, kind === 1 ? 440 : 220, 12345, p.air01, p.bite01, p.lengthRatio, p.leak01, p.bell01, 0)).to.equal(true); return source; };
const render = (source, count) => { const values = new Float64Array(count * 2), first = source.state[S.lastFrame] + 1; for (let index = 0; index < count; index++) { source.sample(first + index); values[index * 2] = source.leftSample; values[index * 2 + 1] = source.rightSample; } return values; };
describe('original sealed modal wind foundation (numerical/tone/device qualification deferred)', () => {
  for (const rate of [44100, 48000, 96000]) for (let kind = 0; kind < 3; kind++) it('retains bounded port work and positive modal loss at ' + rate + '/' + kind, () => {
    const source = create(rate, kind), values = render(source, Math.ceil(rate * 0.25)), d = source.diagnostics(); expect(values.every(Number.isFinite)).to.equal(true); expect(values.some(value => value !== 0)).to.equal(true); expect(d.faults).to.equal(0); expect(d.uniqueRootSlopeProduct).to.be.lessThan(0.25); expect(d.linearLoss).to.be.at.least(0); expect(Math.abs(d.energy + d.linearLoss - d.inputWork)).to.be.lessThan(1e-8 * (1 + Math.abs(d.inputWork))); expect(d.nonlinearIterations).to.be.at.most(Math.ceil(rate * 0.25) * L.iterations);
  });
  it('cannot replenish energy at zero expression pressure and keeps positive body relaxation', () => {
    const source = create(48000); expect(source.setPressure(0)).to.equal(true); expect(render(source, 4096).every(value => value === 0)).to.equal(true); expect(source.state[S.inputWork]).to.equal(0);
    source.setPressure(1); render(source, 12000); source.setPressure(0); render(source, 4096); const work = source.state[S.inputWork], energy = source.state[S.energy]; render(source, 4096); expect(source.state[S.inputWork]).to.equal(work); expect(source.state[S.energy]).to.be.lessThan(energy); expect(source.state[S.faults]).to.equal(0);
  });
  it('releases breath through its actual frontier and retains the declared body tail', () => {
    for (const kind of [0, 1, 2]) { const source = create(48000, kind); render(source, 12000); source.end(12000); expect(source.setPressure(1)).to.equal(false); expect(source.end(12000)).to.equal(false); render(source, 15000); const work = source.state[S.inputWork], energy = source.state[S.energy]; render(source, 2000); expect(source.state[S.inputWork]).to.equal(work); expect(source.state[S.energy]).to.be.at.most(energy); expect(source.state[S.faults]).to.equal(0); }
  });
  it('retains exact partition-independent state and seeded breath without an extra onset', () => {
    const whole = create(48000), split = create(48000), expected = render(whole, 12000), a = render(split, 4097), b = render(split, 7903), joined = new Float64Array(expected.length); joined.set(a); joined.set(b, a.length); expect(joined).to.deep.equal(expected); expect(split.state).to.deep.equal(whole.state); expect(split.modes).to.deep.equal(whole.modes);
  });
  it('uses threshold hysteresis with one energy-preserving register change per owned gesture', () => {
    const source = create(48000, 2, { air01: 0.55 }); source.setPressure(0.5); render(source, 8000); expect(source.state[S.registerTransitions]).to.equal(0); source.setPressure(1); render(source, 8000); expect(source.state[S.registerTransitions]).to.equal(1); expect(source.state[S.highRegister]).to.equal(1); const tokenOnset = source.state[S.onset]; source.setPressure(0); render(source, 8000); source.setPressure(1); render(source, 8000); expect(source.state[S.registerTransitions]).to.equal(1); expect(source.state[S.onset]).to.equal(tokenOnset); expect(source.state[S.faults]).to.equal(0); expect(Math.abs(source.state[S.energy] + source.state[S.linearLoss] - source.state[S.inputWork])).to.be.lessThan(1e-7);
  });
  it('rejects unsupported domains, discontinuous frames and aliased/shared storage', () => {
    expect(() => new WindModalKernel(22050)).to.throw(); expect(() => prepareWindModel({ air01: 0.1 })).to.throw(); expect(() => prepareWindModel({ kind: 'air-pipe', bite01: 0.7 })).to.throw(); expect(() => prepareWindModel({ lengthRatio: 100 })).to.throw(); const source = create(48000); expect(source.begin(2, 660, 1, 0.4, 0.5, 1, 0.2, 0.35, 0)).to.equal(false); expect(source.setPressure(-1)).to.equal(false); expect(() => source.sample(1)).to.throw(); expect(() => source.end(2)).to.throw(); const buffer = new ArrayBuffer(4096); expect(() => new WindModalKernel(48000, { state: new Float64Array(buffer, 0, L.state), modes: new Float64Array(buffer, 0, L.modes * L.modeWidth) })).to.throw(); if (typeof SharedArrayBuffer === 'function') expect(() => new WindModalKernel(48000, { state: new Float64Array(new SharedArrayBuffer(L.state * 8)) })).to.throw();
  });
  it('contains corrupt energy independently before output', () => { const bad = create(48000), good = create(48000); render(bad, 4096); render(good, 4096); bad.state[S.energy] = L.maximumEnergy * 2; render(bad, 1); expect(bad.state[S.faults]).to.equal(1); expect(bad.leftSample).to.equal(0); expect(bad.modes.every(value => value === 0)).to.equal(true); render(good, 128); expect(good.state[S.faults]).to.equal(0); });
});
