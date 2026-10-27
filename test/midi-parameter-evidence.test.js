import { expect } from 'chai';
import { createMidiParameterEvidence } from '../js/app/procgen/workstation/MidiParameterEvidence.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';

const target = (scope = 'document:1:output:A:epoch:1:channel:1', parameter = 'sustain') => ({ key: scope + ':' + parameter, parameter });
describe('target-bound MIDI parameter request evidence', () => {
  it('retains a submitted sustain request through reads without claiming receiver state or an implicit reset', () => {
    const store = createMidiParameterEvidence();
    try {
      expect(store.read(null)).to.include({ targetKey: null, requestedValue: null, delivery: 'unknown' });
      expect(store.read(target())).to.include({ requestedValue: null, submittedValue: null, receiverValue: null, delivery: 'unknown' });
      const request = store.request(target(), 127, 100); expect(store.read(target())).to.include({ requestedValue: 127, submittedValue: null, delivery: 'requested' });
      expect(store.settle(request, true, 110)).to.equal(true); const value = store.read(target());
      expect(value).to.include({ requestedValue: 127, submittedValue: 127, receiverValue: null, delivery: 'submitted' }); expect(store.read(target())).to.equal(value); expect(Object.isFrozen(value)).to.equal(true);
      for (const scope of ['document:2:output:A:epoch:1:channel:1', 'document:1:output:B:epoch:1:channel:1', 'document:1:output:A:epoch:2:channel:1', 'document:1:output:A:epoch:1:channel:2'])
        expect(store.read(target(scope)).requestedValue).to.equal(null);
    } finally { store.dispose(); }
  });
  it('does not allow a late acknowledgement to confirm a newer request and retains an earlier actual submission separately', () => {
    const store = createMidiParameterEvidence();
    try {
      const first = store.request(target(), 127, 1); store.settle(first, true, 2);
      const next = store.request(target(), 0, 3); expect(store.settle(first, true, 4)).to.equal(false); store.settle(next, false, 5);
      expect(store.read(target())).to.include({ requestedValue: 0, submittedValue: 127, receiverValue: null, delivery: 'unconfirmed' });
    } finally { store.dispose(); }
  });
  it('bounds retained evidence and leaves an evicted target unknown rather than zero', () => {
    const store = createMidiParameterEvidence({ maximumEntries: 2 });
    try {
      for (let index = 0; index < 100; index++) store.request(target('route-' + index), index % 128, index);
      expect(store.diagnostics()).to.include({ entries: 2, evicted: 98 }); expect(store.read(target('route-0')).requestedValue).to.equal(null);
    } finally { store.dispose(); }
  });
  it('admits storage before publishing a request, rejects invalid values and releases its owned reservation', () => {
    const budget = createResourceBudget({ limitBytes: 16384, costFactors: { checkpoint: 1 } }), store = createMidiParameterEvidence({ resourceBudget: budget, maximumEntries: 2 });
    expect(budget.diagnostics().residentBytes).to.equal(0); expect(() => store.request(target(), 128, 0)).to.throw('Invalid MIDI parameter'); expect(budget.diagnostics().residentBytes).to.equal(0);
    store.request(target(), 127, 0); expect(budget.diagnostics().residentBytes).to.equal(8192); store.dispose(); store.dispose(); expect(budget.diagnostics().residentBytes).to.equal(0);
    expect(() => store.request(target(), 1, 1)).to.throw('unavailable');
  });
  it('refuses a denied reservation without retaining a request or interpreting it as submitted', () => {
    const budget = createResourceBudget({ limitBytes: 4096 }), store = createMidiParameterEvidence({ resourceBudget: budget, maximumEntries: 2 });
    try { expect(() => store.request(target(), 127, 0)).to.throw(); expect(store.read(target())).to.include({ requestedValue: null, submittedValue: null }); expect(store.diagnostics().entries).to.equal(0); }
    finally { store.dispose(); }
  });
  it('cannot reuse one scope key to display or overwrite another parameter', () => {
    const store = createMidiParameterEvidence();
    try {
      const sustain = target(), pressure = { ...sustain, parameter: 'pressure' }; store.request(sustain, 127, 0);
      expect(store.read(pressure).requestedValue).to.equal(null); expect(() => store.request(pressure, 64, 1)).to.throw('identity collision');
      expect(store.read(sustain).requestedValue).to.equal(127);
    } finally { store.dispose(); }
  });
});
