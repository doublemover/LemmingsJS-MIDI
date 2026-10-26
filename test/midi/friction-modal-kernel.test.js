import { expect } from 'chai';
import { FrictionModalKernel } from '../../js/app/midi-ui/worklet/FrictionModalKernel.js';
import { FRICTION_MODEL_KINDS, FRICTION_MODEL_LIMITS as L, prepareFrictionModel } from '../../js/midi/content/FrictionModel.js';

const begin = (kernel, kind = 0, speed = 120, seconds = 0.25, onset = 0, first = onset) => {
  const count = Math.round(kernel.rate * seconds), pressure = [0.4, 0.25, 0.5][kind];
  return kernel.begin(kind, 220, 1234, 0.5, pressure, 0.18, 0.12, 0, speed * seconds, first, first + count, onset);
};
describe('original sealed modal friction foundation (integration and qualification deferred)', function() {
  this.timeout(30000);
  for (const rate of [44100, 48000, 96000]) for (let kind = 0; kind < 3; kind++) it('accounts input work, friction and linear loss for ' + FRICTION_MODEL_KINDS[kind] + ' at ' + rate, () => {
    const kernel = new FrictionModalKernel(rate); expect(begin(kernel, kind)).to.equal(true);
    for (let frame = 0; frame < Math.round(rate * 0.25); frame++) { kernel.sample(frame); expect(Number.isFinite(kernel.leftSample) && Number.isFinite(kernel.rightSample)).to.equal(true); }
    const view = kernel.diagnostics(); expect(view.faults).to.equal(0); expect(view.uniqueRootSlopeProduct).to.be.lessThan(0.5); expect(view.nonlinearIterations).to.equal(Math.round(rate * 0.25) * L.iterations); expect(view.energy).to.be.greaterThan(0); expect(view.frictionLoss).to.be.at.least(0); expect(view.linearLoss).to.be.at.least(0);
    expect(Math.abs(view.energy + view.frictionLoss + view.linearLoss - view.inputWork)).to.be.lessThan(1e-6); expect(view.peak).to.be.at.most(32); expect(view.modeCount).to.equal(kind === 1 ? 6 : 12);
  });
  for (let kind = 0; kind < 3; kind++) it('creates no energy or autonomous texture for a stationary ' + FRICTION_MODEL_KINDS[kind], () => {
    const kernel = new FrictionModalKernel(48000); expect(begin(kernel, kind, 0)).to.equal(true);
    for (let frame = 0; frame < 12000; frame++) { kernel.sample(frame); expect(kernel.leftSample).to.equal(0); expect(kernel.rightSample).to.equal(0); }
    expect(kernel.diagnostics()).to.include({ energy: 0, inputWork: 0, nonlinearIterations: 0, faults: 0 });
  });
  it('removes bow input work at rest and preserves a positive-loss body tail', () => {
    const kernel = new FrictionModalKernel(48000); expect(begin(kernel, 1, 120, 0.1)).to.equal(true); for (let frame = 0; frame < 4800; frame++) kernel.sample(frame);
    const work = kernel.diagnostics().inputWork; let prior = kernel.diagnostics().energy, tail = 0;
    for (let frame = 4800; frame < 24000; frame++) { kernel.sample(frame); expect(kernel.diagnostics().energy).to.be.at.most(prior + 1e-10); prior = kernel.diagnostics().energy; tail = Math.max(tail, Math.abs(kernel.leftSample), Math.abs(kernel.rightSample)); }
    expect(kernel.diagnostics().inputWork).to.equal(work); expect(kernel.diagnostics().faults).to.equal(0); expect(tail).to.be.greaterThan(0);
  });
  it('keeps pressure changes passive at rest and closes contact at the actual source frontier', () => {
    const kernel = new FrictionModalKernel(48000); expect(begin(kernel, 0, 120, 0.05)).to.equal(true); for (let frame = 0; frame < 2400; frame++) kernel.sample(frame);
    const work = kernel.diagnostics().inputWork; expect(kernel.setPressure(0)).to.equal(true); expect(kernel.end(2400)).to.equal(true); expect(kernel.end(2400)).to.equal(false); expect(() => kernel.end(2500)).to.throw('frontier');
    for (let frame = 2400; frame < 5000; frame++) kernel.sample(frame); expect(kernel.diagnostics().inputWork).to.equal(work); expect(kernel.diagnostics().faults).to.equal(0); expect(kernel.setSpan(6, 8, 5000, 6000)).to.equal(false);
  });
  it('observes reversal through one continuing feedback state without allocating another source', () => {
    const kernel = new FrictionModalKernel(48000); expect(begin(kernel, 2, 120, 0.1)).to.equal(true); const state = kernel.state, modes = kernel.modes;
    expect(kernel.setSpan(12, 0, 4800, 9600)).to.equal(false); for (let frame = 0; frame < 4800; frame++) kernel.sample(frame); expect(kernel.diagnostics().normalizedBowVelocity).to.be.greaterThan(0);
    expect(kernel.setSpan(12, 0, 4800, 9600)).to.equal(true); for (let frame = 4800; frame < 9600; frame++) kernel.sample(frame);
    expect(kernel.state).to.equal(state); expect(kernel.modes).to.equal(modes); expect(kernel.diagnostics().normalizedBowVelocity).to.be.lessThan(0); expect(kernel.diagnostics().faults).to.equal(0);
  });
  it('is independent of render partition and remains silent before an admitted future motion span', () => {
    const a = new FrictionModalKernel(44100), b = new FrictionModalKernel(44100); expect(begin(a, 0, 100, 0.1, 0, 73)).to.equal(true); expect(begin(b, 0, 100, 0.1, 0, 73)).to.equal(true);
    const samples = new Float64Array(5000); for (let frame = 0; frame < samples.length; frame++) { a.sample(frame); samples[frame] = a.leftSample; if (frame < 73) expect(samples[frame]).to.equal(0); }
    for (let first = 0; first < samples.length;) { const end = Math.min(samples.length, first + (first % 131) + 1); for (let frame = first; frame < end; frame++) { b.sample(frame); expect(b.leftSample).to.equal(samples[frame]); } first = end; }
    expect(b.state).to.deep.equal(a.state); expect(b.modes).to.deep.equal(a.modes);
  });
  it('rejects unsafe dimensions, aliases, pressure/pitch domains and nonphysical source spans without changing an active model', () => {
    expect(() => new FrictionModalKernel(32000)).to.throw(); const backing = new ArrayBuffer(2048); expect(() => new FrictionModalKernel(48000, { state: new Float64Array(backing, 0, L.state), modes: new Float64Array(backing, 0, L.modes * L.modeWidth) })).to.throw();
    const kernel = new FrictionModalKernel(48000); expect(begin(kernel)).to.equal(true); const before = kernel.state.slice(); expect(kernel.begin(0, 80, 1234, 0.5, 0.4, 0.18, 0.12, 0, 10, 0, 4800)).to.equal(false); expect(kernel.state).to.deep.equal(before);
    expect(kernel.validSpan(0, 1000, 0, 1)).to.equal(false); expect(kernel.validSpan(0, 1, 0, 96001)).to.equal(false); expect(kernel.setPressure(NaN)).to.equal(false); expect(() => kernel.sample(4)).to.throw('contiguous');
    for (const kind of FRICTION_MODEL_KINDS) { const profile = prepareFrictionModel({ kind }); expect(profile.maximumForceSlopeProduct).to.be.lessThan(0.5); expect(profile.qualification).to.include('pending'); }
    expect(() => prepareFrictionModel({ kind: 'violin-emulation' })).to.throw(); expect(() => prepareFrictionModel({ pressure01: 0.9 })).to.throw();
  });
  it('contains a corrupt energy state without changing an independent same-pitch source', () => {
    const first = new FrictionModalKernel(48000), second = new FrictionModalKernel(48000); begin(first); begin(second); first.modes[0] = NaN; first.sample(0); second.sample(0); expect(first.diagnostics().faults).to.equal(1); expect(first.diagnostics().active).to.equal(false); expect(first.leftSample).to.equal(0); expect(second.diagnostics().faults).to.equal(0); expect(second.diagnostics().active).to.equal(true);
  });
});
