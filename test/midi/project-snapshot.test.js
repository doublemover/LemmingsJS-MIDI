import { expect } from 'chai';
import { sealMidiProjectSnapshot, isSealedMidiProjectNode } from '../../js/midi/project/MidiProjectSnapshot.js';

describe('immutable authored project publication', () => {
  it('seals descendants and reuses previously verified subtrees without cloning', () => {
    const initial = sealMidiProjectSnapshot({ procgen: { lanes: [{ instrumentRef: null, patterns: [{ steps: [{ enabled: false }] }] }] } });
    const lane = initial.procgen.lanes[0]; expect(isSealedMidiProjectNode(lane.patterns[0].steps[0])).to.equal(true);
    expect(() => { lane.patterns[0].steps[0].enabled = true; }).to.throw(TypeError);
    const next = sealMidiProjectSnapshot({ ...initial, name: 'next' }); expect(next.procgen).to.equal(initial.procgen);
    expect(isSealedMidiProjectNode(Object.freeze({ child: {} }))).to.equal(false);
  });
  it('rejects accessors, cycles, hidden hooks and binary/mutable class instances', () => {
    const cycle = {}; cycle.self = cycle;
    const hidden = {}; Object.defineProperty(hidden, 'toJSON', { value: () => ({ changed: true }) });
    for (const value of [cycle, hidden, new Uint8Array(4), new Date(), { get state() { throw new Error('must not invoke'); } }]) expect(() => sealMidiProjectSnapshot(value)).to.throw();
  });
});
