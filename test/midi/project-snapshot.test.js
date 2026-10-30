import { expect } from 'chai';
import { sealMidiProjectSnapshot, copyMidiProjectSnapshot, isSealedMidiProjectNode } from '../../js/midi/project/MidiProjectSnapshot.js';

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
    for (const value of [cycle, hidden, new Uint8Array(4), new Date(), { get state() { throw new Error('must not invoke'); } }]) {
      expect(() => sealMidiProjectSnapshot(value)).to.throw(); expect(() => copyMidiProjectSnapshot(value)).to.throw();
    }
  });
  it('copies mutable authored trees without freezing their input and preserves verified shared subtrees', () => {
    const child = { value: 1 }, input = { a: child, b: child, kept: sealMidiProjectSnapshot({ value: 2 }) }, copy = copyMidiProjectSnapshot(input);
    expect(copy).not.to.equal(input); expect(copy.a).not.to.equal(child); expect(copy.a).to.equal(copy.b); expect(copy.kept).to.equal(input.kept);
    expect(Object.isFrozen(input)).to.equal(false); child.value = 9; expect(copy.a.value).to.equal(1); expect(isSealedMidiProjectNode(copy.a)).to.equal(true);
  });
  it('retains sparse array shape and null prototypes while refusing invalid scalars and depth', () => {
    const input = Object.create(null); input.rows = new Array(4); input.rows[2] = { value: -0 }; const copy = copyMidiProjectSnapshot(input);
    expect(Object.getPrototypeOf(copy)).to.equal(null); expect(copy.rows.length).to.equal(4); expect(0 in copy.rows).to.equal(false); expect(Object.is(copy.rows[2].value, -0)).to.equal(true);
    for (const value of [Infinity, () => {}, Symbol('invalid')]) expect(() => copyMidiProjectSnapshot({ value })).to.throw('scalar');
    let deep = {}; for (let index = 0; index < 50; index++) deep = { deep }; expect(() => copyMidiProjectSnapshot(deep)).to.throw('tree bound');
  });
});
