import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { Range } from '../js/Range.js';

globalThis.lemmings = Lemmings;

describe('Range', function() {
  it('initializes fields to zero', function() {
    const r = new Range();
    expect(r.x).to.equal(0);
    expect(r.y).to.equal(0);
    expect(r.width).to.equal(0);
    expect(r.height).to.equal(0);
    expect(r.direction).to.equal(0);
  });
});
